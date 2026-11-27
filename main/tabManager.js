const path = require('path');
const crypto = require('crypto');
const { app, WebContentsView, ipcMain, Menu, clipboard } = require('electron');
const {
  APP_SCHEME,
  NEW_TAB_URL,
  UI_HEIGHT,
  FIND_BAR_HEIGHT,
  SEARCH_ENGINES,
  SLEEP_CHECK_INTERVAL_MS,
  MAX_CLOSED_TABS
} = require('./constants');
const {
  isSafeNavigationUrl,
  isExternalProtocolUrl,
  confirmOpenExternal,
  isSafeFaviconUrl,
  formatDisplayUrl,
  resolveUserInput,
  attachWebContentsSecurity,
  isBlockedAppSchemeTransition,
  isCertErrorCode,
  takeCertError,
  addCertExceptionKey,
  registerCertificateErrorHandler,
  FIREFOX_UA,
  GOOGLE_FIREFOX_UA,
  isGoogleAuthUrl
} = require('./security');
const storage = require('./storage');
const httpsOnly = require('./httpsOnly');
const { isSearchEngineUrl, getSearchEngineCss, getAdaptivePayload, getSourceFilterPayload, getSourceFilterCss } = require('./searchTheme');

// Ступени масштабирования страницы (как в Chrome)
const SPLIT_GAP = 6;
const SPLIT_MIN = 0.25;
const SPLIT_MAX = 0.75;

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const TAB_PRELOAD_PATH = path.join(__dirname, '..', 'preload', 'tabPreload.js');

// Seed защиты от fingerprinting: один на сессию Инкогнито (в том числе общую для нескольких окон)
const fingerprintSeeds = new WeakMap();
function fingerprintArgs(ses) {
  let seed = fingerprintSeeds.get(ses);
  if (!seed) {
    seed = crypto.randomBytes(16).toString('hex');
    fingerprintSeeds.set(ses, seed);
  }
  return [`--pt-fp-seed=${seed}`];
}

// UA вкладки: Firefox на доменах входа Google, на остальных — обычный Chrome (app.userAgentFallback)
const googleAuthUa = new WeakMap(); // webContents -> true, если сейчас стоит Firefox UA
function googleAuthUaWanted(url) {
  return Boolean(GOOGLE_FIREFOX_UA && isGoogleAuthUrl(url));
}
function googleAuthUaNeedsFlip(wc, url) {
  return Boolean(wc) && !wc.isDestroyed() && Boolean(googleAuthUa.get(wc)) !== googleAuthUaWanted(url);
}
// ВАЖНО: wc.setUserAgent() во время загрузки заставляет Chromium перезагрузить ТЕКУЩУЮ страницу
// (WebContentsImpl::SetUserAgentOverride: если вкладка грузится и запись переопределяет UA — Reload).
// Так клик по «Войти» на Gemini отменял переход на accounts.google.com и просто обновлял Gemini.
// Поэтому UA меняем только на остановленной вкладке; если вкладка ещё грузится — ничего не делаем
// (вернёт false), смену довершит did-stop-loading. Заголовки Firefox для запросов входа подменяет webRequest.
function syncGoogleAuthUa(wc, url) {
  if (!wc || wc.isDestroyed()) return false;
  const want = googleAuthUaWanted(url);
  if (Boolean(googleAuthUa.get(wc)) === want) return true;
  if (wc.isLoading()) return false;
  googleAuthUa.set(wc, want);
  try { wc.setUserAgent(want ? FIREFOX_UA : app.userAgentFallback); } catch { /* wc уничтожен */ }
  return true;
}

// ---- HTTP Basic/Digest/NTLM Auth (событие login) ----
let authSeq = 0; // сквозной id запросов: не повторяется между обычным окном и Инкогнито

// В интерфейс уходит только очищенный набор полей (значения приходят от сервера — обрезаем)
function buildAuthInfo(details, authInfo) {
  const clip = (v, n) => String(v === undefined || v === null ? '' : v).slice(0, n);
  const isProxy = Boolean(authInfo && authInfo.isProxy);
  let secure = false;
  try { secure = new URL(details && details.url).protocol === 'https:'; } catch { secure = false; }
  return {
    host: clip(authInfo && authInfo.host, 255),
    port: authInfo && Number.isInteger(authInfo.port) ? authInfo.port : null,
    realm: clip(authInfo && authInfo.realm, 256),
    scheme: clip(authInfo && authInfo.scheme, 32),
    isProxy,
    secure: isProxy ? null : secure // для прокси https/http целевого адреса не показатель
  };
}

function hostOf(rawUrl) {
  try { return new URL(rawUrl).host.toLowerCase(); } catch { return ''; }
}

// JS-слои (перекраска Google и фильтр источников) выполняются внутри preload вкладки — в изолированном
// мире Electron (contextIsolation). В мир страницы ничего не внедряется (никакого executeJavaScript),
// на её window нет ни одного нашего свойства. main шлёт только данные (JSON) по IPC.
function sendToPreload(wc, channel, payload) {
  if (!wc || wc.isDestroyed()) return;
  try {
    // Результата назад нет: страница не должна получить ничего из нашего мира
    wc.send(channel, payload);
  } catch {
    // страница закрылась
  }
}

// Шаг letterboxing в Инкогнито с защитой от fingerprinting (px)
const LETTERBOX_STEP = 100;

// Preload вкладки синхронно просит готовый CSS темы до первого кадра страницы
const managers = new Set();
let injectIpcRegistered = false;
function registerInjectIpc() {
  if (injectIpcRegistered) return;
  injectIpcRegistered = true;
  ipcMain.on('pt:get-inject', (event, url) => {
    let result = null;
    try {
      if (typeof url !== 'string') { event.returnValue = null; return; }
      for (const m of managers) {
        if (m.ownsContents(event.sender)) {
          result = { css: m.buildThemeCss(event.sender, url, true) };
          break;
        }
      }
    } catch {
      result = null;
    }
    event.returnValue = result;
  });
}

// certificate-error: один обработчик на все менеджеры (обычное окно и Инкогнито); отвечает только за свои вкладки
let certHandlerRegistered = false;
function registerCertificateHandler() {
  if (certHandlerRegistered) return;
  certHandlerRegistered = true;
  registerCertificateErrorHandler(app, (wc) => {
    for (const m of managers) {
      if (m.ownsContents(wc)) return true;
    }
    return false;
  });
}

class TabManager {
  constructor({
    win,
    session,
    incognito = false,
    getSettings,
    getResolvedTheme,
    getChromeTheme,
    isTransparentChrome,
    getPageBackgroundColor,
    onStateChange,
    onSessionDirty,
    onShortcut,
    onFindChange,
    onFindFocus,
    onAuthChange,
    isOverlayOpen,
    getInsets,
    getRightInset,
    onLayout
  }) {
    this.win = win;
    this.session = session;
    this.incognito = Boolean(incognito);
    this.getSettings = getSettings;
    // { left, top }: сдвиг области страницы (сайдбар вертикальных вкладок, панель закладок)
    this.getInsets = typeof getInsets === 'function' ? getInsets : () => ({ left: 0, top: 0 });
    // Ширина справа, занятая боковой панелью Gemini (зависит от ширины окна), и колбэк с её областью после раскладки
    this.getRightInset = typeof getRightInset === 'function' ? getRightInset : () => 0;
    this.onLayout = typeof onLayout === 'function' ? onLayout : () => {};
    this.getResolvedTheme = getResolvedTheme;
    this.isTransparentChrome = typeof isTransparentChrome === 'function' ? isTransparentChrome : () => false;
    this.getChromeTheme = getChromeTheme || (() => 'cyber-blue');
    this.getPageBackgroundColor = getPageBackgroundColor;
    this.onStateChange = onStateChange;
    this.onSessionDirty = this.incognito ? () => {} : onSessionDirty;
    this.onShortcut = onShortcut;
    this.onFindChange = typeof onFindChange === 'function' ? onFindChange : () => {};
    this.onFindFocus = typeof onFindFocus === 'function' ? onFindFocus : () => {};
    this.onAuthChange = typeof onAuthChange === 'function' ? onAuthChange : () => {};
    this.isOverlayOpen = typeof isOverlayOpen === 'function' ? isOverlayOpen : () => false; // карточка окна интерфейса (#pw-popover и др.) поверх страниц

    // Ожидающие запросы авторизации: webContents.id -> { requestId, tabId, wcId, callback, info }
    // На один webContents — не более одного запроса (новый отменяет прежний)
    this.authRequests = new Map();

    this.tabs = [];
    this.activeId = null;
    this.nextId = 1;
    this.closedTabs = [];
    this.childWindows = new Set(); // попапы, открытые из вкладок этого менеджера (для Инкогнито закрываем при выходе)
    this.isHtmlFullscreen = false;
    this.fullscreenTabId = null; // вкладка, которая сейчас в HTML-полноэкранном режиме
    // Split View: activeId — половина в фокусе, splitTabId — напарник
    this.splitTabId = null;
    this.splitRatio = 0.5;

    // Рабочие пространства. В Инкогнито отключены: одно пространство, сессия не пишется
    this.workspacesEnabled = !this.incognito;
    this.activeWorkspaceId = storage.DEFAULT_WORKSPACE_ID;
    this._wsMemory = new Map(); // workspaceId -> { activeId, splitTabId, ratio } на момент ухода из пространства

    // Поиск по странице. Панель одна на окно, строка и регистр общие для всех вкладок;
    // подсветка живёт только в одной вкладке (tabId) и снимается при её смене/закрытии/усыплении
    this.find = {
      open: false,
      query: '',
      matchCase: false,
      tabId: null,      // вкладка, где сейчас есть результаты поиска
      requestId: 0,     // id последнего findInPage: ответы с другим id устарели
      ordinal: 0,
      total: 0,
      done: false       // пришёл finalUpdate: можно уверенно говорить «Нет совпадений»
    };

    this.sleepTimer = setInterval(() => this.checkSleepingTabs(), SLEEP_CHECK_INTERVAL_MS);

    this.lastThemeCss = new WeakMap();
    managers.add(this);
    registerInjectIpc();
    registerCertificateHandler();
  }

  ownsContents(wc) {
    return this.tabs.some((t) => t.view && t.view.webContents === wc);
  }

  // Итоговый CSS страницы (тема поисковика — только при prettySearch; CSS фильтра источников — независимо) или null
  buildThemeCss(wc, url, remember) {
    const settings = this.getSettings();
    let css = '';
    if (settings.prettySearch) {
      css += getSearchEngineCss(url, this.getResolvedTheme(), this.getChromeTheme(), this.isGlass(), Boolean(settings.adblock)) || '';
    }
    // CSS-часть фильтра источников работает независимо от стиля поисковика
    css += getSourceFilterCss(url, settings.trustedSources !== false) || '';
    css = css || null;
    if (remember) this.lastThemeCss.set(wc, css);
    return css;
  }

  // Шлёт CSS в preload страницы только если он изменился (без remove→insert и без мигания)
  _pushThemeCss(wc, force) {
    if (!wc || wc.isDestroyed()) return;
    const css = this.buildThemeCss(wc, wc.getURL(), false);
    if (!force && this.lastThemeCss.get(wc) === css) return;
    this.lastThemeCss.set(wc, css);
    try { wc.send('pt:inject', css); } catch { /* страница закрылась */ }
  }

  getNewTabUrl() {
    return NEW_TAB_URL;
  }

  getTab(id) {
    return this.tabs.find(t => t.id === id) || null;
  }

