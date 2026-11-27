const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const {
  DEFAULT_SETTINGS,
  DEFAULT_NEWTAB_STATE,
  SEARCH_ENGINES,
  NEW_TAB_URL
} = require('./constants');

// ID тем из THEMES в renderer/pages/newtab.html
const ALLOWED_PRESETS = new Set([
  'cyber-blue',
  'nebula-violet',
  'obsidian-chrome',
  'crimson-eclipse',
  'aurora-emerald',
  'tokyo-synth',
  'sakura-midnight',
  'abyss-matrix',
  'solar-gold',
  'silver-cosmos',
  'arctic-glass',
  // старые ID: страница переводит их в новые через LEGACY_MAP, поэтому в уже сохранённых данных не сбрасываем
  'obsidian-mist',
  'shadow-monolith',
  'eclipse-noir',
  'abyss-aurora',
  'pure-carbon'
]);

const WALLPAPER_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

let dataDir = null;
let sessionSaveTimer = null;
let pendingSessionData = null;

function getDataDir() {
  if (!dataDir) {
    dataDir = path.join(app.getPath('userData'), 'browser-data');
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function getFilePath(filename) {
  return path.join(getDataDir(), filename);
}

function readJsonSafe(filename, fallback) {
  try {
    const raw = fs.readFileSync(getFilePath(filename), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Асинхронные записи: сериализуем данные в момент вызова (снимок), пишем в отдельный tmp, по одному файлу — по очереди.
// Поколение (gen) растёт при любой новой записи, в том числе синхронной: устаревшая запись, которая закончилась позже,
// не затирает более свежие данные. text — снимок, который ещё не попал на диск: при выходе его дописывает flushPendingWritesSync
const asyncWrites = new Map(); // filename -> { gen, chain, text }
function asyncState(filename) {
  let st = asyncWrites.get(filename);
  if (!st) { st = { gen: 0, chain: Promise.resolve(), text: null }; asyncWrites.set(filename, st); }
  return st;
}

function writeJsonAtomicAsync(filename, data) {
  let text;
  try { text = JSON.stringify(data, null, 2); } catch (err) {
    console.error(`[storage] Ошибка сериализации ${filename}:`, err.message);
    return Promise.resolve(false);
  }
  const st = asyncState(filename);
  const gen = ++st.gen;
  st.text = text;
  st.chain = st.chain.then(async () => {
    if (st.gen !== gen) return false; // уже есть более новая запись
    const target = getFilePath(filename);
    const tmp = `${target}.async.tmp`;
    try {
      await fs.promises.writeFile(tmp, text, 'utf8');
      if (st.gen !== gen) { await fs.promises.unlink(tmp).catch(() => {}); return false; }
      await fs.promises.rename(tmp, target);
      if (st.gen === gen) st.text = null;
      return true;
    } catch (err) {
      console.error(`[storage] Ошибка записи ${filename}:`, err.message);
      await fs.promises.unlink(tmp).catch(() => {});
      return false;
    }
  });
  return st.chain;
}

// Выход из приложения: всё, что ещё не дошло до диска, пишем синхронно
function flushPendingWritesSync() {
  for (const [filename, st] of asyncWrites) {
    if (st.text === null) continue;
    const text = st.text;
    st.gen++;
    st.text = null;
    try {
      const target = getFilePath(filename);
      const tmp = `${target}.tmp`;
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, target);
    } catch (err) {
      console.error(`[storage] Ошибка записи ${filename}:`, err.message);
    }
  }
}

function writeJsonAtomic(filename, data) {
  try {
    const st = asyncWrites.get(filename);
    if (st) { st.gen++; st.text = null; } // синхронная запись новее любой отложенной
    const target = getFilePath(filename);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    console.error(`[storage] Ошибка записи ${filename}:`, err.message);
    return false;
  }
}

const { sanitizeSeed } = require('./customTheme');
const { isSafeNavigationUrl, invalidatePrivacyCache } = require('./security');
const { PROXY_DEFAULTS, readProxySettings } = require('./proxy');

// Режимы экономии энергии: auto — только от батареи, on — всегда, off — никогда
const ENERGY_SAVER_MODES = ['auto', 'on', 'off'];

// Ссылки на новой вкладке: только http(s)
function isHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  try {
    const { protocol } = new URL(rawUrl.trim());
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function clampGeminiWidth(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 420;
  return Math.min(760, Math.max(320, n));
}

function sanitizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...PROXY_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['dark', 'light', 'system'].includes(merged.theme)) merged.theme = DEFAULT_SETTINGS.theme;
  if (!SEARCH_ENGINES[merged.searchEngine]) merged.searchEngine = DEFAULT_SETTINGS.searchEngine;
  if (typeof merged.sleepMinutes !== 'number' || !Number.isFinite(merged.sleepMinutes) || merged.sleepMinutes < 0) {
    merged.sleepMinutes = DEFAULT_SETTINGS.sleepMinutes;
  }
  merged.sleepMinutes = Math.min(240, Math.floor(merged.sleepMinutes));
  merged.restoreSession = Boolean(merged.restoreSession);
  if (!['cyber-blue', 'nebula-violet', 'obsidian-chrome', 'crimson-eclipse', 'aurora-emerald', 'tokyo-synth', 'sakura-midnight', 'solar-gold', 'silver-cosmos', 'aurora-voxel', 'topo-noir', 'katana-noir', 'custom'].includes(merged.chromeTheme)) {
    merged.chromeTheme = DEFAULT_SETTINGS.chromeTheme;
  }
  merged.customThemeSeed = sanitizeSeed(merged.customThemeSeed);
  if (merged.chromeTheme === 'custom' && !merged.customThemeSeed) merged.chromeTheme = DEFAULT_SETTINGS.chromeTheme;
  merged.transparentChrome = Boolean(merged.transparentChrome);
  merged.verticalTabs = Boolean(merged.verticalTabs); // вертикальные вкладки (сайдбар слева): по умолчанию выключено
  merged.verticalTabsCollapsed = Boolean(merged.verticalTabsCollapsed); // сайдбар свёрнут в узкую полоску с иконками
  // Ширина боковой панели Gemini (px); диапазон совпадает с GEMINI_MIN_WIDTH..GEMINI_MAX_WIDTH в geminiPanel.js
  merged.geminiPanelWidth = clampGeminiWidth(merged.geminiPanelWidth);
  merged.showBookmarksBar = Boolean(merged.showBookmarksBar); // панель закладок под тулбаром (Ctrl+Shift+B): по умолчанию выключена
  merged.trustedSources = merged.trustedSources !== undefined ? Boolean(merged.trustedSources) : true;
  merged.adblock = merged.adblock !== undefined ? Boolean(merged.adblock) : true;
  merged.prettySearch = merged.prettySearch !== undefined ? Boolean(merged.prettySearch) : true;
  merged.searchSuggest = merged.searchSuggest !== undefined ? Boolean(merged.searchSuggest) : true;
  merged.offerSavePasswords = merged.offerSavePasswords !== undefined ? Boolean(merged.offerSavePasswords) : true; // предлагать сохранять пароли: по умолчанию включено
  merged.httpsOnly = Boolean(merged.httpsOnly); // по умолчанию выключено
  merged.blockCamera = Boolean(merged.blockCamera);           // глобальный запрет камеры: по умолчанию выключен
  merged.blockMicrophone = Boolean(merged.blockMicrophone);   // глобальный запрет микрофона: по умолчанию выключен
  merged.blockGeolocation = Boolean(merged.blockGeolocation); // глобальный запрет геолокации: по умолчанию выключен
  merged.incognitoFingerprintProtection = Boolean(merged.incognitoFingerprintProtection); // защита от fingerprinting в Инкогнито: по умолчанию выключена
  merged.incognitoNewWindow = merged.incognitoNewWindow !== undefined ? Boolean(merged.incognitoNewWindow) : true; // Инкогнито в отдельном окне: по умолчанию включено
  if (typeof merged.homeUrl !== 'string' || !merged.homeUrl.trim() || !isSafeNavigationUrl(merged.homeUrl.trim())) {
    merged.homeUrl = NEW_TAB_URL;
  } else {
    merged.homeUrl = merged.homeUrl.trim();
  }
  if (!ENERGY_SAVER_MODES.includes(merged.energySaver)) merged.energySaver = 'auto';
  merged.adblockCosmetic = merged.adblockCosmetic !== undefined ? Boolean(merged.adblockCosmetic) : true;
  merged.blockThirdPartyCookies = Boolean(merged.blockThirdPartyCookies);
  merged.stripTrackingParams = merged.stripTrackingParams !== undefined ? Boolean(merged.stripTrackingParams) : true;

  const { DOH_MODES, DOH_PROVIDER_KEYS, DEFAULT_DOH_MODE, DEFAULT_DOH_PROVIDER, normalizeDohUrl } = require('./doh');
  if (!DOH_MODES.includes(merged.dohMode)) merged.dohMode = DEFAULT_DOH_MODE;
  if (!DOH_PROVIDER_KEYS.includes(merged.dohProvider)) merged.dohProvider = DEFAULT_DOH_PROVIDER;
  merged.dohCustomUrl = merged.dohCustomUrl ? (normalizeDohUrl(merged.dohCustomUrl) || '') : '';
  if (merged.dohProvider === 'custom' && !merged.dohCustomUrl) merged.dohProvider = DEFAULT_DOH_PROVIDER;
  Object.assign(merged, readProxySettings(merged)); // proxyMode, proxyProtocol, proxyHost, proxyPort, proxyBypassRules, proxyIncognitoOnly
  return merged;
}

function loadSettings() {
  return sanitizeSettings(readJsonSafe('settings.json', null));
}

function saveSettings(settings) {
  const clean = sanitizeSettings(settings);
  writeJsonAtomic('settings.json', clean);
  try { invalidatePrivacyCache(); } catch { /* кэш флагов сети обновится сам через 2 с */ }
  return clean;
}

function loadSession() {
  const data = readJsonSafe('session.json', null);
  if (!data || typeof data !== 'object') return null;
  return data;
}

function scheduleSaveSession(sessionData) {
  pendingSessionData = sessionData;
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    if (pendingSessionData) {
      writeJsonAtomicAsync('session.json', pendingSessionData);
      pendingSessionData = null;
    }
  }, 600);
}

function saveSessionSync(sessionData) {
  flushPendingWritesSync();
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
  }
  const toSave = sessionData || pendingSessionData;
  pendingSessionData = null;
  if (toSave) {
    writeJsonAtomic('session.json', toSave);
  }
}

