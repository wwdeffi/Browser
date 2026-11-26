const path = require('path');
const { WebContentsView } = require('electron');

const BLUR_HIDE_DELAY_MS = 120;
const IDLE_DESTROY_MS = 150000; // 2,5 минуты без открытий — уничтожаем WebContentsView и его процесс
const REOPEN_GUARD_MS = 300;    // клик по кнопке «⋮» сразу после blur-закрытия не должен открывать меню заново
const SHOW_FALLBACK_MS = 250;   // если renderer не прислал высоту — показываем с оценочной
const PANEL_WIDTH = 300;
const SHADOW_PAD = 14;          // прозрачное поле вокруг панели под тень
const EDGE_GAP = 8;
const ANCHOR_GAP = 6;
const MIN_HEIGHT = 80;
const DEFAULT_HEIGHT = 420;

const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20000;

// Попап главного меню (кнопка «⋮»): отдельный WebContentsView поверх всех видов.
// Дерево пунктов строит WindowManager (buildModel), здесь — жизненный цикл, позиция, тема и безопасный IPC.
// Сам renderer хранит выделение/путь по подменю и шлёт только ключ выбранного пункта.
class MainMenuPopup {
  // opts: { win, buildModel, getResolvedTheme, getChromeTheme, getCustomCss, onShortcut, onHidden }
  constructor(opts) {
    this.opts = opts;
    this.win = opts.win;
    this.visible = false;
    this.rect = null;
    this.view = null;
    this._loaded = false;
    this._actions = new Map();
    this._height = DEFAULT_HEIGHT;
    this._shown = false;
    this._blurTimer = null;
    this._idleTimer = null;
    this._fallbackTimer = null;
    this._css = '';
    this._cssKey = null;
    this._lastHiddenAt = 0;
  }

