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

// Ищет поле ввода Gemini по нескольким признакам (разметка сайта меняется): редактор contenteditable, role=textbox,
// textarea, в том числе внутри открытых shadow-root. Ставит курсор в конец; true — поле найдено и в фокусе
const EDITOR_FINDER = `
  const SELS = ['rich-textarea [contenteditable]:not([contenteditable="false"])', '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]', '[role="textbox"]', 'textarea'];
  const collect = (root, out) => {
    for (const sel of SELS) for (const el of root.querySelectorAll(sel)) if (!out.includes(el)) out.push(el);
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) collect(el.shadowRoot, out);
    return out;
  };
  const usable = (el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 40 && r.height >= 10 && !el.disabled && !el.readOnly;
  };`;

const FOCUS_EDITOR_SCRIPT = `(() => {${EDITOR_FINDER}
  const el = collect(document, []).find(usable);
  if (!el) return false;
  el.focus();
  if (el.tagName === 'TEXTAREA') {
    el.setSelectionRange(el.value.length, el.value.length);
  } else {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return true;
})()`;

// Фокус сейчас в поле ввода? (после запасного клика мышью)
const IS_EDITING_SCRIPT = `(() => {
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  if (!a) return false;
  return a.isContentEditable || a.tagName === 'TEXTAREA' || a.getAttribute('role') === 'textbox';
})()`;

// Для отчёта об ошибке: что на странице похоже на поле ввода
const DESCRIBE_EDITORS_SCRIPT = `(() => {${EDITOR_FINDER}
  const all = collect(document, []);
  const d = (el) => {
    const r = el.getBoundingClientRect();
    return el.tagName.toLowerCase() + (el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : '')
      + (el.getAttribute('aria-label') ? '[aria-label=' + el.getAttribute('aria-label') + ']' : '')
      + ' ' + Math.round(r.width) + 'x' + Math.round(r.height);
  };
  return { total: all.length, items: all.slice(0, 8).map(d), active: document.activeElement ? document.activeElement.tagName : null };
})()`;

// Скрипт для изолированного мира Gemini: создаёт File и «вставляет» его в поле ввода.
// true — редактор обработал событие (отменил его действие по умолчанию), то есть файл принят
function buildAttachScript(name, text, mime) {
  return `(() => {${EDITOR_FINDER}
    const el = collect(document, []).find(usable);
    if (!el) return false;
    const file = new File([${JSON.stringify(String(text))}], ${JSON.stringify(String(name))}, { type: ${JSON.stringify(String(mime))} });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.focus();
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
    return el.dispatchEvent(ev) === false;
  })()`;
}