// ---- Рабочие пространства (общие для всех окон, файл workspaces.json) ----
const DEFAULT_WORKSPACE_ID = 'main';
const WORKSPACE_COLORS = ['#4f9dff', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#f87171', '#22d3ee', '#94a3b8'];
const WORKSPACE_MAX = 12;
const WORKSPACE_NAME_MAX = 24;
let workspacesCache = null;

function defaultWorkspaces() {
  return [
    { id: DEFAULT_WORKSPACE_ID, name: 'Основное', color: WORKSPACE_COLORS[0] },
    { id: 'work', name: 'Работа', color: WORKSPACE_COLORS[2] },
    { id: 'study', name: 'Учёба', color: WORKSPACE_COLORS[1] },
    { id: 'rest', name: 'Отдых', color: WORKSPACE_COLORS[3] }
  ];
}

function cleanWorkspaceName(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, WORKSPACE_NAME_MAX);
}

function cleanWorkspaceColor(v, fallback) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
}

function sanitizeWorkspaces(raw) {
  const out = [];
  const seen = new Set();
  for (const w of Array.isArray(raw) ? raw : []) {
    if (!w || typeof w !== 'object') continue;
    const id = typeof w.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(w.id) ? w.id : null;
    const name = cleanWorkspaceName(w.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name, color: cleanWorkspaceColor(w.color, WORKSPACE_COLORS[0]) });
  }
  if (!seen.has(DEFAULT_WORKSPACE_ID)) out.unshift(defaultWorkspaces()[0]); // «Основное» есть всегда
  return out.slice(0, WORKSPACE_MAX);
}

function getWorkspaces() {
  if (!workspacesCache) {
    const raw = readJsonSafe('workspaces.json', null);
    workspacesCache = Array.isArray(raw) ? sanitizeWorkspaces(raw) : defaultWorkspaces();
  }
  return workspacesCache.map((w) => ({ ...w }));
}

function saveWorkspaces(list) {
  workspacesCache = sanitizeWorkspaces(list);
  writeJsonAtomic('workspaces.json', workspacesCache);
}

// Неизвестный/удалённый id (в т.ч. из старой session.json без workspaceId) -> «Основное»
function normalizeWorkspaceId(id) {
  return getWorkspaces().some((w) => w.id === id) ? id : DEFAULT_WORKSPACE_ID;
}