  getActive() {
    return this.getTab(this.activeId);
  }

  _getPinnedCount() {
    let count = 0;
    for (const t of this.tabs) {
      if (t.pinned) count++;
    }
    return count;
  }

  // ---- Рабочие пространства ----
  _inWorkspace(tab) {
    return !this.workspacesEnabled || tab.workspaceId === this.activeWorkspaceId;
  }

  _wsTabs() {
    return this.tabs.filter((t) => this._inWorkspace(t));
  }

  // Куда перейти после закрытия вкладки с индексом idx: ближайшая справа вкладка того же пространства, иначе последняя
  _pickNextInWorkspace(idx) {
    const pool = this._wsTabs();
    return pool.find((t) => this.tabs.indexOf(t) >= idx) || pool[pool.length - 1] || null;
  }

  _stashWorkspace() {
    if (this.activeId === null) return;
    this._wsMemory.set(this.activeWorkspaceId, {
      activeId: this.activeId,
      splitTabId: this.splitTabId,
      ratio: this.splitRatio
    });
  }

  // Фоновые вкладки не закрываем: layout() сам скрывает всё, кроме активной и пары Split View
  switchWorkspace(wsId) {
    if (!this.workspacesEnabled) return false;
    const id = storage.normalizeWorkspaceId(wsId);
    if (id === this.activeWorkspaceId) return false;
    this._stashWorkspace();
    this.activeWorkspaceId = id;
    this.splitTabId = null;

    const pool = this._wsTabs();
    if (pool.length === 0) {
      this.createTab(null, { active: true }); // пустое пространство -> Новая вкладка
      return true;
    }
    const mem = this._wsMemory.get(id);
    const target = (mem && pool.find((t) => t.id === mem.activeId)) || pool[0];
    this.switchTab(target.id);

    // Возвращаем пару Split View, которая была в этом пространстве
    const partner = mem && mem.splitTabId !== null ? pool.find((t) => t.id === mem.splitTabId) : null;
    if (partner && partner.id !== target.id) {
      this.splitRatio = mem.ratio;
      this.openSplitView(partner.id);
    }
    return true;
  }

  // Удаление пространства: его вкладки переезжают в toId, ничего не закрывается
  moveWorkspaceTabs(fromId, toId) {
    if (!this.workspacesEnabled) return;
    for (const t of this.tabs) {
      if (t.workspaceId === fromId) t.workspaceId = toId;
    }
    if (this.activeWorkspaceId === fromId) this.activeWorkspaceId = toId;
    this._wsMemory.delete(fromId);
    this._emitState();
    this.onSessionDirty();
  }

  moveTabToWorkspace(id, wsId) {
    const tab = this.getTab(id);
    if (!tab || !this.workspacesEnabled) return false;
    const ws = storage.normalizeWorkspaceId(wsId);
    if (tab.workspaceId === ws) return false;
    if (id === this.splitTabId || (id === this.activeId && this.splitTabId !== null)) this.splitTabId = null;
    tab.workspaceId = ws;
    if (id === this.activeId) this.activeWorkspaceId = ws; // активная вкладка уезжает вместе с видом
    this.layout();
    this._emitState();
    this.onSessionDirty();
    return true;
  }

  getWorkspacesSnapshot() {
    if (!this.workspacesEnabled) return { enabled: false, active: storage.DEFAULT_WORKSPACE_ID, items: [] };
    const counts = new Map();
    for (const t of this.tabs) counts.set(t.workspaceId, (counts.get(t.workspaceId) || 0) + 1);
    return {
      enabled: true,
      active: this.activeWorkspaceId,
      items: storage.getWorkspaces().map((w) => ({ ...w, count: counts.get(w.id) || 0 }))
    };
  }

  // Гарантированный сброс флага HTML-fullscreen (смена/закрытие/падение вкладки), иначе верхняя панель остаётся скрытой.
  // Если передан tab — сбрасываем только когда fullscreen принадлежал именно ей (или владелец неизвестен)
  _resetHtmlFullscreen(tab = null, { exitInPage = false, relayout = true } = {}) {
    if (!this.isHtmlFullscreen) return;
    if (tab && this.fullscreenTabId !== null && this.fullscreenTabId !== tab.id) return;
    const owner = this.fullscreenTabId !== null ? this.getTab(this.fullscreenTabId) : tab;
    this.isHtmlFullscreen = false;
    this.fullscreenTabId = null;
    if (exitInPage && owner && owner.view) {
      try {
        const wc = owner.view.webContents;
        if (!wc.isDestroyed()) wc.executeJavaScript('document.fullscreenElement && document.exitFullscreen()').catch(() => {});
      } catch { /* ignore */ }
    }
    if (relayout) {
      this.layout();
      this._emitFind();
    }
  }

  // ---- Авторизация (HTTP auth) ----
  _emitAuth() {
    this.onAuthChange();
  }

  // Запрос, который сейчас должен быть показан: относится к активной вкладке
  _getActiveAuth() {
    if (this.activeId === null) return null;
    for (const r of this.authRequests.values()) {
      if (r.tabId === this.activeId) return r;
    }
    return null;
  }

  // Состояние для окна интерфейса (событие auth:prompt): показать диалог или скрыть
  getAuthPayload() {
    const r = this._getActiveAuth();
    if (!r) return { visible: false };
    return { visible: true, requestId: r.requestId, tabId: r.tabId, ...r.info };
  }

  // Защита от фишинга: окно логина по подресурсу чужого домена (например, <img src="https://bank.example/...">)
  // не показываем — как делают обычные браузеры. Прокси-авторизация разрешена всегда.
  _isAuthAllowed(tab, wc, details, authInfo) {
    if (authInfo && authInfo.isProxy) return true;
    const reqHost = hostOf(details && details.url);
    if (!reqHost) return false;
    let currentHost = '';
    try { currentHost = hostOf(wc.getURL()); } catch { currentHost = ''; }
    return reqHost === currentHost || reqHost === hostOf(tab.authNavUrl);
  }

  _isSameProxyChallenge(a, b) {
    return Boolean(a && b && a.isProxy && b.isProxy &&
      a.host === b.host && a.port === b.port && a.realm === b.realm && a.scheme === b.scheme);
  }

  // Пустой callback() = отмена: сервер отдаст свою страницу 401, запрос не зависнет
  _cancelAuth(wcId, { relayout = true, notify = true } = {}) {
    const r = this.authRequests.get(wcId);
    if (!r) return false;
    this.authRequests.delete(wcId);
    for (const cb of r.callbacks || [r.callback]) {
      try { cb(); } catch { /* webContents уже уничтожен */ }
    }
    if (relayout) this.layout();
    if (notify) this._emitAuth();
    return true;
  }

  // Ответ пользователя. Принимается только для запроса, который сейчас показан (активная вкладка).
  // credentials = { username, password } или null (отмена)
  respondAuth(requestId, credentials) {
    const r = this._getActiveAuth();
    if (!r || r.requestId !== requestId) return false;
    this.authRequests.delete(r.wcId);
    const answer = (req) => {
      for (const cb of req.callbacks || [req.callback]) {
        try {
          if (credentials) cb(credentials.username, credentials.password);
          else cb();
        } catch { /* webContents уже уничтожен */ }
      }
    };
    answer(r);
    // Прокси один на сессию: те же учётные данные получают ждущие запросы к тому же прокси из других вкладок
    if (credentials && r.info.isProxy) {
      for (const other of Array.from(this.authRequests.values())) {
        if (this._isSameProxyChallenge(other.info, r.info)) {
          this.authRequests.delete(other.wcId);
          answer(other);
        }
      }
    }
    this.layout(); // вернуть страницу на место
    this._emitAuth();
    const cur = this._getActiveContents();
    if (cur) cur.wc.focus();
    return true;
  }

  _destroyView(tab) {
    if (!tab.view) return;
    try { this._cancelAuth(tab.view.webContents.id, { relayout: false }); } catch { /* ignore */ }
    this._clearHttpsUpgrade(tab);
    // Закрываемая/засыпающая вкладка могла держать fullscreen: сбрасываем до уничтожения view (layout сам вызовет вызывающий код)
    this._resetHtmlFullscreen(tab, { relayout: false });
    // Вкладка закрывается или засыпает: снимаем подсветку, пока webContents ещё жив, и сбрасываем счётчик
    if (this.find.tabId === tab.id) {
      this._stopFind();
      this._emitFind();
    }
    const view = tab.view;
    tab.view = null;
    tab._unwire = null; // замыкание держало список слушателей и уничтоженный webContents за спящей вкладкой
    try {
      if (this.win && !this.win.isDestroyed()) {
        this.win.contentView.removeChildView(view);
      }
    } catch {
      // View уже мог быть отсоединён
    }
    try {
      if (view.webContents && !view.webContents.isDestroyed()) {
        view.webContents.close({ waitForBeforeUnload: false });
      }
    } catch {
      // Игнорируем, если webContents уже уничтожен
    }
  }

  // Вкладка «новая вкладка» при прозрачной оболочке полностью прозрачна: обои рисует окно под ней
  _viewBackground(tab) {
    try {
      const wc = tab.view && !tab.view.webContents.isDestroyed() ? tab.view.webContents : null;
      const url = wc ? wc.getURL() : tab.url;
      if (typeof this.isTransparentChrome === 'function' && this.isTransparentChrome() &&
          typeof url === 'string' && url.startsWith(NEW_TAB_URL)) {
        return '#00000000';
      }
      // Страницы поиска в режиме «стекло»: тоже прозрачны, обои видны сквозь них
      // isSearchEngineUrl — лёгкая проверка регулярками: _viewBackground зовётся на каждый sendState(),
      // собирать ради неё ~400 строк CSS незачем
      if (this.isGlass() && isSearchEngineUrl(url)) {
        return '#00000000';
      }
    } catch { /* ignore */ }
    return this.getPageBackgroundColor();
  }

  // Обои под страницами поиска: нужны свои обои + прозрачная оболочка + стилизация поиска
  isGlass() {
    try {
      return Boolean(this.getSettings().prettySearch) && Boolean(this.isTransparentChrome());
    } catch { return false; }
  }

  // Видимые сейчас вкладки: активная и (в Split View) напарник
  _getVisibleTabs() {
    const tabs = [];
    const active = this.getActive();
    if (active) tabs.push(active);
    const split = this._getSplitTab();
    if (split) tabs.push(split);
    return tabs;
  }

  // Активна страница поиска с обоями позади (для доп. размытия обоев); в Split View — любая из двух
  isActiveSearchGlass() {
    return this._getVisibleTabs().some((tab) =>
      typeof tab.url === 'string' && !tab.url.startsWith(NEW_TAB_URL) &&
      this._viewBackground(tab) === '#00000000');
  }

  // Видны ли сейчас обои сквозь активную вкладку или напарника по Split View (для паузы видео-обоев)
  isWallpaperVisibleForActive() {
    return this._getVisibleTabs().some((tab) => this._viewBackground(tab) === '#00000000');
  }

  updateViewsBackground() {
    for (const tab of this.tabs) {
      if (tab.view) {
        tab.view.setBackgroundColor(this._viewBackground(tab));
      }
    }
  }

  // CSS темы вшивает preload до первого кадра. Здесь — только обновления:
  // смена настроек/темы (force) и in-page навигация (отправляем лишь при изменении CSS).
  applySearchTheme(tab, force = false) {
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
    const wc = tab.view.webContents;
    this._pushThemeCss(wc, force);
    if (force) this._applyJsLayers(wc);
  }

