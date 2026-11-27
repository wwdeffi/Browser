const fs = require('fs');
const path = require('path');
const { app, dialog, shell, BrowserWindow } = require('electron');
const {
  APP_SCHEME,
  NEW_TAB_URL,
  ALLOWED_PROTOCOLS,
  INTERNAL_PAGES,
  SEARCH_ENGINES
} = require('./constants');
const { getDomain } = require('tldts');
const { getHub } = require('./webRequestHub');

// Быстрые префиксы: "!yt" откроет YouTube, а "!yt музыка" сразу найдёт "музыка" на YouTube
const SEARCH_BANGS = {
  '!g':  { search: 'https://www.google.com/search?q=', home: 'https://www.google.com' },
  '!г':  { search: 'https://www.google.com/search?q=', home: 'https://www.google.com' },
  '!y':  { search: 'https://ya.ru/search/?text=', home: 'https://ya.ru' },
  '!я':  { search: 'https://ya.ru/search/?text=', home: 'https://ya.ru' },
  '!d':  { search: 'https://duckduckgo.com/?q=', home: 'https://duckduckgo.com' },
  '!b':  { search: 'https://www.bing.com/search?q=', home: 'https://www.bing.com' },
  '!yt': { search: 'https://www.youtube.com/results?search_query=', home: 'https://www.youtube.com' },
  '!ю':  { search: 'https://www.youtube.com/results?search_query=', home: 'https://www.youtube.com' },
  '!w':  { search: 'https://ru.wikipedia.org/w/index.php?search=', home: 'https://ru.wikipedia.org' },
  '!в':  { search: 'https://ru.wikipedia.org/w/index.php?search=', home: 'https://ru.wikipedia.org' },
  '!gh': { search: 'https://github.com/search?q=', home: 'https://github.com' }
};

// Белый список внешних схем: открываются в сторонних приложениях только после подтверждения.
// Всё остальное (file:, javascript:, ms-msdt:, search-ms: и т.п.) по-прежнему блокируется.
const EXTERNAL_PROTOCOLS = new Set([
  'mailto:', 'tg:', 'magnet:', 'steam:', 'discord:', 'zoommtg:', 'viber:', 'whatsapp:', 'tel:'
]);

function isExternalProtocolUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) return false;
  if (/[\u0000-\u001f\u007f]/.test(rawUrl)) return false;
  try {
    return EXTERNAL_PROTOCOLS.has(new URL(rawUrl.trim()).protocol);
  } catch {
    return false;
  }
}

let externalPromptPending = false; // один диалог за раз: страница не сможет засыпать окнами

async function confirmOpenExternal(parent, rawUrl) {
  if (externalPromptPending || !isExternalProtocolUrl(rawUrl)) return false;
  let url;
  try { url = new URL(rawUrl.trim()).href; } catch { return false; }

  externalPromptPending = true;
  try {
    const shown = url.length > 400 ? `${url.slice(0, 400)}…` : url;
    const options = {
      type: 'question',
      title: 'Внешняя ссылка',
      message: 'Открыть ссылку в стороннем приложении?',
      detail: shown,
      buttons: ['Открыть', 'Отмена'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
    const win = parent && !parent.isDestroyed() ? parent : null;
    const { response } = await (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
    if (response !== 0) return false;
    await shell.openExternal(url);
    return true;
  } catch (err) {
    console.error('[security] Не удалось открыть внешнюю ссылку:', err.message);
    return false;
  } finally {
    externalPromptPending = false;
  }
}

function cleanUserAgent(app) {
  app.userAgentFallback = app.userAgentFallback
    // между «(KHTML, like Gecko)» и «Chrome/…» стоит токен приложения под любым именем («DEFFIBrowser/1.0.0» и т.п.)
    .replace(/(\(KHTML, like Gecko\))\s+(?:(?!Chrome\/)\S+\s+)+(?=Chrome\/)/, '$1 ')
    .replace(/\s*Electron\/\S+/g, '')
    .replace(/\s*(?:my-browser|deffi-browser)\/\S+/g, '');
}

// ---- Маскировка под Firefox: только для доменов авторизации Google ----
const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0';
// true — на доменах входа Google подставлять Firefox-UA; false — везде один Chrome-UA (заголовки, navigator.userAgent и client hints совпадают).
// Если вход в Google перестал работать, переключите значение и перезапустите браузер.
const GOOGLE_FIREFOX_UA = false;
const GOOGLE_AUTH_HOSTS = new Set(['accounts.youtube.com', 'myaccount.google.com']);
// Только настоящие домены Google: com, ccTLD (de, fr…) и составные (co.uk, com.au); иначе accounts.google.com.evil.io тоже совпал бы
const GOOGLE_AUTH_HOST_RE = /^accounts\.google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/;

function isGoogleAuthUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (GOOGLE_AUTH_HOSTS.has(h) || GOOGLE_AUTH_HOST_RE.test(h));
  } catch { return false; }
}

// Главный документ — по своему URL; подзапросы и субфреймы — по адресу вкладки
function isGoogleAuthRequest(details) {
  if (isGoogleAuthUrl(details.url)) return true;
  if (details.resourceType === 'mainFrame') return false;
  return isGoogleAuthUrl(safeGetUrl(details.webContents));
}

// Electron не Google Chrome: в Sec-CH-UA у него нет бренда «Google Chrome», а у настоящего Chrome он есть.
// На страницах входа добавляем его (версия та же, что у Chromium), чтобы заголовок совпадал с User-Agent
function addGoogleChromeBrand(value) {
  const v = String(value);
  if (/"Google Chrome"/.test(v)) return v;
  return v.replace(/"Chromium";v="([^"]*)"/, (m, ver) => `${m}, "Google Chrome";v="${ver}"`);
}

function applyChromeBrandHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const l = k.toLowerCase();
    out[k] = (l === 'sec-ch-ua' || l === 'sec-ch-ua-full-version-list') ? addGoogleChromeBrand(v) : v;
  }
  return out;
}

function applyFirefoxHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    const l = k.toLowerCase();
    if (l === 'user-agent' || l.startsWith('sec-ch-')) continue; // Firefox не шлёт Client Hints
    out[k] = v;
  }
  out['User-Agent'] = FIREFOX_UA;
  return out;
}

// ---- Камера и микрофон ('media'): спрашиваем пользователя, выбор хранится по origin ОТДЕЛЬНО для микрофона и камеры ----
// Формат файла: { "<origin>": { "audio": "allow" | "deny", "video": "allow" | "deny" } }
// Разрешение микрофона больше не открывает камеру автоматически.
const MEDIA_PERMISSIONS_FILE = 'media-permissions.json';
const MEDIA_KINDS = ['audio', 'video']; // audio = микрофон, video = камера
let mediaDecisions = null; // Map: origin -> { audio?: 'allow'|'deny', video?: 'allow'|'deny' }
const pendingMediaPrompts = new Map(); // "origin|kinds" -> Promise<boolean> (один диалог на origin и набор устройств)

// Права, которыми пользователь управляет в панели замочка (порядок = порядок в меню).
// Решения хранятся в том же файле и в той же структуре, что и камера/микрофон: { origin: { video, audio, notifications, 'clipboard-read' } }
const SITE_PERMISSION_KINDS = ['video', 'audio', 'notifications', 'clipboard-read'];
const SITE_PERMISSION_LABELS = {
  video: 'Камера',
  audio: 'Микрофон',
  notifications: 'Уведомления',
  'clipboard-read': 'Буфер обмена (чтение)'
};
// Публичные имена прав для панели безопасности -> внутренние ключи хранилища
const SITE_PERMISSION_ALIASES = {
  microphone: 'audio',
  camera: 'video',
  notifications: 'notifications',
  clipboard: 'clipboard-read'
};
const SITE_PERMISSION_NAMES = Object.keys(SITE_PERMISSION_ALIASES);
const SITE_PERMISSION_NAME_BY_KIND = Object.fromEntries(
  Object.entries(SITE_PERMISSION_ALIASES).map(([name, kind]) => [kind, name])
);
// Эти права без диалога: по умолчанию отказ (как и раньше), разрешить можно только из панели замочка
const SILENT_PERMISSIONS = new Set(['notifications', 'clipboard-read']);
const incognitoStores = new WeakMap(); // session Инкогнито -> Map решений (только в памяти)

// Допустимый origin для запроса камеры/микрофона: https: или localhost/127.0.0.1 (в т.ч. по http)
function getMediaOrigin(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && isLocal)) return u.origin;
  } catch {
    // некорректный URL
  }
  return null;
}

function mediaPermissionsPath() {
  const dir = path.join(app.getPath('userData'), 'browser-data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, MEDIA_PERMISSIONS_FILE);
}

// Синхронно читаем файл один раз и дальше держим в памяти: setPermissionCheckHandler обязан отвечать синхронно
function getMediaDecisions() {
  if (mediaDecisions) return mediaDecisions;
  mediaDecisions = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(mediaPermissionsPath(), 'utf8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [origin, value] of Object.entries(raw)) {
        if (getMediaOrigin(origin) !== origin) continue;
        if (value === 'deny') {
          // Старый формат: один общий выбор. Отказ переносим на оба устройства;
          // старое «разрешить» не переносим — неизвестно, чем именно пользователь согласился, спросим заново.
          mediaDecisions.set(origin, { audio: 'deny', video: 'deny' });
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
          const entry = {};
          for (const kind of SITE_PERMISSION_KINDS) {
            if (value[kind] === 'allow' || value[kind] === 'deny') entry[kind] = value[kind];
          }
          if (Object.keys(entry).length) mediaDecisions.set(origin, entry);
        }
      }
    }
  } catch {
    // файла нет или он повреждён — начинаем с пустого списка
  }
  return mediaDecisions;
}

