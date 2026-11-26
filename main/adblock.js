// Блокировка рекламы на уровне сессии (поддерживает обычную и Инкогнито сессии одновременно).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Worker } = require('worker_threads');
const { adblockSession } = require('./webRequestHub');
const { app, net, ipcMain } = require('electron');
const COSMETIC_STUBS = {
  '@ghostery/adblocker/inject-cosmetic-filters': () => ({ styles: [], scripts: [] }),
  '@ghostery/adblocker/is-mutation-observer-enabled': () => false
};
// Заглушки на время, когда блокировщик ни к одной сессии не подключён (preload всё равно шлёт запросы)
function installStubHandlers() {
  for (const [ch, fn] of Object.entries(COSMETIC_STUBS)) {
    ipcMain.removeHandler(ch);
    ipcMain.handle(ch, fn);
  }
}
installStubHandlers();


// Согласованный набор без дублей (AdGuard Russian заменяет RuAdList, AdGuard Tracking заменяет EasyPrivacy)
const LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://filters.adtidy.org/extension/ublock/filters/2_without_easylist.txt', // AdGuard Base (без EasyList)
  'https://filters.adtidy.org/extension/ublock/filters/1.txt',  // AdGuard Russian
  'https://filters.adtidy.org/extension/ublock/filters/3.txt',  // AdGuard Tracking Protection
  'https://filters.adtidy.org/extension/ublock/filters/17.txt'  // AdGuard URL Tracking
];

const CUSTOM_RULES_FILE = 'custom-filters.txt';

// Встроенные исключения для стабильной работы Gemini
const BUILTIN_EXCEPTIONS = [
  '@@||gemini.google.com^',
  '@@||google.com^$domain=gemini.google.com',
  '@@||gstatic.com^$domain=gemini.google.com',
  '@@||googleapis.com^$domain=gemini.google.com',
  '@@||googleusercontent.com^$domain=gemini.google.com',
  '@@||gemini.google.com^$elemhide'
].join('\n');

// Встроенные косметические правила: скрытие рекламных контейнеров, в том числе опустевших после блокировки запросов.
// Дополняют списки AdGuard/EasyList; на Gemini не действуют (исключение $elemhide выше).
const BUILTIN_COSMETIC = [
  '##ins.adsbygoogle',
  '##div[id^="div-gpt-ad"]',
  '##div[id^="google_ads_iframe"]',
  '##div[id^="google_ads_"]:empty',
  '##iframe[id^="google_ads_iframe"]',
  '##[class*="ad-slot"]:empty',
  '##[class*="ad-container"]:empty',
  '##[class*="ad-wrapper"]:empty',
  '##[class*="advert"]:empty',
  '##[id*="ad-slot"]:empty',
  '##[id*="ad-container"]:empty'
].join('\n');

const FETCH_TIMEOUT_MS = 20000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const WORKER_TIMEOUT_MS = 120000;

let blocker = null;
let loading = null;
let buildGen = 0; // поколение сборки: reload() увеличивает его, и устаревшая первая сборка не затирает свежую
const wantedSessions = new Set();
const attachedSessions = new Map(); // сессия -> движок, подключённый к ней сейчас
let blockedCount = 0;
let cosmeticEnabled = true; // косметическая фильтрация (настройка adblockCosmetic); применяется к движку на лету

// Движок всегда содержит косметические правила, а флаги его конфигурации решают, отдаёт ли он их новым страницам
// (запросы preload-скрипта) и следит ли за DOM. Поэтому тумблер действует сразу, без пересборки движка.
function applyCosmeticFlag(b) {
  if (!b || !b.config) return;
  try { b.config.loadCosmeticFilters = cosmeticEnabled; } catch { /* конфиг только для чтения */ }
  try { b.config.enableMutationObserver = cosmeticEnabled; } catch { /* не критично */ }
}

function setCosmetic(on) {
  cosmeticEnabled = on !== false;
  const engines = new Set(attachedSessions.values());
  if (blocker) engines.add(blocker);
  for (const b of engines) applyCosmeticFlag(b);
}