function createWorkspace(name, color) {
  const list = getWorkspaces();
  const clean = cleanWorkspaceName(name);
  if (!clean || list.length >= WORKSPACE_MAX) return null;
  const ws = {
    id: `ws-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: clean,
    color: cleanWorkspaceColor(color, WORKSPACE_COLORS[list.length % WORKSPACE_COLORS.length])
  };
  saveWorkspaces([...list, ws]);
  return ws;
}

function updateWorkspace(id, patch) {
  const list = getWorkspaces();
  const ws = list.find((w) => w.id === id);
  if (!ws || !patch || typeof patch !== 'object') return null;
  if (patch.name !== undefined) {
    const n = cleanWorkspaceName(patch.name);
    if (n) ws.name = n;
  }
  if (patch.color !== undefined) ws.color = cleanWorkspaceColor(patch.color, ws.color);
  saveWorkspaces(list);
  return ws;
}

function deleteWorkspace(id) {
  if (id === DEFAULT_WORKSPACE_ID) return false;
  const list = getWorkspaces();
  if (!list.some((w) => w.id === id)) return false;
  saveWorkspaces(list.filter((w) => w.id !== id));
  return true;
}

function sanitizeNewTabState(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const widgetsRaw = base.widgets && typeof base.widgets === 'object' ? base.widgets : {};

  const links = Array.isArray(base.links)
    ? base.links
        .filter(item => item && typeof item.title === 'string' && typeof item.url === 'string' && isHttpUrl(item.url))
        .slice(0, 20)
        .map((item, i) => ({
          id: typeof item.id === 'string' && item.id ? item.id.slice(0, 32) : `l_${i}`,
          title: item.title.trim().slice(0, 40) || 'Сайт',
          url: item.url.trim().slice(0, 1024),
          color: typeof item.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(item.color) ? item.color : '#a5b4fc'
        }))
    : DEFAULT_NEWTAB_STATE.links.map(l => ({ ...l }));

  const todos = Array.isArray(base.todos)
    ? base.todos
        .filter(item => item && typeof item.text === 'string' && item.text.trim())
        .slice(0, 50)
        .map((item, i) => ({
          id: typeof item.id === 'string' && item.id ? item.id.slice(0, 32) : `t_${i}`,
          text: item.text.trim().slice(0, 160),
          done: Boolean(item.done)
        }))
    : DEFAULT_NEWTAB_STATE.todos.map(t => ({ ...t }));

  const customFile =
    typeof base.customWallpaperFile === 'string' &&
    /^custom-wallpaper(-\d+)?\.(jpg|jpeg|png|webp|gif|mp4|webm)$/i.test(base.customWallpaperFile) &&
    fs.existsSync(getFilePath(base.customWallpaperFile))
      ? base.customWallpaperFile
      : null;

  const wallpaperType = base.wallpaperType === 'custom' && customFile ? 'custom' : 'preset';
  const wallpaperPreset = ALLOWED_PRESETS.has(base.wallpaperPreset)
    ? base.wallpaperPreset
    : DEFAULT_NEWTAB_STATE.wallpaperPreset;

  return {
    wallpaperType,
    wallpaperPreset,
    customWallpaperFile: customFile,
    wallpaperVersion: Number(base.wallpaperVersion) || 1,
    dim: Math.min(80, Math.max(0, Number.isFinite(Number(base.dim)) ? Number(base.dim) : DEFAULT_NEWTAB_STATE.dim)),
    blur: Math.min(18, Math.max(0, Number.isFinite(Number(base.blur)) ? Number(base.blur) : DEFAULT_NEWTAB_STATE.blur)),
    widgets: {
      clock: widgetsRaw.clock !== undefined ? Boolean(widgetsRaw.clock) : true,
      links: widgetsRaw.links !== undefined ? Boolean(widgetsRaw.links) : true,
      search: widgetsRaw.search !== undefined ? Boolean(widgetsRaw.search) : true,
      todo: widgetsRaw.todo !== undefined ? Boolean(widgetsRaw.todo) : true
    },
    links,
    todos
  };
}

function loadNewTabState() {
  return sanitizeNewTabState(readJsonSafe('newtab.json', null));
}

// Чистое слияние состояния новой вкладки с патчем (без записи на диск)
function mergeNewTabState(current, patch) {
  const merged = {
    ...current,
    ...(patch && typeof patch === 'object' ? patch : {}),
    widgets: {
      ...current.widgets,
      ...(patch?.widgets && typeof patch.widgets === 'object' ? patch.widgets : {})
    }
  };
  return sanitizeNewTabState(merged);
}

function saveNewTabState(patch) {
  const clean = mergeNewTabState(loadNewTabState(), patch);
  writeJsonAtomic('newtab.json', clean);
  return clean;
}

// Удаляем старые файлы обоев (кроме keep). Файл, который сейчас проигрывается, на Windows
// удалить нельзя — тогда просто пропускаем, он уберётся при следующем запуске/смене обоев.
function removeOldWallpapers(keep) {
  let names = [];
  try {
    names = fs.readdirSync(path.dirname(getFilePath('custom-wallpaper.tmp')));
  } catch {
    return;
  }
  for (const name of names) {
    if (name === keep || !/^custom-wallpaper(-\d+)?\.[a-z0-9]+$/i.test(name)) continue;
    try {
      fs.unlinkSync(getFilePath(name));
    } catch {
      // файл занят — уберём позже
    }
  }
}

async function saveCustomWallpaper(sourcePath) {
  if (typeof sourcePath !== 'string') return null;
  const ext = path.extname(sourcePath).toLowerCase();
  if (!WALLPAPER_MIME[ext]) return null;

  // Любая ошибка ФС (файл исчез, нет доступа, нет места на диске) не должна ронять обработчик IPC: возвращаем null
  let fileName = null;
  try {
    const stat = await fs.promises.stat(sourcePath);
    const isVideo = ext === '.mp4' || ext === '.webm';
    const maxBytes = (isVideo ? 80 : 15) * 1024 * 1024;
    if (!stat.isFile() || stat.size > maxBytes) return null;

    // Каждый раз новое имя: старый файл может быть открыт плеером (на Windows его нельзя перезаписать — EPERM)
    fileName = `custom-wallpaper-${Date.now()}${ext}`;
    await fs.promises.copyFile(sourcePath, getFilePath(fileName)); // до 80 МБ: синхронная копия подвешивала бы весь main

    const saved = saveNewTabState({
      wallpaperType: 'custom',
      customWallpaperFile: fileName,
      wallpaperVersion: Date.now()
    });
    // Старые обои убираем только после успешного сохранения состояния
    removeOldWallpapers(fileName);
    return saved;
  } catch (err) {
    console.warn('[storage] Не удалось сохранить свои обои:', err && err.message);
    if (fileName) {
      await fs.promises.unlink(getFilePath(fileName)).catch(() => { /* файла нет или он занят */ });
    }
    return null;
  }
}

function clearCustomWallpaper() {
  removeOldWallpapers(null);
  return saveNewTabState({
    wallpaperType: 'preset',
    customWallpaperFile: null,
    wallpaperVersion: Date.now()
  });
}

function getCustomWallpaper() {
  const state = loadNewTabState();
  if (!state.customWallpaperFile) return null;
  const fullPath = getFilePath(state.customWallpaperFile);
  if (!fs.existsSync(fullPath)) return null;
  const ext = path.extname(state.customWallpaperFile).toLowerCase();
  return {
    filePath: fullPath,
    mime: WALLPAPER_MIME[ext] || 'image/jpeg'
  };
}

// ---------- История посещений ----------
const HISTORY_MAX = 3000;
const HISTORY_SAVE_DELAY_MS = 800;

let historyMap = null; // Map<url, entry>; порядок вставки = от старых к новым
let historySaveTimer = null;

function loadHistoryMap() {
  if (historyMap) return historyMap;
  historyMap = new Map();
  const raw = readJsonSafe('history.json', []);
  const list = Array.isArray(raw) ? raw : [];
  const clean = [];
  for (const item of list) {
    if (!item || !isHttpUrl(item.url)) continue;
    clean.push({
      url: item.url.slice(0, 2048),
      title: typeof item.title === 'string' ? item.title.slice(0, 300) : '',
      visitCount: Math.max(1, Math.floor(Number(item.visitCount)) || 1),
      lastVisitedAt: Number(item.lastVisitedAt) || 0
    });
  }
  clean.sort((a, b) => a.lastVisitedAt - b.lastVisitedAt);
  for (const entry of clean.slice(-HISTORY_MAX)) historyMap.set(entry.url, entry);
  return historyMap;
}

function writeHistoryNow({ async: useAsync = false } = {}) {
  if (historySaveTimer) {
    clearTimeout(historySaveTimer);
    historySaveTimer = null;
  }
  if (!historyMap) return;
  // На диске — от новых к старым
  const list = Array.from(historyMap.values()).reverse();
  if (useAsync) writeJsonAtomicAsync('history.json', list);
  else writeJsonAtomic('history.json', list);
}

function scheduleSaveHistory() {
  if (historySaveTimer) clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(() => {
    historySaveTimer = null;
    writeHistoryNow({ async: true });
  }, HISTORY_SAVE_DELAY_MS);
}

// Вызывать при выходе из приложения, чтобы не потерять отложенную запись
function flushHistorySync() {
  flushPendingWritesSync(); // всё, что уже ушло в асинхронную запись, но не дописано (сессия, Студия, закладки, загрузки)
  if (historySaveTimer) writeHistoryNow();
}

function recordVisit(url, title) {
  if (!isHttpUrl(url)) return;
  const map = loadHistoryMap();
  const key = url.slice(0, 2048);
  const prev = map.get(key);
  const newTitle = typeof title === 'string' ? title.trim().slice(0, 300) : '';
  const entry = prev || { url: key, title: '', visitCount: 0, lastVisitedAt: 0 };
  if (newTitle) entry.title = newTitle;
  entry.visitCount++;
  entry.lastVisitedAt = Date.now();
  map.delete(key); // переносим в конец (самая свежая)
  map.set(key, entry);
  while (map.size > HISTORY_MAX) map.delete(map.keys().next().value);
  scheduleSaveHistory();
}

// Обновление заголовка уже записанного url (visitCount не меняется)
function updateHistoryTitle(url, title) {
  if (!isHttpUrl(url) || typeof title !== 'string') return;
  const entry = loadHistoryMap().get(url.slice(0, 2048));
  const newTitle = title.trim().slice(0, 300);
  if (!entry || !newTitle || entry.title === newTitle) return;
  entry.title = newTitle;
  scheduleSaveHistory();
}

function searchHistory(query, limit = 6) {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!q) return [];
  const tokens = q.split(/\s+/);
  const scored = [];
  for (const entry of loadHistoryMap().values()) {
    const url = entry.url.toLowerCase();
    const title = entry.title.toLowerCase();
    const host = url.replace(/^https?:\/\/(www\.)?/, '');
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      let s = 0;
      if (host.startsWith(t)) s = 100;
      else if (title.startsWith(t)) s = 80;
      else if (title.includes(` ${t}`)) s = 50;
      else if (title.includes(t)) s = 30;
      else if (url.includes(t)) s = 20;
      if (!s) { ok = false; break; }
      score += s;
    }
    if (ok) scored.push({ entry, score });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    b.entry.visitCount - a.entry.visitCount ||
    b.entry.lastVisitedAt - a.entry.lastVisitedAt
  );
  const n = Math.max(0, Math.floor(Number(limit)) || 0);
  return scored.slice(0, n).map(s => ({ ...s.entry }));
}

function getHistory(limit = 200) {
  const n = Math.max(0, Math.floor(Number(limit)) || 0);
  return Array.from(loadHistoryMap().values()).reverse().slice(0, n).map(e => ({ ...e }));
}

function clearHistory() {
  loadHistoryMap().clear();
  writeHistoryNow();
}

// Удаление одной записи (страница browser://history). Пишем на диск сразу: удалённое не должно «вернуться» после сбоя
function removeHistoryEntry(url) {
  if (typeof url !== 'string' || !url) return false;
  const removed = loadHistoryMap().delete(url.slice(0, 2048));
  if (removed) writeHistoryNow();
  return removed;
}

// Удаляет записи, чьё последнее посещение не раньше sinceMs (0 = всё). Возвращает число удалённых.
// В истории одна запись на URL (со временем последнего визита), поэтому запись удаляется целиком
function clearHistorySince(sinceMs) {
  const since = Number(sinceMs);
  if (!Number.isFinite(since) || since < 0) return 0;
  const map = loadHistoryMap();
  let removed = 0;
  for (const [url, entry] of map) {
    if (entry.lastVisitedAt >= since) {
      map.delete(url); // удаление текущего ключа во время обхода Map безопасно
      removed++;
    }
  }
  if (removed) writeHistoryNow();
  return removed;
}

// ---------- Студия тем и папки закладок Новой вкладки ----------
// Раньше жили в localStorage страницы browser://newtab, и очистка «Cookies и данные сайтов» их стирала.
// Теперь — постоянный файл newtab-studio.json. Данные проверяются здесь, а не доверяются renderer'у.
const STUDIO_FILE = 'newtab-studio.json';
const STUDIO_ID_RE = /^[a-z0-9_-]{1,64}$/i;
const STUDIO_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const STUDIO_MAX_FOLDERS = 12;
const STUDIO_MAX_GROUPS = 100;
const STUDIO_MAX_LINKS = 500;

const finiteNum = (v) => typeof v === 'number' && Number.isFinite(v);
const nullable = (check) => (v) => (v === null ? null : check(v));
const studioId = (v) => (typeof v === 'string' && STUDIO_ID_RE.test(v) ? v : undefined);
const studioColor = (v) => (typeof v === 'string' && STUDIO_COLOR_RE.test(v) ? v : undefined);
const studioBool = (v) => (typeof v === 'boolean' ? v : undefined);

// Валидатор возвращает очищенное значение либо undefined (ключ отбрасывается)
const STUDIO_PREF_VALIDATORS = {
  themeId: nullable(studioId),
  accentId: studioId,
  autoAccentFor: (v) => (finiteNum(v) ? v : undefined),
  wallSeed: nullable((v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    for (const k of ['h', 's', 'l', 'top', 'ah', 'as']) {
      if (finiteNum(v[k])) out[k] = v[k];
    }
    if (!finiteNum(out.h) || !finiteNum(out.s) || !finiteNum(out.l)) return undefined;
    out.neutral = Boolean(v.neutral);
    const base = studioId(v.base);
    if (base) out.base = base;
    return out;
  }),
  customAccent: nullable(studioColor),
  cardColor: nullable(studioColor),
  clockColor: nullable(studioColor),
  textMode: (v) => (['auto', 'lightText', 'darkText'].includes(v) ? v : undefined),
  animateBg: studioBool,
  parallax: studioBool,
  linksLayout: (v) => (v === 'grid' || v === 'list' ? v : undefined),
  glassAlpha: (v) => (finiteNum(v) ? Math.min(100, Math.max(0, v)) : undefined),
  hudBlur: studioBool,
  hudBorder: studioBool,
  showWeather: studioBool,
  showSideDock: studioBool,
  showSavedBm: studioBool,
  weatherPlace: nullable((v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    if (typeof v.name !== 'string' || !v.name.trim()) return undefined;
    if (!finiteNum(v.lat) || !finiteNum(v.lon) || Math.abs(v.lat) > 90 || Math.abs(v.lon) > 180) return undefined;
    return { name: v.name.trim().slice(0, 120), lat: v.lat, lon: v.lon };
  }),
  showSeconds: studioBool,
  showGreeting: studioBool
};

// Частичный объект: только известные ключи с валидными значениями (остальное добавит renderer из DEFAULT_PREFS)
function sanitizeStudioPrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, validate] of Object.entries(STUDIO_PREF_VALIDATORS)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const value = validate(raw[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function studioUid() {
  return `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Дерево закладок Новой вкладки: { active, folders: [{ id, name, groups: [{ id, title, links: [{ id, title, url }] }] }] }
function sanitizeStudioBookmarks(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.folders)) return null;
  const idOf = (v) => (typeof v === 'string' && STUDIO_ID_RE.test(v.trim()) ? v.trim() : studioUid());
  const text = (v, max, fallback) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);

  const folders = raw.folders.slice(0, STUDIO_MAX_FOLDERS).filter((f) => f && typeof f === 'object').map((f) => ({
    id: idOf(f.id),
    name: text(f.name, 24, 'Папка'),
    groups: (Array.isArray(f.groups) ? f.groups : []).slice(0, STUDIO_MAX_GROUPS).filter((g) => g && typeof g === 'object').map((g) => ({
      id: idOf(g.id),
      title: text(g.title, 32, 'Группа'),
      links: (Array.isArray(g.links) ? g.links : [])
        .filter((l) => l && typeof l === 'object' && isHttpUrl(l.url) && l.url.length <= 2048)
        .slice(0, STUDIO_MAX_LINKS)
        .map((l) => ({ id: idOf(l.id), title: text(l.title, 40, 'Сайт'), url: l.url.trim() }))
    }))
  }));
  const active = typeof raw.active === 'string' && (raw.active === 'home' || folders.some((f) => f.id === raw.active))
    ? raw.active
    : 'home';
  return { active, folders };
}