function persistMediaDecisions() {
  try {
    const target = mediaPermissionsPath();
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(getMediaDecisions()), null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (err) {
    console.error('[security] Ошибка записи media-permissions.json:', err.message);
  }
}

function getMediaDecision(origin, kind, store = getMediaDecisions()) {
  const entry = store.get(origin);
  return entry ? entry[kind] : undefined;
}

function setMediaDecision(origin, kind, value, map = getMediaDecisions()) {
  map.set(origin, { ...(map.get(origin) || {}), [kind]: value });
}

// Какие устройства запрашивает сайт. Нет данных о типах — считаем, что нужны оба (строго).
function requestedMediaKinds(details) {
  const types = Array.isArray(details && details.mediaTypes) ? details.mediaTypes : [];
  const kinds = MEDIA_KINDS.filter((k) => types.includes(k));
  return kinds.length ? kinds : MEDIA_KINDS.slice();
}

function describeMediaKinds(kinds) {
  const cam = kinds.includes('video');
  const mic = kinds.includes('audio');
  if (cam && mic) return 'камере и микрофону';
  if (cam) return 'камере';
  return 'микрофону';
}

function askMediaPermission(origin, kinds, incStore = null) {
  const key = `${incStore ? 'inc' : 'norm'}|${origin}|${kinds.join('+')}`;
  const pending = pendingMediaPrompts.get(key);
  if (pending) return pending; // одновременные запросы от одного origin делят один диалог

  // Родительское окно нужно, чтобы диалог не прятался за основным окном
  const parent = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const cam = kinds.includes('video');
  const mic = kinds.includes('audio');
  const options = {
    type: 'question',
    title: cam && mic ? 'Доступ к камере и микрофону' : cam ? 'Доступ к камере' : 'Доступ к микрофону',
    message: `Сайт ${origin} запрашивает доступ к ${describeMediaKinds(kinds)}.`,
    detail: incStore ? 'Выбор действует только до выхода из режима Инкогнито.' : 'Выбор будет сохранён для этого сайта.',
    buttons: ['Разрешить', 'Блокировать'],
    defaultId: 1,
    cancelId: 2, // Esc / крестик возвращают 2 (нет такой кнопки): отказ только на этот раз, без записи в файл
    noLink: true
  };

  const promise = (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
    .then(({ response }) => {
      // Сохраняем выбор только по явным кнопкам: 0 = «Разрешить», 1 = «Блокировать».
      // Закрытие окна (Esc / крестик) — отказ на этот раз, при следующем запросе спросим снова.
      if (response !== 0 && response !== 1) return false;
      const allow = response === 0;
      for (const kind of kinds) setMediaDecision(origin, kind, allow ? 'allow' : 'deny', incStore || undefined);
      if (!incStore) persistMediaDecisions();
      return allow;
    })
    .catch(() => false)
    .finally(() => { pendingMediaPrompts.delete(key); });

  pendingMediaPrompts.set(key, promise);
  return promise;
}

// Решение по запросу 'media': разрешаем, только если разрешены ВСЕ запрошенные устройства
async function resolveMediaRequest(origin, details, incStore = null) {
  const store = incStore || getMediaDecisions();
  const kinds = requestedMediaKinds(details);
  if (kinds.some((k) => getMediaDecision(origin, k, store) === 'deny')) return false;
  const unknown = kinds.filter((k) => getMediaDecision(origin, k, store) !== 'allow');
  if (!unknown.length) return true;
  // Спрашиваем только про те устройства, по которым решения ещё нет
  return askMediaPermission(origin, unknown, incStore);
}

function listMediaPermissions() {
  return Array.from(getMediaDecisions(), ([origin, v]) => ({
    origin, audio: v.audio || null, video: v.video || null
  })).filter((e) => e.audio || e.video) // сайты только с другими правами в этом списке не нужны
    .sort((a, b) => a.origin.localeCompare(b.origin));
}

function removeMediaPermission(key) {
  if (typeof key !== 'string') return false;
  const store = getMediaDecisions();
  const entry = { ...(store.get(key) || {}) };
  if (!MEDIA_KINDS.some((k) => k in entry)) return false;
  for (const k of MEDIA_KINDS) delete entry[k]; // уведомления и прочие права сайта сохраняем
  if (Object.keys(entry).length) store.set(key, entry);
  else store.delete(key);
  persistMediaDecisions(); // tmp + rename — запись атомарная
  return true;
}

// ---- Панель прав сайта (клик по замочку) ----
// Значение 'ask' в панели = «решения нет»: для камеры/микрофона это диалог, для остальных прав — отказ без вопросов.
function getSitePermissionInfo(ses, rawUrl) {
  const origin = getMediaOrigin(rawUrl);
  const inc = (ses && incognitoStores.get(ses)) || null;
  if (!origin) return { origin: null, incognito: Boolean(inc), items: [] };
  const store = inc || getMediaDecisions();
  const items = SITE_PERMISSION_KINDS.map((kind) => {
    const value = getMediaDecision(origin, kind, store) || 'ask';
    const silent = SILENT_PERMISSIONS.has(kind);
    return {
      kind,
      permission: SITE_PERMISSION_NAME_BY_KIND[kind],
      label: SITE_PERMISSION_LABELS[kind],
      value,
      askLabel: silent ? 'По умолчанию (блокировать)' : 'Спрашивать',
      stateText: value === 'allow'
        ? 'Разрешено'
        : value === 'deny' ? 'Заблокировано'
          : silent ? 'Заблокировано' : 'Спрашивать'
    };
  });
  return { origin, incognito: Boolean(inc), items };
}

// Установка права по публичному имени (microphone | camera | notifications | clipboard)
function setSitePermissionByName(ses, origin, permission, value) {
  if (typeof permission !== 'string' || !Object.prototype.hasOwnProperty.call(SITE_PERMISSION_ALIASES, permission)) return false;
  return setSitePermission(ses, origin, SITE_PERMISSION_ALIASES[permission], value);
}

// Есть ли для этого хоста разовое исключение по сертификату (локальные адреса разработчика)
function hasCertExceptionForHost(ses, rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const set = ses && certExceptions.get(ses);
  if (!set) return false;
  const prefix = `https://${u.host}|`;
  for (const key of set) if (key.startsWith(prefix)) return true;
  return false;
}

// Сводка безопасности для панели замочка: статус соединения, домен, состояния прав для этого origin
// status: 'https' | 'http' | 'internal' | 'ssl-bypass'
function getSiteInfo(ses, rawUrl, { isError = false, tabId = null } = {}) {
  const url = typeof rawUrl === 'string' ? rawUrl : '';
  let status = 'internal';
  let host = '';
  try {
    const u = new URL(url);
    host = u.hostname;
    if (u.protocol === 'https:') status = hasCertExceptionForHost(ses, url) ? 'ssl-bypass' : 'https';
    else if (u.protocol === 'http:') status = 'http';
  } catch {
    // внутренняя или пустая страница
  }
  const perm = getSitePermissionInfo(ses, url);
  const permissions = {};
  for (const item of perm.items) permissions[item.permission] = item.value;
  return {
    tabId,
    status,
    url: formatDisplayUrl(url),
    host,
    origin: perm.origin,
    incognito: perm.incognito,
    isError: Boolean(isError),
    permissionsAvailable: Boolean(perm.origin),
    permissions,
    items: perm.items
  };
}

function setSitePermission(ses, origin, kind, value) {
  if (typeof origin !== 'string' || getMediaOrigin(origin) !== origin) return false;
  if (!SITE_PERMISSION_KINDS.includes(kind)) return false;
  if (value !== 'allow' && value !== 'deny' && value !== 'ask') return false;
  const inc = (ses && incognitoStores.get(ses)) || null;
  const store = inc || getMediaDecisions();
  if (value === 'ask') {
    const entry = { ...(store.get(origin) || {}) };
    delete entry[kind];
    if (Object.keys(entry).length) store.set(origin, entry);
    else store.delete(origin);
  } else {
    setMediaDecision(origin, kind, value, store);
  }
  if (!inc) persistMediaDecisions();
  return true;
}

function resetSitePermissions(ses, origin) {
  if (typeof origin !== 'string' || getMediaOrigin(origin) !== origin) return false;
  const inc = (ses && incognitoStores.get(ses)) || null;
  const store = inc || getMediaDecisions();
  if (!store.delete(origin)) return false;
  if (!inc) persistMediaDecisions();
  return true;
}

// ---- Сетевая приватность: флаги из settings.json (кэш 2 с; storage.saveSettings сбрасывает кэш) ----
const PRIVACY_CACHE_TTL_MS = 2000;
let privacyCache = { at: 0, flags: { blockThirdPartyCookies: false, stripTrackingParams: true, incognitoFingerprintProtection: false, blockCamera: false, blockMicrophone: false, blockGeolocation: false } };

function getPrivacyFlags() {
  const now = Date.now();
  if (now - privacyCache.at < PRIVACY_CACHE_TTL_MS) return privacyCache.flags;
  let flags = privacyCache.flags;
  try {
    // Ленивый require: storage сам подключает security, прямой require на старте дал бы цикл
    const s = require('./storage').loadSettings();
    flags = {
      blockThirdPartyCookies: Boolean(s.blockThirdPartyCookies),
      stripTrackingParams: s.stripTrackingParams !== false,
      incognitoFingerprintProtection: Boolean(s.incognitoFingerprintProtection),
      blockCamera: Boolean(s.blockCamera),
      blockMicrophone: Boolean(s.blockMicrophone),
      blockGeolocation: Boolean(s.blockGeolocation)
    };
  } catch { /* оставляем прежние значения */ }
  privacyCache = { at: now, flags };
  return flags;
}

function invalidatePrivacyCache() {
  privacyCache.at = 0;
}

// Разделение хранилища по сайту верхнего уровня (partitioned storage / SameSite) включается флагами Chromium
// и действует только с запуска: вызывать ДО app.whenReady(). Включается, только если опция включена в настройках.
function applyChromiumPrivacySwitches(electronApp = app) {
  try {
    if (!getPrivacyFlags().blockThirdPartyCookies) return false;
    electronApp.commandLine.appendSwitch(
      'enable-features',
      'ThirdPartyStoragePartitioning,PartitionedCookies,SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure'
    );
    return true;
  } catch {
    return false;
  }
}

// «Сайт» = домен регистрации по tldts (eTLD+1). allowPrivateDomains: поддомены на общих платформах
// (github.io, vercel.app, blogspot.com и т.п.) — разные сайты. IP и localhost сравниваются по полному хосту.
const siteCache = new Map();
function getSite(host) {
  if (typeof host !== 'string' || !host) return '';
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  let site = siteCache.get(h);
  if (site !== undefined) return site;
  let domain = null;
  try { domain = getDomain(h, { allowPrivateDomains: true }); } catch { domain = null; }
  site = domain || h;
  if (siteCache.size > 1000) siteCache.clear();
  siteCache.set(h, site);
  return site;
}

function isSameSiteHost(a, b) {
  const sa = getSite(a);
  return Boolean(sa) && sa === getSite(b);
}

// Кросс-доменный Referer урезаем до origin (https://example.com/)
function trimCrossSiteReferer(requestUrl, referer) {
  try {
    const target = new URL(requestUrl);
    const ref = new URL(referer);
    if (!/^https?:$/.test(ref.protocol) || !/^https?:$/.test(target.protocol)) return referer;
    // https -> http: Referer не отправляем вообще
    if (ref.protocol === 'https:' && target.protocol === 'http:') return null;
    if (isSameSiteHost(target.hostname, ref.hostname)) return referer;
    return `${ref.origin}/`;
  } catch {
    return referer;
  }
}

// Сторонний подзапрос: не главный документ, а сайт запроса != сайт верхней страницы вкладки.
// Если верхний сайт определить нельзя (воркеры, внутренние страницы) — считаем запрос своим, чтобы ничего не ломать.
function isThirdPartyRequest(details) {
  if (!details || details.resourceType === 'mainFrame') return false;
  const wc = details.webContents;
  if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) return false;
  try {
    const top = new URL(wc.getURL());
    const req = new URL(details.url);
    if (!/^https?:$/.test(top.protocol) || !/^https?:$/.test(req.protocol)) return false;
    return !isSameSiteHost(top.hostname, req.hostname);
  } catch {
    return false;
  }
}

// ---- Очистка трекинговых меток из URL ----
const TRACKING_PARAM_EXACT = new Set(['fbclid', 'gclid', 'yclid', 'mc_eid', '_openstat']);
const TRACKING_PARAM_PREFIXES = ['utm_', 'roistat'];
// Ссылки авторизации не трогаем вообще: OAuth/OIDC/SAML чувствительны к любому изменению адреса
const AUTH_QUERY_KEYS = [
  'code', 'state', 'client_id', 'redirect_uri', 'response_type', 'id_token', 'access_token',
  'oauth_token', 'samlrequest', 'samlresponse'
];
const AUTH_PATH_RE = /\/(oauth2?|authorize|saml2?|sso|openid|auth)(\/|$)/i;

function isTrackingParamName(name) {
  const n = name.toLowerCase();
  return TRACKING_PARAM_EXACT.has(n) || TRACKING_PARAM_PREFIXES.some((p) => n.startsWith(p));
}

function looksLikeAuthUrl(u) {
  if (AUTH_PATH_RE.test(u.pathname)) return true;
  for (const key of u.searchParams.keys()) {
    if (AUTH_QUERY_KEYS.includes(key.toLowerCase())) return true;
  }
  return /(^#|&)(access_token|id_token|code|state)=/i.test(u.hash);
}

// Возвращает адрес без трекинговых параметров (остальные части строки запроса остаются байт в байт)
function stripTrackingParams(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 8192) return rawUrl;
  let u;
  try { u = new URL(rawUrl); } catch { return rawUrl; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return rawUrl;
  if (!u.search || looksLikeAuthUrl(u)) return rawUrl;
  const parts = u.search.slice(1).split('&');
  const kept = parts.filter((part) => {
    const rawName = part.split('=')[0];
    let name = rawName;
    try { name = decodeURIComponent(rawName.replace(/\+/g, ' ')); } catch { /* оставляем как есть */ }
    return !isTrackingParamName(name);
  });
  if (kept.length === parts.length) return rawUrl;
  u.search = kept.length ? `?${kept.join('&')}` : '';
  return u.href;
}

// ---- Защита от цифрового отпечатка в Инкогнито: единообразные сетевые заголовки ----
const FP_ACCEPT_LANGUAGE = 'en-US,en;q=0.9';

// Sec-CH-UA строится из реальной мажорной версии Chromium (иначе сайты увидят расхождение с navigator.userAgent),
// но без «Google Chrome»/Electron и с одним и тем же набором брендов у всех пользователей.
// Платформа берётся из ОС, чтобы не противоречить User-Agent.
function buildNormalizedClientHints() {
  const major = String((process.versions && process.versions.chrome) || '0').split('.')[0] || '0';
  const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
  return {
    ua: `"Chromium";v="${major}", "Not_A Brand";v="24"`,
    mobile: '?0',
    platform: `"${platform}"`
  };
}

// Заголовки, раскрывающие размер окна/экрана и железо (старые и Client Hints-версии)
const FP_DROP_HEADERS = new Set(['device-memory', 'dpr', 'viewport-width', 'width', 'downlink', 'ect', 'rtt', 'save-data']);

// Приводит заголовки запроса к единому виду. Возвращает новый объект.
function normalizeFingerprintHeaders(requestHeaders) {
  const hints = buildNormalizedClientHints();
  const out = {};
  let hadUa = false;
  for (const [key, value] of Object.entries(requestHeaders)) {
    const k = key.toLowerCase();
    if (k === 'accept-language') continue; // ниже ставим единый
    if (k === 'sec-ch-ua') { hadUa = true; continue; }
    if (k === 'sec-ch-ua-mobile') { out[key] = hints.mobile; continue; }
    if (k === 'sec-ch-ua-platform') { out[key] = hints.platform; continue; }
    // Остальные Sec-CH-* (Full-Version-List, Platform-Version, Arch, Model, Bitness, Viewport-Width, DPR и т.д.) и
    // прочие «железные» заголовки не отправляем вообще
    if (k.startsWith('sec-ch-') || FP_DROP_HEADERS.has(k)) continue;
    out[key] = value;
  }
  // Sec-CH-UA есть только там, где Chromium его сам отправляет (secure context) — на http не добавляем
  if (hadUa) out['Sec-CH-UA'] = hints.ua;
  out['Accept-Language'] = FP_ACCEPT_LANGUAGE;
  return out;
}

// Sec-GPC: 1, урезание кросс-сайтового Referer и (по настройке) фильтрация Cookie / Set-Cookie у сторонних подзапросов
function applyPrivacyHeaders(ses, { incognito = false } = {}) {
  const filter = { urls: ['http://*/*', 'https://*/*'] };
  const hub = getHub(ses);

  hub.on('security', 'onBeforeRequest', filter, (details, callback) => {
    // Только главный документ и строго GET: POST/PUT и 307/308-редиректы после POST не трогаем
    if (details.resourceType === 'mainFrame' &&
        String(details.method || 'GET').toUpperCase() === 'GET' &&
        getPrivacyFlags().stripTrackingParams) {
      const cleaned = stripTrackingParams(details.url);
      if (cleaned !== details.url) { callback({ redirectURL: cleaned }); return; }
    }
    callback({});
  });

  hub.on('security', 'onBeforeSendHeaders', filter, (details, callback) => {
    const headers = { ...details.requestHeaders };
    headers['Sec-GPC'] = '1';
    const refKey = Object.keys(headers).find((k) => k.toLowerCase() === 'referer');
    if (refKey) {
      const trimmed = trimCrossSiteReferer(details.url, headers[refKey]);
      if (trimmed === null) delete headers[refKey];
      else if (trimmed !== headers[refKey]) headers[refKey] = trimmed;
    }
    if (getPrivacyFlags().blockThirdPartyCookies && isThirdPartyRequest(details)) {
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'cookie') delete headers[k];
      }
    }
    let out = headers;
    // Только сессия Инкогнито и только при включённой настройке (флаг читается на каждый запрос: переключение действует сразу)
    if (incognito && getPrivacyFlags().incognitoFingerprintProtection) {
      out = normalizeFingerprintHeaders(headers);
    }
    if (isGoogleAuthRequest(details)) {
      out = GOOGLE_FIREFOX_UA ? applyFirefoxHeaders(out) : applyChromeBrandHeaders(out); // строго последним
    }
    callback({ requestHeaders: out });
  });

  hub.on('security', 'onHeadersReceived', filter, (details, callback) => {
    try {
      if (getPrivacyFlags().blockThirdPartyCookies && isThirdPartyRequest(details)) {
        const headers = { ...details.responseHeaders };
        let changed = false;
        for (const k of Object.keys(headers)) {
          if (k.toLowerCase() === 'set-cookie') { delete headers[k]; changed = true; }
        }
        if (changed) {
          callback({ responseHeaders: headers });
          return;
        }
      }
    } catch { /* отдаём ответ без изменений */ }
    callback({});
  });
}

