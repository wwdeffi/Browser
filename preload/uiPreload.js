const { contextBridge, ipcRenderer } = require('electron');

// Экспортируем в окно интерфейса строго ограниченный набор безопасных методов,
// и только если страница загружена по file: (окно интерфейса). Иначе window.browser не создаётся.
if (window.location.protocol === 'file:') contextBridge.exposeInMainWorld('browser', {
  // Вкладки
    switchWorkspace: (id) => ipcRenderer.send('workspace:switch', String(id)),
  createWorkspace: (name, color) => ipcRenderer.send('workspace:create', String(name || ''), String(color || '')),
  updateWorkspace: (payload) => ipcRenderer.send('workspace:update', payload && typeof payload === 'object' ? { ...payload } : {}),
  deleteWorkspace: (id) => ipcRenderer.send('workspace:delete', String(id)),
  newTab: (url) => ipcRenderer.send('tab:new', url),
  closeTab: (id) => ipcRenderer.send('tab:close', id),
  switchTab: (id) => ipcRenderer.send('tab:switch', id),
  reorderTab: (fromId, toId, insertAfter) => ipcRenderer.send('tab:reorder', fromId, toId, insertAfter),
  togglePinTab: (id) => ipcRenderer.send('tab:pin', id),
  reopenClosedTab: () => ipcRenderer.send('tab:reopen'),
  showTabMenu: (id) => ipcRenderer.send('tab:context-menu', id),
  muteTab: (id) => ipcRenderer.send('tab:mute', id),

  // Навигация
  navigate: (text) => ipcRenderer.send('nav:go', text),
  back: () => ipcRenderer.send('nav:back'),
  forward: () => ipcRenderer.send('nav:forward'),
  reload: (hard = false) => ipcRenderer.send('nav:reload', hard),
  stop: () => ipcRenderer.send('nav:stop'),
  zoomReset: () => ipcRenderer.send('nav:zoom-reset'),

  // Поиск по странице (Ctrl+F): панель #findbar в окне интерфейса, сам поиск выполняет main-процесс
  findQuery: (text, matchCase) => ipcRenderer.send('find:query', String(text), Boolean(matchCase)),
  findNext: (forward = true) => ipcRenderer.send('find:next', Boolean(forward)),
  findClose: () => ipcRenderer.send('find:close'),

  // Split View: перетаскивание границы (ratio клампится в main)
  splitResize: (ratio) => ipcRenderer.send('split:resize', Number(ratio)),

  // Рамка окна
  minimize: () => ipcRenderer.send('win:minimize'),
  toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
  closeWindow: () => ipcRenderer.send('win:close'),

  // Тема и меню
  toggleTheme: () => ipcRenderer.send('ui:toggle-theme'),
  setChromeTheme: (id) => ipcRenderer.send('ui:chrome-theme', id),
  // rect кнопки «⋮» (в координатах окна интерфейса): попап главного меню — отдельный WebContentsView в main
  openQuickMenu: (rect) => ipcRenderer.send('ui:quick-menu', rect ? {
    left: Number(rect.left), right: Number(rect.right), bottom: Number(rect.bottom)
  } : null),
  // rect кнопки «Загрузки»: попап (стеклянный WebContentsView) встаёт под неё; повторный вызов закрывает попап
  openDownloadsMenu: (rect) => ipcRenderer.send('ui:downloads-menu', rect ? {
    left: Number(rect.left), right: Number(rect.right), bottom: Number(rect.bottom)
  } : null),
  openSiteMenu: (pos) => ipcRenderer.send('ui:site-menu', { x: Number(pos && pos.x), y: Number(pos && pos.y) }),
  // Панель безопасности сайта (замочек)
  getSiteInfo: () => ipcRenderer.invoke('siteInfo:get'),
  setSitePermission: (arg) => {
    const a = arg && typeof arg === 'object' ? arg : {};
    return ipcRenderer.invoke('site:set-permission', {
      origin: String(a.origin),
      permission: String(a.permission),
      value: String(a.value)
    });
  },
  resetSitePermissions: (origin) => ipcRenderer.invoke('site:reset-permissions', String(origin)),
  setSitePopoverOpen: (open) => ipcRenderer.send('site:popover', Boolean(open)),
  toggleBookmark: () => ipcRenderer.send('bookmark:toggle'),
  // Панель закладок и поповер звёздочки
  toggleBookmarksBar: () => ipcRenderer.send('ui:bookmarks-bar'),
  openBookmarkPopover: () => ipcRenderer.send('bookmark:popover'),
  getBookmarksTree: () => ipcRenderer.invoke('ubm:tree'),
  getCurrentBookmark: () => ipcRenderer.invoke('ubm:current'),
  saveCurrentBookmark: (arg) => {
    const a = arg && typeof arg === 'object' ? arg : {};
    return ipcRenderer.invoke('ubm:save', {
      title: String(a.title == null ? '' : a.title).slice(0, 300),
      parentId: typeof a.parentId === 'string' && a.parentId ? a.parentId : null
    });
  },
  removeCurrentBookmark: () => ipcRenderer.invoke('ubm:remove-current'),
  openBookmark: (id, inNewTab) => ipcRenderer.send('ubm:open', String(id), Boolean(inNewTab)),
  onBookmarkPopover: (cb) => ipcRenderer.on('bookmark-popover:open', () => cb()),
  toggleIncognito: () => ipcRenderer.send('ui:toggle-incognito'),
  // Вертикальные вкладки: включить/выключить сайдбар и свернуть/развернуть его
  toggleVerticalTabs: () => ipcRenderer.send('ui:vertical-tabs'),
  toggleVerticalTabsCollapsed: () => ipcRenderer.send('ui:vertical-tabs-collapse'),
  // Боковая панель Gemini
  toggleGemini: () => ipcRenderer.send('ui:gemini-toggle'),
  reloadGemini: () => ipcRenderer.send('ui:gemini-reload'),
  resizeGemini: (width) => ipcRenderer.send('ui:gemini-resize', Number(width)),

  // Подсказки адресной строки (попап — отдельный WebContentsView в main)
  omniboxQuery: (text, rect) => ipcRenderer.send('omnibox:query', String(text), {
    left: Number(rect && rect.left), bottom: Number(rect && rect.bottom), width: Number(rect && rect.width)
  }),
  omniboxMove: (delta) => ipcRenderer.send('omnibox:move', Number(delta)),
  omniboxHide: () => ipcRenderer.send('omnibox:hide'),
  omniboxBlur: () => ipcRenderer.send('omnibox:blur'),
  omniboxAccept: (text) => ipcRenderer.invoke('omnibox:accept', String(text)),

  // Подписки на события от main-процесса
  onState: (cb) => ipcRenderer.on('state', (_e, state) => cb(state)),
  onFocusUrl: (cb) => ipcRenderer.on('focus-url', () => cb()),
  onFindState: (cb) => ipcRenderer.on('find:state', (_e, st) => cb(st)),
  onFindFocus: (cb) => ipcRenderer.on('find:focus', () => cb()),
  onSitePopoverClosed: (cb) => ipcRenderer.on('site-popover:closed', () => cb()),
  // «Сохранить пароль?»: main присылает { promptId, host, username } (пароля в сообщении нет)
  onPasswordSavePrompt: (cb) => ipcRenderer.on('password-save:prompt', (_e, p) => cb({
    promptId: String(p && p.promptId), host: String(p && p.host), username: String(p && p.username == null ? '' : p.username)
  })),
  respondPasswordSave: (promptId, action) => ipcRenderer.invoke('password-save:respond', String(promptId), action === 'save' ? 'save' : 'dismiss'),
  onEnergySaver: (cb) => ipcRenderer.on('energy-saver:state', (_e, active) => cb(Boolean(active))),
  // HTTP Basic Auth (сайт или прокси)
  onAuthPrompt: (cb) => ipcRenderer.on('auth:prompt', (_e, p) => cb(p)),
  respondAuth: (arg) => {
    const a = arg && typeof arg === 'object' ? arg : {};
    return ipcRenderer.send('auth:respond', {
      requestId: Number(a.requestId), // main принимает только целое число
      username: a.username == null ? '' : String(a.username),
      password: a.password == null ? '' : String(a.password),
      cancel: a.cancel === true
    });
  },
  // Вынос вкладки в новое окно (drag за пределы панели)
  detachTab: (id, x, y) => ipcRenderer.send('tab:detach', id, Number(x), Number(y))
});

// Режим экономии энергии: атрибут data-energy-saver на <html> выставляется прямо в preload,
// чтобы main.css реагировал без правок renderer-скриптов
if (window.location.protocol === 'file:') {
  const setEnergyAttr = (active) => {
    const root = document.documentElement;
    if (!root) return;
    if (active) root.dataset.energySaver = 'true';
    else delete root.dataset.energySaver;
  };
  ipcRenderer.on('energy-saver:state', (_e, active) => setEnergyAttr(Boolean(active)));
  document.addEventListener('DOMContentLoaded', () => {
    ipcRenderer.invoke('energy-saver:get').then((active) => setEnergyAttr(Boolean(active))).catch(() => {});
  });
}