let studioCache = null; // { migrated, prefs, bm } — источник правды в памяти; на диск пишется с задержкой
let studioTimer = null;

function loadStudioData() {
  if (studioCache) return studioCache;
  const raw = readJsonSafe(STUDIO_FILE, null);
  studioCache = {
    migrated: Boolean(raw && raw.migrated === true),
    prefs: sanitizeStudioPrefs(raw && raw.prefs),
    bm: sanitizeStudioBookmarks(raw && raw.bm)
  };
  return studioCache;
}

function writeStudioNow({ async: useAsync = false } = {}) {
  if (studioTimer) {
    clearTimeout(studioTimer);
    studioTimer = null;
  }
  if (!studioCache) return false;
  const payload = { version: 1, ...studioCache };
  if (useAsync) { writeJsonAtomicAsync(STUDIO_FILE, payload); return true; }
  return writeJsonAtomic(STUDIO_FILE, payload);
}

// Ползунки и палитры шлют десятки изменений в секунду — склеиваем их в одну запись
function scheduleStudioWrite() {
  if (studioTimer) clearTimeout(studioTimer);
  studioTimer = setTimeout(() => writeStudioNow({ async: true }), 300);
}

function flushStudioSync() {
  if (studioTimer) writeStudioNow();
  flushBookmarksSync(); // дерево закладок пишется отложенно так же, как Студия
}

