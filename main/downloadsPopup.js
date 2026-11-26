'use strict';

// Стеклянный попап «Загрузки» (WebContentsView) вместо нативного Menu.
// Устроен как попап главного меню: отдельный view поверх страниц, закрытие по blur / Escape / смене вкладки,
// сообщения принимаются только от собственного webContents (isSender).
//
// Безопасность попапа:
//  - HTML грузится из data: URL, CSP задана в <meta>: скрипт и стили только по одноразовому nonce,
//    сеть, изображения, фреймы, формы и <base> запрещены;
//  - отдельная in-memory сессия: все запросы кроме data: отменяются, разрешения всегда отклоняются;
//  - sandbox + contextIsolation, без devTools, навигация и window.open запрещены;
//  - в рендерер уходят только id, имена, статусы и проценты — пути к файлам остаются в main,
//    действия приходят как (тип из белого списка, числовой id).

const path = require('path');
const crypto = require('crypto');
const { WebContentsView, session } = require('electron');

const PANEL_W = 364;
const PAD_X = 14; // место под тень слева/справа (view прозрачный)
const PAD_TOP = 4;
const PAD_BOTTOM = 18;
const VIEW_W = PANEL_W + PAD_X * 2;
const MIN_PANEL_H = 96;
const MAX_PANEL_H = 560;
const REOPEN_GUARD_MS = 300; // клик по кнопке закрывает попап через blur, повторное открытие в этот момент не нужно
const FOCUS_GRACE_MS = 150; // сразу после показа blur не закрывает попап (фокус ещё «перетягивается»)
const REVEAL_FALLBACK_MS = 160;
const IDLE_DESTROY_MS = 150000; // как у главного меню: без открытий 2,5 минуты — освобождаем процесс
const PARTITION = 'downloads-popup'; // без «persist:» — в памяти

const ACTIONS_WITH_ID = new Set(['open', 'show', 'cancel', 'retry', 'delete-blocked', 'keep-blocked']);
const ACTIONS_NO_ID = new Set(['clear', 'open-folder', 'open-page']);
const THEME_ID_RE = /^[a-z0-9-]{1,40}$/;

const lockedSessions = new WeakSet();