  // JS-слои (идемпотентны): запускаются один раз на документ (dom-ready) и при смене настроек.
  // Одно IPC-сообщение с конфигом обоих слоёв; выполняет их preload вкладки (изолированный мир).
  _applyJsLayers(wc) {
    if (!wc || wc.isDestroyed()) return;
    let url = '';
    try { url = wc.getURL(); } catch { return; }
    const settings = this.getSettings();
    const msg = {};

    // Фильтр источников «Обзора от ИИ» (только доверенные домены)
    const sources = getSourceFilterPayload(url, settings.trustedSources !== false);
    if (sources) msg.sources = sources;

    // Адаптивная перекраска Google; вне страниц поисковика или без prettySearch — сброс
    let adaptive = null;
    if (settings.prettySearch && isSearchEngineUrl(url)) {
      adaptive = getAdaptivePayload(url, this.getResolvedTheme(), this.getChromeTheme(), this.isGlass(), Boolean(settings.trustedSources));
    }
    msg.adaptive = adaptive || { dark: false };

    sendToPreload(wc, 'pt:layers', msg);
  }

  refreshSearchThemes() {
    this.updateViewsBackground();
    for (const tab of this.tabs) {
      if (tab.view && !tab.view.webContents.isDestroyed()) {
        this.applySearchTheme(tab, true);
      }
    }
  }

