'use strict';

// Боковая панель Gemini (как «Спросить Gemini» в Chrome): справа от страниц живёт отдельный WebContentsView
// с gemini.google.com. Он работает в той же сессии, что и вкладки, поэтому вход в Google-аккаунт общий:
// вошёл один раз во вкладке или в самой панели — и помощник уже под твоим аккаунтом.

const { WebContentsView, clipboard } = require('electron');

const GEMINI_URL = 'https://gemini.google.com/app';
const GEMINI_GAP = 6;            // зазор между страницей и панелью: в нём лежит разделитель #gemini-divider окна интерфейса
const GEMINI_MIN_WIDTH = 320;
const GEMINI_MAX_WIDTH = 760;
const GEMINI_DEFAULT_WIDTH = 420;
const GEMINI_MIN_PAGE_WIDTH = 360; // страница не должна сжиматься уже этого

// Внутри панели остаются только Gemini и вход в Google; любые другие ссылки открываются во вкладках
const GOOGLE_HOST_RE = /(^|\.)google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/;
const PANEL_HOSTS_EXTRA = new Set(['accounts.youtube.com']);

function isPanelUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    if (PANEL_HOSTS_EXTRA.has(h)) return true;
    // gemini.google.com, accounts.google.*, а также служебные поддомены google.com, через которые идёт вход
    return GOOGLE_HOST_RE.test(h);
  } catch {
    return false;
  }
}

function isHttpUrl(rawUrl) {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Кнопки «Скачать приложение» и т.п. в шапке сайта: в узкой панели они наезжают на заголовок «Gemini».
// В Chrome у панели своя версия без них — у нас прячем их скриптом по тексту (классы сайта меняются, текст стабильнее)
const HIDE_LABEL_RE = /скачать приложение|download (the )?app|get the app|получить приложение/i;

function shouldHideLabel(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= 60 && HIDE_LABEL_RE.test(t);
}

// Выполняется в изолированном мире страницы gemini.google.com: DOM общий, переменные сайта недоступны.
// Через CSSOM (style.setProperty) — не упирается ни в CSP, ни в Trusted Types сайта
const TIDY_SCRIPT = `(() => {
  if (window.__deffiGeminiTidy) return;
  window.__deffiGeminiTidy = true;
  const re = ${HIDE_LABEL_RE.toString()};
  const tidy = () => {
    for (const el of document.querySelectorAll('a, button, [role="button"]')) {
      if (el.dataset.deffiHidden) continue;
      const t = (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length <= 60 && re.test(t)) {
        el.style.setProperty('display', 'none', 'important');
        el.dataset.deffiHidden = '1';
      }
    }
  };
  tidy();
  let timer = 0;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(tidy, 120);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();`;

const TIDY_WORLD_ID = 1207; // отдельный изолированный мир для наших правок панели

// Ставит курсор в конец поля ввода Gemini (редактор Quill внутри <rich-textarea>); true — поле найдено и в фокусе
const FOCUS_EDITOR_SCRIPT = `(() => {
  const cands = document.querySelectorAll('rich-textarea .ql-editor, rich-textarea [contenteditable="true"], div[contenteditable="true"][role="textbox"], [contenteditable="true"]');
  for (const el of cands) {
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 10) continue;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  return false;
})()`;

const INSERT_WAIT_MS = 8000; // сколько ждём появления поля ввода (панель могла только что открыться)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isGeminiAppUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return u.protocol === 'https:' && u.hostname === 'gemini.google.com';
  } catch {
    return false;
  }
}

function clampWidth(width) {
  const n = Math.round(Number(width));
  if (!Number.isFinite(n)) return GEMINI_DEFAULT_WIDTH;
  return Math.min(GEMINI_MAX_WIDTH, Math.max(GEMINI_MIN_WIDTH, n));
}

class GeminiPanel {
  constructor({ win, getSession, openInTab, onShortcut, onRelayout, getBackgroundColor, width } = {}) {
    this.win = win;
    this.onRelayout = typeof onRelayout === 'function' ? onRelayout : () => {};
    this.getSession = getSession;
    this.openInTab = typeof openInTab === 'function' ? openInTab : () => {};
    this.onShortcut = typeof onShortcut === 'function' ? onShortcut : null;
    this.getBackgroundColor = typeof getBackgroundColor === 'function' ? getBackgroundColor : () => '#1f1f1f';
    this.width = clampWidth(width ?? GEMINI_DEFAULT_WIDTH);
    this.open = false;
    this.view = null;
    this._session = null;
  }

  isOpen() {
    return this.open;
  }

  // Сколько места панель отнимает у страниц при данной ширине окна (0 — закрыта)
  reservedWidth(windowWidth) {
    if (!this.open) return 0;
    return this.effectiveWidth(windowWidth) + GEMINI_GAP;
  }

  // Ширина с учётом узкого окна: странице оставляем хотя бы GEMINI_MIN_PAGE_WIDTH
  effectiveWidth(windowWidth) {
    const w = Number(windowWidth) || 0;
    const room = Math.max(0, w - GEMINI_MIN_PAGE_WIDTH - GEMINI_GAP);
    return Math.max(0, Math.min(this.width, Math.max(GEMINI_MIN_WIDTH, room)));
  }

  setWidth(width) {
    const next = clampWidth(width);
    if (next === this.width) return false;
    this.width = next;
    return true;
  }

  toggle() {
    this.setOpen(!this.open);
  }

  setOpen(open) {
    const next = Boolean(open);
    if (next === this.open) return;
    this.open = next;
    if (next) this._ensureView();
    else if (this.view) this.view.setVisible(false);
  }