// Копия для отдачи наружу (renderer и инкогнито-слой не должны менять кэш по ссылке)
function getStudio() {
  loadBmStore(); // дерево закладок главнее: подтягиваем актуальные папки Новой вкладки
  const d = loadStudioData();
  return JSON.parse(JSON.stringify({ migrated: d.migrated, prefs: d.prefs, bm: d.bm }));
}

// Чистое слияние (для Инкогнито — без записи на диск)
function mergeStudioPrefs(current, patch) {
  return { ...sanitizeStudioPrefs(current), ...sanitizeStudioPrefs(patch) };
}

function saveStudioPrefs(patch) {
  const d = loadStudioData();
  d.prefs = mergeStudioPrefs(d.prefs, patch);
  scheduleStudioWrite();
  return getStudio();
}

function saveStudioBookmarks(tree) {
  const clean = sanitizeStudioBookmarks(tree);
  if (!clean) return getStudio();
  const d = loadStudioData();
  loadBmStore();
  d.bm = clean;
  scheduleStudioWrite();
  bmSyncFromStudio(clean); // зеркалим папки/группы/ссылки в единое дерево
  bmCommit();
  return getStudio();
}

// Одноразовый перенос из localStorage. Уже перенесённое повторно не трогаем; пишем сразу и синхронно,
// чтобы после подтверждения renderer мог безопасно удалить старые ключи
function migrateStudio(legacy) {
  const d = loadStudioData();
  if (d.migrated) return getStudio();
  const src = legacy && typeof legacy === 'object' ? legacy : {};
  const before = { prefs: d.prefs, bm: d.bm };
  d.prefs = { ...sanitizeStudioPrefs(src.prefs), ...d.prefs };
  d.bm = d.bm || sanitizeStudioBookmarks(src.bm);
  d.migrated = true;
  // Метку «перенесено» оставляем, только если файл реально записан: после неё renderer удаляет старые
  // ключи localStorage. Не записалось (диск полон, нет прав) — откатываем, при следующем открытии повторим
  if (!writeStudioNow()) {
    d.migrated = false;
    d.prefs = before.prefs;
    d.bm = before.bm;
  } else if (d.bm) {
    loadBmStore();
    bmSyncFromStudio(d.bm);
    bmCommit();
  }
  return getStudio();
}

// ---------- Закладки: единое дерево (папки + ссылки) ----------
// Узел: { id, type: 'folder'|'bookmark', title, url, parentId (null = корень), order, createdAt }.
// Источник правды — bookmarks-tree.json. Плоский bookmarks.json остаётся зеркалом (новые сверху) для совместимости.
// Папки и группы Новой вкладки (newtab-studio.json) живут в том же дереве под системной папкой nt_root:
//   nt_root → папки (вкладки-«пилюли») → группы → ссылки. Такая форма гарантирует обмен без потерь в обе стороны.
const BM_TREE_FILE = 'bookmarks-tree.json';
const BM_LEGACY_FILE = 'bookmarks.json';
const BM_MAX_NODES = 10000;
const BM_MAX_DEPTH = 8; // максимум предков у узла
const BM_TITLE_MAX = 300;
const BM_FOLDER_MAX = 120;
const BM_WRITE_DELAY_MS = 250;
const NT_ROOT_ID = 'nt_root';
const NT_LIMITS = [STUDIO_MAX_FOLDERS, STUDIO_MAX_GROUPS, STUDIO_MAX_LINKS]; // для детей узла уровня 0 / 1 / 2

// Ключ закладки: адрес со слешем в конце и без него — одна и та же закладка
// (https://site.com, https://site.com/ и https://site.com/page/ ≡ https://site.com/page)
function normalizeBookmarkUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  try {
    const u = new URL(trimmed);
    const pathname = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${pathname}${u.search}${u.hash}`.slice(0, 2048);
  } catch {
    return trimmed.replace(/\/+$/, '').slice(0, 2048);
  }
}

let bmNodes = null; // Map<id, node>
let bmIdx = null; // { kids: Map<parentId|'', node[]>, urls: Map<url, id>|null }
let bmRev = 1;
let bmWriteTimer = null;

const bmText = (v, max, fallback = '') =>
  typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : fallback;

function bmMakeId(taken) {
  let id;
  do {
    id = `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(id));
  return id;
}

function bmDirty() { bmIdx = null; }

function bmIndex() {
  if (bmIdx) return bmIdx;
  const kids = new Map();
  for (const n of loadBmStore().values()) {
    const k = n.parentId === null ? '' : n.parentId;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(n);
  }
  for (const list of kids.values()) list.sort((a, b) => a.order - b.order);
  bmIdx = { kids, urls: null };
  return bmIdx;
}

function bmChildren(parentId) {
  return bmIndex().kids.get(parentId === null ? '' : parentId) || [];
}

function bmWalk(parentId, visit, inNt = false) {
  for (const n of bmChildren(parentId)) {
    const nt = inNt || n.id === NT_ROOT_ID;
    visit(n, inNt);
    if (n.type === 'folder') bmWalk(n.id, visit, nt);
  }
}

function bmDescendants(id) {
  const out = [];
  bmWalk(id, (n) => out.push(n));
  return out;
}

// Закладки вне Новой вкладки: адрес → id (уникальны, как и раньше)
function bmUrls() {
  const idx = bmIndex();
  if (idx.urls) return idx.urls;
  const urls = new Map();
  bmWalk(null, (n, inNt) => {
    if (n.type === 'bookmark' && !inNt && !urls.has(n.url)) urls.set(n.url, n.id);
  });
  idx.urls = urls;
  return urls;
}

// Уровень внутри Новой вкладки: nt_root = 0, папка = 1, группа = 2, ссылка = 3; -1 — вне её
function bmNtLevel(id) {
  let lvl = 0;
  let cur = bmNodes.get(id);
  while (cur) {
    if (cur.id === NT_ROOT_ID) return lvl;
    lvl++;
    cur = cur.parentId === null ? null : bmNodes.get(cur.parentId);
  }
  return -1;
}

function bmLevel(id) {
  let d = 0;
  let cur = bmNodes.get(id);
  while (cur && cur.parentId !== null) { d++; cur = bmNodes.get(cur.parentId); }
  return d;
}

function bmHeight(id) {
  let h = 0;
  for (const c of bmChildren(id)) if (c.type === 'folder') h = Math.max(h, 1 + bmHeight(c.id));
  return h;
}

function bmFolderPath(id) {
  const names = [];
  let cur = id === null ? null : bmNodes.get(id);
  while (cur) {
    names.unshift(cur.title);
    cur = cur.parentId === null ? null : bmNodes.get(cur.parentId);
  }
  return names;
}

const bmPublic = (n) => ({
  id: n.id,
  type: n.type,
  title: n.title,
  url: n.type === 'bookmark' ? n.url : '',
  parentId: n.parentId,
  order: n.order,
  createdAt: n.createdAt,
  ...(n.id === NT_ROOT_ID ? { system: true } : {})
});

function bmSnapshot() {
  const out = [];
  bmWalk(null, (n) => out.push(bmPublic(n)));
  return out;
}