function cacheFile(name) {
  const dir = path.join(app.getPath('userData'), 'browser-data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function fileAgeMs(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function isFresh(file) {
  const age = fileAgeMs(file);
  return age !== null && age <= CACHE_MAX_AGE_MS;
}

// Уникальное имя временного файла: параллельные записи (первичная сборка, пересборка, два сохранения подряд)
// никогда не пишут в один и тот же .tmp и не затирают друг друга.
const TMP_SUFFIX_RE = /\.\d+-[0-9a-f]{12}\.tmp$/;

function uniqueTmpName(file) {
  return `${file}.${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
}

// Удаляет осиротевшие временные файлы (остаются после аварийного завершения посреди записи)
let tmpSwept = false;
function sweepStaleTmp() {
  if (tmpSwept) return;
  tmpSwept = true;
  try {
    const dir = path.dirname(cacheFile('.'));
    for (const name of fs.readdirSync(dir)) {
      if (!TMP_SUFFIX_RE.test(name)) continue;
      const full = path.join(dir, name);
      const age = fileAgeMs(full);
      if (age !== null && age > 10 * 60 * 1000) fs.promises.unlink(full).catch(() => {});
    }
  } catch { /* не критично */ }
}

async function writeFileAtomic(file, data) {
  const tmp = uniqueTmpName(file);
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, file);
  } catch (err) {
    fs.promises.unlink(tmp).catch(() => {});
    throw err;
  }
}

function writeFileAtomicSync(file, data) {
  const tmp = uniqueTmpName(file);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch { /* временного файла нет */ }
    throw err;
  }
}

function getCustomRules() {
  try {
    return fs.readFileSync(cacheFile(CUSTOM_RULES_FILE), 'utf8');
  } catch {
    return '';
  }
}

function saveCustomRules(text) {
  const clean = typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
  writeFileAtomicSync(cacheFile(CUSTOM_RULES_FILE), clean);
}

async function loadList(url) {
  const file = cacheFile(`list-${Buffer.from(url).toString('base64url').slice(-40)}.txt`);
  let cached = '';
  try {
    cached = await fs.promises.readFile(file, 'utf8');
  } catch {
    // кэша нет
  }
  if (cached.length < 200) cached = '';

  if (cached && isFresh(file)) return { text: cached, status: 'cache' };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (text.length < 200) throw new Error('пустой список');
    await writeFileAtomic(file, text).catch((err) => {
      console.warn(`[adblock] не удалось сохранить кэш ${url}: ${err.message}`);
    });
    return { text, status: 'downloaded' };
  } catch (err) {
    if (cached) {
      console.warn(`[adblock] список недоступен ${url}: ${err.message}; использую кэш`);
      return { text: cached, status: 'stale' };
    }
    console.warn(`[adblock] список недоступен ${url}: ${err.message}`);
    return { text: '', status: 'none' };
  } finally {
    clearTimeout(timer);
  }
}

// Запись пары engine.bin + .stamp строго по очереди и только для актуального поколения сборки.
// Иначе медленная устаревшая сборка могла бы записать старый движок под новым штампом.
let persistQueue = Promise.resolve();

function persistEngine(engineFile, stampFile, bytes, stamp, gen) {
  persistQueue = persistQueue.then(async () => {
    if (gen !== buildGen) return; // за время сборки правила изменились — этот движок уже не актуален
    await writeFileAtomic(engineFile, Buffer.from(bytes));
    if (gen !== buildGen) {
      // поколение сменилось между двумя записями: штамп не обновляем, следующий запуск пересоберёт движок
      return;
    }
    await writeFileAtomic(stampFile, stamp);
  }).catch(() => { /* кэш необязателен */ });
  return persistQueue;
}

// Разбор текстовых списков в воркере (не блокирует главный поток). Возвращает сериализованный движок.
function parseInWorker(text) {
  return new Promise((resolve, reject) => {
    let worker = null;
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (worker) worker.terminate().catch(() => {});
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('таймаут воркера')), WORKER_TIMEOUT_MS);
    try {
      worker = new Worker(path.join(__dirname, 'adblockWorker.js').replace('app.asar', 'app.asar.unpacked'), { workerData: { text } });
    } catch (err) {
      finish(reject, err);
      return;
    }
    worker.once('message', (msg) => {
      if (msg && msg.ok && msg.data) finish(resolve, new Uint8Array(msg.data));
      else finish(reject, new Error((msg && msg.error) || 'воркер вернул ошибку'));
    });
    worker.once('error', (err) => finish(reject, err));
    worker.once('exit', (code) => finish(reject, new Error(`воркер завершился (код ${code})`)));
  });
}

async function build(gen) {
  sweepStaleTmp();
  const { ElectronBlocker } = require('@ghostery/adblocker-electron');
  // v7: движок теперь содержит косметические правила (старый кэш v6 их не имел)
  const engineFile = cacheFile('adblock-engine-v7.bin');
  const stampFile = cacheFile('adblock-engine-v7.stamp');

  const customText = BUILTIN_EXCEPTIONS + '\n' + BUILTIN_COSMETIC + '\n' + getCustomRules();
  const customStamp = crypto.createHash('sha256').update(customText).digest('hex');

  let savedStamp = '';
  try { savedStamp = await fs.promises.readFile(stampFile, 'utf8'); } catch { /* штампа нет */ }
  const stampMatches = savedStamp === customStamp;
  const engineExists = fileAgeMs(engineFile) !== null;

  const loadSavedEngine = async () => {
    try {
      const buf = await fs.promises.readFile(engineFile);
      return ElectronBlocker.deserialize(new Uint8Array(buf));
    } catch {
      return null;
    }
  };

  let b = (stampMatches && isFresh(engineFile)) ? await loadSavedEngine() : null;

  if (!b) {
    const results = await Promise.all(LISTS.map(loadList));
    const texts = results.map((r) => r.text).filter(Boolean);
    const gotCurrent = results.some((r) => r.status === 'downloaded' || r.status === 'cache');

    if (!gotCurrent && stampMatches && engineExists) {
      b = await loadSavedEngine();
      if (b) console.warn('[adblock] нет сети, использую сохранённый движок');
    }

    if (!b && texts.length) {
      const fullText = texts.join('\n') + '\n' + customText;
      let engineBytes = null;
      try {
        engineBytes = await parseInWorker(fullText);
        b = ElectronBlocker.deserialize(engineBytes);
      } catch (err) {
        // Фолбэк: разбираем списки в главном процессе
        console.warn(`[adblock] воркер не справился (${err && err.message}), разбираю в main`);
        engineBytes = null;
        b = ElectronBlocker.parse(fullText, { loadCosmeticFilters: true, loadGenericCosmeticsFilters: true });
      }
      if (gotCurrent) {
        try {
          // сериализация синхронная и до постановки в очередь; сама запись идёт фоном и не задерживает подмену
          persistEngine(engineFile, stampFile, engineBytes || b.serialize(), customStamp, gen);
        } catch { /* кэш необязателен */ }
      }
    }

    if (!b && engineExists) {
      b = await loadSavedEngine();
    }

    if (!b) {
      console.warn('[adblock] ни один список не скачался, беру готовый набор');
      const fetchFn = (u, init) => net.fetch(u, init);
      const caching = { path: cacheFile('adblock-fallback-v5.bin'), read: fs.promises.readFile, write: writeFileAtomic };
      // Предпочтительно: те же готовые списки, с косметическими фильтрами (как в основном пути)
      try {
        const lib = require('@ghostery/adblocker');
        if (Array.isArray(lib.adsAndTrackingLists)) {
          b = await ElectronBlocker.fromLists(fetchFn, lib.adsAndTrackingLists, { loadCosmeticFilters: true, loadGenericCosmeticsFilters: true }, caching);
        }
      } catch (err) {
        console.warn('[adblock] fromLists недоступен:', err && err.message);
        b = null;
      }
      if (!b) {
        b = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchFn, {
          path: cacheFile('adblock-prebuilt-v4.bin'),
          read: fs.promises.readFile,
          write: writeFileAtomic
        });
      }
      // Исключения для Gemini и пользовательские правила — и в фолбэке
      try {
        const extra = customText.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('!'));
        if (extra.length) b.updateFromDiff({ added: extra });
      } catch (err) {
        console.warn('[adblock] не удалось добавить свои правила в фолбэк:', err && err.message);
      }
    }
  }

  try {
    b.on('request-blocked', () => { blockedCount += 1; });
  } catch { /* счётчик необязателен */ }

  applyCosmeticFlag(b);
  return b;
}

function ensureBlocker() {
  if (blocker) return Promise.resolve(blocker);
  if (!loading) {
    const gen = buildGen;
    const p = build(gen)
      .then((b) => {
        // Пока шла сборка, вызвали reload(): этот движок устарел — берём результат свежей сборки
        if (gen !== buildGen) return ensureBlocker();
        blocker = b;
        return b;
      })
      .finally(() => { if (loading === p) loading = null; });
    loading = p;
  }
  return loading;
}

function attachBlocker(b, ses) {
  for (const ch of Object.keys(COSMETIC_STUBS)) ipcMain.removeHandler(ch);
  b.enableBlockingInSession(adblockSession(ses));
}



// disableBlockingInSession() снимает ОБЩИЕ ipcMain-обработчики косметики: переподключаем оставшуюся сессию
// (синхронно, запросы без фильтрации не проходят), а если таких нет — возвращаем заглушки
function restoreCosmeticHandlers() {
  const remaining = attachedSessions.entries().next().value;
  if (!remaining) { installStubHandlers(); return; }
  const [ses, b] = remaining;
  try { b.disableBlockingInSession(adblockSession(ses)); } catch { /* уже снято */ }
  try {
    attachBlocker(b, ses);
  } catch (err) {
    console.error('[adblock] не удалось переподключить сессию:', err && err.message);
    attachedSessions.delete(ses);
    installStubHandlers();
  }
}

async function setEnabled(ses, on) {
  if (!ses) return;

  if (!on) {
    wantedSessions.delete(ses);
    const attached = attachedSessions.get(ses);
    if (attached) {
      try { attached.disableBlockingInSession(adblockSession(ses)); } catch { /* уже снято */ }
    }
    attachedSessions.delete(ses);
    if (attached) restoreCosmeticHandlers();
    return;
  }

  wantedSessions.add(ses);
  if (attachedSessions.has(ses)) return;

  try {
    const b = await ensureBlocker();
    if (!wantedSessions.has(ses) || attachedSessions.has(ses)) return;
    attachBlocker(b, ses);
    attachedSessions.set(ses, b);
  } catch (err) {
    console.error('[adblock] не удалось включить:', err.message);
  }
}

// Пересборка движка после правки custom-filters.txt.
// Бесшовно: новый движок целиком собирается в воркере, а старый всё это время продолжает блокировать;
// подмена происходит синхронно (disable старого + enable нового в одном тике) сразу во всех сессиях,
// поэтому ни один запрос не проходит без фильтрации. Если сборка не удалась — остаётся старый движок.
// Параллельные вызовы схлопываются: идёт одна пересборка, а если за время сборки правила менялись ещё — одна повторная.
let reloadRunning = null;
let reloadAgain = false;

async function reloadOnce() {
  const gen = ++buildGen;

  if (!blocker) {
    // Движка ещё нет (первая сборка идёт или не удалась): блокировать пока нечем, прятать нечего
    loading = null;
    if (!wantedSessions.size) return;
    const b = await ensureBlocker();
    for (const ses of Array.from(wantedSessions)) {
      if (attachedSessions.has(ses)) continue;
      try {
        attachBlocker(b, ses);
        attachedSessions.set(ses, b);
      } catch {
        wantedSessions.delete(ses);
      }
    }
    return;
  }

  // 1) Новый движок собирается целиком (разбор списков идёт в воркере), старый всё это время блокирует
  let fresh;
  try {
    fresh = await build(gen);
  } catch (err) {
    console.error('[adblock] пересборка не удалась, остаётся прежний движок:', err && err.message);
    return;
  }

  // Пока строили, пришла ещё более свежая пересборка: этот движок уже устарел, подменять им нечего
  if (gen !== buildGen) return;

  // 2) Подмена: всё ниже синхронно (один тик event loop), поэтому ни один запрос не пройдёт без фильтрации.
  // Порядок «снять старый → поставить новый» обязателен: disableBlockingInSession сбрасывает webRequest-обработчики сессии.
  blocker = fresh;
  for (const ses of Array.from(wantedSessions)) {
    const old = attachedSessions.get(ses);
    if (old === fresh) continue;
    if (old) {
      try { old.disableBlockingInSession(adblockSession(ses)); } catch { /* уже снято */ }
      attachedSessions.delete(ses);
    }
    try {
      attachBlocker(fresh, ses);
      attachedSessions.set(ses, fresh);
    } catch (err) {
      console.warn('[adblock] не удалось подключить новый движок к сессии:', err && err.message);
      // Откат: возвращаем прежний движок, чтобы сессия не осталась без защиты
      if (old) {
        try {
          attachBlocker(old, ses);
          attachedSessions.set(ses, old);
          continue;
        } catch { /* откат не удался */ }
      }
      wantedSessions.delete(ses);
    }
  }
}

function reload() {
  if (reloadRunning) {
    reloadAgain = true;
    return reloadRunning;
  }
  reloadRunning = (async () => {
    try {
      do {
        reloadAgain = false;
        await reloadOnce();
      } while (reloadAgain);
    } finally {
      reloadRunning = null;
    }
  })();
  return reloadRunning;
}

// Ждёт promise не дольше ms (для старта: не задерживаем окно, если списки качаются впервые). Никогда не бросает.
function settleWithin(promise, ms) {
  let timer = null;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([Promise.resolve(promise).catch(() => {}), timeout]).finally(() => clearTimeout(timer));
}

function getBlockedCount() {
  return blockedCount;
}

module.exports = { setEnabled, setCosmetic, getBlockedCount, getCustomRules, saveCustomRules, reload, settleWithin };