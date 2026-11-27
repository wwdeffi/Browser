const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow, Menu, nativeTheme, screen, session } = require('electron');
const adblock = require('./adblock');
const { SEARCH_ENGINES, SETTINGS_URL, DOWNLOADS_URL = 'browser://downloads', HISTORY_URL = 'browser://history', BOOKMARKS_URL = 'browser://bookmarks' } = require('./constants');
const {
  configureSession,
  syncSearchEngineThemeCookies,
  getSitePermissionInfo,
  setSitePermission,
  setSitePermissionByName,
  resetSitePermissions,
  getSiteInfo: buildSiteInfo,
  getMediaOrigin
} = require('./security');
const { registerProtocolHandler } = require('./protocol');
const storage = require('./storage');
const TabManager = require('./tabManager');
const OmniboxPopup = require('./omniboxPopup');
const MainMenuPopup = require('./mainMenuPopup');
const { GeminiPanel, GEMINI_GAP } = require('./geminiPanel');
const DownloadsPopup = require('./downloadsPopup');
const { buildCustomTheme, sanitizeSeed } = require('./customTheme');
const { setCustomTokens } = require('./searchTheme');
const { applyProxy: applySessionProxy } = require('./proxy');
const crypto = require('crypto');
const passwordManager = require('./passwordManager');

const PW_PROMPT_TTL_MS = 120000; // сколько main держит пароль в памяти, пока карточка не получила ответ

// Вертикальные вкладки: ширина сайдбара слева (развёрнут / свёрнут до полоски с иконками) и запасная высота
// удалённой горизонтальной полосы вкладок (реальное значение читается из --tabbar-height после загрузки интерфейса)
const VT_WIDTH = 232;
const VT_WIDTH_COLLAPSED = 52;
const VT_FALLBACK_TABBAR_HEIGHT = 40;
const BM_BAR_HEIGHT = 32; // высота #bmbar; в UI приходит через state.bookmarksBar.height → --bmbar-height

const STATE_BATCH_MS = 16;

class WindowManager {
  constructor({ registry = null, dedicatedIncognito = false } = {}) {
    this.registry = registry;                              // общий реестр окон
    this.id = null;                                        // BrowserWindow.id — ключ в реестре
    this.dedicatedIncognito = Boolean(dedicatedIncognito); // окно создано сразу как Инкогнито
    this._adopted = false;
    this.settings = storage.loadSettings();
    this.downloads = registry ? registry.ensureDownloads() : null; // один DownloadManager на всё приложение
    this.win = null;
    this.tabManager = null;
    this.omnibox = null;
    this.mainMenu = null;
    this.downloadsPopup = null;
    this.onNewWindow = null; // необязательный хук: main.js может задать собственное создание окна
    this.boundsTimer = null;
    this.customTheme = null;
    this._customCssKey = null;
    this._newTabStateCache = null;
    this._tabbarHeight = VT_FALLBACK_TABBAR_HEIGHT;

    this.isIncognito = false;
    this._incognitoSession = null;
    this._savedNormalSession = null;
    this._lastActiveTabId = null;
    this._lastAuthKey = null;
    this._sitePopoverOpen = false;
    this._hiddenForPopover = [];
    this._pwPrompt = null; // { promptId, origin, username, password, timer } — «Сохранить пароль?»
    this._proxyChain = Promise.resolve();
    this._proxyReady = Promise.resolve();

    if (this.settings.chromeTheme === 'custom') {
      const seed = this.settings.customThemeSeed;
      this.customTheme = seed ? buildCustomTheme(seed) : null;
      setCustomTokens(this.customTheme ? this.customTheme.search : null);
    }

    this.applyTheme(this.settings.theme, false);

    this._onNativeTheme = () => {
      this._syncThemeCookies();
      this.updateWindowBackground();
      this.tabManager?.updateViewsBackground();
      this.tabManager?.refreshSearchThemes();
      this.sendState();
      this.notifySettingsTabs();
      this._broadcastThemeToPages();
    };
    nativeTheme.on('updated', this._onNativeTheme);
  }

  // Кука темы Bing — только в обычной сессии; в Инкогнито ничего не подсаживаем.
  // Нужна лишь когда включена стилизация поиска И выбран Bing
  _syncThemeCookies() {
    if (!this.settings.prettySearch || this.settings.searchEngine !== 'bing') return;
    syncSearchEngineThemeCookies(session.defaultSession, this.getResolvedTheme());
  }

  // Прокси раздельно для обычной сессии и Инкогнито (режим «только Инкогнито» — см. proxy.js).
  // Вызовы выстраиваются в очередь, чтобы быстрые смены настроек не перемешались; промис не отклоняется
  applyProxy() {
    const run = async () => {
      await applySessionProxy(session.defaultSession, this.settings, { incognito: false });
      const incs = this.registry ? this.registry.incognitoSessions() : (this._incognitoSession ? [this._incognitoSession] : []);
      for (const inc of incs) await applySessionProxy(inc, this.settings, { incognito: true });
    };
    this._proxyChain = this._proxyChain.then(run, run);
    return this._proxyChain;
  }

  // Сессия Инкогнито этого окна для списка загрузок (в обычном режиме null: там фильтр только по режиму)
  _downloadsSession() {
    return this.isIncognito ? this._incognitoSession : null;
  }

  getActiveSession() {
    return this.isIncognito && this._incognitoSession ? this._incognitoSession : session.defaultSession;
  }

  getSettings() {
    return this.settings;
  }

  get isPrimary() { return !this.registry || this.registry.primary === this; }

  // Единая точка сохранения настроек: остальные окна подхватывают новый объект
  _saveSettings(next) {
    this.settings = storage.saveSettings(next);
    this.registry?.syncSettings(this);
    return this.settings;
  }

  // Настройки изменило другое окно: обновляем оформление/раскладку здесь
  _onSharedSettingsChanged() {
    if (!this.win || this.win.isDestroyed()) return;
    this._applyCustomTheme();
    this.updateWindowBackground();
    this.tabManager?.updateViewsBackground();
    this.tabManager?.refreshSearchThemes();
    this.omnibox?.hide();
    this.mainMenu?.hide();
    this.downloadsPopup?.hide();
    try { this.tabManager?.layout(); } catch { /* окно закрывается */ }
    this.sendState();
    this.notifySettingsTabs();
  }

  _onDownloadsChanged() {
    this.sendState();
    this.downloadsPopup?.refresh(); // прогресс в открытом попапе обновляется в реальном времени
    this._notifyDownloadsPage(); // и на открытых вкладках browser://downloads
  }

  // Принадлежит ли webContents этому окну (UI, вкладки, попапы)
  ownsSender(sender) {
    if (this.win && !this.win.isDestroyed() && sender === this.win.webContents) return true;
    if (this.tabManager && this.tabManager.ownsContents(sender)) return true;
    const ev = { sender };
    return Boolean(this.omnibox?.isSender(ev) || this.mainMenu?.isSender(ev) || this.downloadsPopup?.isSender(ev));
  }

  moveTabToNewWindow(tabId, point = null) {
    if (!this.registry) return;
    this.omnibox?.hide();
    this.mainMenu?.hide();
    this.downloadsPopup?.hide();
    this._closeSitePopover(); // иначе перенесённый view останется в списке скрытых «на время поповера»
    this.registry.moveTabToNewWindow(this, tabId, point);
  }