function lockSession(ses) {
  if (!ses || lockedSessions.has(ses)) return;
  lockedSessions.add(ses);
  ses.webRequest.onBeforeRequest((details, cb) => cb({ cancel: !/^data:/i.test(details.url) }));
  ses.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

class DownloadsPopup {
  constructor({
    win, downloads, isIncognito, getSession, getResolvedTheme, getChromeTheme, getCustomCss, onShortcut, onOpenFullPage, onClose
  }) {
    this.win = win;
    this.downloads = downloads;
    this.isIncognito = typeof isIncognito === 'function' ? isIncognito : () => false;
    this.getSession = typeof getSession === 'function' ? getSession : () => null; // сессия окна Инкогнито (изоляция списка)
    this._idleTimer = null;
    this.getResolvedTheme = getResolvedTheme || (() => 'dark');
    this.getChromeTheme = getChromeTheme || (() => 'cyber-blue');
    this.getCustomCss = getCustomCss || (() => '');
    this.onShortcut = typeof onShortcut === 'function' ? onShortcut : null;
    this.onOpenFullPage = typeof onOpenFullPage === 'function' ? onOpenFullPage : null;
    this.onClose = typeof onClose === 'function' ? onClose : null;

    this.view = null;
    this.visible = false;
    this.rect = null;

    this._ready = null;
    this._showToken = 0;
    this._shownAt = 0;
    this._hiddenAt = 0;
    this._hiddenByBlur = false;
    this._awaitLayout = false;
    this._revealTimer = null;
    this._panelH = 0;
    this._lastBounds = null;
    this._lastKey = '';
    this._refreshing = false;
    this._refreshAgain = false;
    this._appliedCss = '';
    this._cssKey = null;
    this._destroyed = false;
  }

  _alive() {
    return !this._destroyed && this.win && !this.win.isDestroyed() &&
      this.view && !this.view.webContents.isDestroyed();
  }

  isSender(event) {
    if (!this.view || this.view.webContents.isDestroyed()) return false;
    return event.sender === this.view.webContents && event.senderFrame === event.sender.mainFrame;
  }

  // ---- Создание view ----
  _ensureView() {
    if (this.view && !this.view.webContents.isDestroyed()) return;
    const nonce = crypto.randomBytes(16).toString('base64');
    const ses = session.fromPartition(PARTITION);
    lockSession(ses);

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'downloadsPopupPreload.js'),
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        devTools: false,
        spellcheck: false,
        navigateOnDragDrop: false
      }
    });
    try { view.setBackgroundColor('#00000000'); } catch { /* старый Electron: фон останется по умолчанию */ }
    view.setVisible(false);
    this.view = view;
    this._lastKey = '';
    this._lastBounds = null;
    this._appliedCss = '';
    this._cssKey = null;

    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('will-redirect', (e) => e.preventDefault());
    wc.on('will-attach-webview', (e) => e.preventDefault());
    wc.on('before-input-event', (event, input) => this._onInput(event, input));
    wc.on('blur', () => this._onBlur());
    wc.on('render-process-gone', () => {
      this.hide();
      this._destroyView();
    });

    this._ready = new Promise((resolve) => {
      wc.once('did-finish-load', resolve);
      wc.once('did-fail-load', resolve);
    });
    wc.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(buildHtml(nonce), 'utf8').toString('base64')}`)
      .catch(() => {});
  }

  _destroyView() {
    const view = this.view;
    this.view = null;
    this._ready = null;
    if (!view) return;
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(view); } catch { /* уже снят */ }
    try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* уже закрыт */ }
  }

  // ---- Клавиши и потеря фокуса ----
  _onInput(event, input) {
    if (input.type !== 'keyDown' || !this.visible) return;
    if (input.key === 'Escape') {
      event.preventDefault();
      this.hide({ restoreFocus: true });
      return;
    }
    // Глобальные сочетания (Ctrl+T, Alt+← и т.п.) обрабатывает WindowManager; обычные клавиши — рендерер попапа
    if ((input.control || input.meta || input.alt || /^F\d{1,2}$/.test(input.key)) && this.onShortcut) {
      try { this.onShortcut(event, input); } catch { /* не критично */ }
    }
  }

  _onBlur() {
    if (!this.visible) return;
    if (Date.now() - this._shownAt < FOCUS_GRACE_MS) {
      // фокус только что был отдан попапу и тут же перехвачен (например, закрывающимся главным меню) — возвращаем
      setTimeout(() => { if (this.visible && this._alive()) this.view.webContents.focus(); }, 0);
      return;
    }
    this.hide({ byBlur: true });
  }

  // ---- Показ / скрытие ----
  toggle(rect) {
    if (this.visible) {
      this.hide({ restoreFocus: true });
      return;
    }
    if (this._hiddenByBlur && Date.now() - this._hiddenAt < REOPEN_GUARD_MS) return;
    this.show(rect).catch((err) => console.error('[downloads] Не удалось показать попап:', err));
  }

  _normalizeRect(rect) {
    const [cw] = this.win.getContentSize();
    const ok = (v) => typeof v === 'number' && Number.isFinite(v);
    if (rect && ok(rect.right) && ok(rect.bottom)) {
      return { left: ok(rect.left) ? rect.left : rect.right - 36, right: rect.right, bottom: rect.bottom };
    }
    return { left: cw - 80, right: cw - 44, bottom: 84 };
  }

  async show(rect) {
    if (this._destroyed || !this.win || this.win.isDestroyed()) return;
    const token = ++this._showToken;
    this.rect = this._normalizeRect(rect);
    clearTimeout(this._idleTimer);
    this._ensureView();
    await this._ready;
    if (token !== this._showToken || !this._alive()) return;
    const model = await this.downloads.getPopupModel(this._scope());
    if (token !== this._showToken || !this._alive()) return;

    const wc = this.view.webContents;
    this._syncCustomCss();
    this.visible = true;
    this._shownAt = Date.now();
    this._awaitLayout = true;
    this._lastKey = '';
    this._position(this._panelH || 220);
    this.view.setVisible(false); // покажем после первого замера высоты — без «прыжка» размера
    this.win.contentView.addChildView(this.view); // повторное добавление поднимает view поверх страниц
    wc.send('dlpopup:reset');
    this._sendState(model);
    clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(() => this._reveal(), REVEAL_FALLBACK_MS);
  }

  _reveal() {
    if (!this.visible || !this._alive() || !this._awaitLayout) return;
    this._awaitLayout = false;
    clearTimeout(this._revealTimer);
    this.view.setVisible(true);
    this.view.webContents.focus();
  }

  hide({ restoreFocus = false, byBlur = false } = {}) {
    this._showToken++; // отменяет показ, который ещё готовится
    clearTimeout(this._revealTimer);
    if (!this.visible) return;
    this.visible = false;
    this._awaitLayout = false;
    this._hiddenAt = Date.now();
    this._hiddenByBlur = byBlur;
    if (this.view && !this.view.webContents.isDestroyed()) {
      try { this.view.setVisible(false); } catch { /* view уничтожается */ }
      try { this.win.contentView.removeChildView(this.view); } catch { /* уже снят */ }
    }
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => { if (!this.visible) this._destroyView(); }, IDLE_DESTROY_MS);
    this._idleTimer.unref?.();
    if (this.onClose) {
      try { this.onClose({ restoreFocus }); } catch { /* не критично */ }
    }
  }

  // ---- Геометрия ----
  _maxPanelHeight(y) {
    const [, ch] = this.win.getContentSize();
    const top = typeof y === 'number' ? y : (this.rect ? this.rect.bottom + 2 : 0);
    return clamp(ch - top - PAD_TOP - PAD_BOTTOM - 6, MIN_PANEL_H, MAX_PANEL_H);
  }

  _position(panelHeight) {
    if (!this.win || this.win.isDestroyed() || !this.view || !this.rect) return;
    const [cw] = this.win.getContentSize();
    let x = Math.round(this.rect.right - PANEL_W - PAD_X);
    x = Math.max(0, Math.min(x, cw - VIEW_W));
    const y = Math.max(0, Math.round(this.rect.bottom + 2));
    const h = clamp(Math.ceil(panelHeight), MIN_PANEL_H, this._maxPanelHeight(y));
    if (h === this._panelH && this._lastBounds && this._lastBounds.x === x && this._lastBounds.y === y) return;
    this._panelH = h;
    this._lastBounds = { x, y };
    this.view.setBounds({ x, y, width: VIEW_W, height: h + PAD_TOP + PAD_BOTTOM });
  }

  resize(height) {
    if (!this.visible || !this._alive() || typeof height !== 'number' || !Number.isFinite(height)) return;
    this._position(height);
    if (this._awaitLayout) this._reveal();
  }

  // ---- Данные ----
  _themePayload() {
    const id = this.getChromeTheme();
    return {
      mode: this.getResolvedTheme() === 'light' ? 'light' : 'dark',
      id: typeof id === 'string' && THEME_ID_RE.test(id) ? id : 'cyber-blue'
    };
  }

  // Кастомная тема приходит CSS-строкой — вставляем её через insertCSS (CSP попапа это не затрагивает)
  _syncCustomCss() {
    if (!this._alive()) return;
    let css = '';
    try { css = String(this.getCustomCss() || ''); } catch { css = ''; }
    if (css === this._appliedCss) return;
    const wc = this.view.webContents;
    const old = this._cssKey;
    this._appliedCss = css;
    this._cssKey = null;
    if (old) wc.removeInsertedCSS(old).catch(() => {});
    if (css) {
      wc.insertCSS(css).then((key) => {
        if (this._appliedCss === css) this._cssKey = key;
        else wc.removeInsertedCSS(key).catch(() => {});
      }).catch(() => {});
    }
  }

  _sendState(model) {
    if (!this._alive()) return;
    this._syncCustomCss();
    const payload = { ...model, theme: this._themePayload(), maxHeight: this._maxPanelHeight() };
    const key = JSON.stringify(payload);
    if (key === this._lastKey) return;
    this._lastKey = key;
    this.view.webContents.send('dlpopup:state', payload);
  }

  // Вызывается при любом изменении загрузок или состояния окна (тема, активная вкладка…)
  async refresh() {
    if (!this.visible || !this._alive()) return;
    if (this._refreshing) {
      this._refreshAgain = true;
      return;
    }
    this._refreshing = true;
    try {
      do {
        this._refreshAgain = false;
        const model = await this.downloads.getPopupModel(this._scope());
        if (!this.visible || !this._alive()) break;
        this._sendState(model);
      } while (this._refreshAgain);
    } catch (err) {
      console.error('[downloads] Не удалось обновить попап:', err);
    } finally {
      this._refreshing = false;
    }
  }

  // ---- Действия из попапа ----
  handleAction(type, id) {
    if (typeof type !== 'string') return;
    if (ACTIONS_WITH_ID.has(type)) {
      if (!Number.isInteger(id)) return;
    } else if (!ACTIONS_NO_ID.has(type)) {
      return;
    }
    const d = this.downloads;
    const swallow = () => {};
    // Действия по id — только над записями этого окна (другое окно Инкогнито свои загрузки не отдаёт)
    if (ACTIONS_WITH_ID.has(type) && !d.canAccess(id, this._scope())) return;
    switch (type) {
      case 'open':
        d.openFile(id).then((ok) => { if (ok) this.hide(); else this.refresh(); }).catch(swallow);
        break;
      case 'show':
        d.showInFolder(id);
        this.hide();
        break;
      case 'cancel':
        d.cancel(id);
        break;
      case 'retry':
        d.retry(id);
        break;
      case 'delete-blocked':
        d.deleteBlocked(id).catch(swallow);
        break;
      case 'keep-blocked':
        this.hide();
        d.reviewBlocked(id);
        break;
      case 'clear':
        d.clearFinished(this._scope());
        break;
      case 'open-folder':
        d.openDownloadsFolder();
        this.hide();
        break;
      case 'open-page':
        this.hide();
        if (this.onOpenFullPage) this.onOpenFullPage();
        break;
      default:
        break;
    }
  }

  _scope() {
    return { incognito: this.isIncognito(), ses: this.getSession() };
  }

  destroy() {
    this._destroyed = true;
    clearTimeout(this._revealTimer);
    clearTimeout(this._idleTimer);
    this.visible = false;
    this._destroyView();
  }
}

// ---------------------------------------------------------------------------------------------
// Интерфейс попапа. Всё в одном data: документе; все тексты в DOM ставятся через textContent.
// ---------------------------------------------------------------------------------------------

const CSS = String.raw`
:root{
  color-scheme:dark;
  --accent:#4da3ff; --accent-ink:var(--accent);
  --text:#eef1f8; --muted:#a4adbf; --faint:#7d869a;
  --panel:rgba(20,22,32,.80);
  --border:rgba(255,255,255,.13); --hover:rgba(255,255,255,.07); --sel:rgba(255,255,255,.11);
  --track:rgba(255,255,255,.15); --btn:rgba(255,255,255,.08); --btn-h:rgba(255,255,255,.17);
  --danger:#ff7a85; --warn:#ffbe5c;
  --shadow:0 16px 40px rgba(0,0,0,.45);
  --max-h:520px;
}
:root[data-theme="light"]{
  color-scheme:light;
  --accent-ink:color-mix(in srgb,var(--accent) 62%,#000);
  --text:#161b27; --muted:#505a6c; --faint:#7a8396;
  --panel:rgba(255,255,255,.82);
  --border:rgba(25,35,70,.16); --hover:rgba(25,35,70,.06); --sel:rgba(25,35,70,.10);
  --track:rgba(25,35,70,.14); --btn:rgba(25,35,70,.07); --btn-h:rgba(25,35,70,.14);
  --danger:#c62839; --warn:#995a00;
  --shadow:0 14px 34px rgba(20,30,60,.26);
}
:root[data-chrome-theme="cyber-blue"]{--accent:#4da3ff}
:root[data-chrome-theme="nebula-violet"]{--accent:#a78bfa}
:root[data-chrome-theme="obsidian-chrome"]{--accent:#b9c2d0}
:root[data-chrome-theme="crimson-eclipse"]{--accent:#ff5a6e}
:root[data-chrome-theme="aurora-emerald"]{--accent:#34d399}
:root[data-chrome-theme="tokyo-synth"]{--accent:#ff4fd8}
:root[data-chrome-theme="sakura-midnight"]{--accent:#f59ac0}
:root[data-chrome-theme="solar-gold"]{--accent:#f5b72b}
:root[data-chrome-theme="silver-cosmos"]{--accent:#c7d0de}
:root[data-chrome-theme="aurora-voxel"]{--accent:#4fe0c8}
:root[data-chrome-theme="topo-noir"]{--accent:#98a2b3}
:root[data-chrome-theme="katana-noir"]{--accent:#ef4444}

*{box-sizing:border-box}
html,body{margin:0;height:100%;background:transparent;overflow:hidden;-webkit-user-select:none;user-select:none;
  font:13px/1.4 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;color:var(--text)}
body{padding:4px 14px 18px}
button{font:inherit;color:inherit}
#panel{width:364px;max-height:var(--max-h);display:flex;flex-direction:column;outline:none;
  border-radius:16px;border:1px solid var(--border);overflow:hidden;
  background:linear-gradient(160deg,color-mix(in srgb,var(--accent) 13%,transparent),transparent 46%),var(--panel);
  -webkit-backdrop-filter:blur(30px) saturate(1.6);backdrop-filter:blur(30px) saturate(1.6);
  box-shadow:var(--shadow),inset 0 1px 0 rgba(255,255,255,.10)}
#panel.in{animation:pop .14s ease-out}
@keyframes pop{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}

header{display:flex;align-items:center;gap:8px;padding:12px 12px 8px 16px}
header h1{margin:0;font-size:14px;font-weight:650;letter-spacing:.01em}
#summary{flex:1;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.btn{padding:3px 10px;border-radius:8px;border:1px solid var(--border);background:var(--btn);font-size:12px;
  line-height:1.5;cursor:pointer;white-space:nowrap}
.btn:hover:not(:disabled){background:var(--btn-h)}
.btn:disabled{opacity:.45;cursor:default}
.btn.primary{background:color-mix(in srgb,var(--accent) 24%,transparent);border-color:color-mix(in srgb,var(--accent) 48%,transparent)}
.btn.primary:hover{background:color-mix(in srgb,var(--accent) 36%,transparent)}
.btn.danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 40%,transparent)}
:focus-visible{outline:2px solid var(--accent);outline-offset:1px}

#list{list-style:none;margin:0;padding:2px 6px 6px;overflow-y:auto;flex:1 1 auto;min-height:0;scrollbar-width:thin}
#list[hidden],#empty[hidden],.note[hidden],.bar[hidden],.acts[hidden]{display:none}
.row{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;padding:9px 8px;border-radius:11px;outline:none;cursor:default}
.row.clickable{cursor:pointer}
.row:hover{background:var(--hover)}
.row:focus{background:var(--sel);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--accent) 70%,transparent)}
.badge{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;overflow:hidden;
  font-size:10px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;
  color:var(--accent-ink);background:color-mix(in srgb,var(--accent) 16%,transparent);
  border:1px solid color-mix(in srgb,var(--accent) 30%,transparent)}
.row.warn .badge{color:var(--warn);background:color-mix(in srgb,var(--warn) 16%,transparent);border-color:color-mix(in srgb,var(--warn) 36%,transparent)}
.row.danger .badge{color:var(--danger);background:color-mix(in srgb,var(--danger) 16%,transparent);border-color:color-mix(in srgb,var(--danger) 38%,transparent)}
.row.gone .name,.row.gone .badge{opacity:.55}
.body{min-width:0;display:flex;flex-direction:column;gap:3px}
.name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.note{display:flex;gap:6px;align-items:flex-start;font-size:12px;color:var(--warn)}
.row.danger .note{color:var(--danger)}
.note svg{flex:none;margin-top:2px}
.note span{min-width:0;white-space:normal;overflow-wrap:anywhere}
.bar{height:4px;border-radius:99px;background:var(--track);overflow:hidden;margin:2px 0}
.bar i{display:block;height:100%;width:0;border-radius:inherit;transition:width .25s ease;
  background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 60%,#fff))}
.bar.indet i{width:38%;transition:none;animation:slide 1.1s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-110%)}100%{transform:translateX(280%)}}
.acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:3px}

#empty{padding:26px 16px 30px;text-align:center;color:var(--muted)}
footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border-top:1px solid var(--border)}
.link{background:none;border:0;border-radius:8px;padding:5px 8px;cursor:pointer;font-size:12px;color:var(--accent-ink)}
.link:hover{background:var(--hover)}

@media (prefers-reduced-motion:reduce){
  #panel.in{animation:none}
  .bar i{transition:none}
  .bar.indet i{animation:none;width:100%;opacity:.45}
}
`;

const BODY = String.raw`
<div id="panel" tabindex="-1" role="dialog" aria-label="Загрузки">
  <header>
    <h1>Загрузки</h1>
    <span id="summary"></span>
    <button id="clear" class="btn" type="button" disabled>Очистить список</button>
  </header>
  <ul id="list" hidden></ul>
  <div id="empty">Загрузок пока нет</div>
  <footer>
    <button id="open-page" class="link" type="button">Все загрузки</button>
    <button id="open-folder" class="link" type="button">Папка «Загрузки»</button>
  </footer>
</div>
`;

const CLIENT = String.raw`
(function () {
  'use strict';
  var api = window.dlPopup;
  if (!api) return;

  var root = document.documentElement;
  var panel = document.getElementById('panel');
  var list = document.getElementById('list');
  var empty = document.getElementById('empty');
  var summary = document.getElementById('summary');
  var clearBtn = document.getElementById('clear');
  var pageBtn = document.getElementById('open-page');
  var folderBtn = document.getElementById('open-folder');
  var THEME_RE = /^[a-z0-9-]{1,40}$/;
  var NS = 'http://www.w3.org/2000/svg';

  var rows = new Map();
  var lastHeight = -1;
  var needReport = true;

  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }
  function plural(n, f) {
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return f[0];
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return f[1];
    return f[2];
  }
  function fmtBytes(n) {
    if (!isFinite(n) || n <= 0) return '0 Б';
    var u = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    var i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    var v = n / Math.pow(1024, i);
    var s = (i === 0 || v >= 100) ? String(Math.round(v)) : v.toFixed(1);
    return s.replace('.', ',') + ' ' + u[i];
  }
  function fmtEta(sec) {
    if (sec < 60) return Math.max(1, Math.round(sec)) + ' с';
    if (sec < 3600) return Math.round(sec / 60) + ' мин';
    return Math.floor(sec / 3600) + ' ч ' + Math.round((sec % 3600) / 60) + ' мин';
  }
  function warnIcon() {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('width', '13');
    s.setAttribute('height', '13');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M8 1.8 15 14H1L8 1.8zM8 6.2v3.6M8 11.7v.1');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.4');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.appendChild(p);
    return s;
  }

  function applyTheme(t) {
    if (!t) return;
    root.dataset.theme = t.mode === 'light' ? 'light' : 'dark';
    root.dataset.chromeTheme = (typeof t.id === 'string' && THEME_RE.test(t.id)) ? t.id : 'cyber-blue';
  }

  // Что показать для записи и какие действия доступны
  function describe(it) {
    var d = { cls: '', meta: '', note: '', bar: false, pct: 0, indet: false, acts: [], primary: null,
      badge: (it.ext || '').slice(0, 4) || 'FILE' };
    var tail = [];
    if (it.host) tail.push(it.host);
    if (it.incognito) tail.push('Инкогнито');

    if (it.state === 'progressing') {
      d.bar = true;
      if (it.awaitingPath) {
        d.indet = true;
        d.meta = 'Выберите место сохранения…';
      } else {
        d.indet = it.percent < 0;
        d.pct = Math.max(0, it.percent);
        var parts = [it.total > 0 ? fmtBytes(it.received) + ' из ' + fmtBytes(it.total) : fmtBytes(it.received)];
        if (it.speed > 0) parts.push(fmtBytes(it.speed) + '/с');
        if (it.etaSec > 0 && it.total > 0) parts.push('ещё ' + fmtEta(it.etaSec));
        if (it.incognito) parts.push('Инкогнито');
        d.meta = parts.join(' · ');
      }
      if (it.canCancel) d.acts.push({ act: 'cancel', label: 'Отменить' });
      return d;
    }

    if (it.state === 'completed') {
      if (it.checking) {
        d.bar = true; d.indet = true;
        d.meta = 'Проверка файла…';
        return d;
      }
      if (!it.exists) {
        d.cls = 'gone';
        d.meta = ['Файл удалён или перемещён'].concat(tail).join(' · ');
        return d;
      }
      d.meta = (it.total > 0 ? [fmtBytes(it.total)] : []).concat(tail).join(' · ');
      if (it.verdict === 'blocked') {
        d.cls = 'danger';
        d.note = (it.reason || 'Файл может быть опасным') + '. Файл заблокирован.';
        d.acts.push({ act: 'show', label: 'Показать в папке' });
        d.acts.push({ act: 'delete-blocked', label: 'Удалить файл', cls: 'danger' });
        d.acts.push({ act: 'keep-blocked', label: 'Оставить всё равно…' });
        return d;
      }
      if (it.verdict === 'kept') {
        d.cls = 'warn';
        d.note = 'Оставлен вами несмотря на предупреждение';
      } else if (it.verdict === 'mismatch') {
        d.cls = 'warn';
        d.note = it.reason || 'Содержимое не совпадает с расширением';
      }
      d.acts.push({ act: 'open', label: 'Открыть файл', cls: 'primary' });
      d.acts.push({ act: 'show', label: 'Показать в папке' });
      d.primary = 'open';
      return d;
    }

    // cancelled | interrupted
    d.meta = [it.state === 'cancelled' ? 'Отменено' : 'Прервано'].concat(tail).join(' · ');
    if (it.canRetry) {
      d.acts.push({ act: 'retry', label: 'Повторить', cls: 'primary' });
      d.primary = 'retry';
    }
    if (it.canCancel) d.acts.push({ act: 'cancel', label: 'Отменить' });
    return d;
  }

  function createRow(id) {
    var li = h('li', 'row');
    li.tabIndex = -1;
    li.dataset.id = String(id);
    var badge = h('div', 'badge');
    var body = h('div', 'body');
    var name = h('div', 'name');
    var meta = h('div', 'meta');
    var note = h('div', 'note');
    var noteText = h('span');
    note.appendChild(warnIcon());
    note.appendChild(noteText);
    note.hidden = true;
    var bar = h('div', 'bar');
    var fill = h('i');
    bar.appendChild(fill);
    bar.hidden = true;
    var acts = h('div', 'acts');
    acts.hidden = true;
    body.appendChild(name);
    body.appendChild(meta);
    body.appendChild(note);
    body.appendChild(bar);
    body.appendChild(acts);
    li.appendChild(badge);
    li.appendChild(body);
    return { id: id, li: li, badge: badge, name: name, meta: meta, note: note, noteText: noteText,
      bar: bar, fill: fill, acts: acts, actsKey: '', primary: null };
  }

  function updateRow(r, it) {
    var d = describe(it);
    r.li.className = 'row' + (d.cls ? ' ' + d.cls : '') + (d.primary ? ' clickable' : '');
    r.primary = d.primary;
    setText(r.badge, d.badge);
    setText(r.name, it.name);
    r.name.title = it.name;
    setText(r.meta, d.meta);
    r.note.hidden = !d.note;
    if (d.note) setText(r.noteText, d.note);
    r.bar.hidden = !d.bar;
    r.bar.classList.toggle('indet', d.bar && d.indet);
    r.fill.style.width = (d.bar && !d.indet) ? d.pct + '%' : '';

    var key = d.acts.map(function (a) { return a.act + (a.cls || ''); }).join('|');
    if (key !== r.actsKey) {
      r.actsKey = key;
      r.acts.textContent = '';
      d.acts.forEach(function (a) {
        var b = h('button', 'btn' + (a.cls ? ' ' + a.cls : ''), a.label);
        b.type = 'button';
        b.dataset.act = a.act;
        r.acts.appendChild(b);
      });
      r.acts.hidden = d.acts.length === 0;
    }
  }

  // Порядок стрелок: «Очистить список» → записи → ссылки внизу
  function navItems() {
    var out = [];
    if (!clearBtn.disabled) out.push(clearBtn);
    Array.prototype.forEach.call(list.children, function (li) { out.push(li); });
    out.push(pageBtn, folderBtn);
    return out;
  }

  function currentIndex(navs) {
    var a = document.activeElement;
    if (!a || a === document.body || a === panel) return -1;
    var rowEl = a.closest ? a.closest('.row') : null;
    return navs.indexOf(rowEl || a);
  }

  function render(m) {
    var hadFocus = panel.contains(document.activeElement) && document.activeElement !== panel;
    var prevNavs = navItems();
    var prevIdx = currentIndex(prevNavs);

    applyTheme(m.theme);
    if (typeof m.maxHeight === 'number') root.style.setProperty('--max-h', Math.round(m.maxHeight) + 'px');

    var seen = {};
    m.items.forEach(function (it, idx) {
      seen[it.id] = true;
      var r = rows.get(it.id);
      if (!r) { r = createRow(it.id); rows.set(it.id, r); }
      updateRow(r, it);
      var want = list.children[idx] || null;
      if (want !== r.li) list.insertBefore(r.li, want);
    });
    rows.forEach(function (r, id) {
      if (!seen[id]) { r.li.remove(); rows.delete(id); }
    });

    var active = m.activeCount | 0;
    list.hidden = m.items.length === 0;
    empty.hidden = m.items.length !== 0;
    clearBtn.disabled = !(m.finishedCount > 0);
    setText(summary, active > 0
      ? active + ' ' + plural(active, ['активная', 'активные', 'активных'])
      : (m.items.length ? 'Недавние' : ''));

    // Если сфокусированная запись исчезла — переносим фокус на соседнюю, чтобы клавиатура не «потерялась»
    var a = document.activeElement;
    if (hadFocus && (!a || a === document.body || !panel.contains(a))) {
      var navs = navItems();
      var t = navs[Math.min(Math.max(prevIdx, 0), navs.length - 1)];
      if (t) t.focus();
    }
    reportHeight();
  }

  function reportHeight() {
    var hh = Math.ceil(panel.getBoundingClientRect().height);
    if (hh > 0 && (needReport || hh !== lastHeight)) {
      needReport = false;
      lastHeight = hh;
      api.resize(hh);
    }
  }

  list.addEventListener('click', function (e) {
    var li = e.target.closest ? e.target.closest('.row') : null;
    if (!li) return;
    var id = Number(li.dataset.id);
    var btn = e.target.closest('button[data-act]');
    if (btn) { api.action(btn.dataset.act, id); return; }
    var r = rows.get(id);
    if (r && r.primary) api.action(r.primary, id);
  });
  clearBtn.addEventListener('click', function () { api.action('clear'); });
  pageBtn.addEventListener('click', function () { api.action('open-page'); });
  folderBtn.addEventListener('click', function () { api.action('open-folder'); });

  document.addEventListener('keydown', function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var a = document.activeElement;
    if (e.key === 'Escape') { e.preventDefault(); api.close(); return; }

    var navs = navItems();
    var cur = currentIndex(navs);
    var next = -1;
    if (e.key === 'ArrowDown') next = cur < 0 ? 0 : (cur + 1) % navs.length;
    else if (e.key === 'ArrowUp') next = cur < 0 ? navs.length - 1 : (cur - 1 + navs.length) % navs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = navs.length - 1;
    if (next >= 0) {
      e.preventDefault();
      navs[next].focus();
      return;
    }
    // Enter / пробел на записи — основное действие (открыть или повторить); на кнопках работает штатный click
    if ((e.key === 'Enter' || e.key === ' ') && a && a.classList && a.classList.contains('row')) {
      e.preventDefault();
      var r = rows.get(Number(a.dataset.id));
      if (r && r.primary) api.action(r.primary, r.id);
    }
  });

  api.onState(function (m) {
    if (m && Array.isArray(m.items)) render(m);
  });
  api.onReset(function () {
    needReport = true;
    list.scrollTop = 0;
    panel.classList.remove('in');
    void panel.offsetWidth;
    panel.classList.add('in');
    panel.focus({ preventScroll: true });
  });

  if (typeof ResizeObserver === 'function') new ResizeObserver(reportHeight).observe(panel);
})();
`;

function buildHtml(nonce) {
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ');
  return '<!doctype html><html lang="ru" data-theme="dark" data-chrome-theme="cyber-blue"><head>' +
    '<meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<title>Загрузки</title>' +
    `<style nonce="${nonce}">${CSS}</style></head><body>${BODY}` +
    `<script nonce="${nonce}">${CLIENT}</script></body></html>`;
}

module.exports = DownloadsPopup;
module.exports._buildHtml = buildHtml; // для проверок/тестов