function sanitizeBmNodes(raw) {
  const map = new Map();
  const now = Date.now();
  for (const it of Array.isArray(raw) ? raw : []) {
    if (!it || typeof it !== 'object' || map.size >= BM_MAX_NODES) continue;
    const isFolder = it.type === 'folder';
    if (!isFolder && !(it.type === 'bookmark' && isHttpUrl(it.url))) continue;
    let id = typeof it.id === 'string' && STUDIO_ID_RE.test(it.id) && !map.has(it.id) ? it.id : bmMakeId(map);
    const node = {
      id,
      type: isFolder ? 'folder' : 'bookmark',
      title: isFolder ? bmText(it.title, BM_FOLDER_MAX, 'Папка') : bmText(it.title, BM_TITLE_MAX),
      url: isFolder ? '' : normalizeBookmarkUrl(it.url),
      parentId: typeof it.parentId === 'string' ? it.parentId : null,
      order: Number.isFinite(Number(it.order)) ? Number(it.order) : 0,
      createdAt: Number(it.createdAt) || 0
    };
    if (!isFolder && !node.url) continue;
    if (id === NT_ROOT_ID) {
      if (!isFolder) { node.id = id = bmMakeId(map); } else { node.title = 'Новая вкладка'; node.parentId = null; }
    }
    map.set(id, node);
  }
  // Родитель должен существовать и быть папкой; циклы и слишком глубокую вложенность разрываем
  for (const n of map.values()) {
    const p = n.parentId === null ? null : map.get(n.parentId);
    if (n.parentId !== null && (!p || p.type !== 'folder' || p.id === n.id)) n.parentId = null;
  }
  const depthOf = (n) => {
    let d = 0;
    let cur = n;
    while (cur && cur.parentId !== null) {
      d++;
      if (d > BM_MAX_DEPTH) return Infinity;
      cur = map.get(cur.parentId);
    }
    return d;
  };
  for (const n of map.values()) if (depthOf(n) > BM_MAX_DEPTH) n.parentId = null;
  // Порядок внутри каждой папки — 0..n-1
  const groups = new Map();
  for (const n of map.values()) {
    const k = n.parentId === null ? '' : n.parentId;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(n);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.order - b.order || b.createdAt - a.createdAt);
    list.forEach((n, i) => { n.order = i; });
  }
  return map;
}

function bmEnsureNtRoot() {
  let root = bmNodes.get(NT_ROOT_ID);
  if (!root) {
    root = { id: NT_ROOT_ID, type: 'folder', title: 'Новая вкладка', url: '', parentId: null, order: bmChildren(null).length, createdAt: Date.now() };
    bmNodes.set(NT_ROOT_ID, root);
    bmDirty();
  }
  return root;
}

// Ссылки/группы/папки Новой вкладки (формат Студии) → узлы дерева под nt_root. Прежних потомков заменяем целиком
function bmSyncFromStudio(studioBm) {
  loadBmStore();
  bmEnsureNtRoot();
  const oldMeta = new Map();
  for (const n of bmDescendants(NT_ROOT_ID)) { oldMeta.set(n.id, n.createdAt); bmNodes.delete(n.id); }
  bmDirty();
  const now = Date.now();
  const put = (type, srcId, title, url, parentId, order) => {
    if (bmNodes.size >= BM_MAX_NODES) return null;
    const id = typeof srcId === 'string' && STUDIO_ID_RE.test(srcId) && !bmNodes.has(srcId) ? srcId : bmMakeId(bmNodes);
    const node = { id, type, title, url, parentId, order, createdAt: oldMeta.get(id) || now };
    bmNodes.set(id, node);
    return node;
  };
  const folders = studioBm && Array.isArray(studioBm.folders) ? studioBm.folders : [];
  folders.forEach((f, fi) => {
    const fn = put('folder', f.id, bmText(f.name, BM_FOLDER_MAX, 'Папка'), '', NT_ROOT_ID, fi);
    if (!fn) return;
    (f.groups || []).forEach((g, gi) => {
      const gn = put('folder', g.id, bmText(g.title, BM_FOLDER_MAX, 'Группа'), '', fn.id, gi);
      if (!gn) return;
      (g.links || []).forEach((l, li) => {
        if (isHttpUrl(l.url)) put('bookmark', l.id, bmText(l.title, BM_TITLE_MAX), normalizeBookmarkUrl(l.url), gn.id, li);
      });
    });
  });
  bmDirty();
}

// Дерево под nt_root → формат Студии: { active, folders: [{ id, name, groups: [{ id, title, links }] }] }
function studioFromTree(active) {
  const folders = [];
  for (const f of bmChildren(NT_ROOT_ID).filter((c) => c.type === 'folder').slice(0, STUDIO_MAX_FOLDERS)) {
    const groups = [];
    for (const g of bmChildren(f.id).filter((c) => c.type === 'folder').slice(0, STUDIO_MAX_GROUPS)) {
      const links = bmChildren(g.id)
        .filter((c) => c.type === 'bookmark')
        .slice(0, STUDIO_MAX_LINKS)
        .map((c) => ({ id: c.id, title: bmText(c.title, 40, 'Сайт'), url: c.url }));
      groups.push({ id: g.id, title: bmText(g.title, 32, 'Группа'), links });
    }
    folders.push({ id: f.id, name: bmText(f.title, 24, 'Папка'), groups });
  }
  return { active: active === 'home' || folders.some((f) => f.id === active) ? active : 'home', folders };
}

// Дерево — источник правды для Студии. Возвращает true, если файл студии пришлось обновить
function bmReconcileStudio() {
  if (!bmNodes.has(NT_ROOT_ID)) return false;
  const d = loadStudioData();
  const derived = studioFromTree(d.bm ? d.bm.active : 'home');
  if (d.bm && JSON.stringify(d.bm) === JSON.stringify(derived)) return false;
  d.bm = derived;
  scheduleStudioWrite();
  return true;
}

function loadBmStore() {
  if (bmNodes) return bmNodes;
  const raw = readJsonSafe(BM_TREE_FILE, null);
  let changed = false;
  if (raw && typeof raw === 'object' && Array.isArray(raw.nodes)) {
    bmNodes = sanitizeBmNodes(raw.nodes);
  } else {
    // Первый запуск: переносим плоский bookmarks.json (новые сверху) в корень дерева, дубли сливаем
    bmNodes = new Map();
    const seen = new Set();
    let order = 0;
    const legacy = readJsonSafe(BM_LEGACY_FILE, []);
    for (const item of Array.isArray(legacy) ? legacy : []) {
      if (!item || !isHttpUrl(item.url)) continue;
      const url = normalizeBookmarkUrl(item.url);
      if (!url || seen.has(url) || bmNodes.size >= BM_MAX_NODES) continue;
      seen.add(url);
      const id = typeof item.id === 'string' && STUDIO_ID_RE.test(item.id) && !bmNodes.has(item.id) ? item.id : bmMakeId(bmNodes);
      bmNodes.set(id, {
        id, type: 'bookmark', title: bmText(item.title, BM_TITLE_MAX), url,
        parentId: null, order: order++, createdAt: Number(item.createdAt) || 0
      });
    }
    changed = true;
  }
  bmDirty();
  // Согласуем с Новой вкладкой: если в дереве есть nt_root — оно главнее, иначе подтягиваем папки Студии в дерево
  const d = loadStudioData();
  if (bmNodes.has(NT_ROOT_ID)) {
    bmReconcileStudio();
  } else if (d.bm && d.bm.folders.length) {
    bmSyncFromStudio(d.bm);
    changed = true;
  }
  if (changed) scheduleBmWrite();
  return bmNodes;
}

function writeBmNow({ async: useAsync = false } = {}) {
  if (bmWriteTimer) {
    clearTimeout(bmWriteTimer);
    bmWriteTimer = null;
  }
  if (!bmNodes) return false;
  const write = useAsync ? writeJsonAtomicAsync : writeJsonAtomic;
  const ok = write(BM_TREE_FILE, { version: 2, nodes: bmSnapshot() });
  // Зеркало для совместимости: только «обычные» закладки, новые сверху
  write(BM_LEGACY_FILE, bmSavedList().map(({ id, title, url, createdAt }) => ({ id, title, url, createdAt })));
  return useAsync ? true : ok;
}