// Глобальный запрет камеры/микрофона: types — массив 'video' | 'audio'. Неизвестный тип блокируем при любом включённом запрете
function isMediaGloballyBlocked(types) {
  const f = getPrivacyFlags();
  const list = Array.isArray(types) ? types : [];
  if (!list.length) return f.blockCamera || f.blockMicrophone;
  return (list.includes('video') && f.blockCamera) || (list.includes('audio') && f.blockMicrophone);
}

function configureSession(ses, { incognito = false } = {}) {
  ses.setUserAgent(app.userAgentFallback);
  applyPrivacyHeaders(ses, { incognito });
  const incStore = incognito ? new Map() : null; // разрешения сайтов в Инкогнито — только в памяти
  if (incStore) incognitoStores.set(ses, incStore);
  // Раньше здесь подменялся заголовок User-Agent на Firefox только для accounts.google.com.
  // Из-за этого заголовок («Firefox») расходился с navigator.userAgent и client hints («Chromium»),
  // и Google отклонял вход. Теперь везде единый честный Chrome-UA (без «Electron», см. cleanUserAgent).

  const allowedPermissions = new Set([
    'fullscreen',
    'pointerLock',
    'clipboard-sanitized-write',
    'mediaKeySystem'
  ]);

  // Геолокация запрещена всем сайтам (в т.ч. gemini.google.com и в Инкогнито): автоматических исключений нет

  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    // Глобальные запреты: выше сохранённых разрешений сайтов, диалог не показываем
    if (permission === 'geolocation' && getPrivacyFlags().blockGeolocation) { callback(false); return; }
    if (permission === 'media' && isMediaGloballyBlocked(details && details.mediaTypes)) { callback(false); return; }
    if (permission === 'media') {
      let origin = null;
      try { origin = getMediaOrigin(details?.requestingUrl || _webContents.getURL()); } catch { origin = null; }
      if (!origin) {
        callback(false);
        return;
      }
      resolveMediaRequest(origin, details, incStore).then((allow) => {
        try { callback(allow); } catch { /* вкладка уже закрыта */ }
      });
      return;
    }
    if (SILENT_PERMISSIONS.has(permission)) {
      let origin = null;
      try { origin = getMediaOrigin(details?.requestingUrl || _webContents.getURL()); } catch { origin = null; }
      callback(Boolean(origin) && getMediaDecision(origin, permission, incStore || getMediaDecisions()) === 'allow');
      return;
    }
    if (permission === 'geolocation') {
      callback(false);
      return;
    }
    callback(allowedPermissions.has(permission));
  });

  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (permission === 'geolocation' && getPrivacyFlags().blockGeolocation) return false;
    if (permission === 'media') {
      const mt0 = details && details.mediaType; // 'audio' | 'video' | 'unknown'
      if (isMediaGloballyBlocked(mt0 === 'audio' || mt0 === 'video' ? [mt0] : [])) return false;
    }
    if (permission === 'media') {
      const origin = getMediaOrigin(requestingOrigin);
      if (!origin) return false; // неизвестные сайты — false
      // details.mediaType: 'audio' | 'video' | 'unknown'. Для неизвестного типа нужны оба разрешения.
      const mt = details && details.mediaType;
      const kinds = mt === 'audio' || mt === 'video' ? [mt] : MEDIA_KINDS;
      return kinds.every((k) => getMediaDecision(origin, k, incStore || getMediaDecisions()) === 'allow');
    }
    if (SILENT_PERMISSIONS.has(permission)) {
      const origin = getMediaOrigin(requestingOrigin);
      return Boolean(origin) && getMediaDecision(origin, permission, incStore || getMediaDecisions()) === 'allow';
    }
    if (permission === 'geolocation') return false;
    return allowedPermissions.has(permission);
  });
}