  get webContents() {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  _viewAlive() {
    return Boolean(this.view) && !this.view.webContents.isDestroyed();
  }

  _ensureView() {
    if (this._viewAlive()) return true;
    if (!this.win || this.win.isDestroyed()) return false;
    this.view = null;
    this._loaded = false;
    this._css = '';
    this._cssKey = null;

    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'mainMenuPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false
      }
    });
    this.view = view;
    view.setBackgroundColor('#00000000');
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    view.setVisible(false);
    this.win.contentView.addChildView(view);

    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.on('will-redirect', (e) => e.preventDefault());
    wc.on('will-attach-webview', (e) => e.preventDefault());
    wc.once('did-finish-load', () => {
      if (this.view !== view) return;
      this._loaded = true;
      this._applyCustomCss();
      if (this.visible) this._sendOpen();
    });
    // Потеря фокуса (клик по странице, по панели интерфейса, в другое окно) закрывает меню
    wc.on('blur', () => { if (this.view === view) this.blurHide(); });
    // Горячие клавиши (Ctrl+T и т.п.) работают и при открытом меню: закрываем его и отдаём комбинацию окну
    wc.on('before-input-event', (event, input) => {
      if (this.view !== view || input.type !== 'keyDown') return;
      if (!(input.control || input.meta) && input.code !== 'F12' && input.code !== 'F11') return;
      this.hide({ restoreFocus: true });
      if (typeof this.opts.onShortcut === 'function') this.opts.onShortcut(event, input);
    });
    wc.loadFile(path.join(__dirname, '..', 'renderer', 'mainmenu.html'));
    return true;
  }

  // Прогрев не нужен: вид создаётся лениво при первом открытии и переиспользуется до простоя
  _armIdleTimer() {
    this._clearIdleTimer();
    if (!this.view) return;
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (!this.visible) this._destroyView();
    }, IDLE_DESTROY_MS);
    if (typeof this._idleTimer.unref === 'function') this._idleTimer.unref();
  }

  _clearIdleTimer() {
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }

  _clearBlurTimer() {
    if (this._blurTimer) clearTimeout(this._blurTimer);
    this._blurTimer = null;
  }

  _clearFallbackTimer() {
    if (this._fallbackTimer) clearTimeout(this._fallbackTimer);
    this._fallbackTimer = null;
  }

  _destroyView() {
    this._clearIdleTimer();
    this._clearBlurTimer();
    this._clearFallbackTimer();
    const view = this.view;
    this.view = null;
    this._loaded = false;
    this._css = '';
    this._cssKey = null;
    this._actions.clear();
    if (!view) return;
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(view); } catch { /* окно уже закрыто */ }
    try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* уже закрыт */ }
  }

  isSender(event) {
    const wc = this.webContents;
    return Boolean(wc) && event.sender === wc && event.senderFrame === wc.mainFrame;
  }

  _send(channel, payload) {
    const wc = this.webContents;
    if (wc) wc.send(channel, payload);
  }

  // Дерево с функциями -> плоская карта действий + «чистая» модель для renderer (без функций)
  _serialize(items) {
    const out = [];
    for (const it of items || []) {
      if (!it) continue;
      if (it.type === 'sep') { out.push({ type: 'sep' }); continue; }
      if (it.type === 'header') { out.push({ type: 'header', label: String(it.label || '') }); continue; }
      const key = String(it.key || '');
      if (!key) continue;
      const entry = {
        key,
        type: it.type || 'item',
        label: String(it.label || '').slice(0, 300),
        sub: it.sub ? String(it.sub).slice(0, 300) : '',
        accel: it.accel ? String(it.accel) : '',
        icon: it.icon ? String(it.icon) : '',
        enabled: it.enabled !== false,
        checked: Boolean(it.checked)
      };
      if (it.type === 'zoom') entry.value = String(it.value || '100%');
      if (Array.isArray(it.children)) entry.children = this._serialize(it.children);
      if (typeof it.run === 'function') this._actions.set(key, { run: it.run, keep: Boolean(it.keep), enabled: it.enabled !== false, type: entry.type });
      if (it.type === 'zoom') {
        // Кнопки масштаба — отдельные действия, ключи фиксированы: zoom:out / zoom:in / zoom:reset
        for (const [suffix, fn] of Object.entries(it.actions || {})) {
          if (typeof fn === 'function') this._actions.set(`${key}:${suffix}`, { run: fn, keep: true, enabled: true, type: 'item' });
        }
      }
      out.push(entry);
    }
    return out;
  }

  _buildPayload() {
    this._actions.clear();
    let items = [];
    try { items = this._serialize(this.opts.buildModel()); } catch (err) { console.error('[mainmenu] buildModel:', err); }
    return {
      items,
      theme: this.opts.getResolvedTheme(),
      chromeTheme: this.opts.getChromeTheme()
    };
  }

  _sendOpen() {
    if (!this._loaded || !this.visible) return;
    this._send('mainmenu:open', this._buildPayload());
  }

  // Состояние пунктов изменилось (галочка, масштаб, радио) — обновляем, не закрывая меню и не сбрасывая выделение
  refresh() {
    if (!this.visible || !this._loaded) return;
    this._send('mainmenu:model', this._buildPayload());
  }

  _applyCustomCss() {
    if (!this._loaded || !this._viewAlive()) return;
    const css = this.opts.getCustomCss() || '';
    if (css === this._css) return;
    const wc = this.view.webContents;
    const old = this._cssKey;
    this._css = css;
    this._cssKey = null;
    const dropOld = () => { if (old) wc.removeInsertedCSS(old).catch(() => {}); };
    if (css) wc.insertCSS(css).then((k) => { this._cssKey = k; dropOld(); }).catch(dropOld);
    else dropOld();
  }

  // rect: { left, right, bottom } кнопки меню в координатах окна интерфейса
  _place() {
    if (!this._viewAlive() || !this.rect) return;
    const [cw, ch] = this.win.getContentSize();
    const width = PANEL_WIDTH + SHADOW_PAD * 2;
    const panelRight = Math.min(Math.round(this.rect.right), cw - EDGE_GAP);
    const x = Math.max(0, panelRight - PANEL_WIDTH - SHADOW_PAD);
    const panelTop = Math.round(this.rect.bottom) + ANCHOR_GAP;
    const y = Math.max(0, panelTop - SHADOW_PAD);
    const maxHeight = Math.max(MIN_HEIGHT, ch - panelTop - EDGE_GAP + SHADOW_PAD * 2);
    const height = Math.max(MIN_HEIGHT, Math.min(Math.round(this._height), maxHeight));
    this.view.setBounds({ x, y, width, height });
    this._send('mainmenu:max-height', maxHeight - SHADOW_PAD * 2);
  }

  toggle(rect) {
    if (this.visible) { this.hide({ restoreFocus: true }); return; }
    // Клик по кнопке увёл фокус из попапа и закрыл его по blur за миг до click — это «закрытие кнопкой», не повторное открытие
    if (Date.now() - this._lastHiddenAt < REOPEN_GUARD_MS) return;
    this.show(rect);
  }

  show(rect) {
    if (!this.win || this.win.isDestroyed() || this.win.isMinimized()) return;
    if (rect && finite(rect.right) && finite(rect.bottom)) this.rect = { left: rect.left, right: rect.right, bottom: rect.bottom };
    if (!this.rect) return;
    if (!this._ensureView()) return;

    this._clearBlurTimer();
    this._clearIdleTimer();
    this._clearFallbackTimer();
    this.visible = true;
    this._shown = false;
    this._height = DEFAULT_HEIGHT;
    this._applyCustomCss();
    this._place();
    this.win.contentView.addChildView(this.view); // повторное добавление поднимает вид над страницами
    this._sendOpen();
    // Вид остаётся невидимым, пока renderer не прислал реальную высоту (иначе мелькнёт панель неверного размера)
    this._fallbackTimer = setTimeout(() => { this._fallbackTimer = null; this._reveal(); }, SHOW_FALLBACK_MS);
  }

  _reveal() {
    if (!this.visible || this._shown || !this._viewAlive()) return;
    this._shown = true;
    this._clearFallbackTimer();
    this.view.setVisible(true);
    this.view.webContents.focus();
  }

  resize(height) {
    if (!this.visible || typeof height !== 'number' || !Number.isFinite(height)) return;
    this._height = Math.max(MIN_HEIGHT, Math.min(4000, height)) + SHADOW_PAD * 2;
    this._place();
    this._reveal();
  }

  // Выбор пункта: ключ проверяется по карте текущей модели — renderer не может вызвать произвольное действие
  activate(key) {
    if (!this.visible || typeof key !== 'string') return;
    const act = this._actions.get(key);
    if (!act || !act.enabled) return;
    if (act.keep) {
      try { act.run(); } catch (err) { console.error('[mainmenu] action:', err); }
      setTimeout(() => this.refresh(), 60); // масштаб и настройки применяются асинхронно
      return;
    }
    this.hide({ restoreFocus: true });
    try { act.run(); } catch (err) { console.error('[mainmenu] action:', err); }
  }

  blurHide() {
    if (!this.visible) return;
    this._clearBlurTimer();
    this._blurTimer = setTimeout(() => {
      this._blurTimer = null;
      const wc = this.webContents;
      if (wc && wc.isFocused()) return;
      this.hide();
    }, BLUR_HIDE_DELAY_MS);
  }

  hide(opts = {}) {
    this._clearBlurTimer();
    this._clearFallbackTimer();
    const wasVisible = this.visible;
    if (wasVisible) {
      this.visible = false;
      this._shown = false;
      this._lastHiddenAt = Date.now();
      this._actions.clear();
      if (this._viewAlive()) {
        this.view.setVisible(false);
        this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
        this._send('mainmenu:reset');
      }
      if (opts.restoreFocus && this.win && !this.win.isDestroyed()) this.win.webContents.focus();
      if (typeof this.opts.onHidden === 'function') this.opts.onHidden();
    }
    if (this.view && (wasVisible || !this._idleTimer)) this._armIdleTimer();
  }

  destroy() {
    this.visible = false;
    this._destroyView();
  }
}

module.exports = MainMenuPopup;
