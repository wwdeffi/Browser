const path = require('path');
const { WebContentsView, net } = require('electron');
const {
  SEARCH_ENGINES,
  OMNIBOX_MAX_ROWS,
  OMNIBOX_ROW_HEIGHT,
  OMNIBOX_PADDING,
  OMNIBOX_GAP,
  OMNIBOX_MAX_QUERY_LENGTH
} = require('./constants');
const storage = require('./storage');

const BLUR_HIDE_DELAY_MS = 150;
const IDLE_DESTROY_MS = 150000; // 2,5 минуты без подсказок — уничтожаем WebContentsView и его процесс
const MAX_TABS = 3;
const MAX_BOOKMARKS = 3;
const MAX_SUGGEST = 4;
const SUGGEST_DELAY_MS = 90;
const SUGGEST_TIMEOUT_MS = 1500;
const SUGGEST_URLS = {
  google: 'https://suggestqueries.google.com/complete/search?client=firefox&oe=utf-8&q=',
  yandex: 'https://suggest.yandex.ru/suggest-ff.cgi?part=',
  duckduckgo: 'https://duckduckgo.com/ac/?type=list&q=',
  bing: 'https://api.bing.com/osjson.aspx?query='
};
const SAFE_URL = /^(https?|browser):\/\//i;

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const normUrl = (u) => u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