function scheduleBmWrite() {
  if (bmWriteTimer) clearTimeout(bmWriteTimer);
  bmWriteTimer = setTimeout(() => writeBmNow({ async: true }), BM_WRITE_DELAY_MS);
}

// Вызывать при выходе из приложения (flushStudioSync тоже её вызывает)
function flushBookmarksSync() {
  if (bmWriteTimer) writeBmNow();
}

// Фиксация изменения: ревизия, запись, обновление Студии. Возвращает true, если Студия изменилась
function bmCommit() {
  bmDirty();
  bmRev++;
  const studioChanged = bmReconcileStudio();
  scheduleBmWrite();
  return studioChanged;
}

// «Обычные» закладки (вне Новой вкладки), новые сверху — то, что раньше лежало в bookmarks.json
function bmSavedList() {
  loadBmStore();
  const out = [];
  bmWalk(null, (n, inNt) => {
    if (n.type === 'bookmark' && !inNt) out.push(n);
  });
  out.sort((a, b) => b.createdAt - a.createdAt || a.order - b.order);
  return out.map((n) => ({
    id: n.id, title: n.title, url: n.url, createdAt: n.createdAt,
    parentId: n.parentId, folder: n.parentId === null ? '' : bmFolderPath(n.parentId).join(' / ')
  }));
}

function loadBookmarks() {
  return bmSavedList();
}

function getBookmarkTree() {
  loadBmStore();
  return { rev: bmRev, nodes: bmSnapshot() };
}

function getBookmarksRev() {
  loadBmStore();
  return bmRev;
}

function isBookmarked(url) {
  if (!isHttpUrl(url)) return false;
  loadBmStore();
  return bmUrls().has(normalizeBookmarkUrl(url));
}

// Закладка по адресу страницы (вне «Новой вкладки») для поповера звёздочки: { id, title, parentId } или null
function getBookmarkByUrl(url) {
  if (!isHttpUrl(url)) return null;
  loadBmStore();
  const id = bmUrls().get(normalizeBookmarkUrl(url));
  const n = id ? bmNodes.get(id) : null;
  return n ? { id: n.id, title: n.title, parentId: n.parentId } : null;
}

// Дерево для окна интерфейса: без системной папки «Новой вкладки» и всего её содержимого
function getBookmarkTreeForUi() {
  loadBmStore();
  return { rev: bmRev, nodes: bmSnapshot().filter((n) => bmNtLevel(n.id) < 0) };
}

// ---- Операции с узлами ----
const bmFail = (error) => ({ ok: false, error });

function bmDone(studioChanged, extra) {
  return { ok: true, rev: bmRev, nodes: bmSnapshot(), studioChanged: Boolean(studioChanged), ...extra };
}

// Вставка/перенос узла в папку parentId на позицию index (undefined = в конец), порядок пересчитывается
function bmInsertAt(node, parentId, index) {
  const oldParent = bmNodes.has(node.id) ? node.parentId : undefined;
  const siblings = bmChildren(parentId).filter((c) => c.id !== node.id);
  const i = Number.isInteger(index) ? Math.max(0, Math.min(index, siblings.length)) : siblings.length;
  siblings.splice(i, 0, node);
  node.parentId = parentId;
  bmNodes.set(node.id, node);
  siblings.forEach((s, k) => { s.order = k; });
  bmDirty();
  if (oldParent !== undefined && oldParent !== parentId) {
    bmChildren(oldParent).forEach((s, k) => { s.order = k; });
    bmDirty();
  }
}

// Форма поддерева внутри Новой вкладки: папка (1) → группы (2) → ссылки (3)
function ntShapeOk(node, lvl) {
  if (node.type === 'bookmark') return lvl === 3;
  if (lvl !== 1 && lvl !== 2) return false;
  return bmChildren(node.id).every((c) => ntShapeOk(c, lvl + 1));
}

function bmCheckPlacement(node, parentId, isNew) {
  if (isNew && bmNodes.size >= BM_MAX_NODES) return 'Слишком много закладок (максимум 10 000).';
  if (parentId === null) return '';
  const parent = bmNodes.get(parentId);
  if (!parent || parent.type !== 'folder') return 'Папка не найдена.';
  if (node.id === NT_ROOT_ID) return 'Системную папку нельзя переместить.';
  if (node.type === 'folder' && !isNew) {
    for (let cur = parent; cur; cur = cur.parentId === null ? null : bmNodes.get(cur.parentId)) {
      if (cur.id === node.id) return 'Нельзя переместить папку внутрь неё самой.';
    }
  }
  const height = node.type === 'folder' && !isNew ? bmHeight(node.id) : 0;
  if (bmLevel(parentId) + 1 + height > BM_MAX_DEPTH) return 'Слишком глубокая вложенность папок.';
  const lvl = bmNtLevel(parentId);
  if (lvl >= 0) {
    if (!ntShapeOk(node, lvl + 1)) {
      if (lvl === 0) return 'В «Новой вкладке» на верхнем уровне могут быть только папки.';
      if (lvl === 1) return 'В папке «Новой вкладки» ссылки лежат внутри групп: создайте группу и добавьте ссылку в неё.';
      return 'В группе «Новой вкладки» могут быть только ссылки.';
    }
    const count = bmChildren(parentId).filter((c) => c.id !== node.id).length;
    if (count >= NT_LIMITS[lvl]) return `Достигнут лимит «Новой вкладки» (${NT_LIMITS[lvl]}).`;
  }
  return '';
}

// Пользовательский ввод адреса: «site.com» → https://site.com
function bmCleanUrl(raw) {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  if (!v || v.length > 2048) return '';
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  if (!isHttpUrl(candidate)) return '';
  try { if (!new URL(candidate).hostname) return ''; } catch { return ''; }
  return normalizeBookmarkUrl(candidate);
}

const bmParent = (v) => (typeof v === 'string' && v ? v : null);

function createBookmarkFolder(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  loadBmStore();
  const title = bmText(p.title, BM_FOLDER_MAX);
  if (!title) return bmFail('Введите название папки.');
  const parentId = bmParent(p.parentId);
  const node = { id: bmMakeId(bmNodes), type: 'folder', title, url: '', parentId: null, order: 0, createdAt: Date.now() };
  const err = bmCheckPlacement(node, parentId, true);
  if (err) return bmFail(err);
  bmInsertAt(node, parentId, Number.isInteger(p.index) ? p.index : undefined);
  return bmDone(bmCommit(), { node: bmPublic(node) });
}

function createBookmarkNode(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  loadBmStore();
  const url = bmCleanUrl(p.url);
  if (!url) return bmFail('Введите корректный адрес (http:// или https://).');
  const parentId = bmParent(p.parentId);
  const inNt = parentId !== null && bmNtLevel(parentId) >= 0;
  if (!inNt && bmUrls().has(url)) return bmFail('Такая закладка уже есть.');
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* адрес уже проверен */ }
  const node = {
    id: bmMakeId(bmNodes), type: 'bookmark', title: bmText(p.title, BM_TITLE_MAX, host), url,
    parentId: null, order: 0, createdAt: Date.now()
  };
  const err = bmCheckPlacement(node, parentId, true);
  if (err) return bmFail(err);
  bmInsertAt(node, parentId, Number.isInteger(p.index) ? p.index : undefined);
  return bmDone(bmCommit(), { node: bmPublic(node) });
}

