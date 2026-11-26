const APP_SCHEME = 'browser';
const NEW_TAB_URL = `${APP_SCHEME}://newtab`;
const SETTINGS_URL = `${APP_SCHEME}://settings`;
const HISTORY_URL = `${APP_SCHEME}://history`;
const DOWNLOADS_URL = `${APP_SCHEME}://downloads`;
const BOOKMARKS_URL = `${APP_SCHEME}://bookmarks`;

// Высота верхней панели: 40px вкладки + 42px тулбар = 82px.
// Должна совпадать с --tabbar-height + --toolbar-height в renderer/styles/tokens.css
const UI_HEIGHT = 82;

// Панель поиска по странице (#findbar) лежит в HTML сразу под #toolbar и, пока открыта,
// сдвигает WebContentsView вниз ещё на эту высоту. Должна совпадать с --findbar-height в tokens.css
const FIND_BAR_HEIGHT = 38;

// Максимальная длина строки поиска (в UTF-16 символах); совпадает с maxlength у #find-input в index.html
const FIND_MAX_QUERY_LENGTH = 500;

// Попап подсказок адресной строки (WebContentsView): до 8 строк.
// ROW_HEIGHT и PADDING должны совпадать с --omnibox-row-height и --omnibox-padding в tokens.css
const OMNIBOX_MAX_ROWS = 8;
const OMNIBOX_ROW_HEIGHT = 36;
const OMNIBOX_PADDING = 6;
const OMNIBOX_GAP = 4; // зазор между #omnibox и попапом
const OMNIBOX_MAX_QUERY_LENGTH = 500;

// Тонкая тёмная рамка и скругление области контента (как в Arc / Zen Browser)
const VIEW_INSET = 6;
const VIEW_BORDER_RADIUS = 10;

const SEARCH_ENGINES = {
  google: {
    name: 'Google',
    short: 'G',
    color: '#60a5fa',
    url: 'https://www.google.com/search?q=',
    home: 'https://www.google.com'
  },
  yandex: {
    name: 'Яндекс',
    short: 'Я',
    color: '#f43f5e',
    url: 'https://ya.ru/search/?text=',
    home: 'https://ya.ru'
  },
  duckduckgo: {
    name: 'DuckDuckGo',
    short: 'D',
    color: '#fb923c',
    url: 'https://duckduckgo.com/?q=',
    home: 'https://duckduckgo.com'
  },
  bing: {
    name: 'Bing',
    short: 'B',
    color: '#38bdf8',
    url: 'https://www.bing.com/search?q=',
    home: 'https://www.bing.com'
  }
};

const DEFAULT_SETTINGS = {
  theme: 'dark',          // 'dark' | 'light' | 'system'
  searchEngine: 'google', // ключ из SEARCH_ENGINES
  homeUrl: NEW_TAB_URL,
  sleepMinutes: 15,       // 0 = отключено
  restoreSession: true,
  trustedSources: true,   // в «Обзоре от ИИ» Google оставлять только доверенные источники
  adblock: true,          // блокировка рекламы и трекеров
  prettySearch: true,     // стилизовать страницы поиска под тему браузера
  searchSuggest: true,    // сетевые подсказки поисковика в адресной строке (в Инкогнито всегда выключены)
  httpsOnly: false,       // «Только HTTPS»: http:// сначала пробуем по https://, при неудаче показываем предупреждение
  transparentChrome: false, // прозрачная оболочка (рамка, вкладки, адресная строка) поверх своих обоев
  chromeTheme: 'cyber-blue' // цветовая тема оболочки (синхронизируется со страницей новой вкладки)
};

const DEFAULT_NEWTAB_STATE = {
  wallpaperType: 'preset',
  wallpaperPreset: 'obsidian-mist',
  customWallpaperFile: null,
  wallpaperVersion: 1,
  dim: 28,
  blur: 0,
  widgets: {
    clock: true,
    links: true,
    search: true,
    todo: true
  },
  links: [
    { id: 'l1', title: 'YouTube', url: 'https://www.youtube.com', color: '#ef4444' },
    { id: 'l2', title: 'GitHub', url: 'https://github.com', color: '#e5e7eb' },
    { id: 'l3', title: 'Telegram', url: 'https://web.telegram.org', color: '#38bdf8' },
    { id: 'l4', title: 'ChatGPT', url: 'https://chatgpt.com', color: '#34d399' },
    { id: 'l5', title: 'Google', url: 'https://www.google.com', color: '#60a5fa' },
    { id: 'l6', title: 'Twitch', url: 'https://www.twitch.tv', color: '#a855f7' },
    { id: 'l7', title: 'Gemini', url: 'https://gemini.google.com/app', color: '#8ab4f8' }
  ],
  todos: [
    { id: 't1', text: 'Загрузить любимые тёмные обои (кнопка внизу справа)', done: false },
    { id: 't2', text: 'Добавить свои быстрые ссылки в левую панель', done: false }
  ]
};

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', `${APP_SCHEME}:`, 'about:']);

const INTERNAL_PAGES = {
  newtab: 'newtab.html',
  error: 'error.html',
  settings: 'settings.html',
  history: 'history.html',
  downloads: 'downloads.html',
  bookmarks: 'bookmarks.html'
};

const SLEEP_CHECK_INTERVAL_MS = 30_000;
const MAX_CLOSED_TABS = 25;

module.exports = {
  APP_SCHEME,
  NEW_TAB_URL,
  SETTINGS_URL,
  HISTORY_URL,
  DOWNLOADS_URL,
  BOOKMARKS_URL,
  UI_HEIGHT,
  FIND_BAR_HEIGHT,
  FIND_MAX_QUERY_LENGTH,
  OMNIBOX_MAX_ROWS,
  OMNIBOX_ROW_HEIGHT,
  OMNIBOX_PADDING,
  OMNIBOX_GAP,
  OMNIBOX_MAX_QUERY_LENGTH,
  VIEW_INSET,
  VIEW_BORDER_RADIUS,
  SEARCH_ENGINES,
  DEFAULT_SETTINGS,
  DEFAULT_NEWTAB_STATE,
  ALLOWED_PROTOCOLS,
  INTERNAL_PAGES,
  SLEEP_CHECK_INTERVAL_MS,
  MAX_CLOSED_TABS
};
