const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { AsyncLocalStorage } = require('async_hooks');
const { app, ipcMain: electronIpcMain, dialog, session, webContents, clipboard } = require('electron');
const {
  APP_SCHEME,
  SEARCH_ENGINES,
  FIND_MAX_QUERY_LENGTH,
  OMNIBOX_MAX_QUERY_LENGTH
} = require('./constants');
const storage = require('./storage');
const passwordManager = require('./passwordManager');
const { buildCustomTheme } = require('./customTheme');
const adblock = require('./adblock');
const { DOH_MODES, DOH_PROVIDER_KEYS, normalizeDohUrl, applyDoh } = require('./doh');
const { PROXY_KEYS, sanitizeProxyPatch } = require('./proxy');
const { listMediaPermissions, removeMediaPermission, SITE_PERMISSION_NAMES, isSafeNavigationUrl } = require('./security');
const updater = require('./updater');
const siteIcons = require('./siteIcons');
const extensions = require('./extensions');

const CHROME_THEMES = [
  'cyber-blue', 'nebula-violet', 'obsidian-chrome', 'crimson-eclipse',
  'aurora-emerald', 'tokyo-synth', 'sakura-midnight', 'solar-gold', 'silver-cosmos',
  'aurora-voxel', 'topo-noir', 'katana-noir'
];

const ALLOWED_SETTINGS_KEYS = new Set([
  'theme', 'searchEngine', 'sleepMinutes', 'restoreSession',
  'adblock', 'adblockCosmetic', 'prettySearch', 'searchSuggest', 'trustedSources', 'httpsOnly', 'energySaver',
  'blockThirdPartyCookies', 'stripTrackingParams', 'incognitoFingerprintProtection', 'dohMode', 'dohProvider', 'dohCustomUrl',
  'verticalTabs', 'verticalTabsCollapsed', 'showBookmarksBar', 'incognitoNewWindow', 'offerSavePasswords',
  'blockCamera', 'blockMicrophone', 'blockGeolocation',
  ...PROXY_KEYS
]);