function updateBookmarkNode(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  loadBmStore();
  const node = typeof p.id === 'string' ? bmNodes.get(p.id) : null;
  if (!node) return bmFail('Элемент не найден.');
  if (node.id === NT_ROOT_ID) return bmFail('Системную папку нельзя переименовать.');
  if (node.type === 'folder') {
    const title = bmText(p.title, BM_FOLDER_MAX);
    if (!title) return bmFail('Введите название папки.');
    node.title = title;
  } else {
    if (p.url !== undefined) {
      const url = bmCleanUrl(p.url);
      if (!url) return bmFail('Введите корректный адрес (http:// или https://).');
      if (url !== node.url && bmNtLevel(node.id) < 0 && bmUrls().has(url)) return bmFail('Такая закладка уже есть.');
      node.url = url;
    }
    if (p.title !== undefined) {
      let host = '';
      try { host = new URL(node.url).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
      node.title = bmText(p.title, BM_TITLE_MAX, host);
    }
  }
  return bmDone(bmCommit(), { node: bmPublic(node) });
}

function moveBookmarkNode(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  loadBmStore();
  const node = typeof p.id === 'string' ? bmNodes.get(p.id) : null;
  if (!node) return bmFail('Элемент не найден.');
  if (node.id === NT_ROOT_ID) return bmFail('Системную папку нельзя переместить.');
  const parentId = bmParent(p.parentId);
  const err = bmCheckPlacement(node, parentId, false);
  if (err) return bmFail(err);
  // Ссылка уходит из Новой вкладки в «обычную» область: адрес должен остаться уникальным там
  if (node.type === 'bookmark' && bmNtLevel(node.id) >= 0 && (parentId === null || bmNtLevel(parentId) < 0)) {
    if (bmUrls().has(node.url)) return bmFail('Такая закладка уже есть вне «Новой вкладки».');
  }
  bmInsertAt(node, parentId, Number.isInteger(p.index) ? p.index : undefined);
  return bmDone(bmCommit(), { node: bmPublic(node) });
}

function removeBookmarkNode(id) {
  loadBmStore();
  const node = typeof id === 'string' ? bmNodes.get(id) : null;
  if (!node) return bmFail('Элемент не найден.');
  if (node.id === NT_ROOT_ID) return bmFail('Системную папку нельзя удалить.');
  const removed = [node, ...(node.type === 'folder' ? bmDescendants(node.id) : [])];
  for (const n of removed) bmNodes.delete(n.id);
  bmDirty();
  bmChildren(node.parentId).forEach((s, k) => { s.order = k; });
  return bmDone(bmCommit(), { removed: removed.length });
}

// Возвращает true, если закладка добавлена, и false, если удалена (или url некорректен). Новые — в начало корня
function toggleBookmark(url, title) {
  if (!isHttpUrl(url)) return false;
  loadBmStore();
  const key = normalizeBookmarkUrl(url);
  if (!key) return false;
  const existing = bmUrls().get(key);
  if (existing) {
    removeBookmarkNode(existing);
    return false;
  }
  const node = {
    id: bmMakeId(bmNodes), type: 'bookmark', title: bmText(title, BM_TITLE_MAX), url: key,
    parentId: null, order: 0, createdAt: Date.now()
  };
  if (bmCheckPlacement(node, null, true)) return false;
  bmInsertAt(node, null, 0);
  bmCommit();
  return true;
}

function bmEnsureFolderPath(path) {
  let parentId = null;
  for (const raw of path.slice(0, 6)) {
    const title = bmText(raw, BM_FOLDER_MAX, 'Папка');
    let folder = bmChildren(parentId).find((c) => c.type === 'folder' && c.id !== NT_ROOT_ID && c.title.toLowerCase() === title.toLowerCase());
    if (!folder) {
      if (bmNodes.size >= BM_MAX_NODES) return undefined;
      folder = { id: bmMakeId(bmNodes), type: 'folder', title, url: '', parentId: null, order: 0, createdAt: Date.now() };
      bmInsertAt(folder, parentId, undefined);
    }
    parentId = folder.id;
  }
  return parentId;
}

// Пакетный импорт без дублей (по url). Элементы: { url, title, path?: ['Папка', 'Подпапка'] }. Возвращает { added }
function importBookmarks(items) {
  loadBmStore();
  const now = Date.now();
  let added = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || !isHttpUrl(it.url) || bmNodes.size >= BM_MAX_NODES) continue;
    const url = normalizeBookmarkUrl(it.url);
    if (!url || bmUrls().has(url)) continue;
    const parentId = Array.isArray(it.path) && it.path.length ? bmEnsureFolderPath(it.path) : null;
    if (parentId === undefined) continue;
    bmInsertAt({
      id: bmMakeId(bmNodes), type: 'bookmark', title: bmText(it.title, BM_TITLE_MAX), url,
      parentId: null, order: 0, createdAt: now
    }, parentId, undefined);
    added++;
  }
  if (added) bmCommit();
  return { added };
}

function searchBookmarks(query, limit = 6) {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!q) return [];
  loadBmStore();
  const tokens = q.split(/\s+/);
  const scored = [];
  const seen = new Set();
  for (const entry of bmNodes.values()) {
    if (entry.type !== 'bookmark' || seen.has(entry.url)) continue;
    const url = entry.url.toLowerCase();
    const title = entry.title.toLowerCase();
    const host = url.replace(/^https?:\/\/(www\.)?/, '');
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      let s = 0;
      if (host.startsWith(t)) s = 100;
      else if (title.startsWith(t)) s = 80;
      else if (title.includes(` ${t}`)) s = 50;
      else if (title.includes(t)) s = 30;
      else if (url.includes(t)) s = 20;
      if (!s) { ok = false; break; }
      score += s;
    }
    if (ok) { seen.add(entry.url); scored.push({ entry, score }); }
  }
  scored.sort((a, b) => b.score - a.score || b.entry.createdAt - a.entry.createdAt);
  const n = Math.max(0, Math.floor(Number(limit)) || 0);
  return scored.slice(0, n).map((s) => ({ id: s.entry.id, title: s.entry.title, url: s.entry.url, createdAt: s.entry.createdAt }));
}

// ---- История загрузок (browser-data/downloads.json). Данные проверяет DownloadManager при чтении ----
const DOWNLOADS_FILE = 'downloads.json';

function loadDownloads() {
  return readJsonSafe(DOWNLOADS_FILE, null);
}

function saveDownloads(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return writeJsonAtomic(DOWNLOADS_FILE, payload);
}

// Асинхронный вариант для отложенной записи (при выходе дописывает flushPendingWritesSync)
function saveDownloadsAsync(payload) {
  if (!payload || typeof payload !== 'object') return Promise.resolve(false);
  return writeJsonAtomicAsync(DOWNLOADS_FILE, payload);
}

function sanitizeSessionFavicon(favicon) {
  if (typeof favicon !== 'string') return '';
  const trimmed = favicon.trim();
  if (!trimmed || trimmed.length > 512) return '';
  if (/^data:/i.test(trimmed)) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}

module.exports = {
  ENERGY_SAVER_MODES,
  sanitizeSessionFavicon,
  loadDownloads,
  saveDownloads,
  saveDownloadsAsync,
  flushPendingWritesSync,
  getStudio,
  mergeStudioPrefs,
  saveStudioPrefs,
  saveStudioBookmarks,
  migrateStudio,
  flushStudioSync,
  flushBookmarksSync,
  loadSettings,
  saveSettings,
  loadSession,
  scheduleSaveSession,
  saveSessionSync,
  DEFAULT_WORKSPACE_ID,
  WORKSPACE_COLORS,
  getWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  normalizeWorkspaceId,
  loadNewTabState,
  saveNewTabState,
  mergeNewTabState,
  saveCustomWallpaper,
  clearCustomWallpaper,
  getCustomWallpaper,
  recordVisit,
  updateHistoryTitle,
  searchHistory,
  getHistory,
  clearHistory,
  removeHistoryEntry,
  clearHistorySince,
  HISTORY_MAX,
  flushHistorySync,
  loadBookmarks,
  isBookmarked,
  toggleBookmark,
  importBookmarks,
  searchBookmarks,
  getBookmarkTree,
  getBookmarkTreeForUi,
  getBookmarkByUrl,
  getBookmarksRev,
  createBookmarkFolder,
  createBookmarkNode,
  updateBookmarkNode,
  moveBookmarkNode,
  removeBookmarkNode
};