function looksLikeUrl(s) {
  if (/\s/.test(s)) return false;
  return (
    /^(https?|browser|about|file):/i.test(s) ||
    /^localhost(:\d+)?([/?#]|$)/i.test(s) ||
    /^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(s) ||
    /^[^\s/?#]+\.[a-zа-яё]{2,}(:\d+)?([/?#]|$)/i.test(s)
  );
}

function safeList(thunk) {
  try {
    const r = thunk();
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

// Попап подсказок адресной строки: отдельный WebContentsView поверх всех остальных видов.
// Состояние (элементы, выделение) живёт в main — окно интерфейса только шлёт текст и клавиши.
class OmniboxPopup {
  // opts: { win, getTabs, getActiveId, getSettings, isIncognito, getResolvedTheme, getChromeTheme, getCustomCss, navigate, switchTab }
  constructor(opts) {
    this.opts = opts;
    this.win = opts.win;
    this.visible = false;
    this.items = [];
    this.selected = 0;
    this.lastQuery = '';
    this.rect = null;
    this._loaded = false;
    this._blurTimer = null;
    this._css = '';
    this._cssKey = null;
    this._suggestTimer = null;
    this._abort = null;
    this._seq = 0;
    this._idleTimer = null;
    this._pendingItems = null; // последний payload подсказок — отрисуем по did-finish-load
    this._pendingTheme = null;

    this.view = null; // WebContentsView создаётся лениво (_ensureView) и гасится по простою
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
        preload: path.join(__dirname, '..', 'preload', 'omniboxPreload.js'),
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
    if (typeof view.setBorderRadius === 'function') view.setBorderRadius(10);
    this.win.contentView.addChildView(view);

    const wc = view.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.once('did-finish-load', () => {
      if (this.view !== view) return; // вид уже пересоздан или уничтожен
      this._loaded = true;
      this._applyCustomCss();
      this._flushPending();
    });
    // Клик по «пустому» месту попапа уводит фокус из адресной строки; когда фокус уйдёт и из попапа — прячем
    wc.on('blur', () => { if (this.view === view) this.blurHide(); });
    wc.loadFile(path.join(__dirname, '..', 'renderer', 'omnibox.html'));
    return true;
  }

  // Прогрев при фокусе адресной строки: создаём вид заранее, чтобы к первому символу он уже загрузился
  warmUp() {
    if (!this.win || this.win.isDestroyed() || this.win.isMinimized()) return;
    if (!this._ensureView()) return;
    if (!this.visible) this._armIdleTimer();
  }

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

  // Полностью уничтожает WebContentsView и его процесс рендера; следующий query()/warmUp() создаст его заново
  _destroyView() {
    this._clearIdleTimer();
    this._clearBlurTimer();
    const view = this.view;
    this.view = null;
    this._loaded = false;
    this._css = '';
    this._cssKey = null;
    this._pendingItems = null;
    this._pendingTheme = null;
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

  _flushPending() {
    if (!this._loaded || !this.visible) return;
    if (this._pendingTheme) this._send('omnibox:theme', this._pendingTheme);
    if (this._pendingItems) this._send('omnibox:items', { items: this._pendingItems, selected: this.selected });
  }

  _isIncognito() {
    return typeof this.opts.isIncognito === 'function' ? Boolean(this.opts.isIncognito()) : false;
  }

  _build(raw) {
    const incognito = this._isIncognito();
    const text = raw.trim();
    const words = text.toLowerCase().split(/\s+/);
    const settings = this.opts.getSettings();
    const engine = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google;
    const isUrl = looksLikeUrl(text);

    const items = [{
      type: isUrl ? 'go' : 'search',
      title: clip(text, 200),
      sub: '',
      badge: isUrl ? 'Перейти' : `Поиск · ${engine.name}`
    }];
    const seen = new Set();
    const push = (item, url) => {
      const key = normUrl(url);
      if (items.length >= OMNIBOX_MAX_ROWS || seen.has(key)) return false;
      seen.add(key);
      items.push(item);
      return true;
    };
    const fromStore = (type, it) => {
      if (!it || typeof it.url !== 'string' || !SAFE_URL.test(it.url)) return false;
      return push({ type, url: it.url, title: clip(it.title, 200) || clip(it.url, 200), sub: clip(it.url, 300), badge: '' }, it.url);
    };

    // 1. Открытые вкладки (кроме активной)
    const activeId = this.opts.getActiveId();
    let tabCount = 0;
    for (const t of this.opts.getTabs() || []) {
      if (tabCount >= MAX_TABS || items.length >= OMNIBOX_MAX_ROWS) break;
      if (!t || t.id === activeId || typeof t.url !== 'string' || !SAFE_URL.test(t.url)) continue;
      const hay = `${t.title || ''}\n${t.url}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
      const ok = push({
        type: 'tab', tabId: t.id,
        title: clip(t.title, 200) || clip(t.url, 200), sub: clip(t.url, 300), badge: 'Перейти на вкладку'
      }, t.url);
      if (ok) tabCount++;
    }

    // В Инкогнито обычные закладки и историю в выдачу не подмешиваем
    if (incognito) return items;

    // 2. Закладки
    let bmCount = 0;
    for (const it of safeList(() => storage.searchBookmarks(text, MAX_BOOKMARKS))) {
      if (bmCount >= MAX_BOOKMARKS) break;
      if (fromStore('bookmark', it)) bmCount++;
    }

    // 3. История добирает оставшиеся строки
    for (const it of safeList(() => storage.searchHistory(text, OMNIBOX_MAX_ROWS))) {
      if (items.length >= OMNIBOX_MAX_ROWS) break;
      fromStore('history', it);
    }
    return items;
  }

  async _fetchSuggest(text) {
    const base = SUGGEST_URLS[this.opts.getSettings().searchEngine] || SUGGEST_URLS.google;
    const ac = new AbortController();
    this._abort = ac;
    const timer = setTimeout(() => ac.abort(), SUGGEST_TIMEOUT_MS);
    try {
      const res = await net.fetch(base + encodeURIComponent(text), { signal: ac.signal, credentials: 'omit' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data && data[1])
        ? data[1].filter((s) => typeof s === 'string' && s.trim()).map((s) => clip(s, 200))
        : [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  // Подсказки поисковика приходят асинхронно и вставляются сразу под первой строкой
  _scheduleSuggest(text) {
    clearTimeout(this._suggestTimer);
    if (this._abort) this._abort.abort();
    const q = text.trim();
    // В Инкогнито сетевые подсказки полностью отключены (запрос ушёл бы поисковику вне приватной сессии)
    if (this._isIncognito() || this.opts.getSettings().searchSuggest === false || looksLikeUrl(q)) return;
    const seq = ++this._seq;
    this._suggestTimer = setTimeout(async () => {
      const list = await this._fetchSuggest(q);
      if (seq !== this._seq || !this.visible || text !== this.lastQuery || !list.length) return;
      if (this.selected !== 0) return; // пользователь уже двигался стрелками
      const [first, ...rest] = this.items;
      const sugg = list
        .filter((s) => s.toLowerCase() !== q.toLowerCase())
        .slice(0, MAX_SUGGEST)
        .map((s) => ({ type: 'suggest', title: s, sub: '', badge: '' }));
      this.items = [first, ...sugg, ...rest].slice(0, OMNIBOX_MAX_ROWS);
      this._render();
    }, SUGGEST_DELAY_MS);
  }

  _render() {
    this._place(this.rect);
    this._pendingItems = this.items.map(({ type, title, sub, badge }) => ({ type, title, sub, badge }));
    if (this._loaded) this._send('omnibox:items', { items: this._pendingItems, selected: this.selected });
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

  _place(rect) {
    if (!this._viewAlive()) return;
    const [cw] = this.win.getContentSize();
    const x = Math.max(0, Math.round(rect.left));
    const width = Math.max(120, Math.min(Math.round(rect.width), cw - x));
    const height = this.items.length * OMNIBOX_ROW_HEIGHT + OMNIBOX_PADDING * 2 + 2; // +2: рамка #list (1px сверху и снизу)
    this.view.setBounds({ x, y: Math.round(rect.bottom) + OMNIBOX_GAP, width, height });
  }

  // rect: { left, bottom, width } элемента #omnibox в координатах окна интерфейса
  query(text, rect) {
    if (!this.win || this.win.isDestroyed() || this.win.isMinimized()) return;
    if (typeof text !== 'string' || !text.trim() || text.length > OMNIBOX_MAX_QUERY_LENGTH) {
      this.hide();
      return;
    }
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20000;
    if (rect && ok(rect.left) && ok(rect.bottom) && ok(rect.width)) this.rect = rect;
    if (!this.rect) return;
    if (!this._ensureView()) return;

    this._clearBlurTimer();
    this._clearIdleTimer();
    this.lastQuery = text;
    this.items = this._build(text);
    this.selected = 0;

    this._applyCustomCss();
    this._pendingTheme = { theme: this.opts.getResolvedTheme(), chromeTheme: this.opts.getChromeTheme() };
    if (this._loaded) this._send('omnibox:theme', this._pendingTheme);
    this._render();

    // Повторное addChildView поднимает вид на самый верх (над WebContentsView вкладок)
    this.win.contentView.addChildView(this.view);
    this.view.setVisible(true);
    this.visible = true;
    this._scheduleSuggest(text);
  }

  move(delta) {
    if (!this.visible || !this.items.length) return;
    const n = this.items.length;
    this.selected = (this.selected + (delta < 0 ? -1 : 1) + n) % n;
    if (this._loaded) this._send('omnibox:select', this.selected);
  }

  hover(index) {
    if (this.visible && Number.isInteger(index) && index >= 0 && index < this.items.length) this.selected = index;
  }

  // Enter в адресной строке: true — обработано попапом, false — окно интерфейса переходит само
  accept(text) {
    if (!this.visible) return false;
    if (text !== this.lastQuery) {
      this.hide(); // подсказки устарели (Enter раньше дебаунса): не держим старый попап
      return false;
    }
    const item = this.items[this.selected];
    if (!item) return false;
    this._activate(item);
    return true;
  }

  pick(index) {
    if (!this.visible || !Number.isInteger(index)) return;
    const item = this.items[index];
    if (item) this._activate(item);
  }

  _activate(item) {
    const q = this.lastQuery.trim();
    this.hide();
    if (this.win && !this.win.isDestroyed()) this.win.webContents.focus();
    if (item.type === 'tab') this.opts.switchTab(item.tabId);
    // Подсказка поисковика — всегда прямой поиск, без распознавания адресов и бэнгов («node.js» не должен стать сайтом)
    else if (item.type === 'suggest') this.opts.navigate(item.title, { forceSearch: true });
    else if (item.type === 'search' || item.type === 'go') this.opts.navigate(q);
    else this.opts.navigate(item.url);
  }

  _clearBlurTimer() {
    if (this._blurTimer) clearTimeout(this._blurTimer);
    this._blurTimer = null;
  }

  // Потеря фокуса адресной строкой: клик по самому попапу тоже уводит фокус, поэтому прячем с задержкой
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

  hide() {
    this._clearBlurTimer();
    clearTimeout(this._suggestTimer);
    if (this._abort) this._abort.abort();
    const wasVisible = this.visible;
    if (wasVisible) {
      this.visible = false;
      this.items = [];
      this.lastQuery = '';
      this._pendingItems = null;
      if (this._viewAlive()) {
        this.view.setVisible(false);
        this.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      }
    }
    // Таймер простоя: после скрытия попапа (или если вид прогрет, но подсказок так и не было)
    if (this.view && (wasVisible || !this._idleTimer)) this._armIdleTimer();
  }

  destroy() {
    clearTimeout(this._suggestTimer);
    if (this._abort) this._abort.abort();
    this.visible = false;
    this._destroyView();
  }
}

module.exports = OmniboxPopup;