// Перехват Enter в поле Gemini: если в запросе упомянуты вкладки, Enter не уходит в Gemini, а сообщает об этом браузеру
// (через console.debug с меткой — в панели нет preload). Следующий Enter после выбора вкладок проходит свободно.
const INTENT_MARK = '__deffi_tabs__';
const INTENT_SCRIPT = `(() => {
  if (window.__deffiTabIntent) return;
  window.__deffiTabIntent = true;
  const re = /вклад(?:к|ок)|\\btabs?\\b/i;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    if (window.__deffiAllowSend) { window.__deffiAllowSend = false; return; }
    const t = e.target;
    const text = String((t && (t.value !== undefined ? t.value : t.innerText)) || '').trim();
    if (!text || !re.test(text)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    console.debug('${INTENT_MARK}' + text.slice(0, 500));
  }, true);
})();`;

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
  constructor({ win, getSession, openInTab, onShortcut, onRelayout, onTabIntent, getBackgroundColor, width } = {}) {
    this.win = win;
    this.onTabIntent = typeof onTabIntent === 'function' ? onTabIntent : null;
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

    const run = (code) => wc.executeJavaScriptInIsolatedWorld(TIDY_WORLD_ID, [{ code }]).catch(() => false);
    let focused = false;
    const deadline = Date.now() + INSERT_WAIT_MS;
    while (!focused && Date.now() < deadline) {
      if (!this._wc()) return { ok: false, reason: 'no-panel' };
      if (isGeminiAppUrl(wc.getURL())) focused = await run(FOCUS_EDITOR_SCRIPT);
      if (!focused) await sleep(300);
    }
    if (!focused && isGeminiAppUrl(wc.getURL())) {
      // Запасной путь: кликаем туда, где у Gemini строка ввода (внизу панели), и проверяем, что фокус попал в поле
      const b = this.view.getBounds();
      const x = Math.round(b.width * 0.4);
      const y = Math.max(10, b.height - 50);
      wc.focus();
      for (const type of ['mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
      await sleep(250);
      focused = await run(IS_EDITING_SCRIPT);
    }
    if (!focused) {
      const info = isGeminiAppUrl(wc.getURL()) ? await run(DESCRIBE_EDITORS_SCRIPT) : null;
      console.warn('[gemini-context] поле ввода не найдено:', wc.getURL(), JSON.stringify(info));
      return { ok: false, reason: isGeminiAppUrl(wc.getURL()) ? 'no-input' : 'not-signed-in' };
    }

    wc.focus();
    // Прежний буфер обмена сохраняем и возвращаем после вставки. Каждый метод может отсутствовать
    // в конкретной версии Electron, поэтому читаем осторожно: сбой чтения не должен срывать вставку
    const saved = {};
    for (const [key, method] of [['text', 'readText'], ['html', 'readHTML'], ['image', 'readImage']]) {
      try { if (typeof clipboard[method] === 'function') saved[key] = clipboard[method](); } catch { /* формат недоступен */ }
    }
    try {
      clipboard.writeText(String(text));
      wc.paste();
    } catch (err) {
      console.warn('[gemini-context] вставка не удалась:', err && err.message);
      return { ok: false, reason: 'paste-failed' };
    } finally {
      // Вставка асинхронна: даём ей отработать и только потом возвращаем прежний буфер
      setTimeout(() => {
        try {
          const data = {};
          if (typeof saved.text === 'string') data.text = saved.text;
          if (typeof saved.html === 'string' && saved.html) data.html = saved.html;
          if (saved.image && typeof saved.image.isEmpty === 'function' && !saved.image.isEmpty()) data.image = saved.image;
          if (Object.keys(data).length) clipboard.write(data);
          else clipboard.clear();
        } catch { /* буфер недоступен */ }
      }, 600);
    }
    return { ok: true };
  }

  // Прикрепляет текст к чату Gemini как файл (как при нажатии «+»): в поле ввода остаётся чистое место для вопроса.
  // Файл отдаём редактору событием paste с DataTransfer — Gemini обрабатывает его так же, как вставку файла из проводника.
  // Результат: { ok: true } или { ok: false, reason }; при 'not-accepted' вызывающий может вставить текст обычным путём
  async attachFile(name, text, mime = 'text/markdown') {
    const wc = this._wc();
    if (!wc || !text) return { ok: false, reason: 'no-panel' };
    const run = (code) => wc.executeJavaScriptInIsolatedWorld(TIDY_WORLD_ID, [{ code }]).catch(() => false);
    let focused = false;
    const deadline = Date.now() + INSERT_WAIT_MS;
    while (!focused && Date.now() < deadline) {
      if (!this._wc()) return { ok: false, reason: 'no-panel' };
      if (isGeminiAppUrl(wc.getURL())) focused = await run(FOCUS_EDITOR_SCRIPT);
      if (!focused) await sleep(300);
    }
    if (!focused) return { ok: false, reason: isGeminiAppUrl(wc.getURL()) ? 'no-input' : 'not-signed-in' };
    wc.focus();
    const accepted = await run(buildAttachScript(name, text, mime));
    return accepted ? { ok: true } : { ok: false, reason: 'not-accepted' };
  }

  // Следующий Enter в поле Gemini уйдёт как обычный: без повторного перехвата (после выбора вкладок или отмены)
  allowNextSend() {
    const wc = this._wc();
    if (!wc || !isGeminiAppUrl(wc.getURL())) return;
    wc.executeJavaScriptInIsolatedWorld(TIDY_WORLD_ID, [{ code: 'window.__deffiAllowSend = true;' }]).catch(() => {});
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
      wc.executeJavaScriptInIsolatedWorld(TIDY_WORLD_ID, [{ code: INTENT_SCRIPT }]).catch(() => { /* страница ушла */ });
    });

    // Сообщение от перехватчика Enter. Из него берём только текст запроса (для числа вкладок); действие — лишь меню выбора
    wc.on('console-message', (...args) => {
      const message = args[0] && typeof args[0].message === 'string' ? args[0].message : args[2];
      if (typeof message !== 'string' || !message.startsWith(INTENT_MARK)) return;
      if (this.onTabIntent && isGeminiAppUrl(wc.getURL())) this.onTabIntent(message.slice(INTENT_MARK.length));
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
  buildAttachScript,
  INTENT_SCRIPT,
  INTENT_MARK,
  GEMINI_URL,
  GEMINI_GAP,
  GEMINI_MIN_WIDTH,
  GEMINI_MAX_WIDTH,
  GEMINI_DEFAULT_WIDTH,
  isPanelUrl,
  clampWidth,
  isGeminiAppUrl,
  shouldHideLabel,
  FOCUS_EDITOR_SCRIPT,
  IS_EDITING_SCRIPT,
  DESCRIBE_EDITORS_SCRIPT,
  TIDY_SCRIPT
};