  _attachView(tab, existingView = null) {
    const view = existingView || new WebContentsView({
      webPreferences: {
        session: this.session,
        preload: TAB_PRELOAD_PATH,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: true,
        navigateOnDragDrop: false,
        // читается preload/tabPreload.js; действует на вкладки, созданные после включения настройки
        ...(this._isFingerprintProtectionActive() ? { additionalArguments: fingerprintArgs(this.session) } : {})
      }
    });

    tab.view = view;
    view.setBackgroundColor(this._viewBackground(tab));
    this.win.contentView.addChildView(view);

    const wc = view.webContents;
    // Запоминаем все слушатели, повешенные ниже (и в attachWebContentsSecurity): при переносе вкладки их надо снять
    const wired = [];
    const baseOn = wc.on;
    wc.on = (evt, fn) => { wired.push([evt, fn]); return baseOn.call(wc, evt, fn); };
    const baseOnce = wc.once;
    wc.once = (evt, fn) => { wired.push([evt, fn]); return baseOnce.call(wc, evt, fn); };
    attachWebContentsSecurity(wc, { getParent: () => this.win });
    if (tab.muted) wc.setAudioMuted(true);
    this._applyZoom(tab, wc);
    // Часовой пояс на уровне движка: Date, Intl и дочерние фреймы согласованы (JS-подмена в preload — запасной вариант)
    if (this._isFingerprintProtectionActive()) this._applyTimezoneOverride(wc);

    wc.on('page-title-updated', (_e, title) => {
      if (title) {
        tab.title = title;
        try {
          const cur = wc.getURL();
          if (!this.incognito && /^https?:\/\//i.test(cur)) storage.updateHistoryTitle(cur, title);
        } catch { /* webContents уничтожен */ }
      }
      this._emitState();
    });

    const handleNavigation = (_e, url, isMainFrame = true) => {
      if (isMainFrame === false) return; // iframe не должен менять адрес вкладки
      if (url && !url.startsWith(`${APP_SCHEME}://error`) && !/^chrome-error:/i.test(url)) {
        tab.url = url;
        tab.failedUrl = null;
        tab.httpsWarning = null;
        tab.certWarning = null;
        if (url.startsWith(NEW_TAB_URL)) {
          tab.favicon = null;
          tab.title = 'Новая вкладка';
        }
      }
      this._emitState();
      this.onSessionDirty();
    };

    // ---- HTTP auth: перехватываем login, сами решаем, что показать ----
    const wcId = wc.id;
    wc.on('login', (event, details, authInfo, callback) => {
      event.preventDefault(); // без этого Electron сразу отменит запрос
      if (typeof callback !== 'function') return;
      if (!this._isAuthAllowed(tab, wc, details, authInfo)) {
        callback();
        return;
      }
      const info = buildAuthInfo(details, authInfo);
      // Страница с десятками подресурсов даёт десятки 407 от одного прокси: не отменяем показанный запрос
      // (иначе меняется requestId и введённый ответ отбрасывается), а отвечаем на все сразу
      const pending = this.authRequests.get(wcId);
      if (pending && this._isSameProxyChallenge(pending.info, info)) {
        pending.callbacks.push(callback);
        return;
      }
      this._cancelAuth(wcId, { relayout: false, notify: false }); // прежний запрос этой вкладки
      this.authRequests.set(wcId, {
        requestId: ++authSeq,
        tabId: tab.id,
        wcId,
        callback,
        callbacks: [callback],
        info
      });
      // Диалог рисуется в окне интерфейса, а WebContentsView лежит поверх него: layout() скроет view
      if (tab.id === this.activeId) this._resetHtmlFullscreen(null, { exitInPage: true, relayout: false });
      this.layout();
      this._emitAuth();
    });

    // Новая навигация главного фрейма отменяет висящий запрос; адрес запоминаем для _isAuthAllowed
    wc.on('did-start-navigation', (event, urlArg, isInPlaceArg, isMainFrameArg) => {
      const url = typeof urlArg === 'string' ? urlArg : event && event.url;
      const isMainFrame = typeof isMainFrameArg === 'boolean' ? isMainFrameArg : !event || event.isMainFrame !== false;
      const isSameDoc = typeof isInPlaceArg === 'boolean' ? isInPlaceArg : Boolean(event && event.isSameDocument);
      if (!isMainFrame || isSameDoc) return;
      // UA здесь не меняем: переход уже идёт, смена UA перезагрузила бы старую страницу (см. syncGoogleAuthUa).
      // Для will-navigate/will-redirect это делает _switchGoogleAuthUa, для загрузок из интерфейса — _loadInTab
      tab.authNavUrl = url || null;
      this._cancelAuth(wcId);
    });

    wc.on('did-redirect-navigation', (event, urlArg, _isInPlace, isMainFrameArg) => {
      const isMainFrame = typeof isMainFrameArg === 'boolean' ? isMainFrameArg : !event || event.isMainFrame !== false;
      if (!isMainFrame) return;
      const url = typeof urlArg === 'string' ? urlArg : event && event.url;
      if (url) tab.authNavUrl = url;
    });

    wc.once('destroyed', () => this._cancelAuth(wcId, { relayout: false }));

    wc.on('did-navigate', (e, url) => {
      tab.authNavUrl = null;
      // Страница зафиксирована (не внутренняя страница ошибки Chromium): ожидание HTTPS закончено
      if (!/^chrome-error:/i.test(url)) this._clearHttpsUpgrade(tab);
      // Навигация сбрасывает подсветку на стороне Chromium: обнуляем и счётчик
      if (this.find.tabId === tab.id) {
        this.find.tabId = null;
        this._resetFindResults();
        this._emitFind();
      }
      tab.navId = (tab.navId || 0) + 1;
      this._applyZoom(tab, wc);
      handleNavigation(e, url);
      // Заголовок на этот момент может быть от прошлой страницы — его допишет page-title-updated
      if (!this.incognito && /^https?:\/\//i.test(url)) storage.recordVisit(url, '');
      if (tab.view) tab.view.setBackgroundColor(this._viewBackground(tab));
    });

    wc.on('did-navigate-in-page', (e, url, isMainFrame) => {
      if (isMainFrame === false) return;
      handleNavigation(e, url);
      this.applySearchTheme(tab, false);
    });

    // «Только HTTPS». Эти слушатели стоят после защитных из attachWebContentsSecurity:
    // если те уже отменили навигацию (defaultPrevented), здесь делать нечего
    wc.on('will-navigate', (event, urlArg) => {
      if (event.defaultPrevented) return;
      const url = typeof urlArg === 'string' ? urlArg : event.url;
      if (this._handleHttpsWarningAction(tab, wc, event, url)) return;
      if (this._handleCertWarningAction(tab, wc, event, url)) return;
      if (event.isMainFrame === false) return;
      // Вход в Google ↔ остальные сайты: другой UA. Переход перезапускается с уже сменённым UA
      if (this._switchGoogleAuthUa(tab, wc, event, url, { referrer: wc.getURL() })) return;
      if (!this._shouldUpgrade(url)) return;
      event.preventDefault();
      this._loadInTab(tab, url);
    });

    wc.on('will-redirect', (event, urlArg) => {
      if (event.defaultPrevented || event.isMainFrame === false) return;
      const url = typeof urlArg === 'string' ? urlArg : event.url;
      // Серверный редирект не прерываем ради смены UA: перезапуск через loadURL превращал POST/307/308 в GET
      // и терял Referer. Заголовки Firefox для запросов входа подменяет security.js, navigator.* — tabPreload.js,
      // а wc.setUserAgent выставит did-stop-loading (после остановки вкладки, без перезагрузки страницы).
      // Переходы по ссылкам и из адресной строки (will-navigate) по-прежнему идут через _switchGoogleAuthUa
      if (!this._shouldUpgrade(url)) return;
      event.preventDefault();
      this._upgradeRedirect(tab, wc, url);
    });

    wc.on('dom-ready', () => {
      if (this._applyZoom(tab, wc)) this._emitState();
      this._applyJsLayers(wc);
    });

    wc.on('did-start-loading', () => {
      tab.loading = true;
      this._emitState();
    });

    wc.on('focus', () => this._onTabFocus(tab));

    wc.on('found-in-page', (_e, result) => {
      this._onFoundInPage(tab, result);
    });

    wc.on('did-finish-load', () => {
      // Панель поиска открыта, а на этой странице результатов нет (переключились на ещё грузившуюся вкладку
      // или перешли по ссылке): ищем заново
      if (this.find.open && this.find.query && tab.id === this.activeId && this.find.tabId === null) {
        this._runFind({ findNext: false, forward: true });
      }
      // После полной загрузки (в т.ч. F5) ещё раз перекрашиваем поздно созданные блоки Google
      // Только на страницах поисковиков: на остальных сайтах таймеры не нужны
      let isSearchPage = false;
      try { isSearchPage = isSearchEngineUrl(wc.getURL()); } catch { /* wc уничтожен */ }
      if (!isSearchPage) return;
      for (const ms of [200, 1500]) {
        setTimeout(() => {
          sendToPreload(wc, 'pt:rescan');
        }, ms);
      }
    });

    wc.on('did-stop-loading', () => {
      this._cancelAuth(wcId); // загрузку остановили (Esc, Стоп) — запрос уже недействителен
      // Вкладка остановлена: безопасно привести UA в соответствие с адресом (история назад/вперёд и т.п.)
      try { if (!wc.isLoading()) syncGoogleAuthUa(wc, wc.getURL()); } catch { /* wc уничтожен */ }
      tab.loading = false;
      const currentTitle = wc.getTitle();
      if (currentTitle) tab.title = currentTitle;
      this._emitState();
    });

    wc.on('page-favicon-updated', (_e, favicons) => {
      const valid = Array.isArray(favicons) ? favicons.find(isSafeFaviconUrl) : null;
      const seq = (tab.faviconSeq = (tab.faviconSeq || 0) + 1);
      if (!valid) {
        tab.favicon = null;
        this._emitState();
        return;
      }
      // Окно интерфейса работает в defaultSession: в Инкогнито (и для http:) внешний URL ему не отдаём,
      // а загружаем иконку через сессию вкладки без cookies и передаём как data: URL
      if (!this.incognito && !/^http:/i.test(valid)) {
        tab.favicon = valid;
        this._emitState();
        return;
      }
      tab.favicon = null;
      this._emitState();
      this._fetchFaviconDataUrl(valid).then((dataUrl) => {
        if (seq !== tab.faviconSeq || wc.isDestroyed()) return;
        tab.favicon = dataUrl;
        this._emitState();
      });
    });

    wc.on('media-started-playing', () => {
      tab.audible = true;
      this._emitState();
    });

    wc.on('media-paused', () => {
      tab.audible = false;
      this._emitState();
    });

    wc.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      if (validatedURL && validatedURL.startsWith(`${APP_SCHEME}://error`)) return;

      // Попытка открыть http-адрес по HTTPS не удалась: вместо страницы ошибки показываем предупреждение
      const upgrade = tab.httpsUpgrade;
      if (upgrade && httpsOnly.isFallbackError(errorCode)) {
        this._showHttpsWarning(tab, wc, upgrade, errorCode);
        return;
      }
      this._clearHttpsUpgrade(tab);

      // Ошибка сертификата (ERR_CERT_*): страница с типом ошибки; для локальных адресов — разовое исключение
      if (isCertErrorCode(errorCode)) {
        this._showCertWarning(tab, wc, errorCode, errorDescription, validatedURL);
        return;
      }

      tab.failedUrl = validatedURL || tab.url;
      tab.loading = false;

      const params = new URLSearchParams({
        code: String(errorCode),
        desc: errorDescription || 'ERR_FAILED',
        url: tab.failedUrl || ''
      });
      wc.loadURL(`${APP_SCHEME}://error?${params.toString()}`).catch(() => {});
      this._emitState();
    });

    wc.on('render-process-gone', (_e, details) => {
      if (!details || details.reason === 'clean-exit') return;
      this._cancelAuth(wcId);
      this._resetHtmlFullscreen(tab); // процесс упал во время fullscreen — панель браузера должна вернуться
      if (wc.isDestroyed() || tab.view !== view) return;

      let currentUrl = '';
      try { currentUrl = wc.getURL(); } catch { currentUrl = ''; }

      tab.loading = false;
      tab.audible = false;
      // Если упала сама страница ошибки — не уходим в бесконечный цикл перезагрузок
      if (currentUrl.startsWith(`${APP_SCHEME}://error`)) {
        this._emitState();
        return;
      }

      tab.failedUrl = tab.url;
      const reason = String(details.reason || 'unknown').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      const descByReason = {
        CRASHED: 'RENDERER_CRASHED',
        OOM: 'RENDERER_OOM',
        KILLED: 'RENDERER_KILLED',
        ABNORMAL_EXIT: 'RENDERER_ABNORMAL_EXIT',
        LAUNCH_FAILED: 'RENDERER_LAUNCH_FAILED',
        INTEGRITY_FAILURE: 'RENDERER_INTEGRITY_FAILURE'
      };
      const params = new URLSearchParams({
        code: details.exitCode !== undefined && details.exitCode !== null ? String(details.exitCode) : '',
        desc: descByReason[reason] || `RENDERER_${reason}`,
        url: tab.failedUrl || ''
      });
      wc.loadURL(`${APP_SCHEME}://error?${params.toString()}`).catch(() => {});
      this._emitState();
    });

    wc.on('context-menu', (_e, params) => {
      this._showContextMenu(tab, wc, params);
    });

    wc.on('did-create-window', (childWin) => {
      try { childWin.removeMenu(); } catch { /* ignore */ }
      this.childWindows.add(childWin);
      childWin.once('closed', () => { this.childWindows.delete(childWin); });
      // Окно больше не дочернее (см. setWindowOpenHandler) — закрываем попап сами, когда закрывается основное окно,
      // иначе оно удержит приложение живым (window-all-closed не сработает)
      const mainWin = this.win;
      if (mainWin && !mainWin.isDestroyed()) {
        const closeChild = () => { try { if (!childWin.isDestroyed()) childWin.close(); } catch { /* ignore */ } };
        mainWin.once('closed', closeChild);
        childWin.once('closed', () => {
          try { if (!mainWin.isDestroyed()) mainWin.removeListener('closed', closeChild); } catch { /* ignore */ }
        });
      }
      if (childWin.webContents) {
        attachWebContentsSecurity(childWin.webContents, { getParent: () => this.win });
        // Вложенные окна из попапа не плодим: безопасные ссылки открываем вкладкой основного окна
        childWin.webContents.setWindowOpenHandler(({ url }) => {
          if (isExternalProtocolUrl(url)) {
            confirmOpenExternal(this.win, url);
            return { action: 'deny' };
          }
          if (isBlockedAppSchemeTransition(childWin.webContents.getURL(), url)) {
            return { action: 'deny' };
          }
          if (isSafeNavigationUrl(url) && url !== 'about:blank') {
            this.createTab(url, { active: true });
          }
          return { action: 'deny' };
        });
      }
    });

    wc.on('enter-html-full-screen', () => {
      if (tab.id === this.splitTabId) this.switchTab(tab.id);
      this.isHtmlFullscreen = true;
      this.fullscreenTabId = tab.id;
      this.layout();
      this._emitFind(); // в полноэкранном HTML-режиме панель поиска скрыта
    });

    wc.on('leave-html-full-screen', () => {
      if (this.fullscreenTabId !== null && this.fullscreenTabId !== tab.id) return;
      this.isHtmlFullscreen = false;
      this.fullscreenTabId = null;
      this.layout();
      this._emitFind();
    });

    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        wc.openDevTools({ mode: 'detach' });
        event.preventDefault();
        return;
      }
      this.onShortcut(event, input);
    });

    wc.setWindowOpenHandler(({ url, disposition, features }) => {
      if (isExternalProtocolUrl(url)) {
        confirmOpenExternal(this.win, url);
        return { action: 'deny' };
      }
      if (!isSafeNavigationUrl(url)) return { action: 'deny' };
      // Страница не из browser: не может открывать browser:// во вкладке или попапе
      if (isBlockedAppSchemeTransition(wc.getURL(), url)) return { action: 'deny' };

      // OAuth / платёжные попапы: window.open(..., 'width=500,height=600') — нужен настоящий
      // дочерний window с window.opener, иначе скрипт сайта не сможет вернуть результат
      const hasPopupFeatures = typeof features === 'string' && /(^|,)\s*(width|height|left|top|popup)\b/i.test(features);
      const isPopup = disposition === 'new-window' || (hasPopupFeatures && disposition !== 'background-tab');
      // Попап не проходит через will-navigate, поэтому http-попап при «Только HTTPS» открываем обычной вкладкой
      if (isPopup && !this._shouldUpgrade(url)) {
        const options = {
          autoHideMenuBar: true,
          webPreferences: {
            session: this.session,
            // preload нужен всегда: без него в OAuth-попапе Google JS (navigator.*, window.chrome, Passkey) расходится
            // с заголовками Firefox, которые подменяет security.js. Внутренние API он отдаёт только страницам browser://
            preload: TAB_PRELOAD_PATH,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            navigateOnDragDrop: false
          }
        };
        if (this._isFingerprintProtectionActive()) {
          options.webPreferences.additionalArguments = fingerprintArgs(this.session);
        }
        // Без options.parent: дочернее окно на Windows «приклеено» к родителю, и в основное окно браузера
        // нельзя переключиться (например, скопировать 2FA-код из почты). Закрытие попапа вместе с основным
        // окном обеспечивает did-create-window ниже.
        return { action: 'allow', overrideBrowserWindowOptions: options };
      }

      const currentIndex = this.tabs.findIndex(t => t.id === tab.id);
      const activate = disposition !== 'background-tab';
      this.createTab(url, {
        active: activate,
        insertIndex: currentIndex >= 0 ? currentIndex + 1 : null
      });
      return { action: 'deny' };
    });

    delete wc.on; // обратно к прототипному EventEmitter.on
    delete wc.once;
    tab._unwire = () => {
      for (const [evt, fn] of wired) { try { wc.removeListener(evt, fn); } catch { /* wc уничтожен */ } }
      wired.length = 0;
    };
    return view;
  }

  // ---- Контекстное меню веб-страниц ----
  _showContextMenu(tab, wc, params) {
    if (!this.win || this.win.isDestroyed() || wc.isDestroyed()) return;

    const settings = this.getSettings();
    const engine = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google;
    const flags = params.editFlags || {};
    // «&» в label на Windows — признак горячей буквы, поэтому экранируем
    const esc = (str) => String(str).replace(/&/g, '&&');
    const openInNewTab = (url) => {
      const idx = this.tabs.findIndex(t => t.id === tab.id);
      this.createTab(url, { active: true, insertIndex: idx >= 0 ? idx + 1 : null });
    };

    const groups = [];

    // Навигация (для редактируемых полей не показываем)
    if (!params.isEditable) {
      const nav = wc.navigationHistory;
      groups.push([
        { label: 'Назад', enabled: nav.canGoBack(), click: () => nav.goBack() },
        { label: 'Вперёд', enabled: nav.canGoForward(), click: () => nav.goForward() },
        { label: 'Обновить', click: () => this.reloadTab(tab.id, false) }
      ]);
    }

    // Редактируемые поля
    if (params.isEditable) {
      const edit = [];
      const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions.slice(0, 5) : [];
      if (params.misspelledWord) {
        if (suggestions.length) {
          for (const word of suggestions) {
            edit.push({ label: esc(word), click: () => wc.replaceMisspelling(word) });
          }
        } else {
          edit.push({ label: 'Нет вариантов', enabled: false });
        }
        groups.push(edit.splice(0));
      }
      groups.push([
        { label: 'Отменить', enabled: Boolean(flags.canUndo), click: () => wc.undo() },
        { label: 'Повторить', enabled: Boolean(flags.canRedo), click: () => wc.redo() }
      ]);
      groups.push([
        { label: 'Вырезать', enabled: Boolean(flags.canCut), click: () => wc.cut() },
        { label: 'Копировать', enabled: Boolean(flags.canCopy), click: () => wc.copy() },
        { label: 'Вставить', enabled: Boolean(flags.canPaste), click: () => wc.paste() },
        { label: 'Выделить всё', enabled: Boolean(flags.canSelectAll), click: () => wc.selectAll() }
      ]);
    }

    // Выделенный текст
    const selection = typeof params.selectionText === 'string' ? params.selectionText.trim() : '';
    if (selection) {
      const sel = [];
      if (!params.isEditable) {
        sel.push({ label: 'Копировать', click: () => wc.copy() });
      }
      const flat = selection.replace(/\s+/g, ' ');
      const shown = flat.length > 30 ? `${flat.slice(0, 30)}…` : flat;
      sel.push({
        label: `Найти «${esc(shown)}» в ${esc(engine.name)}`,
        click: () => openInNewTab(engine.url + encodeURIComponent(selection.slice(0, 500)))
      });
      groups.push(sel);
    }

    // Ссылки
    const pageUrl = (() => { try { return wc.getURL(); } catch { return ''; } })();
    const allowedTarget = (u) => isSafeNavigationUrl(u) && !isBlockedAppSchemeTransition(pageUrl, u);
    if (params.linkURL && allowedTarget(params.linkURL)) {
      groups.push([
        { label: 'Открыть ссылку в новой вкладке', click: () => openInNewTab(params.linkURL) },
        { label: 'Копировать адрес ссылки', click: () => clipboard.writeText(params.linkURL) }
      ]);
    }

    // Изображения
    if (params.mediaType === 'image' && params.srcURL) {
      const safeSrc = allowedTarget(params.srcURL);
      const canSave = safeSrc || params.srcURL.startsWith('data:image/');
      const img = [];
      if (safeSrc) {
        img.push({ label: 'Открыть картинку в новой вкладке', click: () => openInNewTab(params.srcURL) });
        img.push({ label: 'Копировать адрес картинки', click: () => clipboard.writeText(params.srcURL) });
      }
      if (canSave) {
        img.push({ label: 'Сохранить картинку как…', click: () => { try { wc.downloadURL(params.srcURL); } catch { /* ignore */ } } });
      }
      if (img.length) groups.push(img);
    }

    groups.push([
      {
        label: 'Исследовать элемент',
        click: () => {
          if (wc.isDestroyed()) return;
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
          wc.inspectElement(params.x, params.y);
        }
      }
    ]);

    const template = [];
    for (const group of groups) {
      if (!group.length) continue;
      if (template.length) template.push({ type: 'separator' });
      template.push(...group);
    }
    if (!template.length) return;

    Menu.buildFromTemplate(template).popup({ window: this.win });
  }

  // Фавиконка через сессию вкладки (без cookies) → data: URL. null, если не удалось или это не маленькое изображение.
  async _fetchFaviconDataUrl(url) {
    if (typeof url !== 'string') return null;
    if (url.startsWith('data:image/') || url.startsWith(`${APP_SCHEME}:`)) return url;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      const res = await this.session.fetch(url, { credentials: 'omit', signal: ac.signal });
      if (!res.ok) return null;
      const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|jpeg|gif|webp|svg\+xml)$/.test(type)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > 65536) return null;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Режим «Только HTTPS» ----
  // Схема: http://-адрес сначала грузится как https://. Состояние попытки лежит в tab.httpsUpgrade
  // ({ httpUrl, httpsUrl, hops }) и живёт до коммита страницы (did-navigate). Если HTTPS не ответил
  // (ошибка соединения/сертификата или таймаут), вкладка показывает browser://error с desc=HTTPS_ONLY_UNAVAILABLE,
  // а tab.httpsWarning разрешает странице выполнить действия «назад» / «всё равно перейти».
  _shouldUpgrade(url) {
    return httpsOnly.shouldUpgrade(url, {
      enabled: Boolean(this.getSettings().httpsOnly),
      incognito: this.incognito
    });
  }

  _clearHttpsUpgrade(tab) {
    if (tab.httpsTimer) clearTimeout(tab.httpsTimer);
    tab.httpsTimer = null;
    tab.httpsUpgrade = null;
  }

  // Если сайт молча не отвечает на 443, ошибки не будет вообще: ограничиваем ожидание
  _armHttpsTimer(tab) {
    if (tab.httpsTimer) clearTimeout(tab.httpsTimer);
    const upgrade = tab.httpsUpgrade;
    tab.httpsTimer = setTimeout(() => {
      tab.httpsTimer = null;
      if (!upgrade || tab.httpsUpgrade !== upgrade || !tab.view) return;
      const wc = tab.view.webContents;
      if (wc.isDestroyed()) return;
      this._showHttpsWarning(tab, wc, upgrade, -118); // ERR_CONNECTION_TIMED_OUT
    }, httpsOnly.HTTPS_UPGRADE_TIMEOUT_MS);
  }

  // Переход, которому нужен другой User-Agent (вход в Google ↔ остальные сайты). Менять UA «на лету» нельзя:
  // Chromium перезагрузит ТЕКУЩУЮ страницу и отменит начатый переход (клик по «Войти» на Gemini обновлял Gemini).
  // Поэтому отменяем переход и на следующем тике, когда вкладка остановлена, загружаем адрес заново — уже с нужным UA
  // (_loadInTab сам останавливает вкладку и меняет UA до loadURL). true — переход отменён и будет перезапущен.
  _switchGoogleAuthUa(tab, wc, event, url, { referrer = null, redirect = false } = {}) {
    if (!/^https?:\/\//i.test(url || '')) return false;
    if (!googleAuthUaNeedsFlip(wc, url)) return false;
    // Предохранитель от цикла «вход ↔ сайт»: больше 6 перезапусков за 10 секунд — не вмешиваемся
    const now = Date.now();
    const recent = (tab.uaSwitches || []).filter((t) => now - t < 10000);
    tab.uaSwitches = recent;
    if (recent.length >= 6) return false;
    recent.push(now);
    event.preventDefault();
    setTimeout(() => {
      if (wc.isDestroyed() || !tab.view || tab.view.webContents !== wc) return;
      this._loadInTab(tab, url, { redirect, referrer });
    }, 0);
    return true;
  }

  // Единая точка загрузки адреса в существующую вкладку: здесь http:// заменяется на https://
  _loadInTab(tab, url, { redirect = false, referrer = null } = {}) {
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;
    const wc = tab.view.webContents;
    const prev = tab.httpsUpgrade;
    tab.httpsWarning = null; // начата новая загрузка: страница предупреждения больше не актуальна
    tab.certWarning = null;

    let target = url;
    if (this._shouldUpgrade(url)) {
      target = httpsOnly.toHttps(url);
      tab.httpsUpgrade = { httpUrl: url, httpsUrl: target, hops: redirect && prev ? prev.hops + 1 : 0 };
      this._armHttpsTimer(tab);
    } else if (!redirect) {
      this._clearHttpsUpgrade(tab);
    }
    // UA меняем ДО загрузки и только на остановленной вкладке (см. syncGoogleAuthUa)
    if (googleAuthUaNeedsFlip(wc, target)) {
      try { if (wc.isLoading()) wc.stop(); } catch { /* ignore */ }
      syncGoogleAuthUa(wc, target);
    }
    const loadOpts = referrer && /^https?:\/\//i.test(referrer) ? { httpReferrer: referrer } : {};
    wc.loadURL(target, loadOpts).catch(() => {});
  }

  // Серверный редирект на http://: апгрейдим, но не даём сайту зациклить нас
  // (https://a -> 302 -> http://a -> https://a ...). Повтор того же хоста или длинная цепочка = предупреждение
  _upgradeRedirect(tab, wc, url) {
    const prev = tab.httpsUpgrade;
    if (prev) {
      let sameHost = false;
      try { sameHost = new URL(prev.httpUrl).host === new URL(url).host; } catch { /* ignore */ }
      if (sameHost || prev.hops >= 5) {
        this._showHttpsWarning(tab, wc, prev, -310); // ERR_TOO_MANY_REDIRECTS
        return;
      }
    }
    this._loadInTab(tab, url, { redirect: true });
  }

  _showHttpsWarning(tab, wc, upgrade, errorCode) {
    this._clearHttpsUpgrade(tab);
    if (!wc || wc.isDestroyed() || !tab.view || tab.view.webContents !== wc) return;
    try { wc.stop(); } catch { /* ignore */ }
    // failedUrl хранит http-адрес: перезагрузка, дублирование и восстановление сессии снова пойдут через апгрейд
    tab.failedUrl = upgrade.httpUrl;
    tab.httpsWarning = { httpUrl: upgrade.httpUrl, httpsUrl: upgrade.httpsUrl };
    tab.loading = false;
    const params = new URLSearchParams({
      code: String(errorCode),
      desc: 'HTTPS_ONLY_UNAVAILABLE',
      url: upgrade.httpUrl
    });
    wc.loadURL(`${APP_SCHEME}://error?${params.toString()}`).catch(() => {});
    this._emitState();
  }

  // Кнопки страницы предупреждения переходят на browser://error?action=... — перехватываем это в will-navigate.
  // Работает только пока вкладка реально показывает предупреждение, которое выставил main (tab.httpsWarning);
  // адрес для перехода берётся из состояния вкладки, а не из параметров URL
  _handleHttpsWarningAction(tab, wc, event, url) {
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== 'error') return false;
    const action = parsed.searchParams.get('action');
    if (action !== 'https-proceed' && action !== 'https-back') return false;

    event.preventDefault();
    const warning = tab.httpsWarning;
    let current = '';
    try { current = wc.getURL(); } catch { /* ignore */ }
    if (!warning || !current.startsWith(`${APP_SCHEME}://error`)) return true;

    if (action === 'https-proceed') {
      httpsOnly.addException(warning.httpUrl, this.incognito); // до закрытия браузера
      tab.url = warning.httpUrl;
      tab.failedUrl = null;
      this._loadInTab(tab, warning.httpUrl); // исключение есть: апгрейда не будет
      this._emitState();
    } else {
      this._leaveHttpsWarning(tab, wc, warning);
    }
    return true;
  }

  // ---- Ошибка сертификата ----
  // tab.certWarning ставит только main: { url, exceptionKey }. exceptionKey != null — адрес локальный (проверено по hostname
  // в security.js) и у сертификата есть отпечаток; только тогда исключение возможно.
  // Что именно разрешать, берётся из этого состояния, а не из параметров URL страницы ошибки.
  _showCertWarning(tab, wc, errorCode, errorDescription, validatedURL) {
    if (!wc || wc.isDestroyed() || !tab.view || tab.view.webContents !== wc) return;
    const failedUrl = validatedURL || tab.url || '';
    const info = takeCertError(wc.id, failedUrl);
    const exceptionKey = info ? info.exceptionKey : null;

    tab.failedUrl = failedUrl;
    tab.loading = false;
    tab.certWarning = { url: failedUrl, exceptionKey };

    const params = new URLSearchParams({
      code: String(errorCode),
      desc: errorDescription || 'ERR_CERT_INVALID',
      url: failedUrl,
      kind: 'cert'
    });
    if (exceptionKey) {
      params.set('local', '1');
      if (info.fingerprint) params.set('fp', info.fingerprint); // только для показа; в действии не участвует
    }
    wc.loadURL(`${APP_SCHEME}://error?${params.toString()}`).catch(() => {});
    this._emitState();
  }

  // browser://error?action=cert-back | cert-proceed — перехватываем в will-navigate (как действия «Только HTTPS»)
  _handleCertWarningAction(tab, wc, event, url) {
    let parsed;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== 'error') return false;
    const action = parsed.searchParams.get('action');
    if (action !== 'cert-proceed' && action !== 'cert-back') return false;

    event.preventDefault();
    const warning = tab.certWarning;
    let current = '';
    try { current = wc.getURL(); } catch { /* ignore */ }
    if (!warning || !current.startsWith(`${APP_SCHEME}://error`)) return true;

    if (action === 'cert-proceed') {
      // Обычный сайт: исключения нет, даже если страница прислала cert-proceed
      if (!warning.exceptionKey) return true;
      if (!addCertExceptionKey(wc.session, warning.exceptionKey)) return true;
      const target = warning.url;
      tab.certWarning = null;
      tab.failedUrl = null;
      tab.url = target;
      this._loadInTab(tab, target); // certificate-error найдёт исключение (origin + fingerprint) и разрешит
      this._emitState();
    } else {
      tab.certWarning = null;
      this._leaveHttpsWarning(tab, wc, { httpUrl: warning.url, httpsUrl: warning.url });
    }
    return true;
  }

  // «Вернуться назад»: идём к ближайшей записи истории, которая не является результатом неудачной попытки
  // (в истории могут оставаться запись ошибки Chromium и сама страница предупреждения); иначе — новая вкладка
  _leaveHttpsWarning(tab, wc, warning) {
    const skip = new Set([warning.httpUrl, warning.httpsUrl]);
    tab.httpsWarning = null;
    tab.failedUrl = null;
    try {
      const nav = wc.navigationHistory;
      const entries = nav.getAllEntries();
      for (let i = nav.getActiveIndex() - 1; i >= 0; i--) {
        const u = entries[i] && entries[i].url;
        if (!u || skip.has(u) || u.startsWith(`${APP_SCHEME}://error`) || /^chrome-error:/i.test(u)) continue;
        nav.goToIndex(i);
        return;
      }
    } catch { /* откатимся на новую вкладку */ }
    this._loadInTab(tab, this.getNewTabUrl());
  }

  createTab(input, options = {}) {
    const {
      active = true,
      pinned = false,
      sleeping = false,
      title = null,
      favicon = null,
      insertIndex = null,
      workspaceId = null
    } = options;

    const settings = this.getSettings();
    const url = input ? resolveUserInput(input, settings) : this.getNewTabUrl();

    const tab = {
      id: this.nextId++,
      view: null,
      navId: 0,
      url,
      failedUrl: null,
      title: title || 'Новая вкладка',
      // http: не пускаем в окно интерфейса; в Инкогнито допустимы только data:/browser:
      favicon: favicon && isSafeFaviconUrl(favicon) && !/^http:/i.test(favicon) &&
        !(this.incognito && /^https?:/i.test(favicon)) ? favicon : null,
      pinned: Boolean(pinned),
      sleeping: Boolean(sleeping),
      loading: !sleeping,
      audible: false,
      muted: false,
      zoomFactor: 1,
      lastActiveAt: Date.now(),
      workspaceId: this.workspacesEnabled
        ? storage.normalizeWorkspaceId(workspaceId || this.activeWorkspaceId)
        : storage.DEFAULT_WORKSPACE_ID
    };

    const pinnedCount = this._getPinnedCount();
    let idx;
    if (tab.pinned) {
      idx = insertIndex !== null ? Math.min(Math.max(0, insertIndex), pinnedCount) : pinnedCount;
    } else if (insertIndex !== null) {
      idx = Math.min(Math.max(pinnedCount, insertIndex), this.tabs.length);
    } else {
      idx = this.tabs.length;
    }
    this.tabs.splice(idx, 0, tab);

    if (!tab.sleeping) {
      this._attachView(tab);
      this._loadInTab(tab, url);
    }

    if (active || this.activeId === null) {
      this.switchTab(tab.id);
    } else {
      this.layout();
      this._emitState();
      this.onSessionDirty();
    }

    return tab;
  }

  wakeTab(tab) {
    if (!tab || (!tab.sleeping && tab.view)) return;
    tab.sleeping = false;
    tab.loading = true;
    tab.lastActiveAt = Date.now();
    this._attachView(tab);
    const targetUrl = tab.failedUrl || tab.url || this.getNewTabUrl();
    this._loadInTab(tab, targetUrl);
  }

  sleepTab(id) {
    const tab = this.getTab(id);
    if (!tab || tab.sleeping || tab.id === this.activeId) return false;
    if (tab.id === this.splitTabId) this.closeSplitView(); // ручное усыпление напарника выходит из Split View

    if (tab.view && !tab.view.webContents.isDestroyed()) {
      const wc = tab.view.webContents;
      const currentUrl = wc.getURL();
      if (currentUrl && !currentUrl.startsWith(`${APP_SCHEME}://error`)) {
        tab.url = currentUrl;
      }
      const currentTitle = wc.getTitle();
      if (currentTitle) tab.title = currentTitle;
    }

    this._destroyView(tab);
    tab.sleeping = true;
    tab.loading = false;
    tab.audible = false;
    this._emitState();
    return true;
  }

  sleepAllBackgroundTabs() {
    let count = 0;
    for (const tab of this.tabs) {
      if (tab.id === this.activeId || tab.id === this.splitTabId || tab.sleeping) continue;
      if (tab.audible || (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.isCurrentlyAudible())) {
        continue;
      }
      if (tab.url.startsWith(`${APP_SCHEME}://`)) continue;
      if (this.sleepTab(tab.id)) count++;
    }
    return count;
  }

  checkSleepingTabs() {
    const { sleepMinutes } = this.getSettings();
    if (!(sleepMinutes > 0)) return; // «Отключено»
    const cutoff = Date.now() - sleepMinutes * 60_000;
    for (const tab of this.tabs) {
      if (tab.id === this.activeId || tab.id === this.splitTabId || tab.sleeping || tab.pinned) continue;
      if (tab.url.startsWith(`${APP_SCHEME}://`)) continue;

      const isPlayingAudio =
        tab.audible ||
        (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.isCurrentlyAudible());
      if (isPlayingAudio) {
        tab.lastActiveAt = Date.now();
        continue;
      }

      if (tab.lastActiveAt <= cutoff) {
        this.sleepTab(tab.id);
      }
    }
  }

  switchTab(id) {
    const target = this.getTab(id);
    if (!target) return;

    // Вкладка из другого пространства (история, «перейти к открытой вкладке»): переходим в её пространство
    if (this.workspacesEnabled && target.workspaceId !== this.activeWorkspaceId) {
      this._stashWorkspace();
      this.activeWorkspaceId = target.workspaceId;
      this.splitTabId = null;
    }

    const prev = this.getActive();
    if (prev && prev.id !== target.id) {
      prev.lastActiveAt = Date.now();
    }
    const prevActiveId = this.activeId;

    // Клик по напарнику — меняем роли; переход на третью вкладку заменяет активную половину, напарник остаётся
    if (this.splitTabId !== null && target.id === this.splitTabId) this.splitTabId = prevActiveId;

    // Смена вкладки выводит из HTML-fullscreen (иначе новая вкладка открылась бы без верхней панели)
    if (prevActiveId !== target.id) this._resetHtmlFullscreen(null, { exitInPage: true, relayout: false });

    this.activeId = target.id;
    target.lastActiveAt = Date.now();

    if (target.sleeping || !target.view) {
      this.wakeTab(target);
    }

    this.layout();

    // Если на выбранной вкладке висит запрос авторизации, фокус остаётся в окне интерфейса (диалог)
    if (!this._getActiveAuth() && target.view && !target.view.webContents.isDestroyed()) {
      target.view.webContents.focus();
    }

    if (prevActiveId !== target.id) this._syncFindOnSwitch(target);

    this._emitAuth(); // показать диалог выбранной вкладки или скрыть прежний
    this._emitState();
    this.onSessionDirty();
  }

  switchRelative(delta) {
    const tabs = this._wsTabs();
    if (tabs.length <= 1) return;
    const idx = tabs.findIndex(t => t.id === this.activeId);
    if (idx === -1) return;
    const nextIdx = (idx + delta + tabs.length) % tabs.length;
    this.switchTab(tabs[nextIdx].id);
  }

  switchByPosition(oneBasedIndex) {
    const tabs = this._wsTabs();
    if (tabs.length === 0) return;
    if (oneBasedIndex === 9) {
      this.switchTab(tabs[tabs.length - 1].id);
      return;
    }
    const target = tabs[oneBasedIndex - 1];
    if (target) this.switchTab(target.id);
  }

  // Перенос вкладки в другое окно: view остаётся живым (страница не перезагружается), у этого менеджера вкладка исчезает.
  // Возвращает { tab, view } для adoptTab() нового менеджера. Если вкладок не осталось — activeId = null, окно закрывает вызывающий
  detachTabForTransfer(id) {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    const tab = this.tabs[idx];
    const view = tab.view && tab.view.webContents && !tab.view.webContents.isDestroyed() ? tab.view : null;

    if (view) {
      // Слушатели (в том числе once('destroyed')) снимаем в любом случае, даже если шаги ниже бросят исключение
      try {
        try { this._cancelAuth(view.webContents.id, { relayout: false }); } catch { /* ignore */ }
        this._clearHttpsUpgrade(tab);
        this._resetHtmlFullscreen(tab, { relayout: false });
        if (this.find.tabId === tab.id) { this._stopFind(); this._emitFind(); }
        try { this.win.contentView.removeChildView(view); } catch { /* уже отсоединён */ }
      } finally {
        if (typeof tab._unwire === 'function') tab._unwire();
      }
    }
    tab.view = null;
    this.tabs.splice(idx, 1);

    // Дальше как в closeTab, но без записи в closedTabs и без автосоздания новой вкладки
    let partnerId = null;
    if (id === this.splitTabId) this.splitTabId = null;
    else if (id === this.activeId && this.splitTabId !== null) { partnerId = this.splitTabId; this.splitTabId = null; }

    if (this.tabs.length === 0) {
      this.activeId = null;
    } else if (id === this.activeId) {
      const next = (partnerId !== null && this.getTab(partnerId)) || this._pickNextInWorkspace(idx);
      if (next) {
        this.switchTab(next.id);
      } else {
        this.activeId = null; // в пространстве пусто, а в других вкладки остались — окно не закрываем
        this.createTab();
      }
    } else {
      this.layout();
      this._emitState();
      this.onSessionDirty();
    }

    const { id: _oldId, view: _oldView, _unwire, ...rest } = tab;
    return { tab: rest, view };
  }

  // Принимает вкладку из другого окна: тот же WebContentsView, новый id и новые слушатели
  adoptTab({ tab: old, view }, { active = true } = {}) {
    const tab = { ...old, id: this.nextId++, view: null, _unwire: null };
    this.tabs.splice(tab.pinned ? this._getPinnedCount() : this.tabs.length, 0, tab);
    if (view && !view.webContents.isDestroyed()) {
      this._attachView(tab, view);
    } else {
      tab.sleeping = true; // view не пережил перенос: вкладка проснётся и загрузится при активации
      tab.loading = false;
    }
    if (active || this.activeId === null) {
      this.switchTab(tab.id);
    } else {
      this.layout();
      this._emitState();
      this.onSessionDirty();
    }
    return tab;
  }

  closeTab(id) {
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const [tab] = this.tabs.splice(idx, 1);

    const savedUrl = tab.failedUrl || tab.url;
    if (savedUrl && savedUrl !== 'about:blank' &&
      !savedUrl.startsWith(`${APP_SCHEME}://error`) &&
      !/^browser:\/\/newtab\/?([?#]|$)/i.test(savedUrl)) { // пустая новая вкладка не должна вытеснять реальные закрытые сайты
      this.closedTabs.push({
        url: savedUrl,
        title: tab.title,
        favicon: tab.favicon,
        pinned: tab.pinned
      });
      if (this.closedTabs.length > MAX_CLOSED_TABS) {
        this.closedTabs.shift();
      }
    }

    this._destroyView(tab);

    let partnerId = null;
    if (id === this.splitTabId) this.splitTabId = null;
    else if (id === this.activeId && this.splitTabId !== null) { partnerId = this.splitTabId; this.splitTabId = null; }

    if (this._wsTabs().length === 0) { // пространство опустело; вкладки других пространств не трогаем
      this.activeId = null;
      this.createTab();
      return;
    }

    if (id === this.activeId) {
      const nextTab = (partnerId !== null && this.getTab(partnerId)) || this._pickNextInWorkspace(idx);
      this.switchTab(nextTab.id);
    } else {
      this.layout(); // закрыли напарника: активная вкладка снова на всю ширину
      this._emitState();
      this.onSessionDirty();
    }
  }

  closeOtherTabs(keepId) {
    const toClose = this.tabs.filter(t => t.id !== keepId && !t.pinned && this._inWorkspace(t)).map(t => t.id);
    for (const id of toClose) {
      this.closeTab(id);
    }
  }

  reopenClosedTab() {
    const last = this.closedTabs.pop();
    if (!last) return;
    this.createTab(last.url, {
      active: true,
      pinned: last.pinned,
      title: last.title,
      favicon: last.favicon
    });
  }

  duplicateTab(id) {
    const tab = this.getTab(id);
    if (!tab) return;
    const idx = this.tabs.findIndex(t => t.id === id);
    this.createTab(tab.failedUrl || tab.url, {
      active: true,
      insertIndex: idx + 1
    });
  }

  togglePinTab(id) {
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;

    const [tab] = this.tabs.splice(idx, 1);
    tab.pinned = !tab.pinned;

    const pinnedCount = this._getPinnedCount();
    this.tabs.splice(pinnedCount, 0, tab);

    this.layout(); // порядок вкладок влияет на половины Split View
    this._emitState();
    this.onSessionDirty();
  }

  reorderTab(fromId, toId, insertAfter = false) {
    if (fromId === toId) return;
    const fromIdx = this.tabs.findIndex(t => t.id === fromId);
    const toIdx = this.tabs.findIndex(t => t.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    if (this.tabs[fromIdx].pinned !== this.tabs[toIdx].pinned) return;

    const [moved] = this.tabs.splice(fromIdx, 1);
    const newToIdx = this.tabs.findIndex(t => t.id === toId);
    const targetIdx = insertAfter ? newToIdx + 1 : newToIdx;
    this.tabs.splice(targetIdx, 0, moved);

    this.layout(); // порядок вкладок влияет на половины Split View
    this._emitState();
    this.onSessionDirty();
  }

  navigateActive(input, { forceSearch = false } = {}) {
    const tab = this.getActive();
    if (!tab) return;
    if (tab.sleeping || !tab.view) this.wakeTab(tab);

    let url;
    const text = typeof input === 'string' ? input.trim() : '';
    if (forceSearch && text) {
      // Строка из подсказок поисковика уходит прямо в поиск
      const engine = SEARCH_ENGINES[this.getSettings().searchEngine] || SEARCH_ENGINES.google;
      url = engine.url + encodeURIComponent(text);
    } else {
      url = resolveUserInput(input, this.getSettings());
    }
    tab.url = url;
    tab.failedUrl = null;
    this._loadInTab(tab, url);
    tab.view.webContents.focus();
    this._emitState();
  }

  goBack() {
    const tab = this.getActive();
    if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.navigationHistory.goBack();
    }
  }

  goForward() {
    const tab = this.getActive();
    if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.navigationHistory.goForward();
    }
  }

  reloadActive(hard = false) {
    this.reloadTab(this.activeId, hard);
  }

  reloadTab(id, hard = false) {
    const tab = this.getTab(id);
    if (!tab) return;
    if (tab.sleeping || !tab.view) {
      this.wakeTab(tab);
      return;
    }
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;

    if (tab.failedUrl && wc.getURL().startsWith(`${APP_SCHEME}://error`)) {
      const retryUrl = tab.failedUrl;
      tab.failedUrl = null;
      this._loadInTab(tab, retryUrl);
      return;
    }

    if (hard) wc.reloadIgnoringCache();
    else wc.reload();
  }

  // ---- Масштаб страницы ----
  _applyZoom(tab, wc) {
    if (!wc || wc.isDestroyed()) return false;
    const target = tab.zoomFactor || 1;
    try {
      if (Math.abs(wc.getZoomFactor() - target) > 0.001) {
        wc.setZoomFactor(target);
        return true;
      }
    } catch { /* страница закрывается */ }
    return false;
  }

  _getActiveContents() {
    const tab = this.getActive();
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return null;
    return { tab, wc: tab.view.webContents };
  }

  _setZoom(factor) {
    const cur = this._getActiveContents();
    if (!cur) return;
    cur.tab.zoomFactor = factor;
    try { cur.wc.setZoomFactor(factor); } catch { /* ignore */ }
    this._emitState();
  }

  zoomIn() {
    const cur = this._getActiveContents();
    if (!cur) return;
    const f = cur.wc.getZoomFactor();
    const next = ZOOM_STEPS.find((s) => s > f + 0.001);
    if (next !== undefined) this._setZoom(next);
  }

  zoomOut() {
    const cur = this._getActiveContents();
    if (!cur) return;
    const f = cur.wc.getZoomFactor();
    let prev;
    for (const s of ZOOM_STEPS) {
      if (s < f - 0.001) prev = s;
    }
    if (prev !== undefined) this._setZoom(prev);
  }

  zoomReset() {
    this._setZoom(1);
  }

  // ---- Звук вкладки ----
  toggleMuteTab(id) {
    const tab = this.getTab(id);
    if (!tab) return;
    tab.muted = !tab.muted;
    if (tab.view && !tab.view.webContents.isDestroyed()) {
      try { tab.view.webContents.setAudioMuted(tab.muted); } catch { /* ignore */ }
    }
    this._emitState();
  }

  // ---- Печать ----
  printActive() {
    const cur = this._getActiveContents();
    if (!cur) return;
    try { cur.wc.print(); } catch { /* ignore */ }
  }

  stopActive() {
    const tab = this.getActive();
    if (tab && tab.view && !tab.view.webContents.isDestroyed()) {
      tab.view.webContents.stop();
    }
  }

  // ---- Поиск по странице (Ctrl+F) ----
  isFindOpen() {
    return this.find.open;
  }

  // Панель видна, только если открыта и страница не в полноэкранном HTML-режиме
  _findVisible() {
    return this.find.open && !this.isHtmlFullscreen;
  }

  isFindVisible() {
    return this._findVisible();
  }

  _findPayload() {
    const f = this.find;
    return { visible: this._findVisible(), ordinal: f.ordinal, total: f.total, done: f.done };
  }

  _emitFind() {
    this.onFindChange(this._findPayload());
  }

  _resetFindResults() {
    const f = this.find;
    f.ordinal = 0;
    f.total = 0;
    f.done = false;
  }

  // Останавливает поиск и снимает подсветку там, где он шёл (если вкладка ещё жива). Состояние панели не шлёт
  _stopFind() {
    const f = this.find;
    const tab = f.tabId !== null ? this.getTab(f.tabId) : null;
    f.tabId = null;
    f.requestId = 0;
    this._resetFindResults();
    if (!tab || !tab.view) return;
    const wc = tab.view.webContents;
    if (wc.isDestroyed()) return;
    try { wc.stopFindInPage('clearSelection'); } catch { /* страница закрывается */ }
  }

  openFindBar() {
    if (this.isHtmlFullscreen) return;
    if (this._getActiveAuth()) return; // страница скрыта диалогом авторизации
    if (!this._getActiveContents()) return;
    const f = this.find;
    const wasOpen = f.open;
    f.open = true;
    if (!wasOpen) this.layout();
    this._emitFind();
    this.onFindFocus(); // renderer поставит фокус в поле и выделит уже введённый текст
    // Панель открыта заново: возвращаем подсветку прежнего запроса
    if (!wasOpen && f.query) this._runFind({ findNext: false, forward: true });
  }

  closeFindBar({ restoreFocus = true } = {}) {
    const f = this.find;
    if (!f.open) return;
    f.open = false;
    this._stopFind(); // stopFindInPage('clearSelection')
    this.layout();
    this._emitFind();
    if (restoreFocus) {
      const cur = this._getActiveContents();
      if (cur) cur.wc.focus();
    }
  }

  // Новая строка или переключатель «Aa»: начинаем новую сессию поиска в активной вкладке
  setFindQuery(text, matchCase) {
    const f = this.find;
    if (!f.open) return;
    f.query = text;
    f.matchCase = Boolean(matchCase);
    if (!text) {
      this._stopFind();
      this._emitFind();
      return;
    }
    this._runFind({ findNext: false, forward: true });
  }

  // Enter / F3 (вперёд) и Shift+Enter / Shift+F3 (назад)
  findNext(forward = true) {
    const f = this.find;
    if (!f.open || !f.query) return;
    const cur = this._getActiveContents();
    if (!cur) return;
    // Продолжаем текущую сессию, только если она идёт именно в этой вкладке
    this._runFind({ findNext: f.tabId === cur.tab.id, forward: Boolean(forward) });
  }

  _runFind({ findNext = false, forward = true } = {}) {
    const f = this.find;
    const cur = this._getActiveContents();
    if (!f.open || !f.query || !cur) {
      this._stopFind();
      this._emitFind();
      return;
    }
    // Подсветка осталась в другой вкладке: снимаем её
    if (f.tabId !== null && f.tabId !== cur.tab.id) {
      this._stopFind();
      findNext = false;
    }
    try {
      // В Electron findNext: true — «продолжить текущий поиск» (следующее/предыдущее совпадение);
      // без него (или при смене текста/регистра) начинается новая сессия
      f.requestId = cur.wc.findInPage(f.query, { forward, matchCase: f.matchCase, findNext });
      f.tabId = cur.tab.id;
    } catch {
      this._stopFind();
      this._emitFind();
      return;
    }
    if (!findNext) {
      this._resetFindResults();
      this._emitFind();
    }
  }

  // Результаты приходят порциями; устаревшие (другой requestId/вкладка) отбрасываем
  _onFoundInPage(tab, result) {
    const f = this.find;
    if (!f.open || f.tabId !== tab.id || tab.id !== this.activeId) return;
    if (!result || result.requestId !== f.requestId) return;
    if (Number.isFinite(result.matches) && result.matches >= 0) f.total = result.matches;
    if (Number.isFinite(result.activeMatchOrdinal) && result.activeMatchOrdinal >= 0) f.ordinal = result.activeMatchOrdinal;
    if (f.total === 0) f.ordinal = 0;
    if (result.finalUpdate) f.done = true;
    this._emitFind();
  }

  // Переключение вкладки: поиск в прежней останавливаем, в новой (если панель открыта) запускаем заново
  _syncFindOnSwitch(target) {
    const f = this.find;
    if (f.tabId !== null && f.tabId !== target.id) this._stopFind();
    if (!f.open) return;
    if (f.query && target.view && !target.view.webContents.isDestroyed() && !target.loading) {
      this._runFind({ findNext: false, forward: true });
    } else {
      this._emitFind(); // нечего искать или вкладка ещё грузится (до did-finish-load): счётчик пуст
    }
  }

  // ---- Split View ----
  _getSplitTab() {
    if (this.splitTabId === null || this.isHtmlFullscreen) return null;
    const t = this.getTab(this.splitTabId);
    return t && t.id !== this.activeId ? t : null;
  }

  openSplitView(secondTabId) {
    const second = this.getTab(secondTabId);
    if (!second || second.id === this.activeId || !this._inWorkspace(second)) return false;
    this.splitTabId = second.id;
    second.lastActiveAt = Date.now();
    this.layout(); // разбудит напарника, если он спит
    this._emitState();
    this.onSessionDirty();
    return true;
  }

  closeSplitView() {
    if (this.splitTabId === null) return;
    this.splitTabId = null;
    this.layout();
    this._emitState();
    this.onSessionDirty();
  }

  setSplitRatio(ratio) {
    const r = Number(ratio);
    if (!Number.isFinite(r) || this.splitTabId === null) return;
    this.splitRatio = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r));
    this.layout();
    this._emitState();
    this.onSessionDirty(); // запись в session.json отложена на 600 мс, перетаскивание не бьёт по диску
  }

  toggleSplitView() {
    if (this.splitTabId !== null) { this.closeSplitView(); return; }
    const idx = this.tabs.findIndex(t => t.id === this.activeId);
    if (idx === -1) return;
    const pool = this._wsTabs();
    const pi = pool.findIndex(t => t.id === this.activeId);
    const partner = pool[pi + 1] || pool[pi - 1];
    if (partner) { this.openSplitView(partner.id); return; }
    const created = this.createTab(null, { active: false, insertIndex: idx + 1 });
    this.openSplitView(created.id);
  }

  // Фокус в половине-напарнике делает её активной (адресная строка, Назад/Вперёд, Ctrl+F, Ctrl+D)
  _onTabFocus(tab) {
    if (this.splitTabId === null || tab.id !== this.splitTabId) return;
    this.switchTab(tab.id); // switchTab меняет роли местами
  }

  // Инкогнито + защита от fingerprinting: часовой пояс UTC через CDP. Конфликтует с открытым DevTools на этой вкладке —
  // тогда отладчик уже занят, и остаётся JS-подмена из preload
  async _applyTimezoneOverride(wc) {
    try {
      if (wc.isDestroyed()) return;
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
    } catch { /* DevTools уже подключён или вкладка закрыта */ }
  }

  // Letterboxing (Инкогнито + включённая защита от fingerprinting): размер страницы округляется вниз до шага
  // и центрируется в доступной области, чтобы сайты не узнавали точный размер окна/разрешение экрана
  _isFingerprintProtectionActive() {
    if (!this.incognito) return false;
    try { return Boolean(this.getSettings().incognitoFingerprintProtection); } catch { return false; }
  }

  _letterbox(rect) {
    const step = LETTERBOX_STEP;
    const snap = (v) => (v >= step ? Math.floor(v / step) * step : v); // меньше шага — не схлопываем в 0
    const width = snap(rect.width);
    const height = snap(rect.height);
    return {
      x: rect.x + Math.floor((rect.width - width) / 2),
      y: rect.y + Math.floor((rect.height - height) / 2),
      width,
      height
    };
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const [w, h] = this.win.getContentSize();
    // Открытая панель #findbar (38px под #toolbar) сдвигает страницу вниз; в полноэкранном HTML-режиме панели нет
    // В HTML-fullscreen отступов нет: видео занимает всё окно
    const extra = this.isHtmlFullscreen ? { left: 0, top: 0 } : this.getInsets();
    const topOffset = this.isHtmlFullscreen ? 0 : UI_HEIGHT + (this._findVisible() ? FIND_BAR_HEIGHT : 0) + extra.top;
    // Страница занимает всё окно под панелью: без рамки по краям и без скруглений
    const left = extra.left;
    const radius = 0;
    // Справа может стоять панель Gemini; в HTML-fullscreen видео занимает всё окно
    const right = this.isHtmlFullscreen ? 0 : Math.max(0, Number(this.getRightInset?.(w)) || 0);
    const viewWidth = Math.max(0, w - left - right);
    const viewHeight = Math.max(0, h - topOffset);

    const split = this._getSplitTab();
    if (split && (split.sleeping || !split.view)) this.wakeTab(split);

    // Диалог авторизации живёт в окне интерфейса, под WebContentsView: на время диалога прячем все страницы
    // То же для карточек интерфейса: layout() зовут при ресайзе и смене вкладки, он не должен заново показать страницы поверх них
    const authOpen = Boolean(this._getActiveAuth()) || Boolean(this.isOverlayOpen?.());

    const bounds = new Map();
    const full = { x: left, y: topOffset, width: viewWidth, height: viewHeight };
    if (split) {
      const avail = Math.max(0, viewWidth - SPLIT_GAP);
      const leftW = Math.round(avail * this.splitRatio);
      const L = { x: left, y: topOffset, width: leftW, height: viewHeight };
      const R = { x: left + leftW + SPLIT_GAP, y: topOffset, width: avail - leftW, height: viewHeight };
      // Стороны фиксированы порядком вкладок в полосе: слева та, что левее
      const activeLeft = this.tabs.findIndex(t => t.id === this.activeId) < this.tabs.indexOf(split);
      bounds.set(this.activeId, activeLeft ? L : R);
      bounds.set(split.id, activeLeft ? R : L);
    } else {
      bounds.set(this.activeId, full);
    }

    if (this._isFingerprintProtectionActive()) {
      for (const [id, rect] of bounds) bounds.set(id, this._letterbox(rect));
    }

    for (const tab of this.tabs) {
      if (!tab.view) continue;
      const b = bounds.get(tab.id);
      tab.view.setVisible(Boolean(b) && !authOpen);
      if (b) {
        tab.view.setBounds(b);
        if (typeof tab.view.setBorderRadius === 'function') {
          tab.view.setBorderRadius(radius);
        }
      }
    }

    // Панель Gemini: та же высота, что у страниц, справа от зазора; прячется под модалками интерфейса и в HTML-fullscreen
    const panelRect = right > 0 && !authOpen
      ? { x: left + viewWidth, y: topOffset, width: right, height: viewHeight }
      : null;
    try { this.onLayout?.({ panelRect }); } catch { /* панель уничтожена */ }
  }

  getStateSnapshot() {
    const active = this.getActive();
    const activeWc = active && active.view && !active.view.webContents.isDestroyed()
      ? active.view.webContents
      : null;
    const nav = activeWc ? activeWc.navigationHistory : null;

    return {
      activeId: this.activeId,
      splitTabId: this.splitTabId,
      splitRatio: this.splitRatio,
      workspaces: this.getWorkspacesSnapshot(),
      canGoBack: nav ? nav.canGoBack() : false,
      canGoForward: nav ? nav.canGoForward() : false,
      canReopenClosed: this.closedTabs.length > 0,
      zoomPercent: activeWc ? Math.round(activeWc.getZoomFactor() * 100) : 100,
      tabs: this._wsTabs().map(t => {
        const wc = t.view && !t.view.webContents.isDestroyed() ? t.view.webContents : null;
        const wcUrl = wc ? wc.getURL() : '';
        const isError = Boolean(wcUrl && wcUrl.startsWith(`${APP_SCHEME}://error`));
        const rawUrl = isError ? wcUrl : (t.url || wcUrl || '');
        const isNewTab = !isError && rawUrl.startsWith(NEW_TAB_URL);

        let displayUrl;
        if (isNewTab) {
          displayUrl = '';
        } else if (isError) {
          displayUrl = formatDisplayUrl(t.failedUrl || t.url || '');
        } else {
          displayUrl = formatDisplayUrl(rawUrl);
        }

        return {
          id: t.id,
          title: (!isNewTab && wc && wc.getTitle()) || t.title || 'Новая вкладка',
          url: displayUrl,
          isNewTab,
          isError,
          favicon: t.favicon,
          loading: t.loading,
          pinned: t.pinned,
          sleeping: t.sleeping,
          audible: t.audible,
          muted: Boolean(t.muted)
        };
      })
    };
  }

  serializeSession() {
    const activeIndex = Math.max(0, this.tabs.findIndex(t => t.id === this.activeId));
    // Активная пара Split View. id вкладок между запусками не живут, поэтому пишем индексы в массиве tabs.
    // Слева та вкладка, что левее в полосе (как в layout()); ratio — доля ширины левой половины
    const splitTab = this.splitTabId !== null ? this.getTab(this.splitTabId) : null;
    let split = null;
    if (splitTab && splitTab.id !== this.activeId && !this.incognito) {
      const b = this.tabs.indexOf(splitTab);
      split = { leftIndex: Math.min(activeIndex, b), rightIndex: Math.max(activeIndex, b), ratio: this.splitRatio };
    }
    return {
      activeIndex,
      activeWorkspaceId: this.activeWorkspaceId,
      split,
      tabs: this.tabs.map(t => ({
        url: t.failedUrl || t.url || this.getNewTabUrl(),
        title: t.title || 'Новая вкладка',
        // data:-иконки и длинные URL в сессию не пишем — иконка подтянется при загрузке/пробуждении вкладки
        favicon: storage.sanitizeSessionFavicon(t.favicon),
        pinned: Boolean(t.pinned),
        workspaceId: t.workspaceId
      }))
    };
  }

  restoreSession(sessionData) {
    if (!sessionData || !Array.isArray(sessionData.tabs) || sessionData.tabs.length === 0) {
      this.createTab();
      return;
    }

    const safeActiveIdx = Math.min(
      Math.max(0, Number(sessionData.activeIndex) || 0),
      sessionData.tabs.length - 1
    );

    const createdIds = [];
    sessionData.tabs.forEach((saved, index) => {
      const isTargetActive = index === safeActiveIdx;
      const tab = this.createTab(saved.url, {
        active: false,
        pinned: Boolean(saved.pinned),
        sleeping: !isTargetActive,
        title: saved.title,
        favicon: storage.sanitizeSessionFavicon(saved.favicon),
        workspaceId: saved.workspaceId // нет поля / пространство удалено -> «Основное»
      });
      createdIds.push(tab.id);
    });

    const targetId = createdIds[safeActiveIdx] || createdIds[0];
    if (targetId) {
      this.switchTab(targetId); // заодно включает пространство активной вкладки
      this._restoreSplit(sessionData.split, createdIds, safeActiveIdx);
    }
  }

  // Восстановление Split View: пара валидна, только если одна из вкладок активна и обе в одном пространстве
  _restoreSplit(split, ids, activeIdx) {
    if (!split || typeof split !== 'object') return;
    const l = Number(split.leftIndex);
    const r = Number(split.rightIndex);
    const ok = (i) => Number.isInteger(i) && i >= 0 && i < ids.length;
    if (!ok(l) || !ok(r) || l === r || (activeIdx !== l && activeIdx !== r)) return;
    const partner = this.getTab(ids[activeIdx === l ? r : l]);
    if (!partner || !this._inWorkspace(partner)) return;
    const ratio = Number(split.ratio);
    if (Number.isFinite(ratio)) this.splitRatio = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ratio));
    this.openSplitView(partner.id); // layout() разбудит спящего напарника
  }

  _emitState() {
    this.onStateChange();
  }

  destroyAll() {
	  managers.delete(this);
    if (this.sleepTimer) {
      clearInterval(this.sleepTimer);
      this.sleepTimer = null;
    }
    // Поиск по странице не должен переживать менеджер: запрос не протекает между обычным режимом и Инкогнито
    this.find.open = false;
    this.find.query = '';
    this.find.tabId = null;
    this.find.ordinal = 0;
    this.find.total = 0;
    this.find.done = false;
    for (const tab of this.tabs) {
      this._destroyView(tab);
    }
    this.tabs = [];
    this.activeId = null;
    this.splitTabId = null;
    this.isHtmlFullscreen = false;
    this.fullscreenTabId = null;
    for (const wcId of Array.from(this.authRequests.keys())) this._cancelAuth(wcId, { relayout: false });
    // Попапы Инкогнито живут во временной сессии — закрываем принудительно (destroy, чтобы не ждать beforeunload)
    if (this.incognito) {
      httpsOnly.clearIncognitoExceptions(); // исключения «Только HTTPS» из Инкогнито не должны пережить сеанс
      for (const childWin of Array.from(this.childWindows)) {
        try { if (!childWin.isDestroyed()) childWin.destroy(); } catch { /* ignore */ }
      }
    }
    this.childWindows.clear();
  }
}

module.exports = TabManager;