// Синхронизирует родную cookie темы Bing (SRCHHPGUSR: WEBTHEME и DM) с темой браузера,
// чтобы Bing и Bing Поиск ИИ (copilotsearch) сами отдавали тёмную/светлую вёрстку
async function syncSearchEngineThemeCookies(ses, resolvedTheme) {
  if (!ses || !ses.cookies) return;
  const targetVal = resolvedTheme === 'light' ? '0' : '1';

  try {
    const existing = await ses.cookies.get({ url: 'https://www.bing.com', name: 'SRCHHPGUSR' });
    let value = existing.length ? existing[0].value : '';

    for (const c of existing) {
      await ses.cookies.remove('https://www.bing.com', c.name).catch(() => {});
    }

    const setParam = (str, key, val) => {
      const re = new RegExp(`(^|&)${key}=[^&]*`, 'i');
      if (re.test(str)) return str.replace(re, `$1${key}=${val}`);
      return str ? `${str}&${key}=${val}` : `${key}=${val}`;
    };

    value = setParam(value, 'WEBTHEME', targetVal);
    value = setParam(value, 'DM', targetVal);

    await ses.cookies.set({
      url: 'https://www.bing.com',
      domain: '.bing.com',
      path: '/',
      name: 'SRCHHPGUSR',
      value,
      secure: true,
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365
    });
  } catch (err) {
    console.error('[security] Ошибка синхронизации темы Bing:', err.message);
  }
}

function isSafeNavigationUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 8192) return false;
  try {
    const parsed = new URL(rawUrl);
    if (EXTERNAL_PROTOCOLS.has(parsed.protocol)) return false;
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return false;
    if (parsed.protocol === 'about:' && rawUrl !== 'about:blank') return false;
    if (parsed.protocol === `${APP_SCHEME}:`) {
      return Boolean(INTERNAL_PAGES[parsed.hostname]);
    }
    return true;
  } catch {
    return false;
  }
}

// true, если адрес относится к внутренней схеме browser:
function isAppSchemeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  try {
    return new URL(rawUrl).protocol === `${APP_SCHEME}:`;
  } catch {
    return false;
  }
}

// Страница, открытая не по browser:, не должна уходить на browser:// (навигация, редирект, попап)
function isBlockedAppSchemeTransition(sourceUrl, targetUrl) {
  return isAppSchemeUrl(targetUrl) && !isAppSchemeUrl(sourceUrl);
}

function safeGetUrl(wc) {
  try { return wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch { return ''; }
}

function isSafeFaviconUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) return false;
  if (rawUrl.startsWith('data:image/')) return true;
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === `${APP_SCHEME}:`;
  } catch {
    return false;
  }
}

function formatDisplayUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return '';
  try {
    return decodeURI(rawUrl);
  } catch {
    return rawUrl;
  }
}