  getResolvedTheme() {
    if (this.settings.theme === 'dark') return 'dark';
    if (this.settings.theme === 'light') return 'light';
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  getFrameBackgroundColor() {
    const c = this.customTheme;
    if (c && this.settings.chromeTheme === 'custom') {
      return this.getResolvedTheme() === 'dark' ? c.frame : c.lightFrame;
    }
    return this.getResolvedTheme() === 'dark' ? '#090a0f' : '#e6eaf2';
  }

  _getNewTabState() {
    if (!this._newTabStateCache) {
      try { this._newTabStateCache = storage.loadNewTabState(); } catch { return null; }
    }
    return this._newTabStateCache;
  }

  getWallpaperInfo() {
    const st = this._getNewTabState();
    const custom = Boolean(st && st.wallpaperType === 'custom' && st.customWallpaperFile);
    return {
      active: Boolean(this.settings.transparentChrome && custom),
      available: custom,
      url: custom ? `browser://wallpaper?v=${st.wallpaperVersion}` : '',
      video: custom ? /\.(mp4|webm)$/i.test(st.customWallpaperFile) : false,
      dim: custom && typeof st.dim === 'number' ? st.dim : 28,
      blur: custom && typeof st.blur === 'number' ? st.blur : 0,
      searchBlur: (this.tabManager && this.tabManager.isActiveSearchGlass && this.tabManager.isActiveSearchGlass()) ? 12 : 0,
      visible: Boolean(this.win && !this.win.isDestroyed() && !this.win.isMinimized()) &&
        Boolean(this.tabManager && this.tabManager.isWallpaperVisibleForActive && this.tabManager.isWallpaperVisibleForActive())
    };
  }

  isTransparentChrome() {
    const st = this._getNewTabState();
    const custom = Boolean(st && st.wallpaperType === 'custom' && st.customWallpaperFile);
    return Boolean(this.settings.transparentChrome && custom);
  }

  setTransparentChrome(enabled) {
    this._saveSettings({ ...this.settings, transparentChrome: Boolean(enabled) });
    this.tabManager?.updateViewsBackground();
    this.tabManager?.refreshSearchThemes();
    this.sendState();
  }

  onNewTabStateChanged() {
    for (const wm of (this.registry ? this.registry.all() : [this])) wm._onNewTabStateChangedLocal();
  }

  _onNewTabStateChangedLocal() {
    this._newTabStateCache = null;
    this.tabManager?.updateViewsBackground();
    this.tabManager?.refreshSearchThemes();
    this.sendState();
  }

  _applyCustomTheme() {
    const seed = this.settings.customThemeSeed;
    this.customTheme = this.settings.chromeTheme === 'custom' && seed ? buildCustomTheme(seed) : null;
    setCustomTokens(this.customTheme ? this.customTheme.search : null);
    const wc = this.win && !this.win.isDestroyed() ? this.win.webContents : null;
    if (!wc || wc.isDestroyed()) return;
    const old = this._customCssKey;
    this._customCssKey = null;
    const done = () => { if (old) wc.removeInsertedCSS(old).catch(() => {}); };
    if (this.customTheme) {
      wc.insertCSS(this.customTheme.css).then((k) => { this._customCssKey = k; done(); }).catch(done);
    } else {
      done();
    }
  }

  setCustomChromeTheme(seed, mode) {
    const clean = sanitizeSeed(seed);
    if (!clean || !this.win || this.win.isDestroyed()) return;
    this.settings.customThemeSeed = clean;
    this.settings.chromeTheme = 'custom';
    this._applyCustomTheme();
    this.applyTheme(mode === 'light' ? 'light' : 'dark');
  }

  getPageBackgroundColor() {
    return this.getResolvedTheme() === 'dark' ? '#0b0c12' : '#f4f6fb';
  }

  updateWindowBackground() {
    if (!this.win || this.win.isDestroyed()) return;
    this.win.setBackgroundColor(this.getFrameBackgroundColor());
    this.gemini?.updateBackground();
  }

  applyTheme(theme, persist = true) {
    if (!['dark', 'light', 'system'].includes(theme)) return;
    this.settings.theme = theme;
    nativeTheme.themeSource = theme;
    if (persist) {
      this._saveSettings(this.settings);
    }
    this._syncThemeCookies();
    this.updateWindowBackground();
    this.tabManager?.updateViewsBackground();
    this.tabManager?.refreshSearchThemes();
    this.sendState();
    this.notifySettingsTabs();
    this._broadcastThemeToPages();
  }

  // Открытые browser://-страницы получают новую палитру (колбэк задаёт main/index.js)
  _broadcastThemeToPages() {
    if (this.win && !this.win.isDestroyed()) this.registry?.onThemeChanged?.();
  }

  setChromeTheme(id, mode) {
    this.settings.chromeTheme = id;
    this._applyCustomTheme();
    this.applyTheme(mode === 'light' ? 'light' : 'dark');
  }

  setChromeThemeKeepMode(id) {
    if (this.settings.chromeTheme === id) return;
    this._saveSettings({ ...this.settings, chromeTheme: id });
    this._applyCustomTheme();
    this.updateWindowBackground();
    this.tabManager?.refreshSearchThemes();
    this.sendState();
    this.notifySettingsTabs();
  }

  updateSettings(patch) {
    const prevTheme = this.settings.theme;
    const prevPrettySearch = this.settings.prettySearch;
    const prevSearchEngine = this.settings.searchEngine;
    const prevAdblock = this.settings.adblock;
    const prevTrusted = this.settings.trustedSources;
    const prevVertical = this.settings.verticalTabs;
    const prevVerticalCollapsed = this.settings.verticalTabsCollapsed;
    const prevBmBar = this.settings.showBookmarksBar;
    this._saveSettings({ ...this.settings, ...patch });

    // Панель закладок показана/скрыта: страницы сдвигаются, попапы закрываем (их якоря сдвинулись)
    if (this.settings.showBookmarksBar !== prevBmBar) {
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      this._closeSitePopover();
      try { this.tabManager?.layout(); } catch { /* окно закрывается */ }
    }

    // Сайдбар включён/выключен/свёрнут: страницы получают новые границы, попапы закрываем (их якоря сдвинулись)
    if (this.settings.verticalTabs !== prevVertical || this.settings.verticalTabsCollapsed !== prevVerticalCollapsed) {
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      try { this.tabManager?.layout(); } catch { /* окно закрывается */ }
    }

    if (this.settings.theme !== prevTheme) {
      nativeTheme.themeSource = this.settings.theme;
      this.updateWindowBackground();
      this.tabManager?.updateViewsBackground();
      this._broadcastThemeToPages();
    }
    // Кука Bing: при смене темы, включении prettySearch или переключении поисковика на Bing
    if (
      this.settings.theme !== prevTheme ||
      this.settings.prettySearch !== prevPrettySearch ||
      this.settings.searchEngine !== prevSearchEngine
    ) {
      this._syncThemeCookies();
    }
    if (this.settings.adblock !== prevAdblock) {
      adblock.setEnabled(session.defaultSession, this.settings.adblock);
      const incs = this.registry ? this.registry.incognitoSessions() : (this._incognitoSession ? [this._incognitoSession] : []);
      for (const inc of incs) adblock.setEnabled(inc, this.settings.adblock);
    }
    if (
      this.settings.theme !== prevTheme ||
      this.settings.prettySearch !== prevPrettySearch ||
      this.settings.trustedSources !== prevTrusted
    ) {
      this.tabManager?.refreshSearchThemes();
    }
    this.sendState();
    this.notifySettingsTabs();
  }

  getSettingsPayload() {
    const engines = Object.entries(SEARCH_ENGINES).map(([key, val]) => ({
      key,
      name: val.name,
      short: val.short,
      color: val.color
    }));
    return {
      settings: this.settings,
      resolvedTheme: this.getResolvedTheme(),
      chromeTheme: this.settings.chromeTheme,
      engines,
      incognito: Boolean(this.isIncognito),
      blockedCount: adblock.getBlockedCount()
    };
  }

  notifySettingsTabs() {
    if (!this.tabManager) return;
    const payload = this.getSettingsPayload();
    for (const tab of this.tabManager.tabs) {
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      try {
        if (tab.view.webContents.getURL().startsWith(SETTINGS_URL)) {
          tab.view.webContents.send('settings:changed', payload);
        }
      } catch { /* вкладка закрывается */ }
    }
  }

  openSettingsTab() {
    if (!this.tabManager) return;
    const existing = this.tabManager.tabs.find((t) => {
      const url = (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.getURL()) || t.url || '';
      return url.startsWith(SETTINGS_URL);
    });
    if (existing) {
      this.tabManager.switchTab(existing.id);
    } else {
      this.tabManager.createTab(SETTINGS_URL, { active: true });
    }
  }

  // Страница истории: переключаемся на уже открытую вкладку или создаём новую
  openHistoryTab() {
    if (!this.tabManager) return;
    const existing = this.tabManager.tabs.find((t) => {
      const url = (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.getURL()) || t.url || '';
      return url.startsWith(HISTORY_URL);
    });
    if (existing) {
      this.tabManager.switchTab(existing.id);
    } else {
      this.tabManager.createTab(HISTORY_URL, { active: true });
    }
  }

  // Диспетчер закладок (Ctrl+Shift+O): переключаемся на уже открытую вкладку или создаём новую
  openBookmarksTab() {
    if (!this.tabManager) return;
    const existing = this.tabManager.tabs.find((t) => {
      const url = (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.getURL()) || t.url || '';
      return url.startsWith(BOOKMARKS_URL);
    });
    if (existing) {
      this.tabManager.switchTab(existing.id);
    } else {
      this.tabManager.createTab(BOOKMARKS_URL, { active: true });
    }
  }

  toggleBookmarkActive() {
    if (this.isIncognito) return; // Инкогнито: ничего не пишем в bookmarks.json (в т.ч. по Ctrl+D)
    if (!this.tabManager) return;
    const tab = this.tabManager.getActive();
    if (!tab) return;
    const wc = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
    const url = (wc ? wc.getURL() : tab.url) || '';
    const title = (wc ? wc.getTitle() : tab.title) || url;
    if (!/^https?:\/\//i.test(url)) return;
    storage.toggleBookmark(url, title);
    this.sendState();
    this.notifyNewTabBookmarks();
  }

  // ---- Панель закладок и поповер звёздочки ----
  getBookmarksBarHeight() {
    return this.settings.showBookmarksBar && !this.isIncognito ? BM_BAR_HEIGHT : 0;
  }

  toggleBookmarksBar() {
    if (this.isIncognito) return; // в Инкогнито панель скрыта
    this.updateSettings({ showBookmarksBar: !this.settings.showBookmarksBar });
  }

  // Адрес и заголовок активной http(s)-страницы (не Инкогнито) или null
  _getActivePage() {
    if (this.isIncognito || !this.tabManager) return null;
    const tab = this.tabManager.getActive();
    if (!tab) return null;
    const wc = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
    const url = (wc ? wc.getURL() : tab.url) || '';
    if (!/^https?:\/\//i.test(url)) return null;
    return { url, title: (wc ? wc.getTitle() : tab.title) || url };
  }

  getActiveBookmarkInfo() {
    const page = this._getActivePage();
    if (!page) return { ok: false };
    const bm = storage.getBookmarkByUrl(page.url);
    return { ok: true, bookmarked: Boolean(bm), title: bm ? bm.title : page.title, parentId: bm ? bm.parentId : null };
  }

  // Звёздочка / Ctrl+D: как в Chrome — страница сразу попадает в корень, поповер уточняет название и папку
  openBookmarkPopover() {
    const page = this._getActivePage();
    if (!page || !this.win || this.win.isDestroyed() || this.win.webContents.isDestroyed()) return;
    if (!storage.getBookmarkByUrl(page.url)) {
      storage.toggleBookmark(page.url, page.title);
      this.sendState();
      this.notifyNewTabBookmarks();
      this.notifyNewTabStudioBookmarks();
    }
    this.win.webContents.send('bookmark-popover:open');
  }

  // payload: { title, parentId|null }. Адрес берём из активной вкладки, а не от renderer
  saveActiveBookmark(p) {
    const page = this._getActivePage();
    if (!page) return { ok: false, error: 'Страница недоступна.' };
    const parentId = typeof p.parentId === 'string' && p.parentId ? p.parentId : null;
    const title = typeof p.title === 'string' ? p.title : '';
    const existing = storage.getBookmarkByUrl(page.url);
    if (!existing) return storage.createBookmarkNode({ url: page.url, title: title || page.title, parentId });
    if (existing.parentId !== parentId) {
      const moved = storage.moveBookmarkNode({ id: existing.id, parentId });
      if (!moved.ok) return moved;
    }
    return storage.updateBookmarkNode({ id: existing.id, title });
  }

  removeActiveBookmark() {
    const page = this._getActivePage();
    const bm = page && storage.getBookmarkByUrl(page.url);
    if (!bm) return { ok: false, error: 'Закладка не найдена.' };
    return storage.removeBookmarkNode(bm.id);
  }

  // Рассылает изменения закладок: список ★ — во вкладки browser://newtab, ревизию дерева — в диспетчеры browser://bookmarks
  notifyNewTabBookmarks() {
    for (const wm of (this.registry ? this.registry.all() : [this])) {
      wm._notifyNewTabBookmarksLocal();
      if (wm !== this) wm.sendState(); // звёздочка в адресной строке соседних окон
    }
  }

  _notifyNewTabBookmarksLocal() {
    if (!this.tabManager) return;
    const list = this.isIncognito ? [] : storage.loadBookmarks();
    const rev = this.isIncognito ? 0 : storage.getBookmarksRev();
    for (const tab of this.tabManager.tabs) {
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      try {
        const wc = tab.view.webContents;
        const url = wc.getURL();
        if (url.startsWith('browser://newtab')) wc.send('internal:bookmarks:changed', list);
        else if (url.startsWith(BOOKMARKS_URL)) wc.send('bookmarks:changed', { rev });
      } catch { /* вкладка закрывается */ }
    }
  }

  // Папки и группы Новой вкладки изменились в дереве закладок: обновляем открытые вкладки browser://newtab
  // (кроме `except` — вкладки, которая сама прислала изменение)
  notifyNewTabStudioBookmarks(except = null) {
    for (const wm of (this.registry ? this.registry.all() : [this])) wm._notifyNewTabStudioBookmarksLocal(except);
  }

  _notifyNewTabStudioBookmarksLocal(except = null) {
    if (!this.tabManager || this.isIncognito) return;
    const bm = storage.getStudio().bm;
    if (!bm) return;
    for (const tab of this.tabManager.tabs) {
      if (!tab.view || tab.view.webContents.isDestroyed()) continue;
      try {
        const wc = tab.view.webContents;
        if (wc !== except && wc.getURL().startsWith('browser://newtab')) wc.send('internal:studio-bm:changed', bm);
      } catch { /* вкладка закрывается */ }
    }
  }

  _createTabManager(ses, incognito = false) {
    const tm = new TabManager({
      win: this.win,
      session: ses,
      incognito,
      getSettings: () => this.settings,
      getResolvedTheme: () => this.getResolvedTheme(),
      getChromeTheme: () => this.settings.chromeTheme,
      isTransparentChrome: () => this.isTransparentChrome(),
      getPageBackgroundColor: () => this.getPageBackgroundColor(),
      onStateChange: () => this.sendState(),
      onSessionDirty: () => this.scheduleSessionSave(),
      onShortcut: (event, input) => this.handleShortcut(event, input, 'page'),
      onFindChange: (payload) => this.sendFindState(payload),
      onFindFocus: () => this.focusFindBar(),
      onAuthChange: () => this.sendAuthState(),
      getInsets: () => this._getPageInsets(),
      getRightInset: (windowWidth) => this._getGeminiInset(windowWidth),
      onLayout: ({ panelRect }) => this._layoutGemini(panelRect),
      isOverlayOpen: () => this._sitePopoverOpen
    });
    return tm;
  }

  // ---- Вертикальные вкладки ----
  getVerticalTabsInfo() {
    const enabled = Boolean(this.settings.verticalTabs);
    const collapsed = enabled && Boolean(this.settings.verticalTabsCollapsed);
    return { enabled, collapsed, width: enabled ? (collapsed ? VT_WIDTH_COLLAPSED : VT_WIDTH) : 0 };
  }

  toggleVerticalTabs() {
    this.updateSettings({ verticalTabs: !this.settings.verticalTabs });
  }

  toggleVerticalTabsCollapsed() {
    if (!this.settings.verticalTabs) {
      this.updateSettings({ verticalTabs: true, verticalTabsCollapsed: false });
      return;
    }
    this.updateSettings({ verticalTabsCollapsed: !this.settings.verticalTabsCollapsed });
  }

  // Отступы области страницы относительно классической раскладки: слева — сайдбар,
  // сверху — панель закладок минус убранная горизонтальная полоса вкладок. Letterboxing TabManager применяет уже после них
  _getPageInsets() {
    const vt = this.getVerticalTabsInfo();
    const top = this.getBookmarksBarHeight() - (vt.enabled ? Math.round(this._tabbarHeight) : 0);
    return { left: vt.enabled ? vt.width : 0, top };
  }

  // ---- Боковая панель Gemini ----
  // В Инкогнито панель недоступна (как в Chrome): там не должно быть входа в Google-аккаунт
  isGeminiAvailable() {
    return !this.isIncognito;
  }

  _getGeminiInset(windowWidth) {
    if (!this.gemini || !this.isGeminiAvailable()) return 0;
    return this.gemini.reservedWidth(windowWidth);
  }

  _layoutGemini(panelRect) {
    if (!this.gemini) return;
    if (!panelRect || !this.isGeminiAvailable()) { this.gemini.layout(null); return; }
    // panelRect включает зазор с разделителем слева
    this.gemini.layout({
      x: Math.round(panelRect.x + GEMINI_GAP),
      y: Math.round(panelRect.y),
      width: Math.max(0, Math.round(panelRect.width - GEMINI_GAP)),
      height: Math.round(panelRect.height)
    });
  }

  getGeminiState() {
    const st = this.gemini ? this.gemini.getState() : { open: false, width: 0, gap: GEMINI_GAP };
    const available = this.isGeminiAvailable();
    const [w] = this.win && !this.win.isDestroyed() ? this.win.getContentSize() : [0];
    return {
      available,
      open: available && st.open,
      width: available && st.open && this.gemini ? this.gemini.effectiveWidth(w) : 0,
      gap: st.gap
    };
  }

  toggleGeminiPanel(force) {
    if (!this.gemini || !this.isGeminiAvailable()) return;
    const open = typeof force === 'boolean' ? force : !this.gemini.isOpen();
    this.omnibox?.hide();
    this.mainMenu?.hide();
    this.downloadsPopup?.hide();
    this.gemini.setOpen(open);
    try { this.tabManager?.layout(); } catch { /* окно закрывается */ }
    if (open) this.gemini.focus();
    else {
      const wc = this._getActiveWebContents();
      if (wc && !wc.isDestroyed()) wc.focus();
    }
    this.sendState();
  }

  resizeGeminiPanel(width) {
    if (!this.gemini || !this.gemini.isOpen()) return;
    if (!this.gemini.setWidth(width)) return;
    try { this.tabManager?.layout(); } catch { /* окно закрывается */ }
    this.sendState();
    // Ширину запоминаем с задержкой: во время перетаскивания событий десятки в секунду
    clearTimeout(this._geminiWidthTimer);
    this._geminiWidthTimer = setTimeout(() => {
      if (this.gemini && this.settings.geminiPanelWidth !== this.gemini.width) {
        this.updateSettings({ geminiPanelWidth: this.gemini.width });
      }
    }, 400);
  }

  reloadGeminiPanel() {
    this.gemini?.reload();
  }

  _readTabbarHeight() {
    const wc = this.win && !this.win.isDestroyed() ? this.win.webContents : null;
    if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScript("parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tabbar-height'))")
      .then((h) => {
        if (!Number.isFinite(h) || h <= 0 || h === this._tabbarHeight) return;
        this._tabbarHeight = h;
        if (this.settings.verticalTabs) { try { this.tabManager?.layout(); } catch { /* ignore */ } }
      })
      .catch(() => {});
  }

  // Состояние диалога HTTP-авторизации для окна интерфейса: { visible: false } или { visible: true, requestId, host, port, realm, scheme, isProxy, secure, tabId }.
  // Повторы не шлём; при появлении нового запроса фокус уходит в окно интерфейса (страница на это время скрыта)
  sendAuthState() {
    if (!this.win || this.win.isDestroyed()) return;
    const wc = this.win.webContents;
    if (wc.isDestroyed()) return;
    const payload = this.tabManager ? this.tabManager.getAuthPayload() : { visible: false };
    const key = JSON.stringify(payload);
    if (key === this._lastAuthKey) return;
    this._lastAuthKey = key;
    if (payload.visible) {
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      wc.focus();
    }
    wc.send('auth:prompt', payload);
  }

  // Новая временная сессия Инкогнито (общая логика для режима в окне и отдельного окна)
  async _openIncognitoSession() {
    // random-суффикс: два окна Инкогнито в одну миллисекунду не должны получить общий partition
    const incSes = session.fromPartition(`incognito-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, { cache: false });
    this.registry?.retainIncognito(incSes);
    configureSession(incSes, { incognito: true });
    registerProtocolHandler(incSes);
    // Прокси должен стоять до первого запроса первой Инкогнито-вкладки
    await applySessionProxy(incSes, this.settings, { incognito: true });
    this.downloads?.attach(incSes, { incognito: true });
    // Первая Инкогнито-вкладка не должна грузиться без блокировщика (ожидание ограничено таймаутом)
    await adblock.settleWithin(adblock.setEnabled(incSes, this.settings.adblock !== false), 2500);
    return incSes;
  }

  _cleanupIncognitoSession(incSes) {
    if (!incSes) return;
    if (this.registry && this.registry.releaseIncognito(incSes) > 0) return; // сессию ещё держит другое окно
    adblock.setEnabled(incSes, false).catch(() => {});
    this.downloads?.detach(incSes);
    this.downloads?.clearIncognito(incSes);
    incSes.clearStorageData().catch(() => {});
    incSes.clearCache().catch(() => {});
  }

  async toggleIncognito() {
    if (!this.win || this.win.isDestroyed() || !this.tabManager) return;
    if (this.dedicatedIncognito) { this.win.close(); return; } // «Выйти из Инкогнито» в отдельном окне = закрыть его
    if (this._togglingIncognito) return; // повторное нажатие, пока ждём AdBlock
    this._togglingIncognito = true;
    // incognitoNewWindow (по умолчанию true): Инкогнито открывается отдельным окном рядом с обычным
    if (!this.isIncognito && this.registry && this.settings.incognitoNewWindow !== false) {
      try { await this.registry.openIncognitoWindow(this); } finally { this._togglingIncognito = false; }
      return;
    }
    try {
      await this._toggleIncognitoInner();
    } finally {
      this._togglingIncognito = false;
    }
  }

  async _toggleIncognitoInner() {
    this.omnibox?.hide();
    this.mainMenu?.hide();
    this.downloadsPopup?.hide();
    this._closeSitePopover();
    this.tabManager.closeFindBar({ restoreFocus: false });
    this.tabManager.find.query = ''; // запрос Ctrl+F не переходит между режимами

    if (!this.isIncognito) {
      // Сохраняем обычные вкладки до входа в Инкогнито
      this._savedNormalSession = this._collectSessionData();
      if (this._savedNormalSession) storage.saveSessionSync(this._savedNormalSession);
      storage.flushHistorySync();

      const incSes = await this._openIncognitoSession();
      if (!this.win || this.win.isDestroyed()) {
        this._cleanupIncognitoSession(incSes);
        return;
      }

      this.tabManager.destroyAll();
      this._incognitoSession = incSes;
      this.isIncognito = true;
      this.tabManager = this._createTabManager(incSes, true);
      this.tabManager.createTab();
      this._sendStateNow();
      return;
    }

    // Выход из Инкогнито: уничтожаем временные вкладки, чистим сессию, возвращаем обычные вкладки
    this.tabManager.destroyAll();
    const oldInc = this._incognitoSession;
    this._incognitoSession = null;
    this.isIncognito = false;
    this._cleanupIncognitoSession(oldInc);

    const saved = this._savedNormalSession;
    this._savedNormalSession = null;
    this.tabManager = this._createTabManager(session.defaultSession, false);
    if (saved) this.tabManager.restoreSession(saved);
    else this.tabManager.createTab();
    this._sendStateNow();
  }

  _validateBounds(bounds) {
    const defaults = { width: 1320, height: 840 };
    if (!bounds || typeof bounds !== 'object') return defaults;

    const width = Math.max(540, Number(bounds.width) || defaults.width);
    const height = Math.max(420, Number(bounds.height) || defaults.height);

    if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') {
      return { width, height };
    }

    const visible = screen.getAllDisplays().some(display => {
      const wa = display.workArea;
      return (
        bounds.x + 80 >= wa.x &&
        bounds.x <= wa.x + wa.width - 80 &&
        bounds.y >= wa.y &&
        bounds.y <= wa.y + wa.height - 60
      );
    });

    return visible ? { x: bounds.x, y: bounds.y, width, height } : { width, height };
  }

  _collectSessionData() {
    if (!this.win || this.win.isDestroyed() || !this.tabManager) return null;
    if (!this.tabManager.tabs.length) return null; // вкладки ещё не восстановлены: не затираем session.json пустым списком
    const isMaximized = this.win.isMaximized();
    const windowBounds = this.win.getNormalBounds();
    return {
      windowBounds,
      isMaximized,
      ...this.tabManager.serializeSession()
    };
  }

  scheduleSessionSave() {
    if (this.isIncognito || !this.isPrimary) return;
    const data = this._collectSessionData();
    if (data) storage.scheduleSaveSession(data);
  }

  flushSessionSync() {
    storage.flushHistorySync();
    storage.flushStudioSync(); // отложенная запись настроек Студии тем не должна потеряться при выходе
    if (!this.isPrimary) return; // не основное окно и Инкогнито-окна session.json не трогают
    if (this.isIncognito) {
      // Не перезаписываем обычную сессию инкогнито-вкладками
      if (this._savedNormalSession) storage.saveSessionSync(this._savedNormalSession);
      return;
    }
    const data = this._collectSessionData();
    if (data) storage.saveSessionSync(data);
  }

  // Окно интерфейса грузит только свой index.html: любые навигации, <webview> и попапы запрещены
  _lockdownUiWebContents() {
    const wc = this.win.webContents;
    const deny = (event) => event.preventDefault();
    wc.on('will-navigate', deny);
    wc.on('will-redirect', deny);
    wc.on('will-attach-webview', deny);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  // opts: { secondary, bounds, incognitoSession, adoptPayload }. Без opts — основное окно (восстанавливает сессию)
  createMainWindow(opts = {}) {
    const savedSession = !opts.secondary && this.settings.restoreSession ? storage.loadSession() : null;
    const bounds = this._validateBounds(opts.bounds || savedSession?.windowBounds);

    this.win = new BrowserWindow({
      ...bounds,
      minWidth: 540,
      minHeight: 420,
      frame: false,
      show: false,
      icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
      backgroundColor: this.getFrameBackgroundColor(),
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'uiPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        navigateOnDragDrop: false
      }
    });

    this.id = this.win.id;
    this.registry?.register(this);
    this.win.removeMenu();
    this._lockdownUiWebContents();

    // Прокси обычной сессии применяется до создания первой вкладки (ожидается в did-finish-load)
    this._proxyReady = this.applyProxy();

    // Панель Gemini создаётся закрытой; WebContentsView с gemini.google.com появляется при первом открытии
    this.gemini = new GeminiPanel({
      win: this.win,
      getSession: () => session.defaultSession, // общая с вкладками сессия: общий вход в Google
      width: this.settings.geminiPanelWidth,
      getBackgroundColor: () => this.getPageBackgroundColor(),
      openInTab: (url) => this.tabManager?.createTab(url),
      onShortcut: (event, input) => this.handleShortcut(event, input, 'gemini'),
      onRelayout: () => { try { this.tabManager?.layout(); } catch { /* окно закрывается */ } }
    });
    if (opts.incognitoSession) {
      this._incognitoSession = opts.incognitoSession;
      this.isIncognito = true;
      this.tabManager = this._createTabManager(opts.incognitoSession, true);
    } else {
      this.tabManager = this._createTabManager(session.defaultSession, false);
    }
    // Перенос вкладки: живой WebContentsView переезжает в этот менеджер без перезагрузки страницы
    if (opts.adoptPayload) {
      this.tabManager.adoptTab(opts.adoptPayload);
      this._adopted = true;
    }

    this.omnibox = new OmniboxPopup({
      win: this.win,
      getTabs: () => (this.tabManager ? this.tabManager.getStateSnapshot().tabs : []),
      getActiveId: () => (this.tabManager ? this.tabManager.activeId : null),
      getSettings: () => this.settings,
      isIncognito: () => this.isIncognito,
      getResolvedTheme: () => this.getResolvedTheme(),
      getChromeTheme: () => this.settings.chromeTheme,
      getCustomCss: () => (this.customTheme && this.settings.chromeTheme === 'custom' ? this.customTheme.css : ''),
      navigate: (text, opts) => this.tabManager?.navigateActive(text, opts),
      switchTab: (id) => this.tabManager?.switchTab(id)
    });

    this.mainMenu = new MainMenuPopup({
      win: this.win,
      buildModel: () => this._buildMainMenuModel(),
      getResolvedTheme: () => this.getResolvedTheme(),
      getChromeTheme: () => this.settings.chromeTheme,
      getCustomCss: () => (this.customTheme && this.settings.chromeTheme === 'custom' ? this.customTheme.css : ''),
      onShortcut: (event, input) => this.handleShortcut(event, input, 'ui')
    });

    this.downloadsPopup = new DownloadsPopup({
      win: this.win,
      downloads: this.downloads,
      isIncognito: () => this.isIncognito,
      getSession: () => this._downloadsSession(),
      getResolvedTheme: () => this.getResolvedTheme(),
      getChromeTheme: () => this.settings.chromeTheme,
      getCustomCss: () => (this.customTheme && this.settings.chromeTheme === 'custom' ? this.customTheme.css : ''),
      onShortcut: (event, input) => this.handleShortcut(event, input, 'ui'),
      onOpenFullPage: () => this.openDownloadsPage(),
      // Escape и выбор действия возвращают фокус странице; закрытие по клику вне попапа фокус не трогает
      onClose: ({ restoreFocus }) => {
        if (!restoreFocus || !this.win || this.win.isDestroyed()) return;
        const wc = this._getActiveWebContents();
        if (wc && !wc.isDestroyed()) wc.focus();
        else this.win.webContents.focus();
      }
    });

    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    let shown = false;
    const revealWindow = () => {
      if (shown || !this.win || this.win.isDestroyed()) return;
      shown = true;
      if (savedSession?.isMaximized) {
        this.win.maximize();
      }
      this.win.show();
    };

    const fallbackShowTimer = setTimeout(revealWindow, 500);

    this.win.webContents.once('did-finish-load', async () => {
      this._readTabbarHeight();
      await this._proxyReady;
      if (!this.win || this.win.isDestroyed() || !this.tabManager) {
        clearTimeout(fallbackShowTimer);
        return;
      }
      this._applyCustomTheme();
      this.updateWindowBackground();

      if (this._adopted) {
        // вкладка уже перенесена из другого окна
      } else if (savedSession && this.settings.restoreSession) {
        this.tabManager.restoreSession(savedSession);
      } else {
        this.tabManager.createTab();
      }
      this._lastAuthKey = null; // интерфейс (пере)загружен: отправить состояние диалога заново
      this._sendStateNow();
      clearTimeout(fallbackShowTimer);
      setTimeout(revealWindow, 40);
    });

    this.win.webContents.on('before-input-event', (event, input) => {
      this.handleShortcut(event, input, 'ui');
    });

    const syncLayoutAndState = () => {
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      if (this.tabManager) this.tabManager.layout();
      this.sendState();
    };

    const scheduleBoundsSave = () => {
      if (this.boundsTimer) clearTimeout(this.boundsTimer);
      this.boundsTimer = setTimeout(() => this.scheduleSessionSave(), 400);
    };

    this.win.on('resize', () => {
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      if (this.tabManager) this.tabManager.layout();
      scheduleBoundsSave();
    });
    this.win.on('move', () => {
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      scheduleBoundsSave();
    });
    this.win.on('maximize', syncLayoutAndState);
    this.win.on('unmaximize', syncLayoutAndState);
    this.win.on('minimize', () => {
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      this.sendState();
    });
    this.win.on('restore', () => this.sendState());
    this.win.on('enter-full-screen', syncLayoutAndState);
    this.win.on('leave-full-screen', syncLayoutAndState);

    this.win.on('close', () => {
      const reg = this.registry;
      // Основное окно с живыми «соседями» сессию не пишет: её подхватит следующее обычное окно (см. unregister).
      // Последнее обычное окно, выход из приложения и одиночный режим пишут как раньше
      if (!reg || reg.quitting || !this.isPrimary || !reg.hasOtherNormalWindows(this)) this.flushSessionSync();
      else storage.flushHistorySync();
    });

    this.win.on('closed', () => {
      this.registry?.unregister(this);
      nativeTheme.removeListener('updated', this._onNativeTheme);
      clearTimeout(fallbackShowTimer);
      this._dropPasswordPrompt(); // пароль не должен оставаться в памяти после закрытия окна
      if (this.boundsTimer) clearTimeout(this.boundsTimer);
      if (this.omnibox) {
        this.omnibox.destroy();
        this.omnibox = null;
      }
      if (this.mainMenu) {
        this.mainMenu.destroy();
        this.mainMenu = null;
      }
      if (this.downloadsPopup) {
        this.downloadsPopup.destroy();
        this.downloadsPopup = null;
      }
      clearTimeout(this._geminiWidthTimer);
      if (this.gemini) {
        this.gemini.destroy();
        this.gemini = null;
      }
      if (this.tabManager) {
        this.tabManager.destroyAll();
        this.tabManager = null;
      }
      if (this._incognitoSession) {
        const inc = this._incognitoSession;
        this._incognitoSession = null;
        this.isIncognito = false;
        this._cleanupIncognitoSession(inc);
      }
      this.win = null;
    });

    return this.win;
  }

  // Состояние интерфейса шлём не чаще раза в кадр (16 мс): загрузка страниц, прогресс скачиваний и смена заголовков
  // порождают десятки событий подряд, а снимок состояния собирается заново каждый раз. Читается он в момент отправки,
  // поэтому устаревшие данные не уходят. Где важна мгновенность (создание окна, смена режима) — _sendStateNow()
  sendState() {
    if (this._statePending) return;
    this._statePending = true;
    setTimeout(() => {
      this._statePending = false;
      this._sendStateNow();
    }, STATE_BATCH_MS);
  }

  _sendStateNow() {
    if (!this.win || this.win.isDestroyed() || !this.tabManager) return;
    const tabState = this.tabManager.getStateSnapshot();
    if (tabState.activeId !== this._lastActiveTabId) {
      this._lastActiveTabId = tabState.activeId;
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      this._closeSitePopover(); // смена вкладки закрывает карточку замочка (она относилась к прошлой вкладке)
    }

    const active = this.tabManager.getActive();
    const activeWc = active && active.view && !active.view.webContents.isDestroyed()
      ? active.view.webContents
      : null;
    const wcActiveUrl = activeWc ? activeWc.getURL() : '';
    const rawActiveUrl = (wcActiveUrl.startsWith('browser://error')
      ? wcActiveUrl
      : (active?.url || wcActiveUrl)) || '';

    this.win.webContents.send('state', {
      ...tabState,
      isMaximized: this.win.isMaximized(),
      isIncognito: this.isIncognito,
      verticalTabs: this.getVerticalTabsInfo(),
      gemini: this.getGeminiState(),
      bookmarksBar: { visible: this.getBookmarksBarHeight() > 0, height: BM_BAR_HEIGHT },
      bookmarksRev: this.getBookmarksBarHeight() > 0 ? storage.getBookmarksRev() : 0, // панель перечитывает дерево при смене ревизии
      isBookmarked: this.isIncognito ? false : storage.isBookmarked(rawActiveUrl),
      themeSetting: this.settings.theme,
      resolvedTheme: this.getResolvedTheme(),
      chromeTheme: this.settings.chromeTheme,
      sleepMinutes: this.settings.sleepMinutes,
      searchEngine: this.settings.searchEngine,
      wallpaper: this.getWallpaperInfo(),
      downloads: this.downloads
        ? this.downloads.getSummary({ incognito: this.isIncognito, ses: this._downloadsSession() })
        : { activeCount: 0, progress: 0, totalItems: 0 }
    });
    this.sendAuthState(); // дедуплицируется; покрывает смену менеджера (Инкогнито) и перезагрузку интерфейса
    this.downloadsPopup?.refresh(); // смена темы и т.п. доезжает до открытого попапа загрузок
  }

  handleShortcut(event, input, source = 'page') {
    if (input.type !== 'keyDown' || !this.tabManager) return;

    const ctrl = input.control || input.meta;
    const shift = input.shift;
    const alt = input.alt;
    const code = input.code;

    if (alt && !ctrl && !shift) {
      // Alt+G — панель Gemini, как в Chrome
      if (code === 'KeyG') {
        event.preventDefault();
        this.toggleGeminiPanel();
        return;
      }
      if (source === 'gemini') return; // остальные Alt-сочетания в панели (Назад/Вперёд) — её собственные
      if (code === 'ArrowLeft') {
        event.preventDefault();
        this.tabManager.goBack();
      } else if (code === 'ArrowRight') {
        event.preventDefault();
        this.tabManager.goForward();
      }
      return;
    }

    if (!ctrl && !alt) {
      if (code === 'F5') {
        event.preventDefault();
        this.tabManager.reloadActive(shift);
        return;
      }
      if (code === 'F11') {
        event.preventDefault();
        if (this.win && !this.win.isDestroyed()) this.win.setFullScreen(!this.win.isFullScreen());
        return;
      }
      if (code === 'F6') {
        event.preventDefault();
        this.focusUrlBar();
        return;
      }
      if (code === 'F12') {
        event.preventDefault();
        this.toggleDevToolsActive();
        return;
      }
      if (code === 'F3') {
        event.preventDefault();
        if (this.tabManager.isFindOpen()) this.tabManager.findNext(!shift);
        else this.tabManager.openFindBar();
        return;
      }
      if (code === 'Escape') {
        if (this.tabManager.isFindVisible()) {
          if (source === 'page') {
            event.preventDefault(); // Escape не должен проваливаться на веб-страницу
            this.tabManager.closeFindBar();
          }
          return;
        }
        const active = this.tabManager.getActive();
        if (active && active.loading) {
          event.preventDefault();
          this.tabManager.stopActive();
        }
        return;
      }
    }

    if (!ctrl || alt) return;

    if (code === 'KeyT' && !shift) {
      event.preventDefault();
      this.tabManager.createTab();
    } else if (code === 'KeyT' && shift) {
      event.preventDefault();
      this.tabManager.reopenClosedTab();
    } else if (code === 'KeyW' && !shift) {
      event.preventDefault();
      const active = this.tabManager.getActive();
      if (active) this.tabManager.closeTab(active.id);
    } else if (code === 'KeyF' && !shift) {
      event.preventDefault();
      this.tabManager.openFindBar();
    } else if (code === 'KeyD' && !shift) {
      event.preventDefault();
      this.openBookmarkPopover();
    } else if (code === 'KeyB' && shift) {
      event.preventDefault();
      this.toggleBookmarksBar();
    } else if (code === 'KeyO' && shift) {
      event.preventDefault();
      this.openBookmarksTab();
    } else if (code === 'KeyH' && !shift) {
      event.preventDefault();
      this.openHistoryTab();
    } else if (code === 'KeyJ' && !shift) {
      event.preventDefault();
      this.openDownloadsPage();
    } else if (code === 'Comma' && !shift) {
      event.preventDefault();
      this.openSettingsTab();
    } else if (code === 'KeyN' && shift) {
      event.preventDefault();
      this.toggleIncognito();
    } else if (code === 'KeyN' && !shift) {
      event.preventDefault();
      this.openNewWindow();
    } else if (code === 'KeyI' && shift) {
      event.preventDefault();
      this.toggleDevToolsActive();
    } else if (code === 'KeyS' && shift) {
      event.preventDefault();
      this.tabManager.toggleSplitView();
    } else if (code === 'KeyL' && !shift) {
      event.preventDefault();
      this.focusUrlBar();
    } else if (code === 'KeyR' || code === 'F5') {
      event.preventDefault();
      this.tabManager.reloadActive(shift);
    } else if (code === 'KeyP' && !shift) {
      event.preventDefault();
      this.tabManager.printActive();
    } else if (code === 'Equal' || code === 'NumpadAdd') {
      event.preventDefault();
      this.tabManager.zoomIn();
    } else if (code === 'Minus' || code === 'NumpadSubtract') {
      event.preventDefault();
      this.tabManager.zoomOut();
    } else if (!shift && (code === 'Digit0' || code === 'Numpad0')) {
      event.preventDefault();
      this.tabManager.zoomReset();
    } else if (code === 'Tab') {
      event.preventDefault();
      this.tabManager.switchRelative(shift ? -1 : 1);
    } else if (!shift && /^Digit[1-9]$/.test(code)) {
      event.preventDefault();
      this.tabManager.switchByPosition(Number(code.slice(5)));
    }
  }

  focusUrlBar() {
    if (!this.win || this.win.isDestroyed()) return;
    this.omnibox?.warmUp(); // ленивый попап подсказок: создаём заранее при фокусе адресной строки
    this.win.webContents.focus();
    this.win.webContents.send('focus-url');
  }

  // Вызывать из IPC-обработчика фокуса/клика по адресной строке в окне интерфейса
  warmOmnibox() {
    this.omnibox?.warmUp();
  }

  sendFindState(payload) {
    if (!this.win || this.win.isDestroyed()) return;
    const wc = this.win.webContents;
    if (wc.isDestroyed()) return;
    wc.send('find:state', payload);
  }

  focusFindBar() {
    if (!this.win || this.win.isDestroyed()) return;
    const wc = this.win.webContents;
    if (wc.isDestroyed()) return;
    wc.focus();
    wc.send('find:focus');
  }

  showTabContextMenu(tabId) {
    if (!this.win || !this.tabManager) return;
    const tab = this.tabManager.getTab(tabId);
    if (!tab) return;

    const isActive = tab.id === this.tabManager.activeId;
    const isSplitPartner = tab.id === this.tabManager.splitTabId;
    const hasSplit = this.tabManager.splitTabId !== null;
    const idx = this.tabManager.tabs.findIndex(t => t.id === tabId);

    const template = [
      {
        label: 'Новая вкладка справа',
        click: () => this.tabManager.createTab(null, { active: true, insertIndex: idx + 1 })
      },
      {
        label: 'Дублировать вкладку',
        click: () => this.tabManager.duplicateTab(tabId)
      },
      {
        label: tab.pinned ? 'Открепить вкладку' : 'Закрепить вкладку',
        click: () => this.tabManager.togglePinTab(tabId)
      },
      {
        label: tab.muted ? 'Включить звук вкладки' : 'Выключить звук вкладки',
        click: () => this.tabManager.toggleMuteTab(tabId)
      },
      ...(!isActive && !isSplitPartner
        ? [{ label: 'Открыть рядом (Split View)', click: () => this.tabManager.openSplitView(tabId) }]
        : []),
      ...(hasSplit
        ? [{ label: 'Закрыть Split View', click: () => this.tabManager.closeSplitView() }]
        : []),
      {
        label: tab.sleeping ? 'Разбудить вкладку' : 'Усыпить вкладку (освободить ОЗУ)',
        enabled: !isActive,
        click: () => {
          if (tab.sleeping) this.tabManager.switchTab(tabId);
          else this.tabManager.sleepTab(tabId);
        }
      },
      { label: 'Перенести в новое окно', click: () => this.moveTabToNewWindow(tabId) },
      ...(this.tabManager.workspacesEnabled
        ? [{
            label: 'Переместить в пространство',
            submenu: storage.getWorkspaces().map((ws) => ({
              label: ws.name,
              type: 'radio',
              checked: ws.id === tab.workspaceId,
              click: () => this.tabManager.moveTabToWorkspace(tabId, ws.id)
            }))
          }]
        : []),
      { type: 'separator' },
      {
        label: 'Восстановить закрытую вкладку',
        accelerator: 'CmdOrCtrl+Shift+T',
        enabled: this.tabManager.closedTabs.length > 0,
        click: () => this.tabManager.reopenClosedTab()
      },
      { type: 'separator' },
      {
        label: 'Закрыть вкладку',
        click: () => this.tabManager.closeTab(tabId)
      },
      {
        label: 'Закрыть другие вкладки',
        enabled: this.tabManager._wsTabs().some(t => t.id !== tabId && !t.pinned),
        click: () => this.tabManager.closeOtherTabs(tabId)
      }
    ];

    Menu.buildFromTemplate(template).popup({ window: this.win });
  }

  // Попап загрузок (стеклянный WebContentsView). rect — { left, right, bottom } кнопки в координатах окна интерфейса
  toggleDownloadsMenu(rect) {
    if (!this.win || this.win.isDestroyed() || !this.downloads || !this.downloadsPopup) return;
    if (!this.downloadsPopup.visible) {
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this._closeSitePopover();
    }
    this.downloadsPopup.toggle(rect);
  }

  // Совместимость со старым вызовом showDownloadsMenu(x, y)
  showDownloadsMenu(x, y) {
    const ok = Number.isFinite(x) && Number.isFinite(y);
    this.toggleDownloadsMenu(ok ? { left: x, right: x + 36, bottom: y } : null);
  }

  // Полная страница загрузок: открываем существующую вкладку или создаём новую
  openDownloadsPage() {
    if (!this.tabManager) return;
    const existing = this.tabManager.tabs.find((t) => {
      const url = (t.view && !t.view.webContents.isDestroyed() && t.view.webContents.getURL()) || t.url || '';
      return url.startsWith(DOWNLOADS_URL);
    });
    if (existing) this.tabManager.switchTab(existing.id);
    else this.tabManager.createTab(DOWNLOADS_URL, { active: true });
  }

  // Сообщаем открытым вкладкам browser://downloads, что список изменился (страница ещё и опрашивает main сама)
  _notifyDownloadsPage() {
    const tabs = this.tabManager ? this.tabManager.tabs : [];
    for (const t of tabs) {
      try {
        const wc = t.view && t.view.webContents;
        if (!wc || wc.isDestroyed()) continue;
        if (wc.getURL().startsWith(DOWNLOADS_URL)) wc.send('downloads:changed');
      } catch { /* вкладка закрывается */ }
    }
  }

  // ---- Панель безопасности сайта (поповер в окне интерфейса) ----
  _getActiveSiteContext() {
    if (!this.win || this.win.isDestroyed() || !this.tabManager) return null;
    const tab = this.tabManager.getActive();
    if (!tab) return null;
    const wc = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
    const url = (wc ? wc.getURL() : tab.url) || '';
    const ses = wc ? wc.session : this.getActiveSession();
    return { tab, url, ses };
  }

  // Сводка безопасности активной вкладки: статус соединения, домен, состояния прав для её origin
  getSiteInfo() {
    const ctx = this._getActiveSiteContext();
    if (!ctx) return null;
    return buildSiteInfo(ctx.ses, ctx.url, { isError: ctx.url.startsWith('browser://error'), tabId: ctx.tab.id });
  }

  // Меняем право только для origin активной вкладки: интерфейс не может править права чужого сайта
  setSitePermissionForActive(origin, permission, value) {
    const ctx = this._getActiveSiteContext();
    if (!ctx || typeof origin !== 'string' || getMediaOrigin(ctx.url) !== origin) return null;
    const ok = setSitePermissionByName(ctx.ses, origin, permission, value);
    return { ok, info: this.getSiteInfo() };
  }

  resetSitePermissionsForActive(origin) {
    const ctx = this._getActiveSiteContext();
    if (!ctx || typeof origin !== 'string' || getMediaOrigin(ctx.url) !== origin) return null;
    const ok = resetSitePermissions(ctx.ses, origin);
    return { ok, info: this.getSiteInfo() };
  }

  // ---- Рабочие пространства ----
  _broadcastWorkspaces() {
    if (this.registry) this.registry.workspacesChanged();
    else this.sendState();
  }

  switchWorkspace(id) {
    if (this.isIncognito || !this.tabManager) return;
    this.tabManager.switchWorkspace(id);
  }

  createWorkspace(name, color) {
    if (this.isIncognito || !this.tabManager) return;
    const ws = storage.createWorkspace(name, color);
    if (!ws) return;
    this._broadcastWorkspaces();
    this.tabManager.switchWorkspace(ws.id); // сразу открываем: в нём появится Новая вкладка
  }

  updateWorkspace(id, patch) {
    if (this.isIncognito) return;
    if (storage.updateWorkspace(id, patch)) this._broadcastWorkspaces();
  }

  deleteWorkspace(id) {
    if (this.isIncognito) return;
    if (!storage.deleteWorkspace(id)) return;
    // Вкладки удалённого пространства не закрываем: во всех окнах они переезжают в «Основное»
    for (const wm of this.registry ? this.registry.all() : [this]) {
      wm.tabManager?.moveWorkspaceTabs(id, storage.DEFAULT_WORKSPACE_ID);
    }
    this._broadcastWorkspaces();
  }

  // Пока карточка открыта, страницы (WebContentsView) скрываются, иначе они перекрыли бы HTML окна интерфейса
  // (как с диалогом HTTP-авторизации). При закрытии возвращаем только активную и парную вкладки.
  setSitePopoverOpen(open) {
    open = Boolean(open);
    if (open === this._sitePopoverOpen) return;
    if (!this.win || this.win.isDestroyed() || !this.tabManager) {
      this._sitePopoverOpen = false;
      this._hiddenForPopover = [];
      return;
    }
    if (open) {
      if (!this.tabManager.getActive()) return;
      this.omnibox?.hide();
      this.mainMenu?.hide();
      this.downloadsPopup?.hide();
      this._hiddenForPopover = [];
      for (const tab of this.tabManager.tabs) {
        const v = tab.view;
        if (!v || v.webContents.isDestroyed()) continue;
        let visible;
        try { visible = typeof v.getVisible === 'function' ? v.getVisible() : undefined; } catch { visible = undefined; }
        if (visible === undefined) visible = tab.id === this.tabManager.activeId || tab.id === this.tabManager.splitTabId;
        if (!visible) continue;
        try { v.setVisible(false); this._hiddenForPopover.push(v); } catch { /* view уже уничтожен */ }
      }
      this._sitePopoverOpen = true;
      this.win.webContents.focus();
      return;
    }
    this._restoreAfterSitePopover();
  }

  _restoreAfterSitePopover() {
    this._sitePopoverOpen = false;
    const hidden = this._hiddenForPopover;
    this._hiddenForPopover = [];
    const keep = new Set();
    const tm = this.tabManager;
    if (tm) {
      for (const tab of tm.tabs) {
        if (tab.id === tm.activeId || tab.id === tm.splitTabId) keep.add(tab.view);
      }
    }
    for (const v of hidden) {
      try {
        if (keep.has(v) && !v.webContents.isDestroyed()) v.setVisible(true);
      } catch { /* view уже уничтожен */ }
    }
    try { tm?.layout(); } catch { /* ignore */ }
  }

  // Закрытие со стороны main (смена вкладки, Инкогнито): возвращаем страницы и сообщаем интерфейсу
  _closeSitePopover() {
    this._dropPasswordPrompt(); // смена вкладки / Инкогнито / меню отменяют незавершённый запрос на сохранение
    if (!this._sitePopoverOpen) return;
    this._restoreAfterSitePopover();
    if (this.win && !this.win.isDestroyed() && !this.win.webContents.isDestroyed()) {
      this.win.webContents.send('site-popover:closed');
    }
  }

  // ---- «Сохранить пароль?»: открытый текст живёт только в памяти main и в окно интерфейса не уходит ----
  requestPasswordSave({ origin, host, username, password }) {
    if (this.isIncognito || !this.win || this.win.isDestroyed() || this.win.webContents.isDestroyed()) return;
    const cur = this._pwPrompt;
    if (cur && cur.origin === origin && cur.username === username && cur.password === password) return; // дубль
    this._dropPasswordPrompt();
    const promptId = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (this._pwPrompt && this._pwPrompt.promptId === promptId) this._closeSitePopover();
    }, PW_PROMPT_TTL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    this._pwPrompt = { promptId, origin, username, password, timer };
    this.win.webContents.send('password-save:prompt', { promptId, host, username });
  }

  respondPasswordSave(promptId, action) {
    const p = this._pwPrompt;
    if (!p || p.promptId !== promptId) return { ok: false, error: 'Запрос устарел.' };
    const { origin, username, password } = p;
    this._dropPasswordPrompt();
    if (action !== 'save' || this.isIncognito) return { ok: true, saved: false };
    return passwordManager.upsert({ origin, username, password });
  }

  _dropPasswordPrompt() {
    const p = this._pwPrompt;
    if (!p) return;
    this._pwPrompt = null;
    clearTimeout(p.timer);
    p.password = '';
  }

  // Панель замочка: статус соединения + права текущего сайта (нативное меню, как меню вкладки и загрузок:
  // HTML поверх страницы перекрыл бы WebContentsView)
  showSiteMenu(x, y) {
    if (!this.win || this.win.isDestroyed() || !this.tabManager) return;
    const tab = this.tabManager.getActive();
    if (!tab) return;
    const wc = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
    const url = (wc ? wc.getURL() : tab.url) || '';
    const ses = wc ? wc.session : this.getActiveSession(); // у спящей вкладки view нет — берём активную сессию

    let host = '';
    try { host = new URL(url).host; } catch { /* внутренняя страница */ }

    let status = 'Внутренняя страница браузера';
    if (url.startsWith('browser://error')) status = 'Не удалось загрузить страницу';
    else if (buildSiteInfo(ses, url).status === 'ssl-bypass') status = 'Сертификат не проверен (ваше исключение)';
    else if (url.startsWith('https://')) status = 'Соединение защищено (HTTPS)';
    else if (url.startsWith('http://')) status = 'Соединение не защищено (HTTP)';

    const info = getSitePermissionInfo(ses, url);
    const template = [];
    if (host) template.push({ label: host, enabled: false });
    template.push({ label: status, enabled: false });
    template.push({ type: 'separator' });

    if (!info.origin) {
      template.push({
        label: /^https?:\/\//i.test(url) ? 'Права недоступны на незащищённых страницах' : 'Для этой страницы права не настраиваются',
        enabled: false
      });
    } else {
      template.push({ label: 'Права для этого сайта', enabled: false });
      for (const item of info.items) {
        template.push({
          label: `${item.label}: ${item.stateText}`,
          submenu: [
            { label: item.askLabel, type: 'radio', checked: item.value === 'ask', click: () => setSitePermission(ses, info.origin, item.kind, 'ask') },
            { label: 'Разрешить', type: 'radio', checked: item.value === 'allow', click: () => setSitePermission(ses, info.origin, item.kind, 'allow') },
            { label: 'Блокировать', type: 'radio', checked: item.value === 'deny', click: () => setSitePermission(ses, info.origin, item.kind, 'deny') }
          ]
        });
      }
      template.push({ type: 'separator' });
      template.push({
        label: 'Сбросить все права сайта',
        enabled: info.items.some((i) => i.value !== 'ask'),
        click: () => resetSitePermissions(ses, info.origin)
      });
      if (info.incognito) {
        template.push({ label: 'Инкогнито: выбор действует до выхода из режима', enabled: false });
      }
    }

    if (/^https?:\/\//i.test(url)) {
      template.push({ type: 'separator' });
      // Уже открытый доступ (идущий звонок, подписка на уведомления) меняется только после перезагрузки страницы
      template.push({ label: 'Перезагрузить страницу, чтобы применить', click: () => this.tabManager?.reloadActive(false) });
    }

    const opts = { window: this.win };
    if (Number.isFinite(x) && Number.isFinite(y)) {
      opts.x = Math.round(x);
      opts.y = Math.round(y);
    }
    Menu.buildFromTemplate(template).popup(opts);
  }

  // ---- Главное меню («⋮»): стеклянный попап (WebContentsView) вместо нативного Menu ----
  _getActiveWebContents() {
    const tab = this.tabManager ? this.tabManager.getActive() : null;
    return tab && tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
  }

  toggleDevToolsActive() {
    const wc = this._getActiveWebContents();
    if (wc) wc.toggleDevTools();
  }

  openNewWindow() {
    if (this.registry) { this.registry.openNormalWindow(this); return; } // Ctrl+N и «Новое окно» в меню
    if (typeof this.onNewWindow === 'function') { this.onNewWindow(); return; }
    // Запасной путь: отдельный экземпляр приложения (если в main.js включён requestSingleInstanceLock,
    // обработайте 'second-instance' и аргумент --new-window либо задайте windowManager.onNewWindow)
    try {
      const args = process.defaultApp ? [app.getAppPath(), '--new-window'] : ['--new-window'];
      spawn(process.execPath, args, { detached: true, stdio: 'ignore' }).unref();
    } catch (err) {
      console.error('[mainmenu] Не удалось открыть новое окно:', err);
    }
  }

  // rect — { left, right, bottom } кнопки меню; без него якорь ставится в правый верхний угол
  toggleMainMenu(rect) {
    if (!this.win || this.win.isDestroyed() || !this.tabManager || !this.mainMenu) return;
    if (!this.mainMenu.visible) {
      this.omnibox?.hide();
      this.downloadsPopup?.hide();
      this._closeSitePopover();
      if (!rect) {
        const [cw] = this.win.getContentSize();
        rect = { left: cw - 44, right: cw - 8, bottom: 84 };
      }
    }
    this.mainMenu.toggle(rect);
  }

  // Совместимость со старым вызовом showQuickMenu()
  showQuickMenu(rect) {
    this.toggleMainMenu(rect);
  }

  _buildMainMenuModel() {
    const tm = this.tabManager;
    if (!tm) return [];
    const inc = this.isIncognito;
    const set = (patch) => this.updateSettings(patch);
    const safeUrl = /^(https?|browser):\/\//i;
    const list = (thunk) => { try { const r = thunk(); return Array.isArray(r) ? r : []; } catch { return []; } };
    const hostOf = (u) => { try { return new URL(u).host || u; } catch { return u; } };

    const activeWc = this._getActiveWebContents();
    const activeUrl = (activeWc ? activeWc.getURL() : (tm.getActive() || {}).url) || '';
    const canBookmark = !inc && /^https?:\/\//i.test(activeUrl);
    let zoomPct = 100;
    try { if (activeWc) zoomPct = Math.round(activeWc.getZoomFactor() * 100); } catch { /* вкладка закрывается */ }

    const urlItems = (prefix, rows, max) => rows
      .filter((r) => r && typeof r.url === 'string' && safeUrl.test(r.url))
      .slice(0, max)
      .map((r, i) => ({
        key: `${prefix}:${i}`,
        label: String(r.title || r.url).slice(0, 120),
        sub: hostOf(r.url),
        run: () => tm.createTab(r.url, { active: true })
      }));
    const emptyRow = (key, text) => ({ key, label: text, enabled: false });

    // Закладки и история в Инкогнито не показываются (как и в подсказках адресной строки)
    const bookmarkRows = inc ? [] : urlItems('bm', list(() => storage.loadBookmarks()), 30);
    const historyRows = inc ? [] : urlItems('hs', list(() => storage.getHistory(15)), 15);
    const bookmarked = !inc && canBookmark && storage.isBookmarked(activeUrl);

    const radio = (key, label, checked, fn) => ({ key, type: 'radio', label, checked, keep: true, run: fn });
    const check = (key, label, checked, fn) => ({ key, type: 'check', label, checked, keep: true, run: fn });

    const sleepOptions = [
      ['Отключено', 0], ['5 минут', 5], ['15 минут', 15], ['30 минут', 30], ['60 минут', 60]
    ];

    return [
      { key: 'new-tab', label: 'Новая вкладка', accel: 'Ctrl+T', icon: 'plus', run: () => tm.createTab() },
      { key: 'new-window', label: 'Новое окно', accel: 'Ctrl+N', icon: 'window', run: () => this.openNewWindow() },
      {
        key: 'incognito', label: inc ? 'Выйти из режима Инкогнито' : 'Режим Инкогнито', accel: 'Ctrl+Shift+N',
        icon: 'incognito', run: () => this.toggleIncognito()
      },
      {
        key: 'split', label: tm.splitTabId !== null ? 'Закрыть Split View' : 'Разделить экран (Split View)', accel: 'Ctrl+Shift+S',
        icon: 'split', run: () => tm.toggleSplitView()
      },
      {
        key: 'reopen', label: 'Восстановить закрытую вкладку', accel: 'Ctrl+Shift+T', icon: 'reopen',
        enabled: tm.closedTabs.length > 0, run: () => tm.reopenClosedTab()
      },
      { key: 'sleep-all', label: 'Усыпить все фоновые вкладки сейчас', icon: 'moon', run: () => tm.sleepAllBackgroundTabs() },
      { type: 'sep' },
      {
        key: 'bookmarks', label: 'Закладки', icon: 'star', enabled: !inc, sub: inc ? 'Недоступно в Инкогнито' : '',
        children: inc ? [] : [
          {
            key: 'bm-toggle', label: bookmarked ? 'Убрать из закладок' : 'Добавить в закладки', accel: 'Ctrl+D',
            enabled: canBookmark, keep: true, run: () => this.toggleBookmarkActive()
          },
          { key: 'bm-all', label: 'Диспетчер закладок', accel: 'Ctrl+Shift+O', icon: 'star', run: () => this.openBookmarksTab() },
          { type: 'sep' },
          ...(bookmarkRows.length ? bookmarkRows : [emptyRow('bm-empty', 'Закладок пока нет')])
        ]
      },
      {
        key: 'history', label: 'История', icon: 'history', enabled: !inc, sub: inc ? 'Не ведётся в Инкогнито' : '',
        children: inc ? [] : [
          { key: 'hs-all', label: 'Вся история', accel: 'Ctrl+H', icon: 'history', run: () => this.openHistoryTab() },
          { type: 'sep' },
          ...(historyRows.length ? historyRows : [emptyRow('hs-empty', 'История пуста')])
        ]
      },
      {
        key: 'downloads', label: 'Загрузки', icon: 'download',
        run: () => {
          // главное меню закрывается само: открываем попап загрузок под той же кнопкой чуть позже, когда фокус успокоится
          const r = this.mainMenu && this.mainMenu.rect;
          const anchor = r && Number.isFinite(r.right) && Number.isFinite(r.bottom)
            ? { left: Number.isFinite(r.left) ? r.left : r.right - 36, right: r.right, bottom: r.bottom }
            : null;
          setTimeout(() => this.toggleDownloadsMenu(anchor), 60);
        }
      },
      { type: 'sep' },
      {
        key: 'zoom', type: 'zoom', label: 'Масштаб', icon: 'zoom', value: `${zoomPct}%`,
        run: () => tm.zoomReset(),
        actions: { out: () => tm.zoomOut(), in: () => tm.zoomIn(), reset: () => tm.zoomReset() }
      },
      { key: 'find', label: 'Найти на странице', accel: 'Ctrl+F', icon: 'find', run: () => tm.openFindBar() },
      { key: 'print', label: 'Печать…', accel: 'Ctrl+P', icon: 'print', run: () => tm.printActive() },
      { key: 'devtools', label: 'Инструменты разработчика', accel: 'F12', icon: 'devtools', enabled: Boolean(activeWc), run: () => this.toggleDevToolsActive() },
      { type: 'sep' },
      {
        key: 'quick', label: 'Быстрые настройки', icon: 'sliders',
        children: [
          {
            key: 'theme', label: 'Тема оформления', icon: 'theme',
            children: [
              radio('theme-dark', 'Тёмная', this.settings.theme === 'dark', () => this.applyTheme('dark')),
              radio('theme-light', 'Светлая', this.settings.theme === 'light', () => this.applyTheme('light')),
              radio('theme-system', 'Как в системе (Windows)', this.settings.theme === 'system', () => this.applyTheme('system'))
            ]
          },
          {
            key: 'sleep', label: 'Усыпление фоновых вкладок', icon: 'moon',
            children: sleepOptions.map(([label, value]) =>
              radio(`sleep-${value}`, label, this.settings.sleepMinutes === value, () => set({ sleepMinutes: value })))
          },
          {
            key: 'engine', label: 'Поисковик по умолчанию', icon: 'globe',
            children: Object.entries(SEARCH_ENGINES).map(([key, eng]) =>
              radio(`engine-${key}`, eng.name, this.settings.searchEngine === key, () => set({ searchEngine: key })))
          },
          check('opt-vtabs', 'Вертикальные вкладки (сайдбар слева)', Boolean(this.settings.verticalTabs), () => set({ verticalTabs: !this.settings.verticalTabs })),
          check('opt-bmbar', 'Панель закладок (Ctrl+Shift+B)', Boolean(this.settings.showBookmarksBar), () => set({ showBookmarksBar: !this.settings.showBookmarksBar })),
          { type: 'sep' },
          check('opt-trusted', 'Только доверенные источники в ИИ-обзоре', this.settings.trustedSources !== false, () => set({ trustedSources: this.settings.trustedSources === false })),
          check('opt-adblock', 'Блокировка рекламы', this.settings.adblock !== false, () => set({ adblock: this.settings.adblock === false })),
          check('opt-pretty', 'Красивый стиль поисковика', Boolean(this.settings.prettySearch), () => set({ prettySearch: !this.settings.prettySearch })),
          check('opt-restore', 'Восстанавливать вкладки при запуске', Boolean(this.settings.restoreSession), () => set({ restoreSession: !this.settings.restoreSession }))
        ]
      },
      { type: 'sep' },
      { key: 'settings', label: 'Настройки', accel: 'Ctrl+,', icon: 'settings', run: () => this.openSettingsTab() },
      { key: 'exit', label: 'Выход', icon: 'exit', run: () => { if (this.win && !this.win.isDestroyed()) this.win.close(); } }
    ];
  }

}

module.exports = WindowManager;