  focus() {
    const wc = this._wc();
    if (wc) wc.focus();
  }

  reload() {
    const wc = this._wc();
    if (wc) wc.loadURL(GEMINI_URL);
  }

  // Кладёт текст в поле ввода Gemini (в конец уже набранного), не отправляя его: вопрос пользователь допишет сам.
  // Вставка идёт как обычная — через буфер обмена, поэтому переносы строк и большие объёмы редактор переваривает штатно;
  // прежнее содержимое буфера возвращаем на место. Результат: { ok: true } или { ok: false, reason }
  async insertText(text) {
    const wc = this._wc();
    if (!wc || !text) return { ok: false, reason: 'no-panel' };

    let focused = false;
    const deadline = Date.now() + INSERT_WAIT_MS;
    while (!focused && Date.now() < deadline) {
      if (!this._wc()) return { ok: false, reason: 'no-panel' };
      if (isGeminiAppUrl(wc.getURL())) {
        focused = await wc.executeJavaScriptInIsolatedWorld(TIDY_WORLD_ID, [{ code: FOCUS_EDITOR_SCRIPT }]).catch(() => false);
      }
      if (!focused) await sleep(300);
    }
    if (!focused) return { ok: false, reason: isGeminiAppUrl(wc.getURL()) ? 'no-input' : 'not-signed-in' };

    wc.focus();
    const saved = { text: clipboard.readText(), html: clipboard.readHTML(), image: clipboard.readImage() };
    try {
      clipboard.writeText(String(text));
      wc.paste();
    } catch {
      return { ok: false, reason: 'paste-failed' };
    } finally {
      // Вставка асинхронна: даём ей отработать и только потом возвращаем прежний буфер
      setTimeout(() => {
        try {
          const data = { text: saved.text, html: saved.html };
          if (saved.image && !saved.image.isEmpty()) data.image = saved.image;
          clipboard.write(data);
        } catch { /* буфер недоступен */ }
      }, 600);
    }
    return { ok: true };
  }

  // rect — область панели в координатах окна; null — спрятать (закрыта, HTML-fullscreen, модалка интерфейса)
  layout(rect) {
    if (!this.view) return;
    const show = this.open && rect && rect.width > 0 && rect.height > 0;
    this.view.setVisible(Boolean(show));
    if (show) this.view.setBounds(rect);
  }

  updateBackground() {
    if (!this.view) return;
    try { this.view.setBackgroundColor(this.getBackgroundColor()); } catch { /* view уничтожен */ }
  }

  getState() {
    return { open: this.open, width: this.width, gap: GEMINI_GAP };
  }

  destroy() {
    const view = this.view;
    this.view = null;
    this.open = false;
    if (!view) return;
    try { if (this.win && !this.win.isDestroyed()) this.win.contentView.removeChildView(view); } catch { /* окно уже закрыто */ }
    try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* уже закрыт */ }
  }

  _wc() {
    const wc = this.view && this.view.webContents;
    return wc && !wc.isDestroyed() ? wc : null;
  }

  _ensureView() {
    if (!this.win || this.win.isDestroyed()) return;
    const ses = this.getSession();
    // Сессия поменялась (не должно случаться: в Инкогнито панель недоступна) — пересоздаём view
    if (this.view && this._session !== ses) {
      this.destroy();
      this.open = true;
    }
    if (this.view) return;

    this._session = ses;
    const view = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false, // ответ Gemini должен дописываться, даже когда фокус на странице
        navigateOnDragDrop: false
      }
    });
    this.view = view;
    this.updateBackground();
    view.setVisible(false); // покажет layout()
    this.win.contentView.addChildView(view);

    const wc = view.webContents;

    // Новые окна (ссылки из ответов, «Открыть в новой вкладке») — во вкладки браузера
    wc.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) this.openInTab(url);
      return { action: 'deny' };
    });

    // Переход на посторонний сайт внутри панели тоже уводим во вкладку
    const guardNavigation = (event, url) => {
      if (isPanelUrl(url)) return;
      event.preventDefault();
      if (isHttpUrl(url)) this.openInTab(url);
    };
    wc.on('will-navigate', guardNavigation);
    wc.on('will-redirect', (event, url, isInPlace, isMainFrame) => {
      if (isMainFrame) guardNavigation(event, url);
    });

    // Прячем кнопки шапки, которые в узкой панели наезжают на заголовок
    wc.on('dom-ready', () => {
      if (!isGeminiAppUrl(wc.getURL())) return;
      wc.executeJavaScriptInIsolatedWorld(TIDY_WORLD_ID, [{ code: TIDY_SCRIPT }]).catch(() => { /* страница ушла */ });
    });

    if (this.onShortcut) {
      wc.on('before-input-event', (event, input) => this.onShortcut(event, input));
    }

    wc.on('render-process-gone', () => {
      // Упал процесс панели: при следующем открытии создадим заново
      if (this.view === view) {
        const wasOpen = this.open;
        this.destroy();
        if (wasOpen) {
          this.setOpen(true);
          this.onRelayout();
        }
      }
    });

    wc.loadURL(GEMINI_URL).catch(() => { /* офлайн: Chromium покажет свою страницу ошибки */ });
  }
}

module.exports = {
  GeminiPanel,
  GEMINI_URL,
  GEMINI_GAP,
  GEMINI_MIN_WIDTH,
  GEMINI_MAX_WIDTH,
  GEMINI_DEFAULT_WIDTH,
  isPanelUrl,
  clampWidth,
  isGeminiAppUrl,
  shouldHideLabel,
  TIDY_SCRIPT
};