function resolveUserInputRaw(rawInput, settings) {
  const engine = SEARCH_ENGINES[settings.searchEngine] || SEARCH_ENGINES.google;
  const homeUrl = settings.homeUrl || NEW_TAB_URL;

  if (typeof rawInput !== 'string') return homeUrl;
  const input = rawInput.trim();
  if (!input) return homeUrl;

  // about:blank (например, при восстановлении сессии) — не поисковый запрос
  if (input.toLowerCase() === 'about:blank') return 'about:blank';

  const bareBang = SEARCH_BANGS[input.toLowerCase()];
  if (bareBang) {
    return bareBang.home;
  }

  const bangMatch = input.match(/^(![a-zа-яё]+)\s+(.+)$/i);
  if (bangMatch) {
    const target = SEARCH_BANGS[bangMatch[1].toLowerCase()];
    if (target) {
      return target.search + encodeURIComponent(bangMatch[2].trim());
    }
  }

  if (input.toLowerCase().startsWith(`${APP_SCHEME}://`)) {
    if (isSafeNavigationUrl(input)) return input;
    return engine.url + encodeURIComponent(input);
  }

  // host:port (localhost:3000, site.com:8080) — не схема, поэтому разбираем до проверки схемы
  const hasHostPort = /^[^\s:/?#@]+:\d{1,5}([/?#]|$)/.test(input);

  if (!hasHostPort && /^[a-z][a-z0-9+.-]*:/i.test(input)) {
    if (/^https?:\/\//i.test(input) && isSafeNavigationUrl(input)) {
      return input;
    }
    return engine.url + encodeURIComponent(input);
  }

  const looksLikeLocal = !input.includes(' ') &&
    /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?([/?#]|$)/i.test(input);
  if (looksLikeLocal) {
    return `http://${input}`;
  }

  const looksLikeDomain = !input.includes(' ') &&
    /^[^\s/?#]+\.[a-zа-яё]{2,}(:\d+)?([/?#]|$)/i.test(input);
  if (looksLikeDomain) {
    return `https://${input}`;
  }

  return engine.url + encodeURIComponent(input);
}

// Введённый/вставленный адрес тоже очищаем от трекинговых меток (поисковые запросы не затрагиваются)
function resolveUserInput(rawInput, settings) {
  const url = resolveUserInputRaw(rawInput, settings);
  const enabled = settings && typeof settings.stripTrackingParams === 'boolean'
    ? settings.stripTrackingParams
    : getPrivacyFlags().stripTrackingParams;
  return enabled ? stripTrackingParams(url) : url;
}

function attachWebContentsSecurity(wc, options = {}) {
  const getParent = typeof options.getParent === 'function' ? options.getParent : null;
  const resolveParent = () => {
    try {
      const p = getParent ? getParent() : null;
      if (p && !p.isDestroyed()) return p;
    } catch { /* ignore */ }
    return BrowserWindow.fromWebContents(wc) || BrowserWindow.getFocusedWindow() || null;
  };

  // Одна проверка и для обычной навигации, и для серверных редиректов:
  // иначе сайт мог бы обойти will-navigate через 302 на внешний протокол / небезопасный URL
  const makeGuard = (kind) => (event, urlArg) => {
    // В новых версиях Electron адрес приходит в event.url, позиционный аргумент — устаревший
    const targetUrl = typeof urlArg === 'string' ? urlArg : (event && event.url);
    if (isExternalProtocolUrl(targetUrl)) {
      event.preventDefault();
      confirmOpenExternal(resolveParent(), targetUrl);
      return;
    }
    if (!isSafeNavigationUrl(targetUrl)) {
      event.preventDefault();
      return;
    }
    // Внешний сайт не может увести вкладку на browser://settings и другие внутренние страницы
    if (isBlockedAppSchemeTransition(safeGetUrl(wc), targetUrl)) {
      event.preventDefault();
      return;
    }

    // Очистка трекинговых меток теперь в onBeforeRequest (applyPrivacyHeaders): там известен метод запроса
  };

  wc.on('will-navigate', makeGuard('navigate'));
  wc.on('will-redirect', makeGuard('redirect'));

  // WebRTC не должен раскрывать реальный IP в обход прокси/VPN
  try { wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp'); } catch { /* wc уже уничтожен */ }

  wc.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
}

// ---- Ошибки сертификата и разовое исключение для локальных адресов разработчика ----
// Исключение — только в памяти и только на время жизни сессии Electron (у Инкогнито своя сессия, она умирает вместе с ним).
// Ключ: "https://host:port|sha256/<fingerprint>". Другой сертификат на том же адресе — другой ключ, исключения нет.

// Разбор IPv4 строго по строке: ровно 4 десятичных октета без ведущих нулей
function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = [];
  for (let i = 1; i <= 4; i++) {
    if (m[i].length > 1 && m[i][0] === '0') return null;
    const n = Number(m[i]);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

// Разбор IPv6 (без скобок) в 8 групп; IPv4-хвост не поддерживается: URL уже нормализует его в hex
function parseIPv6(host) {
  if (!host.includes(':') || !/^[0-9a-f:]+$/.test(host)) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const groupsOf = (s) => (s === '' ? [] : s.split(':'));
  const head = groupsOf(halves[0]);
  const tail = halves.length === 2 ? groupsOf(halves[1]) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

// Локальный адрес разработчика. Только строка hostname, никакого DNS-резолвинга.
// localhost, *.localhost, *.local, 127/8, 10/8, 172.16/12, 192.168/16, ::1, fc00::/7, fe80::/10
function isLocalDevHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname || hostname.length > 253) return false;
  let h = hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  else if (h.endsWith('.')) h = h.slice(0, -1); // «localhost.» — тот же localhost

  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.local') && h.length > '.local'.length) return true;

  const v4 = parseIPv4(h);
  if (v4) {
    const [a, b] = v4;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }

  const v6 = parseIPv6(h);
  if (v6) {
    if (v6.slice(0, 7).every((g) => g === 0) && v6[7] === 1) return true; // ::1
    if ((v6[0] & 0xfe00) === 0xfc00) return true;                        // fc00::/7
    if ((v6[0] & 0xffc0) === 0xfe80) return true;                        // fe80::/10
  }
  return false;
}

// Ключ исключения. null — исключение для этого адреса невозможно (не https, не локальный хост, нет отпечатка)
function certExceptionKey(rawUrl, certificate) {
  const fingerprint = certificate && typeof certificate.fingerprint === 'string' ? certificate.fingerprint : '';
  if (!fingerprint || fingerprint.length > 256) return null;
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'wss:') return null; // wss — для HMR dev-серверов
  if (!isLocalDevHostname(u.hostname)) return null;
  return `https://${u.host}|${fingerprint}`;
}

const certExceptions = new WeakMap(); // Session -> Set<key>

function hasCertException(ses, rawUrl, certificate) {
  const key = certExceptionKey(rawUrl, certificate);
  const set = ses && certExceptions.get(ses);
  return Boolean(key && set && set.has(key));
}

function addCertExceptionKey(ses, key) {
  if (!ses || typeof key !== 'string' || !key) return false;
  let set = certExceptions.get(ses);
  if (!set) { set = new Set(); certExceptions.set(ses, set); }
  set.add(key);
  return true;
}

// Что certificate-error увидел для главного фрейма вкладки: did-fail-load приходит следом и забирает это
const pendingCertErrors = new Map(); // webContents.id -> { origin, exceptionKey, fingerprint, at }
const CERT_INFO_TTL_MS = 30000;

function recordCertError(wc, rawUrl, certificate) {
  const now = Date.now();
  for (const [id, v] of pendingCertErrors) {
    if (now - v.at > CERT_INFO_TTL_MS) pendingCertErrors.delete(id);
  }
  let origin = '';
  try { origin = `https://${new URL(rawUrl).host}`; } catch { return; }
  pendingCertErrors.set(wc.id, {
    origin,
    exceptionKey: certExceptionKey(rawUrl, certificate), // null для обычных сайтов
    fingerprint: certificate && typeof certificate.fingerprint === 'string' ? certificate.fingerprint.slice(0, 256) : '',
    at: now
  });
}

// Забирает (и удаляет) сведения о сертификате для адреса, на котором упала загрузка
function takeCertError(wcId, failedUrl) {
  const info = pendingCertErrors.get(wcId);
  pendingCertErrors.delete(wcId);
  if (!info || Date.now() - info.at > CERT_INFO_TTL_MS) return null;
  try {
    if (`https://${new URL(failedUrl).host}` !== info.origin) return null;
  } catch {
    return null;
  }
  return info;
}

// Ошибки сертификата Chromium: -200…-299 (ERR_CERT_*)
function isCertErrorCode(code) {
  return Number.isInteger(code) && code <= -200 && code > -300;
}

// Обработчик certificate-error: по умолчанию отказ; разрешаем только вкладки браузера и только при разовом исключении
function registerCertificateErrorHandler(electronApp, isOwnedContents) {
  electronApp.on('certificate-error', (event, wc, url, _error, certificate, callback, isMainFrame) => {
    event.preventDefault(); // без этого Electron игнорирует callback(true)
    let allow = false;
    try {
      if (wc && !wc.isDestroyed() && isOwnedContents(wc)) {
        if (hasCertException(wc.session, url, certificate)) allow = true;
        else if (isMainFrame !== false) recordCertError(wc, url, certificate);
      }
    } catch {
      allow = false;
    }
    callback(allow);
  });
}

module.exports = {
  getPrivacyFlags,
  invalidatePrivacyCache,
  applyChromiumPrivacySwitches,
  getSite,
  isSameSiteHost,
  stripTrackingParams,
  isLocalDevHostname,
  addCertExceptionKey,
  takeCertError,
  isCertErrorCode,
  registerCertificateErrorHandler,
  cleanUserAgent,
  FIREFOX_UA,
  GOOGLE_FIREFOX_UA,
  isGoogleAuthUrl,
  addGoogleChromeBrand,
  listMediaPermissions,
  removeMediaPermission,
  getSitePermissionInfo,
  setSitePermission,
  setSitePermissionByName,
  resetSitePermissions,
  getSiteInfo,
  getMediaOrigin,
  SITE_PERMISSION_NAMES,
  configureSession,
  syncSearchEngineThemeCookies,
  isSafeNavigationUrl,
  isExternalProtocolUrl,
  isAppSchemeUrl,
  isBlockedAppSchemeTransition,
  confirmOpenExternal,
  isSafeFaviconUrl,
  formatDisplayUrl,
  resolveUserInput,
  attachWebContentsSecurity
};