function decodeEntities(str) {
  return String(str || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k[0] === '#') {
      const cp = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[k];
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseNetscapeBookmarks(html) {
  const out = [];
  const seen = new Set();
  const stack = []; // имена открытых папок (null — безымянный <DL>, например корневой)
  let pending = null; // имя папки из <H3>, которая откроется следующим <DL>
  const re = /<(\/?)dl\b[^>]*>|<h3\b[^>]*>([\s\S]*?)<\/h3>|<a\s([^>]*?)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (/^<\/?dl/i.test(m[0])) {
      if (m[1] === '/') stack.pop();
      else { stack.push(pending); pending = null; }
      continue;
    }
    if (m[2] !== undefined) {
      pending = decodeEntities(m[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim() || null;
      continue;
    }
    // кавычки разбираем парами: апостроф внутри "..." (и наоборот) больше не обрывает ссылку
    const hrefMatch = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
    if (!hrefMatch) continue;
    const rawUrl = decodeEntities(hrefMatch[1] ?? hrefMatch[2]).trim();
    if (!/^https?:\/\//i.test(rawUrl) || rawUrl.length > 2048) continue;
    let href;
    try { href = new URL(rawUrl).href; } catch { continue; }
    if (seen.has(href)) continue;
    seen.add(href);
    const title = decodeEntities(m[4].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
    out.push({ url: href, title: title || href, path: stack.filter(Boolean) });
  }
  return out;
}

// nodes — плоский список дерева ({ id, type, title, url, parentId, order, createdAt })
function buildNetscapeBookmarks(nodes) {
  const kids = new Map();
  for (const n of nodes) {
    const k = n.parentId === null ? '' : n.parentId;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(n);
  }
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order);
  const lines = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Закладки</TITLE>',
    '<H1>Закладки</H1>',
    '<DL><p>'
  ];
  const emit = (parentKey, indent) => {
    for (const n of kids.get(parentKey) || []) {
      const ts = n.createdAt ? Math.floor(n.createdAt / 1000) : Math.floor(Date.now() / 1000);
      if (n.type === 'folder') {
        lines.push(`${indent}<DT><H3 ADD_DATE="${ts}">${escapeHtml(n.title || 'Папка')}</H3>`, `${indent}<DL><p>`);
        emit(n.id, `${indent}  `);
        lines.push(`${indent}</DL><p>`);
      } else {
        lines.push(`${indent}<DT><A HREF="${escapeHtml(n.url)}" ADD_DATE="${ts}">${escapeHtml(n.title || n.url)}</A>`);
      }
    }
  };
  emit('', '  ');
  lines.push('</DL><p>');
  return lines.join('\n');
}

const UI_INDEX_PATH = path.resolve(__dirname, '..', 'renderer', 'index.html');
const UI_INDEX_URL = pathToFileURL(UI_INDEX_PATH);

function isUiIndexUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'file:' && parsed.pathname === UI_INDEX_URL.pathname;
  } catch {
    return false;
  }
}

function registerIpcHandlers(registry, energySaver) {
  // Каждый IPC-вызов исполняется в контексте окна-отправителя (AsyncLocalStorage сохраняет его и после await),
  // поэтому весь код ниже по-прежнему обращается к `windowManager.*` и получает именно это окно
  const als = new AsyncLocalStorage();
  const currentWm = () => als.getStore() || registry.getFallback();
  const windowManager = new Proxy({}, {
    get(_t, prop) {
      const wm = currentWm();
      if (!wm) return prop === 'getSettings' ? () => storage.loadSettings() : undefined; // окон ещё нет
      const v = wm[prop];
      return typeof v === 'function' ? v.bind(wm) : v;
    },
    set(_t, prop, value) {
      const wm = currentWm();
      if (wm) wm[prop] = value;
      return true;
    }
  });
  // Обёртка над ipcMain: окно определяется по event.sender; сообщения от неизвестных webContents отбрасываются
  const ipcMain = {
    on(channel, fn) {
      electronIpcMain.on(channel, (event, ...args) => {
        const wm = registry.fromSender(event.sender);
        if (wm) als.run(wm, () => fn(event, ...args));
      });
    },
    handle(channel, fn) {
      electronIpcMain.handle(channel, (event, ...args) => {
        const wm = registry.fromSender(event.sender);
        return wm ? als.run(wm, () => fn(event, ...args)) : null;
      });
    }
  };

  // Начальное состояние косметической фильтрации (движок применит его при сборке и на лету при смене)
  try { adblock.setCosmetic(storage.loadSettings().adblockCosmetic); } catch { /* не критично */ }

  function isTrustedUiSender(event) {
    if (
      !windowManager.win ||
      windowManager.win.isDestroyed() ||
      event.sender !== windowManager.win.webContents
    ) {
      return false;
    }
    // Только главный фрейм и только наш renderer/index.html по file:
    const frame = event.senderFrame;
    return Boolean(frame) && frame === event.sender.mainFrame && isUiIndexUrl(frame.url);
  }

  function isTrustedInternalHost(event, expectedHost) {
    try {
      const frame = event.senderFrame;
      if (!frame || frame !== event.sender.mainFrame) return false;
      const parsed = new URL(frame.url);
      return parsed.protocol === `${APP_SCHEME}:` && parsed.hostname.toLowerCase() === expectedHost;
    } catch {
      return false;
    }
  }

  const isTrustedNewTabSender = (event) => isTrustedInternalHost(event, 'newtab');
  const isTrustedSettingsSender = (event) => isTrustedInternalHost(event, 'settings');
  const isTrustedHistorySender = (event) => isTrustedInternalHost(event, 'history');
  const isTrustedDownloadsSender = (event) => isTrustedInternalHost(event, 'downloads');
  const isTrustedBookmarksSender = (event) => isTrustedInternalHost(event, 'bookmarks');

  // ---- Единая тема оболочки: окно интерфейса и все внутренние browser:// страницы ----
  // Ключ в settings.json, где main хранит «затравку» кастомной темы (ту, что принимает setCustomChromeTheme)
  const CUSTOM_SEED_KEY = 'customThemeSeed';

  function buildThemePayload() {
    const settings = windowManager.getSettings() || {};
    let id = settings.chromeTheme === 'custom' || CHROME_THEMES.includes(settings.chromeTheme)
      ? settings.chromeTheme
      : 'cyber-blue';
    let css = '';
    if (id === 'custom') {
      const built = buildCustomTheme(settings[CUSTOM_SEED_KEY]);
      if (built) css = built.css;
      else id = 'cyber-blue';
    }
    let mode = null;
    try {
      const m = windowManager.getResolvedTheme();
      if (m === 'light' || m === 'dark') mode = m;
    } catch { /* окно ещё не готово */ }
    return { id, css, mode };
  }

  function isThemeTarget(c) {
    try {
      if (!c || c.isDestroyed()) return false;
      const url = c.getURL();
      if (registry.isUiWebContents(c)) {
        return isUiIndexUrl(url);
      }
      return new URL(url).protocol === `${APP_SCHEME}:`;
    } catch {
      return false;
    }
  }

  function pushTheme(c, payload) {
    if (!isThemeTarget(c)) return;
    const data = payload || buildThemePayload();
    c.executeJavaScript(
      `window.__applyChromeTheme && window.__applyChromeTheme(${JSON.stringify(data)})`,
      true
    ).catch(() => { /* страница закрылась или ушла на другой адрес */ });
  }

  function broadcastTheme() {
    const payload = buildThemePayload();
    for (const c of webContents.getAllWebContents()) pushTheme(c, payload);
  }

  // Применение темы в WindowManager может быть отложенным — дублируем рассылку (операция идемпотентна)
  function scheduleThemeBroadcast() {
    setImmediate(broadcastTheme);
    setTimeout(broadcastTheme, 150);
  }

  // Каждая новая страница получает актуальную палитру сразу после dom-ready (до первой отрисовки)
  const themeWatched = new WeakSet();
  function watchForTheme(c) {
    if (themeWatched.has(c)) return;
    themeWatched.add(c);
    c.on('dom-ready', () => pushTheme(c));
  }
  app.on('web-contents-created', (_event, c) => watchForTheme(c));
  for (const c of webContents.getAllWebContents()) {
    watchForTheme(c);
    pushTheme(c); // окно, созданное до регистрации обработчиков
  }

  function handleUi(channel, fn) {
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedUiSender(event)) return;
      fn(...args);
    });
  }

  // В Инкогнито browser://newtab не пишет в обычные файлы (newtab.json, bookmarks.json, обои):
  // изменения живут только в памяти до выхода из режима
  const incognitoNewTabStates = new WeakMap(); // Инкогнито-сессия -> состояние Новой вкладки
  function getIncognitoNewTabState() {
    const ses = windowManager._incognitoSession;
    if (!ses) return storage.loadNewTabState();
    if (!incognitoNewTabStates.has(ses)) incognitoNewTabStates.set(ses, storage.loadNewTabState());
    return incognitoNewTabStates.get(ses);
  }

  // Студия тем и папки закладок: в Инкогнито читаем оформление из файла, а все изменения держим только в памяти.
  // Личные данные не подмешиваем: папки закладок — значения по умолчанию, город погоды — пусто
  const incognitoStudios = new WeakMap(); // Инкогнито-сессия -> студия тем и папки закладок
  function getIncognitoStudio() {
    const ses = windowManager._incognitoSession;
    if (!incognitoStudios.has(ses)) {
      const real = storage.getStudio();
      incognitoStudios.set(ses, { migrated: real.migrated, prefs: { ...real.prefs, weatherPlace: null }, bm: null });
    }
    return incognitoStudios.get(ses);
  }

  function buildStudioPayload() {
    return windowManager.isIncognito ? JSON.parse(JSON.stringify(getIncognitoStudio())) : storage.getStudio();
  }

  const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

  // ---- Глобальные запреты камеры / микрофона / геолокации ----
  const PERM_BLOCK_KEYS = ['blockCamera', 'blockMicrophone', 'blockGeolocation'];

  function getPermBlocks() {
    const s = storage.loadSettings();
    return {
      blockCamera: Boolean(s.blockCamera),
      blockMicrophone: Boolean(s.blockMicrophone),
      blockGeolocation: Boolean(s.blockGeolocation)
    };
  }

  // Рассылаем состояние всем открытым Новым вкладкам (всех окон, включая Инкогнито)
  function broadcastPermBlocks() {
    const payload = getPermBlocks();
    for (const wc of webContents.getAllWebContents()) {
      try {
        if (wc.isDestroyed()) continue;
        const u = new URL(wc.getURL());
        if (u.protocol === `${APP_SCHEME}:` && u.hostname.toLowerCase() === 'newtab') {
          wc.send('internal:perm-blocks:changed', payload);
        }
      } catch { /* вкладка закрывается или URL пустой */ }
    }
  }

  function buildNewTabPayload(state) {
    const settings = windowManager.getSettings();
    const engineKey = SEARCH_ENGINES[settings.searchEngine] ? settings.searchEngine : 'google';
    const engine = SEARCH_ENGINES[engineKey];
    const engines = Object.entries(SEARCH_ENGINES).map(([key, val]) => ({
      key,
      name: val.name,
      short: val.short,
      color: val.color
    }));

    return {
      state: state || (windowManager.isIncognito ? getIncognitoNewTabState() : storage.loadNewTabState()),
      incognito: Boolean(windowManager.isIncognito),
      transparentChrome: Boolean(windowManager.settings && windowManager.settings.transparentChrome),
      searchEngine: engineKey,
      searchEngineName: engine.name,
      engines,
      energySaverActive: Boolean(energySaver && energySaver.isActive())
    };
  }

  // Окно интерфейса запрашивает текущее состояние при загрузке (дальше получает push 'energy-saver:state')
  ipcMain.handle('energy-saver:get', (event) => {
    if (!isTrustedUiSender(event)) return false;
    return Boolean(energySaver && energySaver.isActive());
  });

  // Страница настроек получает вместе с настройками и эффективный флаг energySaverActive
  function withEnergyState(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    return { ...payload, energySaverActive: Boolean(energySaver && energySaver.isActive()) };
  }

  // ---- Вкладки ----
  handleUi('tab:new', (url) => {
    const safeUrl = typeof url === 'string' && url.length <= 4096 ? url : null;
    windowManager.tabManager?.createTab(safeUrl);
  });

  handleUi('tab:close', (id) => {
    if (typeof id === 'number' && Number.isInteger(id)) windowManager.tabManager?.closeTab(id);
  });

  handleUi('tab:switch', (id) => {
    if (typeof id === 'number' && Number.isInteger(id)) windowManager.tabManager?.switchTab(id);
  });

  handleUi('tab:reorder', (fromId, toId, insertAfter) => {
    if (
      typeof fromId === 'number' && Number.isInteger(fromId) &&
      typeof toId === 'number' && Number.isInteger(toId)
    ) {
      windowManager.tabManager?.reorderTab(fromId, toId, Boolean(insertAfter));
    }
  });

  handleUi('tab:pin', (id) => {
    if (typeof id === 'number' && Number.isInteger(id)) windowManager.tabManager?.togglePinTab(id);
  });

  handleUi('tab:mute', (id) => {
    if (typeof id === 'number' && Number.isInteger(id)) windowManager.tabManager?.toggleMuteTab(id);
  });

  handleUi('tab:reopen', () => windowManager.tabManager?.reopenClosedTab());

  handleUi('tab:context-menu', (id) => {
    if (typeof id === 'number' && Number.isInteger(id)) windowManager.showTabContextMenu(id);
  });

  // Отрыв вкладки перетаскиванием за пределы панели вкладок; sx/sy — экранные координаты точки отпускания
  handleUi('tab:detach', (id, sx, sy) => {
    if (typeof id !== 'number' || !Number.isInteger(id)) return;
    const ok = Number.isFinite(sx) && Number.isFinite(sy) && (sx !== 0 || sy !== 0);
    windowManager.moveTabToNewWindow(id, ok ? { x: Math.round(sx), y: Math.round(sy) } : null);
  });

  // ---- Навигация ----
  handleUi('nav:go', (text) => {
    if (typeof text === 'string' && text.length <= 4096) {
      windowManager.tabManager?.navigateActive(text);
    }
  });

  handleUi('nav:back', () => windowManager.tabManager?.goBack());
  handleUi('nav:forward', () => windowManager.tabManager?.goForward());
  handleUi('nav:reload', (hard) => windowManager.tabManager?.reloadActive(Boolean(hard)));
  handleUi('nav:stop', () => windowManager.tabManager?.stopActive());
  handleUi('nav:zoom-reset', () => windowManager.tabManager?.zoomReset());

  // ---- Поиск по странице (Ctrl+F) ----
  handleUi('find:query', (text, matchCase) => {
    if (typeof text !== 'string') return;
    windowManager.tabManager?.setFindQuery(text.slice(0, FIND_MAX_QUERY_LENGTH), Boolean(matchCase));
  });

  handleUi('find:next', (forward) => {
    windowManager.tabManager?.findNext(Boolean(forward));
  });

  handleUi('find:close', () => {
    windowManager.tabManager?.closeFindBar({ restoreFocus: true });
  });

  // ---- Split View ----
  handleUi('split:resize', (ratio) => {
    if (typeof ratio === 'number' && Number.isFinite(ratio)) {
      windowManager.tabManager?.setSplitRatio(ratio);
    }
  });

  // ---- Рабочие пространства (результат приходит обычным state-событием) ----
  const isWsId = (v) => typeof v === 'string' && /^[a-z0-9_-]{1,40}$/i.test(v);
  handleUi('workspace:switch', (id) => {
    if (isWsId(id)) windowManager.switchWorkspace(id);
  });
  handleUi('workspace:create', (name, color) => {
    if (typeof name !== 'string' || name.length > 100) return;
    windowManager.createWorkspace(name, typeof color === 'string' ? color : undefined);
  });
  handleUi('workspace:update', (payload) => {
    if (!isPlainObject(payload) || !isWsId(payload.id)) return;
    const patch = {};
    if (typeof payload.name === 'string' && payload.name.length <= 100) patch.name = payload.name;
    if (typeof payload.color === 'string') patch.color = payload.color;
    windowManager.updateWorkspace(payload.id, patch);
  });
  handleUi('workspace:delete', (id) => {
    if (isWsId(id)) windowManager.deleteWorkspace(id);
  });

  // ---- HTTP-авторизация: ответ из окна интерфейса ----
  // { requestId, username, password } — войти; { requestId, cancel: true } — отмена.
  // Принимается только для запроса, который сейчас показан на активной вкладке (проверяет TabManager)
  handleUi('auth:respond', (payload) => {
    if (!isPlainObject(payload) || !Number.isInteger(payload.requestId)) return;
    let credentials = null;
    if (!payload.cancel) {
      const { username, password } = payload;
      if (typeof username !== 'string' || typeof password !== 'string') return;
      if (username.length > 1024 || password.length > 1024) return;
      credentials = { username, password };
    }
    windowManager.tabManager?.respondAuth(payload.requestId, credentials);
  });

  // ---- Рамка, тема, меню, закладки, Инкогнито ----
  // Попап загрузок — стеклянный WebContentsView; rect кнопки нужен для позиционирования
  handleUi('ui:downloads-menu', (rect) => {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20000;
    let valid = null;
    if (rect && ok(rect.left) && ok(rect.right) && ok(rect.bottom)) {
      valid = { left: rect.left, right: rect.right, bottom: rect.bottom };
    } else if (rect && ok(rect.x) && ok(rect.y)) { // старый формат { x, y }
      valid = { left: rect.x, right: rect.x + 36, bottom: rect.y };
    }
    windowManager.toggleDownloadsMenu(valid);
  });

  handleUi('ui:site-menu', (pos) => {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20000;
    if (pos && ok(pos.x) && ok(pos.y)) windowManager.showSiteMenu(pos.x, pos.y);
    else windowManager.showSiteMenu();
  });

  // ---- Панель безопасности сайта (поповер замочка) ----
  const SITE_VALUES = new Set(['allow', 'deny', 'ask']);

  ipcMain.handle('siteInfo:get', (event) => {
    if (!isTrustedUiSender(event)) return null;
    return windowManager.getSiteInfo();
  });

  // payload: { origin, permission: 'microphone'|'camera'|'notifications'|'clipboard', value: 'allow'|'deny'|'ask' }
  ipcMain.handle('site:set-permission', (event, payload) => {
    if (!isTrustedUiSender(event) || !isPlainObject(payload)) return null;
    const { origin, permission, value } = payload;
    if (typeof origin !== 'string' || origin.length > 2048) return null;
    if (typeof permission !== 'string' || !SITE_PERMISSION_NAMES.includes(permission)) return null;
    if (typeof value !== 'string' || !SITE_VALUES.has(value)) return null;
    return windowManager.setSitePermissionForActive(origin, permission, value);
  });

  ipcMain.handle('site:reset-permissions', (event, origin) => {
    if (!isTrustedUiSender(event) || typeof origin !== 'string' || origin.length > 2048) return null;
    return windowManager.resetSitePermissionsForActive(origin);
  });

  // Открытие/закрытие карточки: на время показа страницы скрываются, чтобы WebContentsView не перекрывал поповер
  handleUi('site:popover', (open) => windowManager.setSitePopoverOpen(Boolean(open)));

  handleUi('win:minimize', () => windowManager.win?.minimize());
  handleUi('win:toggle-maximize', () => {
    if (!windowManager.win) return;
    if (windowManager.win.isMaximized()) windowManager.win.unmaximize();
    else windowManager.win.maximize();
  });
  handleUi('win:close', () => windowManager.win?.close());

  handleUi('ui:toggle-theme', () => {
    const next = windowManager.getResolvedTheme() === 'dark' ? 'light' : 'dark';
    windowManager.applyTheme(next);
    scheduleThemeBroadcast();
  });

  handleUi('ui:chrome-theme', (id) => {
    if (typeof id === 'string' && CHROME_THEMES.includes(id)) {
      windowManager.setChromeThemeKeepMode(id);
      scheduleThemeBroadcast();
    }
  });

  // Главное меню («⋮») — стеклянный попап; rect кнопки нужен для позиционирования
  handleUi('ui:quick-menu', (rect) => {
    const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20000;
    const valid = rect && ok(rect.left) && ok(rect.right) && ok(rect.bottom)
      ? { left: rect.left, right: rect.right, bottom: rect.bottom }
      : null;
    windowManager.toggleMainMenu(valid);
  });
  handleUi('ui:toggle-incognito', () => windowManager.toggleIncognito());
  handleUi('ui:vertical-tabs', () => windowManager.toggleVerticalTabs());
  handleUi('ui:vertical-tabs-collapse', () => windowManager.toggleVerticalTabsCollapsed());
  handleUi('ui:gemini-toggle', () => windowManager.toggleGeminiPanel());
  handleUi('ui:gemini-reload', () => windowManager.reloadGeminiPanel());
  handleUi('ui:gemini-context', () => windowManager.attachTabContextToGemini());
  handleUi('ui:gemini-tabs', () => windowManager.pickTabsForGemini());
  handleUi('ui:gemini-resize', (width) => {
    if (typeof width === 'number' && Number.isFinite(width)) windowManager.resizeGeminiPanel(width);
  });
  handleUi('bookmark:toggle', () => windowManager.toggleBookmarkActive());
  handleUi('ui:bookmarks-bar', () => windowManager.toggleBookmarksBar()); // Ctrl+Shift+B / меню
  handleUi('bookmark:popover', () => windowManager.openBookmarkPopover()); // звёздочка

  // ---- Omnibox (подсказки адресной строки) ----
  handleUi('omnibox:query', (text, rect) => {
    if (typeof text === 'string' && text.length <= OMNIBOX_MAX_QUERY_LENGTH) {
      windowManager.omnibox?.query(text, rect);
    }
  });

  handleUi('omnibox:move', (delta) => {
    if (typeof delta === 'number' && Number.isFinite(delta)) windowManager.omnibox?.move(delta);
  });

  handleUi('omnibox:hide', () => windowManager.omnibox?.hide());
  handleUi('omnibox:blur', () => windowManager.omnibox?.blurHide());

  ipcMain.handle('omnibox:accept', (event, text) => {
    if (!isTrustedUiSender(event) || typeof text !== 'string') return false;
    return Boolean(windowManager.omnibox?.accept(text));
  });

  ipcMain.on('omnibox:pick', (event, index) => {
    if (!windowManager.omnibox?.isSender(event)) return;
    windowManager.omnibox.pick(index);
  });

  ipcMain.on('omnibox:hover', (event, index) => {
    if (!windowManager.omnibox?.isSender(event)) return;
    windowManager.omnibox.hover(index);
  });

  // ---- Попап главного меню: принимаем сообщения только от его собственного WebContentsView ----
  ipcMain.on('mainmenu:activate', (event, key) => {
    if (!windowManager.mainMenu?.isSender(event)) return;
    if (typeof key === 'string' && key.length > 0 && key.length <= 64) windowManager.mainMenu.activate(key);
  });

  ipcMain.on('mainmenu:close', (event) => {
    if (!windowManager.mainMenu?.isSender(event)) return;
    windowManager.mainMenu.hide({ restoreFocus: true });
  });

  ipcMain.on('mainmenu:resize', (event, height) => {
    if (!windowManager.mainMenu?.isSender(event)) return;
    if (typeof height === 'number' && Number.isFinite(height)) windowManager.mainMenu.resize(height);
  });

  // ---- Попап загрузок: принимаем сообщения только от его собственного WebContentsView ----
  ipcMain.on('dlpopup:action', (event, type, id) => {
    const popup = windowManager.downloadsPopup;
    if (!popup?.isSender(event)) return;
    if (typeof type !== 'string' || type.length > 32) return;
    if (id !== null && !Number.isInteger(id)) return;
    popup.handleAction(type, id);
  });

  ipcMain.on('dlpopup:close', (event) => {
    if (!windowManager.downloadsPopup?.isSender(event)) return;
    windowManager.downloadsPopup.hide({ restoreFocus: true });
  });

  ipcMain.on('dlpopup:resize', (event, height) => {
    if (!windowManager.downloadsPopup?.isSender(event)) return;
    if (typeof height === 'number' && Number.isFinite(height)) windowManager.downloadsPopup.resize(height);
  });

  // ---- Внутренняя страница browser://newtab ----
  ipcMain.handle('internal:newtab:get', (event) => {
    if (!isTrustedNewTabSender(event)) return null;
    // Временные изменения Инкогнито живут в WeakMap по сессии и уходят вместе с ней
    return { ...buildNewTabPayload(), studio: buildStudioPayload() };
  });

  // ---- Студия тем и папки закладок Новой вкладки (постоянный файл вместо localStorage) ----
  ipcMain.handle('internal:studio:save-prefs', (event, patch) => {
    if (!isTrustedNewTabSender(event) || !isPlainObject(patch)) return null;
    if (windowManager.isIncognito) {
      const cur = getIncognitoStudio();
      const prefs = storage.mergeStudioPrefs(cur.prefs, patch);
      prefs.weatherPlace = null; // город в Инкогнито не запоминаем даже в памяти
      incognitoStudios.set(windowManager._incognitoSession, { ...cur, prefs });
      return { ok: true, incognito: true };
    }
    storage.saveStudioPrefs(patch);
    return { ok: true };
  });

  ipcMain.handle('internal:studio:save-bookmarks', (event, tree) => {
    if (!isTrustedNewTabSender(event) || !isPlainObject(tree)) return null;
    if (windowManager.isIncognito) {
      const cur = getIncognitoStudio();
      incognitoStudios.set(windowManager._incognitoSession, { ...cur, bm: JSON.parse(JSON.stringify(tree)) });
      return { ok: true, incognito: true };
    }
    storage.saveStudioBookmarks(tree);
    // Те же папки лежат в едином дереве: обновляем открытые диспетчеры закладок и другие вкладки Новой вкладки
    windowManager.notifyNewTabBookmarks();
    windowManager.notifyNewTabStudioBookmarks(event.sender);
    return { ok: true };
  });

  // Одноразовый перенос из localStorage. В Инкогнито не выполняется: у временной сессии свой пустой localStorage,
  // а метку «перенесено» в обычный файл ставить оттуда нельзя
  ipcMain.handle('internal:studio:migrate', (event, legacy) => {
    if (!isTrustedNewTabSender(event)) return null;
    if (windowManager.isIncognito) return { migrated: false, incognito: true };
    return storage.migrateStudio(isPlainObject(legacy) ? legacy : {});
  });

  ipcMain.handle('internal:newtab:save', (event, patch) => {
    if (!isTrustedNewTabSender(event)) return null;
    if (windowManager.isIncognito) {
      const next = storage.mergeNewTabState(getIncognitoNewTabState(), patch);
      incognitoNewTabStates.set(windowManager._incognitoSession, next);
      return buildNewTabPayload(next);
    }
    const saved = storage.saveNewTabState(patch);
    windowManager.onNewTabStateChanged();
    return buildNewTabPayload(saved);
  });

  // Иконка сайта для плитки «Быстрый доступ»: data:-URL или null. В Инкогнито — только из кэша, без сетевых запросов
  ipcMain.handle('internal:site-icon', async (event, url) => {
    if (!isTrustedNewTabSender(event) || typeof url !== 'string' || url.length > 2048) return null;
    try {
      return await siteIcons.getIcon(url, { allowNetwork: !windowManager.isIncognito });
    } catch {
      return null;
    }
  });

  ipcMain.handle('internal:perm-blocks:get', (event) => {
    if (!isTrustedNewTabSender(event)) return null;
    return getPermBlocks();
  });

  ipcMain.handle('internal:perm-blocks:set', (event, key, value) => {
    if (!isTrustedNewTabSender(event)) return null;
    if (!PERM_BLOCK_KEYS.includes(key) || typeof value !== 'boolean') return getPermBlocks();
    windowManager.updateSettings({ [key]: value });
    broadcastPermBlocks();
    return getPermBlocks();
  });

  ipcMain.handle('internal:set-search-engine', (event, key) => {
    if (!isTrustedNewTabSender(event)) return null;
    // Инкогнито: settings.json не трогаем
    if (!windowManager.isIncognito && typeof key === 'string' && SEARCH_ENGINES[key]) {
      windowManager.updateSettings({ searchEngine: key });
    }
    return buildNewTabPayload();
  });

  ipcMain.handle('internal:newtab:pick-wallpaper', async (event) => {
    if (!isTrustedNewTabSender(event) || !windowManager.win) return null;
    if (windowManager.isIncognito) return { error: 'В режиме Инкогнито смена обоев недоступна.' };
    const result = await dialog.showOpenDialog(windowManager.win, {
      title: 'Выберите обои: изображение (до 15 МБ) или видео MP4/WebM (до 80 МБ)',
      properties: ['openFile'],
      filters: [{ name: 'Изображения и видео', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm'] }]
    });

    if (result.canceled || !result.filePaths.length) return { canceled: true };

    const updated = await storage.saveCustomWallpaper(result.filePaths[0]);
    if (!updated) {
      return { error: 'Не удалось сохранить обои: файл слишком большой (изображение до 15 МБ, видео до 80 МБ), недоступен или имеет неподдерживаемый формат.' };
    }
    windowManager.onNewTabStateChanged();
    return buildNewTabPayload(updated);
  });

  ipcMain.handle('internal:newtab:clear-wallpaper', (event) => {
    if (!isTrustedNewTabSender(event)) return null;
    if (windowManager.isIncognito) return buildNewTabPayload();
    const updated = storage.clearCustomWallpaper();
    windowManager.onNewTabStateChanged();
    return buildNewTabPayload(updated);
  });

  ipcMain.on('internal:navigate', (event, text) => {
    if (!isTrustedNewTabSender(event)) return;
    if (typeof text === 'string' && text.length <= 4096) {
      windowManager.tabManager?.navigateActive(text);
    }
  });

  // ---- Подсказки под полем поиска новой вкладки (тот же попап, что у адресной строки) ----
  // Принимаем только от browser://newtab, который сейчас показан в этом окне (активная вкладка или пара Split View).
  // Вкладку ищем по webContents отправителя среди вкладок окна. При отказе пишем причину в консоль (терминал, где запущен electron)
  const omniWarned = new Set();
  function omniReject(reason) {
    if (omniWarned.has(reason)) return;
    omniWarned.add(reason);
    console.warn(`[newtab omnibox] отклонено: ${reason}`);
  }
  function activeNewTabSender(event) {
    if (!isTrustedNewTabSender(event)) { omniReject('отправитель не browser://newtab'); return null; }
    const tm = windowManager.tabManager;
    if (!tm) { omniReject('у окна нет tabManager'); return null; }
    const tab = (tm.tabs || []).find((t) => t && t.view && !t.view.webContents.isDestroyed() && t.view.webContents === event.sender);
    if (!tab) { omniReject('вкладка отправителя не найдена среди вкладок окна'); return null; }
    if (tab.id !== tm.activeId && tab.id !== tm.splitTabId) { omniReject('вкладка не активна'); return null; }
    if (!windowManager.omnibox) { omniReject('у окна нет попапа omnibox'); return null; }
    return tab;
  }

  ipcMain.on('internal:omnibox:query', (event, text, rect) => {
    if (typeof text !== 'string' || text.length > OMNIBOX_MAX_QUERY_LENGTH || !rect || typeof rect !== 'object') return;
    const tab = activeNewTabSender(event);
    if (!tab) return;
    // Координаты страницы -> координаты окна: смещение вида вкладки + масштаб страницы
    const b = tab.view.getBounds();
    const z = event.sender.getZoomFactor() || 1;
    const left = b.x + Number(rect.left) * z;
    const bottom = b.y + Number(rect.bottom) * z;
    const width = Number(rect.width) * z;
    if (![left, bottom, width].every(Number.isFinite)) return;
    windowManager.omnibox?.query(text, { left, bottom, width });
  });

  ipcMain.on('internal:omnibox:move', (event, delta) => {
    if (!activeNewTabSender(event) || typeof delta !== 'number' || !Number.isFinite(delta)) return;
    windowManager.omnibox?.move(delta);
  });

  ipcMain.on('internal:omnibox:warm', (event) => {
    if (activeNewTabSender(event)) windowManager.omnibox?.warmUp(); // создаём попап заранее, как при фокусе адресной строки
  });

  ipcMain.on('internal:omnibox:hide', (event) => {
    if (activeNewTabSender(event)) windowManager.omnibox?.hide();
  });

  ipcMain.on('internal:omnibox:blur', (event) => {
    if (activeNewTabSender(event)) windowManager.omnibox?.blurHide();
  });

  ipcMain.handle('internal:omnibox:accept', (event, text) => {
    if (!activeNewTabSender(event) || typeof text !== 'string') return false;
    return Boolean(windowManager.omnibox?.accept(text));
  });

  ipcMain.on('internal:open-new-tab', (event, url) => {
    if (!isTrustedNewTabSender(event)) return;
    if (typeof url === 'string' && url.length <= 4096) {
      windowManager.tabManager?.createTab(url, { active: false });
    }
  });

  ipcMain.on('internal:transparent-chrome', (event, enabled) => {
    if (!isTrustedNewTabSender(event) || windowManager.isIncognito) return;
    windowManager.setTransparentChrome(Boolean(enabled));
  });

  ipcMain.on('internal:chrome-theme', (event, id, mode, seed) => {
    if (!isTrustedNewTabSender(event) || windowManager.isIncognito) return; // иначе пишется settings.json
    if (id === 'custom') {
      windowManager.setCustomChromeTheme(seed, mode === 'light' ? 'light' : 'dark');
      scheduleThemeBroadcast();
      return;
    }
    if (typeof id !== 'string' || !CHROME_THEMES.includes(id)) return;
    windowManager.setChromeTheme(id, mode === 'light' ? 'light' : 'dark');
    scheduleThemeBroadcast();
  });

  ipcMain.handle('internal:bookmarks:list', (event) => {
    if (!isTrustedNewTabSender(event) || windowManager.isIncognito) return []; // обычные закладки в Инкогнито не показываем
    return storage.loadBookmarks();
  });

  ipcMain.handle('internal:bookmarks:remove', (event, url) => {
    if (!isTrustedNewTabSender(event) || typeof url !== 'string') return [];
    if (windowManager.isIncognito) return []; // bookmarks.json в Инкогнито не меняем и не показываем
    if (storage.isBookmarked(url)) {
      storage.toggleBookmark(url);
      windowManager.sendState();
      windowManager.notifyNewTabBookmarks();
    }
    return storage.loadBookmarks();
  });

  // ---- Страница истории browser://history ----
  // В Инкогнито история не ведётся, а обычную отсюда не показываем и не меняем (как и в settings:clear:history)
  ipcMain.handle('history:get', (event) => {
    if (!isTrustedHistorySender(event)) return null;
    if (windowManager.isIncognito) return { incognito: true, items: [] };
    return { incognito: false, items: storage.getHistory(storage.HISTORY_MAX) };
  });

  ipcMain.handle('history:remove', (event, url) => {
    if (!isTrustedHistorySender(event)) return null;
    if (windowManager.isIncognito) return { ok: false, blocked: true, incognito: true };
    if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return { ok: false };
    return { ok: storage.removeHistoryEntry(url) };
  });

  // Границу диапазона считает main (renderer присылает только имя диапазона), «сегодня» — с локальной полуночи
  ipcMain.handle('history:clear', (event, range) => {
    if (!isTrustedHistorySender(event)) return null;
    if (windowManager.isIncognito) return { ok: false, blocked: true, incognito: true };
    let since;
    if (range === 'hour') {
      since = Date.now() - 60 * 60 * 1000;
    } else if (range === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      since = d.getTime();
    } else if (range === 'all') {
      since = 0;
    } else {
      return { ok: false };
    }
    return { ok: true, removed: storage.clearHistorySince(since) };
  });

  // Открытие записи: в этой вкладке или (Ctrl/средняя кнопка) в фоновой. В истории лежат только http(s)
  ipcMain.on('history:open', (event, url, inNewTab) => {
    if (!isTrustedHistorySender(event)) return;
    if (typeof url !== 'string' || url.length > 4096 || !/^https?:\/\//i.test(url)) return;
    if (inNewTab === true) windowManager.tabManager?.createTab(url, { active: false });
    else windowManager.tabManager?.navigateActive(url);
  });

  // ---- Диспетчер закладок browser://bookmarks ----
  // Рендерер присылает только id и текст; проверку адресов, вложенности и лимитов делает storage.
  // В Инкогнито обычные закладки не показываем и не меняем (как и на Новой вкладке)
  const BM_BAD_REQUEST = { ok: false, error: 'Некорректный запрос.' };
  const bmIsId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
  const isBookmarksOrNewTabSender = (event) => isTrustedBookmarksSender(event) || isTrustedNewTabSender(event);

  ipcMain.handle('bookmarks:get', (event) => {
    if (!isBookmarksOrNewTabSender(event)) return null;
    if (windowManager.isIncognito) return { ok: true, incognito: true, rev: 0, nodes: [] };
    return { ok: true, incognito: false, ...storage.getBookmarkTree() };
  });

  function bookmarkMutation(channel, run) {
    ipcMain.handle(channel, (event, payload) => {
      if (!isBookmarksOrNewTabSender(event)) return null;
      if (windowManager.isIncognito) return { ok: false, blocked: true, incognito: true, error: 'Недоступно в режиме Инкогнито.' };
      const res = run(payload);
      if (res && res.ok) {
        windowManager.sendState(); // звёздочка в адресной строке
        windowManager.notifyNewTabBookmarks(); // список ★ на Новой вкладке и другие диспетчеры
        if (res.studioChanged) windowManager.notifyNewTabStudioBookmarks(); // папки/группы Новой вкладки
      }
      return res;
    });
  }

  bookmarkMutation('bookmarks:create-folder', (p) => (isPlainObject(p) ? storage.createBookmarkFolder(p) : BM_BAD_REQUEST));
  bookmarkMutation('bookmarks:create', (p) => (isPlainObject(p) ? storage.createBookmarkNode(p) : BM_BAD_REQUEST));
  bookmarkMutation('bookmarks:update', (p) => (isPlainObject(p) && bmIsId(p.id) ? storage.updateBookmarkNode(p) : BM_BAD_REQUEST));
  bookmarkMutation('bookmarks:move', (p) => (isPlainObject(p) && bmIsId(p.id) ? storage.moveBookmarkNode(p) : BM_BAD_REQUEST));
  bookmarkMutation('bookmarks:remove', (id) => (bmIsId(id) ? storage.removeBookmarkNode(id) : BM_BAD_REQUEST));

  // ---- Панель закладок и поповер звёздочки (только окно интерфейса) ----
  // Дерево — без системной папки «Новой вкладки». Адрес текущей страницы берёт main, renderer присылает название и id папки
  ipcMain.handle('ubm:tree', (event) => {
    if (!isTrustedUiSender(event)) return null;
    if (windowManager.isIncognito) return { ok: true, incognito: true, rev: 0, nodes: [] };
    return { ok: true, incognito: false, ...storage.getBookmarkTreeForUi() };
  });

  ipcMain.handle('ubm:current', (event) => {
    if (!isTrustedUiSender(event)) return null;
    return windowManager.getActiveBookmarkInfo();
  });

  function uiBookmarkMutation(channel, run) {
    ipcMain.handle(channel, (event, payload) => {
      if (!isTrustedUiSender(event)) return null;
      if (windowManager.isIncognito) return { ok: false, blocked: true, incognito: true, error: 'Недоступно в режиме Инкогнито.' };
      const res = run(payload);
      if (res && res.ok) {
        windowManager.sendState(); // звёздочка и ревизия дерева для панели
        windowManager.notifyNewTabBookmarks();
        windowManager.notifyNewTabStudioBookmarks();
        return { ok: true, rev: res.rev };
      }
      return res || BM_BAD_REQUEST;
    });
  }

  uiBookmarkMutation('ubm:save', (p) => (isPlainObject(p) ? windowManager.saveActiveBookmark(p) : BM_BAD_REQUEST));
  uiBookmarkMutation('ubm:remove-current', () => windowManager.removeActiveBookmark());

  // Клик по закладке на панели: renderer присылает id, адрес main берёт из дерева
  ipcMain.on('ubm:open', (event, id, inNewTab) => {
    if (!isTrustedUiSender(event) || !bmIsId(id) || windowManager.isIncognito) return;
    const node = storage.getBookmarkTreeForUi().nodes.find((n) => n.id === id && n.type === 'bookmark');
    const url = node && node.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || !isSafeNavigationUrl(url)) return;
    if (inNewTab === true) windowManager.tabManager?.createTab(url, { active: true });
    else windowManager.tabManager?.navigateActive(url);
  });

  // Открытие закладки: в этой вкладке или (Ctrl/средняя кнопка) в фоновой
    ipcMain.on('bookmarks:open', (event, url, inNewTab) => {
    if (!isTrustedBookmarksSender(event)) return;
    if (typeof url !== 'string' || url.length > 4096) return;
    if (!/^https?:\/\//i.test(url) || !isSafeNavigationUrl(url)) return; // http(s) + проверка из security.js
    if (inNewTab === true) windowManager.tabManager?.createTab(url, { active: true });
    else windowManager.tabManager?.navigateActive(url);
  });

  // ---- Страница загрузок browser://downloads ----
  // Рендерер присылает только имя действия и числовой id; пути, URL и сами файлы выбирает main
  const DOWNLOAD_ACTIONS = new Set(['pause', 'resume', 'cancel', 'retry', 'open', 'show', 'review', 'remove', 'clear', 'open-folder']);
  const DOWNLOAD_GLOBAL_ACTIONS = new Set(['clear', 'open-folder']);

  ipcMain.handle('downloads:get', async (event) => {
    if (!isTrustedDownloadsSender(event) || !windowManager.downloads) return null;
    return windowManager.downloads.getPageModel({
      incognito: Boolean(windowManager.isIncognito), ses: windowManager._downloadsSession()
    });
  });

  ipcMain.handle('downloads:action', async (event, type, id) => {
    const dm = windowManager.downloads;
    if (!isTrustedDownloadsSender(event) || !dm) return null;
    if (typeof type !== 'string' || !DOWNLOAD_ACTIONS.has(type)) return { ok: false };
    const incognito = Boolean(windowManager.isIncognito);
    const scope = { incognito, ses: windowManager._downloadsSession() };
    let ok = true;
    let message = '';

    if (DOWNLOAD_GLOBAL_ACTIONS.has(type)) {
      if (type === 'clear') dm.clearHistory(scope);
      else dm.openDownloadsFolder();
    } else {
      if (!Number.isInteger(id)) return { ok: false };
      // чужой режим (обычные записи из Инкогнито и наоборот) и чужое окно Инкогнито не трогаем
      if (!dm.canAccess(id, scope)) return { ok: false };
      switch (type) {
        case 'pause': ok = dm.pause(id); break;
        case 'resume': ok = dm.resume(id); if (!ok) message = 'Не удалось возобновить загрузку'; break;
        case 'cancel': dm.cancel(id); break;
        case 'retry': ok = dm.retry(id); if (!ok) message = 'Не удалось повторить загрузку'; break;
        case 'open':
          ok = await dm.openFile(id);
          if (!ok) message = 'Файл удалён, перемещён или недоступен';
          break;
        case 'show': dm.showInFolder(id); break;
        case 'review': dm.reviewBlocked(id); break;
        case 'remove': ok = dm.remove(id); break;
        default: ok = false;
      }
    }
    return { ok, message, model: await dm.getPageModel(scope) };
  });

  // ---- Страница настроек browser://settings ----
  ipcMain.handle('settings:get', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    return withEnergyState(windowManager.getSettingsPayload());
  });

  ipcMain.handle('settings:update', async (event, patch) => {
    if (!isTrustedSettingsSender(event)) return null;
    let proxyError = null;
    if (patch && typeof patch === 'object') {
      const clean = {};
      const proxyPatch = {};
      for (const [k, v] of Object.entries(patch)) {
        if (!ALLOWED_SETTINGS_KEYS.has(k)) continue;
        if (PROXY_KEYS.includes(k)) { proxyPatch[k] = v; continue; } // проверяется целиком ниже
        if (k === 'energySaver' && !storage.ENERGY_SAVER_MODES.includes(v)) continue;
        if ((k === 'blockThirdPartyCookies' || k === 'stripTrackingParams' || k === 'incognitoFingerprintProtection' ||
          k === 'verticalTabs' || k === 'verticalTabsCollapsed' || k === 'showBookmarksBar' ||
          k === 'incognitoNewWindow' || k === 'offerSavePasswords' ||
          k === 'blockCamera' || k === 'blockMicrophone' || k === 'blockGeolocation') && typeof v !== 'boolean') continue;
        if (k === 'dohMode' && !DOH_MODES.includes(v)) continue;
        if (k === 'dohProvider' && !DOH_PROVIDER_KEYS.includes(v)) continue;
        if (k === 'dohCustomUrl') {
          const norm = v === '' ? '' : normalizeDohUrl(v);
          if (norm === null) continue;
          clean[k] = norm;
          continue;
        }
        if (k === 'adblockCosmetic') {
          if (typeof v !== 'boolean') continue;
          adblock.setCosmetic(v);
        }
        clean[k] = v;
      }
      // Прокси: патч проверяется целиком вместе с сохранёнными значениями (ручной режим требует хост и порт)
      if (Object.keys(proxyPatch).length) {
        const r = sanitizeProxyPatch(proxyPatch, windowManager.getSettings());
        if (r.ok) Object.assign(clean, r.clean);
        else proxyError = r.error;
      }
      // «Свой адрес» без валидного URL не принимаем (ни из патча, ни из сохранённого)
      if (clean.dohProvider === 'custom') {
        const effective = clean.dohCustomUrl !== undefined ? clean.dohCustomUrl : windowManager.getSettings().dohCustomUrl;
        if (!normalizeDohUrl(effective)) delete clean.dohProvider;
      }
      if (Object.keys(clean).length) {
        windowManager.updateSettings(clean);
        if (PERM_BLOCK_KEYS.some((k) => Object.prototype.hasOwnProperty.call(clean, k))) broadcastPermBlocks();
        if (Object.prototype.hasOwnProperty.call(clean, 'theme')) scheduleThemeBroadcast();
        if (energySaver) energySaver.refresh();
        // Letterboxing: пересчитываем границы вкладок сразу после переключения защиты от fingerprinting
        if (Object.prototype.hasOwnProperty.call(clean, 'incognitoFingerprintProtection')) {
          try { windowManager.tabManager?.layout(); } catch { /* окно закрывается */ }
        }
        // DoH применяется сразу, без перезапуска
        if (Object.keys(clean).some((k) => k.startsWith('doh'))) applyDoh(windowManager.getSettings(), windowManager.registry);
        // Прокси: отдельно для обычной сессии и Инкогнито, сразу и без перезапуска
        if (Object.keys(clean).some((k) => k.startsWith('proxy'))) await windowManager.applyProxy();
      }
    }
    const payload = withEnergyState(windowManager.getSettingsPayload());
    return proxyError && payload ? { ...payload, proxyError } : payload;
  });

  ipcMain.handle('settings:sleep-now', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    const count = windowManager.tabManager ? windowManager.tabManager.sleepAllBackgroundTabs() : 0;
    return { ok: true, count };
  });

  ipcMain.handle('settings:adblock:get-rules', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    return adblock.getCustomRules();
  });

  ipcMain.handle('settings:adblock:save-rules', async (event, text) => {
    if (!isTrustedSettingsSender(event)) return null;
    if (typeof text !== 'string' || text.length > 512 * 1024) {
      return { ok: false, error: 'Слишком большой список правил (максимум 512 КБ).' };
    }
    try {
      adblock.saveCustomRules(text);
      await adblock.reload();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Ошибка сохранения правил' };
    }
  });

  ipcMain.handle('settings:media:list', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    if (windowManager.isIncognito) return []; // домены из обычного режима в Инкогнито не показываем
    return listMediaPermissions();
  });

  ipcMain.handle('settings:media:remove', (event, origin) => {
    if (!isTrustedSettingsSender(event) || windowManager.isIncognito) return false;
    return removeMediaPermission(origin);
  });

  // ---- Обновления: только browser://settings ----
  ipcMain.handle('settings:updater:state', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    return updater.getState();
  });
  ipcMain.handle('settings:updater:check', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    return updater.check();
  });
  ipcMain.handle('settings:updater:download', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    return updater.download();
  });
  ipcMain.handle('settings:updater:install', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    return updater.install();
  });

  // ---- Расширения Chrome (распакованные): только browser://settings, не из Инкогнито ----
  const EXT_BLOCKED = { ok: false, blocked: true, error: 'Недоступно в режиме Инкогнито.' };

  ipcMain.handle('settings:ext:list', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    if (windowManager.isIncognito) return []; // локальные пути расширений не раскрываем
    return extensions.list();
  });

  ipcMain.handle('settings:ext:add', async (event) => {
    if (!isTrustedSettingsSender(event) || !windowManager.win) return null;
    if (windowManager.isIncognito) return EXT_BLOCKED;
    const res = await dialog.showOpenDialog(windowManager.win, {
      title: 'Папка распакованного расширения',
      properties: ['openDirectory']
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    return extensions.add(session.defaultSession, res.filePaths[0]); // путь только из системного диалога
  });

  ipcMain.handle('settings:ext:remove', async (event, dirPath) => {
    if (!isTrustedSettingsSender(event)) return null;
    if (windowManager.isIncognito) return EXT_BLOCKED;
    return extensions.remove(session.defaultSession, dirPath);
  });

  // ---- Менеджер паролей: только browser://settings, в Инкогнито запрещён ----
  const PW_BLOCKED = { ok: false, blocked: true, incognito: true, error: 'Недоступно в режиме Инкогнито.' };
  const PW_BAD_REQUEST = { ok: false, error: 'Некорректный запрос.' };
  const pwIsId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;

  ipcMain.handle('passwords:list', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    const available = passwordManager.isAvailable();
    if (windowManager.isIncognito) return { ...PW_BLOCKED, available, items: [] };
    return { ok: true, available, items: passwordManager.list() };
  });

  ipcMain.handle('passwords:reveal', (event, id) => {
    if (!isTrustedSettingsSender(event)) return null;
    if (windowManager.isIncognito) return PW_BLOCKED;
    return pwIsId(id) ? passwordManager.reveal(id) : PW_BAD_REQUEST;
  });

  // Копирование пароля делает main: через 30 с буфер очищается, если в нём всё ещё этот пароль
  const PW_CLIPBOARD_CLEAR_MS = 30000;
  let pwClipTimer = null;
  let pwClipValue = null;
  function copySecret(text, ms = PW_CLIPBOARD_CLEAR_MS) {
    clipboard.writeText(text);
    pwClipValue = text;
    clearTimeout(pwClipTimer);
    pwClipTimer = setTimeout(() => {
      try { if (clipboard.readText() === pwClipValue) clipboard.clear(); } catch { /* буфер недоступен */ }
      pwClipValue = null;
      pwClipTimer = null;
    }, ms);
    if (typeof pwClipTimer.unref === 'function') pwClipTimer.unref();
  }
  // При выходе пароль не должен остаться в буфере
  app.on('will-quit', () => {
    if (pwClipValue === null) return;
    try { if (clipboard.readText() === pwClipValue) clipboard.clear(); } catch { /* ignore */ }
  });

  ipcMain.handle('passwords:copy', (event, id) => {
    if (!isTrustedSettingsSender(event)) return null;
    if (windowManager.isIncognito) return PW_BLOCKED;
    if (!pwIsId(id)) return PW_BAD_REQUEST;
    const res = passwordManager.reveal(id);
    if (!res || !res.ok || typeof res.password !== 'string') return res || PW_BAD_REQUEST;
    copySecret(res.password);
    return { ok: true, clearAfterMs: PW_CLIPBOARD_CLEAR_MS };
  });

  ipcMain.handle('passwords:remove', (event, id) => {
    if (!isTrustedSettingsSender(event)) return null;
    if (windowManager.isIncognito) return PW_BLOCKED;
    return pwIsId(id) ? passwordManager.remove(id) : PW_BAD_REQUEST;
  });

  ipcMain.handle('passwords:clear', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    if (windowManager.isIncognito) return PW_BLOCKED;
    return passwordManager.clear();
  });

  const PW_IMPORT_MAX_BYTES = 10 * 1024 * 1024;
  ipcMain.handle('passwords:import-csv', async (event) => {
    if (!isTrustedInternalHost(event, 'settings')) return null;
    if (windowManager.isIncognito) return PW_BLOCKED;
    if (!windowManager.win) return PW_BAD_REQUEST;
    if (!passwordManager.isAvailable()) {
      return { ok: false, error: 'Безопасное хранилище ОС недоступно: импорт невозможен.' };
    }
    const res = await dialog.showOpenDialog(windowManager.win, {
      title: 'Импорт паролей из Chrome (CSV)',
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
    const file = res.filePaths[0]; // путь только из системного диалога
    let text;
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return { ok: false, error: 'Выбран не файл.' };
      if (stat.size > PW_IMPORT_MAX_BYTES) return { ok: false, error: 'Файл больше 10 МБ.' };
      text = await fs.promises.readFile(file, 'utf8');
    } catch {
      return { ok: false, error: 'Не удалось прочитать файл.' };
    }
    const result = passwordManager.importFromCsv(text);
    text = null;
    if (!result.ok) return result;

    let deleted = false;
    let deleteError = false;
    const ask = await dialog.showMessageBox(windowManager.win, {
      type: 'question',
      title: 'Импорт паролей',
      message: 'Удалить исходный незашифрованный CSV-файл с диска?',
      detail: `${path.basename(file)} содержит пароли открытым текстом.`,
      buttons: ['Удалить файл', 'Оставить'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (ask.response === 0) {
      try { await fs.promises.unlink(file); deleted = true; } catch { deleteError = true; }
    }
    return { ...result, deleted, deleteError };
  });

  // ---- Автоподстановка и «Сохранить пароль?»: вызовы из обычных вкладок (tabPreload) ----
  // origin берём ТОЛЬКО из event.senderFrame.url; от страницы приходят лишь логин и пароль.
  // Допустимы активная вкладка и парная вкладка Split View, только верхний фрейм, не Инкогнито.
  function pwTabContext(event) {
    if (windowManager.isIncognito) return null;
    const tm = windowManager.tabManager;
    if (!tm || !Array.isArray(tm.tabs)) return null;
    const tab = tm.tabs.find((t) => t.view && !t.view.webContents.isDestroyed() && t.view.webContents === event.sender);
    if (!tab || (tab.id !== tm.activeId && tab.id !== tm.splitTabId)) return null;
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) return null;
    return passwordManager.normalizeOrigin(frame.url); // { origin, host } | null
  }

  ipcMain.handle('pw:accounts', (event) => {
    const o = pwTabContext(event);
    if (!o || !passwordManager.isAvailable()) return [];
    return passwordManager.list()
      .filter((e) => e.origin === o.origin)
      .map((e) => ({ id: e.id, username: e.username }));
  });

  ipcMain.handle('pw:fill', (event, id) => {
    const o = pwTabContext(event);
    if (!o || !pwIsId(id)) return { ok: false };
    const entry = passwordManager.list().find((e) => e.id === id && e.origin === o.origin);
    if (!entry) return { ok: false };
    const r = passwordManager.reveal(id);
    return r.ok ? { ok: true, username: entry.username, password: r.password } : { ok: false };
  });

  ipcMain.on('pw:submit', (event, data) => {
    const o = pwTabContext(event);
    if (!o || !isPlainObject(data)) return;
    if ((windowManager.getSettings() || {}).offerSavePasswords === false) return;
    if (typeof data.username !== 'string' || typeof data.password !== 'string') return;
    const username = data.username.trim();
    const password = data.password;
    if (username.length > 256 || !password || password.length > 1024) return;
    if (!passwordManager.isAvailable()) return;
    if (passwordManager.isSaved(o.origin, username, password)) return;
    windowManager.requestPasswordSave({ origin: o.origin, host: o.host, username, password });
  });

  // Ответ карточки «Сохранить пароль?» из окна интерфейса: 'save' | 'dismiss'
  ipcMain.handle('password-save:respond', (event, promptId, action) => {
    if (!isTrustedUiSender(event)) return null;
    if (typeof promptId !== 'string' || promptId.length > 64) return { ok: false };
    return windowManager.respondPasswordSave(promptId, action === 'save' ? 'save' : 'dismiss');
  });

  // Очистка данных из браузерной сессии: в Инкогнито трогаем только текущую временную сессию, обычную — никогда
  function getClearTargetSession() {
    if (!windowManager.isIncognito) return session.defaultSession;
    return windowManager._incognitoSession || null;
  }

  ipcMain.handle('settings:clear:cache', async (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    try {
      const ses = getClearTargetSession();
      if (!ses) return { ok: false };
      await ses.clearCache();
      return { ok: true, incognito: Boolean(windowManager.isIncognito) };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('settings:clear:history', (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    // В Инкогнито история не ведётся; обычную историю отсюда не стираем
    if (windowManager.isIncognito) return { ok: false, blocked: true, incognito: true };
    storage.clearHistory();
    return { ok: true };
  });

  ipcMain.handle('settings:clear:site-data', async (event) => {
    if (!isTrustedSettingsSender(event)) return null;
    try {
      const ses = getClearTargetSession();
      if (!ses) return { ok: false };
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage']
      });
      return { ok: true, incognito: Boolean(windowManager.isIncognito) };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle('settings:bookmarks:import', async (event) => {
    if (!isTrustedSettingsSender(event) || !windowManager.win) return null;
    // Импорт пишет в постоянный bookmarks.json — из Инкогнито этого делать нельзя
    if (windowManager.isIncognito) return { ok: false, blocked: true, error: 'Недоступно в режиме Инкогнито.' };
    const res = await dialog.showOpenDialog(windowManager.win, {
      title: 'Импорт закладок из HTML',
      properties: ['openFile'],
      filters: [{ name: 'HTML-файл закладок', extensions: ['html', 'htm'] }]
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true };
    try {
      const stat = await fs.promises.stat(res.filePaths[0]);
      if (stat.size > 10 * 1024 * 1024) return { ok: false, error: 'Файл больше 10 МБ.' };
      const html = await fs.promises.readFile(res.filePaths[0], 'utf8');
      const items = parseNetscapeBookmarks(html);
      const { added } = storage.importBookmarks(items);
      windowManager.sendState();
      windowManager.notifyNewTabBookmarks();
      return { ok: true, added, duplicates: Math.max(0, items.length - added) };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Ошибка чтения файла' };
    }
  });

  ipcMain.handle('settings:bookmarks:export', async (event) => {
    if (!isTrustedSettingsSender(event) || !windowManager.win) return null;
    // Обычные закладки в Инкогнито не показываем (как и на Новой вкладке), значит и не выгружаем
    if (windowManager.isIncognito) return { ok: false, blocked: true, error: 'Недоступно в режиме Инкогнито.' };
    const res = await dialog.showSaveDialog(windowManager.win, {
      title: 'Экспорт закладок в HTML',
      defaultPath: 'bookmarks.html',
      filters: [{ name: 'HTML-файл закладок', extensions: ['html'] }]
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    try {
      const nodes = storage.getBookmarkTree().nodes;
      await fs.promises.writeFile(res.filePath, buildNetscapeBookmarks(nodes), 'utf8');
      return { ok: true, count: nodes.filter((n) => n.type === 'bookmark').length };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : 'Ошибка записи файла' };
    }
  });

  // Для вызова из WindowManager (setCustomChromeTheme / applyTheme / быстрое меню), если тема меняется мимо IPC
  return { broadcastTheme };
}

module.exports = { registerIpcHandlers };