const fs = require('fs');
const path = require('path');
const { app, shell, dialog, session } = require('electron');

// storage.js: если в нём есть loadDownloads()/saveDownloads(payload) — история хранится через него,
// иначе (и при любой ошибке) используется собственный файл downloads.json в userData
let storage = null;
try { storage = require('./storage'); } catch { storage = null; }

const MAX_ITEMS = 20; // сколько последних загрузок показывает попап
const MAX_HISTORY = 500; // сколько записей хранится на диске и показывается на странице browser://downloads
const PERSIST_DELAY_MS = 1000;
const STALE_SPEED_MS = 3000; // нет событий progress дольше — скорость показываем как 0
const STORE_VERSION = 1;
const VALID_STATES = new Set(['progressing', 'paused', 'completed', 'cancelled', 'interrupted']);
const VALID_VERDICTS = new Set(['ok', 'mismatch', 'blocked', 'kept']);
const NOTIFY_THROTTLE_MS = 250;
const EXISTS_TTL_MS = 3000; // как долго помним результат проверки «файл на месте» (сетевой диск не дёргаем на каждый тик)
const EXISTS_TIMEOUT_MS = 1500;

// Потенциально опасные исполняемые/скриптовые расширения (Windows): такие файлы молча в «Загрузки» не кладём
const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.msi', '.bat', '.cmd', '.ps1', '.vbs', '.scr', '.lnk', '.js', '.jar',
  '.hta', '.wsf', '.jse', '.vbe', '.reg', '.pif', '.msp',
  '.dll', '.com', '.cpl', '.chm', '.iso', '.img', '.vhd', '.vhdx', '.url', '.scf',
  '.msix', '.appinstaller', '.ocx',
  '.docm', '.xlsm', '.pptm', '.dotm', '.xltm', '.potm', '.ppam', '.xlam',
  '.svg', '.html', '.htm', '.xhtml', '.mht', '.mhtml',
  '.xll', '.wll', '.msc', '.wsh', '.ws', '.wsc', '.vb', '.inf', '.gadget',
  '.diagcab', '.appref-ms', '.library-ms', '.searchconnector-ms', '.settingcontent-ms'
]);

// Веб-форматы открываются в самом браузере, подтверждение запуска для них не нужно (иначе будет только раздражать)
const SAFE_TO_OPEN_WITHOUT_PROMPT = new Set(['.svg', '.html', '.htm', '.xhtml', '.mht', '.mhtml']);
function needsLaunchConfirm(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return DANGEROUS_EXTENSIONS.has(ext) && !SAFE_TO_OPEN_WITHOUT_PROMPT.has(ext);
}

function isDangerousFileName(name) {
  return DANGEROUS_EXTENSIONS.has(path.extname(String(name || '')).toLowerCase());
}

// Безопасное имя файла для Windows: без путей, запрещённых символов и зарезервированных имён
function sanitizeFileName(name) {
  let base = path.basename(String(name || ''))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!base) base = 'download';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(base)) base = `_${base}`;
  if (base.length > 180) {
    const ext = path.extname(base).slice(0, 20);
    base = base.slice(0, 180 - ext.length) + ext;
  }
  return base;
}

// ---- Проверка содержимого по magic bytes (после завершения загрузки) ----
const SNIFF_BYTES = 1024; // для PE нужны 64 байта, для текстовых скриптов — начало файла
const MSI_SCAN_BYTES = 4 * 1024 * 1024;

// Ожидаемый «вид» содержимого по расширению. Расширения, которых здесь нет, не проверяются (текст и т.п.)
const EXPECTED_KINDS = {
  '.pdf': ['pdf'],
  '.png': ['png'],
  '.jpg': ['jpg'], '.jpeg': ['jpg'],
  '.gif': ['gif'],
  '.webp': ['webp'],
  '.ico': ['ico'],
  '.zip': ['zip'], '.docx': ['zip'], '.xlsx': ['zip'], '.pptx': ['zip'],
  '.odt': ['zip'], '.ods': ['zip'], '.odp': ['zip'], '.epub': ['zip'], '.apk': ['zip'],
  '.7z': ['7z'],
  '.rar': ['rar'],
  '.gz': ['gz'], '.tgz': ['gz'],
  '.mp3': ['mp3'],
  '.mp4': ['mp4'], '.m4a': ['mp4'], '.m4v': ['mp4'],
  '.webm': ['mkv'], '.mkv': ['mkv']
};

const KIND_LABELS = {
  pdf: 'PDF', png: 'PNG', jpg: 'JPEG', gif: 'GIF', webp: 'WebP', ico: 'ICO', zip: 'ZIP', '7z': '7z',
  rar: 'RAR', gz: 'GZIP', mp3: 'MP3', mp4: 'MP4', mkv: 'Matroska/WebM', markup: 'HTML/XML-разметка'
};

const MACHO_MAGICS = [
  [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe],
  [0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf]
];

const startsWith = (buf, bytes, offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

function sniffKind(head) {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpg';
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00])) return 'ico';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06]) ||
      startsWith(head, [0x50, 0x4b, 0x07, 0x08])) return 'zip';
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z';
  if (startsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar';
  if (startsWith(head, [0x1f, 0x8b])) return 'gz';
  if (startsWith(head, [0x49, 0x44, 0x33]) || (head.length > 1 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'mp3';
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) return 'mp4';
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'mkv';
  const skip = startsWith(head, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  const text = head.subarray(skip).toString('latin1').trimStart().toLowerCase();
  if (/^(<!doctype html|<html|<head|<body|<script|<svg|<\?xml)/.test(text)) return 'markup';
  return null;
}

// Скрипты, у которых shebang/служебная строка в начале файла — норма (.sh, .py и т.п.): подменой не считаем
const SCRIPT_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.py', '.pl', '.rb', '.php', '.lua', '.command', '.mjs', '.cjs'
]);

// Старые форматы Office/Outlook тоже лежат в OLE-контейнере (D0 CF 11 E0), поэтому для них MSI ищем по CLSID
const LEGACY_OLE_EXTENSIONS = new Set([
  '.doc', '.dot', '.xls', '.xlt', '.xlw', '.ppt', '.pps', '.pot', '.msg', '.pub', '.vsd', '.mpp', '.wps'
]);
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
// CLSID корневой записи MSI ({000C1084-...}) и MSP/MST ({000C1086-...}, {000C1082-...}) в little-endian виде
const MSI_CLSIDS = [0x84, 0x86, 0x82].map((b) =>
  Buffer.from([b, 0x10, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46]));

// Текстовые скрипты по началу файла (после BOM и пробелов, без учёта регистра)
const SCRIPT_PATTERNS = [
  [/^#!/, 'скрипт с shebang (#!)'],
  [/^<script[\s>]/, 'HTML-скрипт (<script>)'],
  [/^@echo\s+off\b/, 'пакетный файл Windows (@echo off)'],
  [/^(powershell|pwsh)(\.exe)?\s+(-|\/|iex\b|invoke-|start-|\$|\()/, 'скрипт PowerShell'],
  [/^<\?php/, 'PHP-скрипт'],
  [/^<hta:application/, 'HTA-приложение'],
  [/^<(job|package)[\s>]/, 'Windows Script File']
];

function decodeHeadText(head) {
  if (startsWith(head, [0xff, 0xfe])) return head.subarray(2).toString('utf16le');
  if (startsWith(head, [0xfe, 0xff])) {
    const b = Buffer.from(head.subarray(2, 2 + ((head.length - 2) & ~1)));
    return b.swap16().toString('utf16le');
  }
  return head.subarray(startsWith(head, [0xef, 0xbb, 0xbf]) ? 3 : 0).toString('latin1');
}

function detectScript(head, ext) {
  if (SCRIPT_EXTENSIONS.has(ext)) return null;
  const text = decodeHeadText(head).replace(/^[\s\ufeff\u200b]+/, '').toLowerCase();
  for (const [re, label] of SCRIPT_PATTERNS) if (re.test(text)) return label;
  return null;
}

// OLE-контейнер: MSI-установщик под видом чего-то другого. Для .doc/.xls/... ищем CLSID установщика
async function detectOleInstaller(fh, head, size, ext) {
  if (!startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) return null;
  if (!LEGACY_OLE_EXTENSIONS.has(ext)) return startsWith(head, OLE_MAGIC) ? 'установщик MSI / OLE-контейнер' : 'OLE-контейнер';
  const buf = Buffer.alloc(Math.min(MSI_SCAN_BYTES, size));
  const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
  const data = buf.subarray(0, bytesRead);
  return MSI_CLSIDS.some((c) => data.indexOf(c) !== -1) ? 'установщик MSI' : null;
}

// Исполняемые форматы: PE (Windows), ELF, Mach-O. Для PE дополнительно проверяем сигнатуру «PE\0\0» по e_lfanew,
// чтобы текст, случайно начинающийся с «MZ», не считался программой.
async function detectExecutable(fh, head, size) {
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return 'ELF';
  if (MACHO_MAGICS.some((m) => startsWith(head, m))) return 'Mach-O';
  // CA FE BA BE: универсальный Mach-O (малое число архитектур) или Java class (версия >= 45)
  if (startsWith(head, [0xca, 0xfe, 0xba, 0xbe]) && head.length >= 8) {
    return head.readUInt32BE(4) < 30 ? 'Mach-O (universal)' : 'Java class';
  }
  if (startsWith(head, [0x4d, 0x5a]) && head.length >= 64) {
    const off = head.readUInt32LE(60);
    if (off >= 64 && off < 0x100000 && off <= size - 4) {
      const pe = Buffer.alloc(4);
      const { bytesRead } = await fh.read(pe, 0, 4, off);
      if (bytesRead === 4 && startsWith(pe, [0x50, 0x45, 0x00, 0x00])) return 'Windows PE';
    }
  }
  return null;
}

// -> { verdict: 'ok' | 'mismatch' | 'blocked', reason }
async function inspectFile(file) {
  const ext = path.extname(file).toLowerCase();
  // Явно опасные расширения пользователь уже подтвердил в системном диалоге «Сохранить как»
  if (DANGEROUS_EXTENSIONS.has(ext)) return { verdict: 'ok', reason: '' };

  let fh = null;
  try {
    fh = await fs.promises.open(file, 'r');
    const { size } = await fh.stat();
    if (size === 0) return { verdict: 'ok', reason: '' };

    const buf = Buffer.alloc(Math.min(SNIFF_BYTES, size));
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const head = buf.subarray(0, bytesRead);

    const shownExt = ext ? `«${ext}»` : '«без расширения»';
    const exe = await detectExecutable(fh, head, size);
    if (exe) return { verdict: 'blocked', reason: `Подмена типа файла: внутри исполняемый файл (${exe}), а расширение ${shownExt}` };

    const ole = await detectOleInstaller(fh, head, size, ext);
    if (ole) return { verdict: 'blocked', reason: `Подмена типа файла: внутри ${ole}, а расширение ${shownExt}` };

    const script = detectScript(head, ext);
    if (script) return { verdict: 'blocked', reason: `Подмена типа файла: внутри ${script}, а расширение ${shownExt}` };

    const expected = EXPECTED_KINDS[ext];
    if (!expected) return { verdict: 'ok', reason: '' };
    const real = sniffKind(head);
    if (real && expected.includes(real)) return { verdict: 'ok', reason: '' };
    const realLabel = real ? KIND_LABELS[real] : 'неизвестный формат';
    return { verdict: 'mismatch', reason: `Содержимое не совпадает с расширением «${ext}»: ${realLabel}` };
  } catch {
    return { verdict: 'mismatch', reason: 'Не удалось проверить файл' };
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

function formatSpeed(bps) {
  if (!(bps > 0)) return '';
  const kb = bps / 1024;
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} КБ/с`;
  const mb = kb / 1024;
  return `${(mb < 10 ? mb.toFixed(1) : String(Math.round(mb))).replace('.', ',')} МБ/с`;
}

// ---- Хранилище истории загрузок (на диске) ----
function storeFile() {
  return path.join(app.getPath('userData'), 'downloads.json');
}

function readStore() {
  try {
    if (storage && typeof storage.loadDownloads === 'function') {
      const data = storage.loadDownloads();
      if (data) return data;
    }
  } catch { /* читаем из собственного файла */ }
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch { return null; }
}

// Отложенная запись: не блокирует main. Через storage — с защитой от гонки с синхронным flush
function writeStoreAsync(payload) {
  try {
    if (storage && typeof storage.saveDownloadsAsync === 'function') {
      storage.saveDownloadsAsync(payload).catch(() => {});
      return;
    }
  } catch { /* пишем в собственный файл */ }
  const file = storeFile();
  const tmp = `${file}.async.tmp`;
  const text = JSON.stringify(payload);
  fs.promises.mkdir(path.dirname(file), { recursive: true })
    .then(() => fs.promises.writeFile(tmp, text, 'utf8'))
    .then(() => fs.promises.rename(tmp, file))
    .catch((err) => console.error('[downloads] Не удалось сохранить историю загрузок:', err));
}

function writeStoreSync(payload) {
  try {
    if (storage && typeof storage.saveDownloads === 'function' && storage.saveDownloads(payload) !== false) return;
  } catch { /* пишем в собственный файл */ }
  const file = storeFile();
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('[downloads] Не удалось сохранить историю загрузок:', err);
  }
}

const clampStr = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const clampNum = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

const shortenName = (str, max = 200) => (str.length > max ? `${str.slice(0, max - 1)}…` : str);

class DownloadManager {
  constructor({ getWindow, onChange }) {
    this.getWindow = getWindow;
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    this.entries = []; // новые сверху, максимум MAX_HISTORY
    this.nextId = 1;
    this._persistTimer = null;
    this._restore(readStore());
    this._reserved = new Set(); // пути, занятые активными загрузками
    this._attached = new Map(); // ses -> { handler, incognito }
    this._notifyTimer = null;
    this._promptChain = Promise.resolve(); // диалоги предупреждений показываем по очереди
    app.on('before-quit', () => this.flush());
  }

  _isLive(e) {
    return e.state === 'progressing' || e.state === 'paused';
  }

  // ---- Сохранение истории на диск (инкогнито не пишем никогда) ----
  _restore(raw) {
    const list = raw && Array.isArray(raw.items) ? raw.items : [];
    const seen = new Set();
    const out = [];
    let maxId = 0;
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const id = Number.isInteger(r.id) && r.id > 0 ? r.id : 0;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      maxId = Math.max(maxId, id);
      const state = VALID_STATES.has(r.state) ? r.state : 'interrupted';
      out.push({
        id,
        incognito: false,
        name: clampStr(r.name, 260) || 'download',
        savePath: clampStr(r.savePath, 1024),
        url: clampStr(r.url, 2048),
        // загрузка, оборвавшаяся вместе с предыдущим сеансом, после перезапуска «прервана»
        state: state === 'progressing' || state === 'paused' ? 'interrupted' : state,
        received: clampNum(r.received),
        total: clampNum(r.total),
        checking: false,
        verdict: VALID_VERDICTS.has(r.verdict) ? r.verdict : 'ok',
        origPath: clampStr(r.origPath, 1024),
        reason: clampStr(r.reason, 400),
        ses: null,
        speed: 0,
        startedAt: clampNum(r.startedAt),
        endedAt: clampNum(r.endedAt),
        _t: 0, _r: 0, _u: 0, _exists: true, _existsAt: 0,
        item: null
      });
      if (out.length >= MAX_HISTORY) break;
    }
    this.entries = out;
    this.nextId = maxId + 1;
  }

  _serialize() {
    const items = this.entries.filter((e) => !e.incognito).slice(0, MAX_HISTORY).map((e) => ({
      id: e.id,
      name: e.name,
      savePath: e.savePath,
      url: e.url,
      state: this._isLive(e) ? 'interrupted' : e.state,
      received: e.received,
      total: e.total,
      verdict: e.verdict,
      origPath: e.origPath,
      reason: e.reason,
      startedAt: e.startedAt || 0,
      endedAt: e.endedAt || 0
    }));
    return { version: STORE_VERSION, items };
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      writeStoreAsync(this._serialize());
    }, PERSIST_DELAY_MS);
  }

  // Синхронная запись (выход из приложения)
  flush() {
    if (this._persistTimer) { clearTimeout(this._persistTimer); this._persistTimer = null; }
    writeStoreSync(this._serialize());
  }

  attach(ses, { incognito = false } = {}) {
    if (!ses || this._attached.has(ses)) return;
    const handler = (_event, item) => this._onWillDownload(item, incognito, ses);
    this._attached.set(ses, { handler, incognito });
    ses.on('will-download', handler);
  }

  detach(ses) {
    const rec = this._attached.get(ses);
    if (!rec) return;
    try { ses.removeListener('will-download', rec.handler); } catch { /* сессия уже уничтожена */ }
    this._attached.delete(ses);
  }

  // Выход из Инкогнито: отменяем активные и убираем все инкогнито-записи из меню
  // ses задан — трогаем только записи этой Инкогнито-сессии (закрытие одного окна не должно ломать загрузки другого)
  clearIncognito(ses = null) {
    const match = (e) => e.incognito && (!ses || e.ses === ses);
    for (const e of this.entries) {
      if (match(e) && e.item) { try { e.item.cancel(); } catch { /* уже завершена */ } }
    }
    this.entries = this.entries.filter((e) => !match(e));
    this._notify(true);
  }

  _downloadsDir() {
    const dir = app.getPath('downloads');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* папка уже есть или недоступна */ }
    return dir;
  }

  // file.ext -> file (1).ext -> file (2).ext ...
  _uniquePath(dir, fileName) {
    const ext = path.extname(fileName);
    const stem = ext ? fileName.slice(0, -ext.length) : fileName;
    let candidate = path.join(dir, fileName);
    let n = 0;
    while ((fs.existsSync(candidate) || this._reserved.has(candidate.toLowerCase())) && n < 10000) {
      n += 1;
      candidate = path.join(dir, `${stem} (${n})${ext}`);
    }
    return candidate;
  }

  _onWillDownload(item, incognito = false, ses = null) {
    const safeName = sanitizeFileName(item.getFilename());
    const dangerous = isDangerousFileName(safeName);
    let savePath = null; // для обычных файлов известен сразу, для опасных — после выбора в диалоге

    if (dangerous) {
      // setSavePath намеренно НЕ вызываем: Electron сам покажет системный диалог «Сохранить как» и без выбора
      // пользователя ничего не запишет. (item.setSavePath обязан вызываться синхронно внутри will-download,
      // поэтому await dialog.showSaveDialog здесь не годится — Electron к тому моменту уже выберет путь сам.)
      // setSaveDialogOptions настраивает именно этот диалог — это тот же системный showSaveDialog.
      try {
        item.setSaveDialogOptions({
          title: 'Сохранить потенциально опасный файл?',
          defaultPath: path.join(this._downloadsDir(), safeName),
          buttonLabel: 'Сохранить',
          message: 'Файл может запускать программы. Сохраняйте его, только если доверяете сайту.'
        });
      } catch {
        // старый Electron без setSaveDialogOptions: диалог всё равно покажет сам Electron (путь не задан)
      }
    } else {
      savePath = this._uniquePath(this._downloadsDir(), safeName);
      this._reserved.add(savePath.toLowerCase());
      item.setSavePath(savePath);
    }

    const entry = {
      id: this.nextId++,
      incognito,
      name: savePath ? path.basename(savePath) : safeName,
      savePath: savePath || '',
      url: item.getURL(),
      state: 'progressing',
      received: 0,
      total: item.getTotalBytes() || 0,
      checking: false, // идёт проверка magic bytes
      verdict: 'ok', // 'ok' | 'mismatch' | 'blocked' | 'kept' (оставлен пользователем)
      origPath: '',
      reason: '',
      ses, // сессия-источник: нужна для «Повторить»
      speed: 0, // сглаженная скорость, байт/с
      startedAt: Date.now(),
      endedAt: 0,
      _u: Date.now(),
      _t: Date.now(),
      _r: 0,
      _exists: true,
      _existsAt: 0,
      item
    };
    this.entries.unshift(entry);
    this._trim();
    this._notify(true);

    // Для опасных файлов путь становится известен только после выбора в диалоге
    const syncChosenPath = () => {
      if (savePath) return;
      let chosen = '';
      try { chosen = item.getSavePath(); } catch { chosen = ''; }
      if (chosen) {
        savePath = chosen;
        entry.savePath = chosen;
        entry.name = path.basename(chosen);
      }
    };

    item.on('updated', (_e, state) => {
      syncChosenPath();
      let paused = false;
      try { paused = state !== 'interrupted' && item.isPaused(); } catch { paused = false; }
      entry.state = state === 'interrupted' ? 'interrupted' : (paused ? 'paused' : 'progressing');
      entry.received = item.getReceivedBytes();
      entry.total = item.getTotalBytes() || entry.total;
      const now = Date.now();
      entry._u = now;
      const dt = now - entry._t;
      if (dt >= 500) {
        const inst = Math.max(0, ((entry.received - entry._r) * 1000) / dt);
        entry.speed = entry.speed ? entry.speed * 0.6 + inst * 0.4 : inst;
        entry._t = now;
        entry._r = entry.received;
      }
      if (entry.state !== 'progressing') entry.speed = 0;
      this._notify(false);
    });

    item.on('done', (_e, state) => {
      syncChosenPath();
      entry.state = ['completed', 'cancelled', 'interrupted'].includes(state) ? state : 'interrupted';
      entry.received = item.getReceivedBytes();
      if (entry.state === 'completed') entry.total = entry.received || entry.total;
      entry.item = null;
      entry.speed = 0;
      entry.endedAt = Date.now();
      entry._existsAt = 0;
      if (savePath) this._reserved.delete(savePath.toLowerCase());
      if (entry.state === 'completed' && entry.savePath) entry.checking = true;
      this._trim();
      this._notify(true);
      if (entry.checking) this._verify(entry);
    });
  }

  // Проверка готового файла по magic bytes. Исполняемый файл под «безопасным» расширением нейтрализуем (.blocked)
  async _verify(entry) {
    try {
      const res = await inspectFile(entry.savePath);
      if (res.verdict === 'blocked') {
        entry.origPath = entry.savePath;
        const target = this._uniquePath(path.dirname(entry.savePath), `${path.basename(entry.savePath)}.blocked`);
        try {
          await fs.promises.rename(entry.savePath, target);
          entry.savePath = target;
          entry.name = path.basename(target);
        } catch {
          // не смогли переименовать: файл остаётся, но в меню он помечен как заблокированный (без «Открыть»)
        }
      }
      entry.verdict = res.verdict;
      entry.reason = res.reason;
    } finally {
      entry.checking = false;
      entry._existsAt = 0;
      this._notify(true);
    }
    if (entry.verdict === 'blocked') this._promptBlocked(entry);
  }

  // Явное предупреждение о подмене типа файла: удалить / оставить / решить позже (файл остаётся заблокированным)
  _promptBlocked(entry) {
    this._promptChain = this._promptChain.then(async () => {
      if (entry.verdict !== 'blocked' || !this.entries.includes(entry)) return;
      const win = this.getWindow();
      const opts = {
        type: 'warning',
        title: 'Опасный файл',
        message: `Файл «${entry.name.replace(/\.blocked$/, '')}» может быть опасным`,
        detail: `${entry.reason}.\n\nТакой приём используют, чтобы заставить вас запустить вредоносную программу. ` +
          'Рекомендуем удалить файл. Пока вы не решите, он остаётся заблокированным.',
        buttons: ['Удалить файл', 'Оставить всё равно', 'Решить позже'],
        defaultId: 0,
        cancelId: 2,
        noLink: true
      };
      let res;
      try {
        res = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      } catch { return; }
      if (entry.verdict !== 'blocked' || !this.entries.includes(entry)) return;
      if (res.response === 0) await this.deleteBlocked(entry.id);
      else if (res.response === 1) await this.keepBlocked(entry.id);
    }).catch(() => {});
  }

  // «Оставить всё равно»: возвращаем исходное имя и снимаем блокировку
  async keepBlocked(id) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.verdict !== 'blocked') return;
    if (entry.origPath && entry.savePath !== entry.origPath) {
      try {
        const target = this._uniquePath(path.dirname(entry.origPath), path.basename(entry.origPath));
        await fs.promises.rename(entry.savePath, target);
        entry.savePath = target;
        entry.name = path.basename(target);
      } catch {
        // не смогли вернуть имя: файл остаётся под именем .blocked
      }
    }
    entry.verdict = 'kept';
    entry.reason = '';
    entry._existsAt = 0;
    this._notify(true);
  }

  async deleteBlocked(id) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry || entry.verdict !== 'blocked') return;
    try { await fs.promises.unlink(entry.savePath); } catch { /* уже удалён */ }
    this.entries = this.entries.filter((e) => e.id !== id);
    this._notify(true);
  }

  // Храним последние MAX_HISTORY загрузок; активные не выбрасываем
  _trim() {
    for (let i = this.entries.length - 1; i >= 0 && this.entries.length > MAX_HISTORY; i--) {
      if (!this._isLive(this.entries[i])) this.entries.splice(i, 1);
    }
  }

  _notify(immediate) {
    if (immediate) {
      this._schedulePersist();
      if (this._notifyTimer) { clearTimeout(this._notifyTimer); this._notifyTimer = null; }
      this.onChange();
      return;
    }
    if (this._notifyTimer) return;
    this._notifyTimer = setTimeout(() => {
      this._notifyTimer = null;
      this.onChange();
    }, NOTIFY_THROTTLE_MS);
  }

  _percent(entry) {
    if (entry.state === 'completed') return 100;
    return entry.total > 0 ? Math.min(100, Math.floor((entry.received / entry.total) * 100)) : 0;
  }

  // Записи, видимые окну: обычный режим и Инкогнито не видят загрузки друг друга,
  // а каждое окно Инкогнито (своя сессия ses) не видит загрузки других окон Инкогнито
  _inScope(e, { incognito = false, ses = null } = {}) {
    if (Boolean(e.incognito) !== Boolean(incognito)) return false;
    return !incognito || !ses || e.ses === ses;
  }

  _scoped(incognito, ses = null) {
    return this.entries.filter((e) => this._inScope(e, { incognito, ses }));
  }

  // Принадлежит ли запись этому окну (для действий над записью по id)
  canAccess(id, scope = {}) {
    const e = this._find(id);
    return Boolean(e) && this._inScope(e, scope);
  }

  getSummary({ incognito = false, ses = null } = {}) {
    const entries = this._scoped(incognito, ses);
    const active = entries.filter((e) => this._isLive(e));
    let received = 0;
    let total = 0;
    for (const e of active) {
      if (e.total > 0) { received += e.received; total += e.total; }
    }
    return {
      activeCount: active.length,
      progress: total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0,
      totalItems: entries.length
    };
  }

  cancel(id) {
    const entry = this.entries.find((e) => e.id === id);
    if (entry && entry.item) {
      try { entry.item.cancel(); } catch { /* уже завершена */ }
    }
  }

  clearFinished({ incognito = false, ses = null } = {}) {
    this.clearHistory({ incognito, ses });
  }

  // ---- Данные и действия для попапа «Загрузки» (downloadsPopup.js) ----
  _find(id) {
    return this.entries.find((e) => e.id === id) || null;
  }

  // Файл на месте? Результат кешируется; недоступный сетевой диск не блокирует интерфейс дольше таймаута
  async _fileExists(entry) {
    if (!entry.savePath) return false;
    const now = Date.now();
    if (entry._existsAt && now - entry._existsAt < EXISTS_TTL_MS) return entry._exists;
    entry._existsAt = now;
    const path0 = entry.savePath;
    const ok = await Promise.race([
      fs.promises.access(path0).then(() => true, () => false),
      new Promise((resolve) => { setTimeout(() => resolve(true), EXISTS_TIMEOUT_MS); }) // не знаем — не говорим «удалён»
    ]);
    if (entry.savePath === path0) entry._exists = ok;
    return ok;
  }

  _canRetry(e) {
    if (e.state === 'interrupted' && e.item) return true; // докачка той же загрузки
    if (e.state !== 'cancelled' && e.state !== 'interrupted') return false;
    return this._retrySession(e) !== null && /^https?:\/\//i.test(e.url);
  }

  // Сессия для повторной загрузки: у записей из прошлых сеансов своей сессии нет — берём обычную
  _retrySession(e) {
    if (e.ses) return e.ses;
    return e.incognito ? null : session.defaultSession;
  }

  _etaSeconds(e) {
    if (e.state !== 'progressing' || e.total <= 0 || e.speed <= 0) return 0;
    return Math.max(0, Math.round((e.total - e.received) / e.speed));
  }

  // Сериализуемый снимок для рендерера попапа. Пути к файлам и URL наружу не отдаём
  async getPopupModel({ incognito = false, ses = null } = {}) {
    const scoped = this._scoped(incognito, ses);
    const entries = scoped.slice(0, MAX_ITEMS);
    const items = await Promise.all(entries.map(async (e) => {
      const completed = e.state === 'completed';
      const exists = completed && !e.checking ? await this._fileExists(e) : false;
      let host = '';
      try {
        const u = new URL(e.url);
        if (u.protocol === 'http:' || u.protocol === 'https:') host = u.host;
      } catch { /* blob:, data: и т.п. */ }
      const shown = e.name.replace(/\.blocked$/, '');
      return {
        id: e.id,
        name: shortenName(e.name),
        ext: path.extname(shown).slice(1).toUpperCase(),
        state: e.state === 'paused' ? 'progressing' : e.state, // попап «Пауза» не знает
        percent: this._isLive(e) ? (e.total > 0 ? this._percent(e) : -1) : (completed ? 100 : 0),
        received: e.received,
        total: e.total,
        speed: e.state === 'progressing' ? Math.round(e.speed) : 0,
        etaSec: this._etaSeconds(e),
        awaitingPath: e.state === 'progressing' && !e.savePath,
        checking: Boolean(e.checking),
        verdict: e.verdict,
        reason: e.reason || '',
        exists,
        canRetry: this._canRetry(e),
        canCancel: Boolean(e.item),
        incognito: Boolean(e.incognito),
        host
      };
    }));
    const activeCount = scoped.filter((e) => this._isLive(e)).length;
    return { items, activeCount, finishedCount: scoped.length - activeCount };
  }

  // «Открыть файл»: только готовый, проверенный и не заблокированный; путь берём из записи, а не из рендерера
  async openFile(id) {
    const e = this._find(id);
    if (!e || e.state !== 'completed' || e.checking || e.verdict === 'blocked' || !e.savePath) return false;
    e._existsAt = 0;
    if (!(await this._fileExists(e))) {
      this._notify(true); // интерфейс покажет «Файл удалён или перемещён»
      return false;
    }
    if (needsLaunchConfirm(e.savePath)) {
      const win = this.getWindow();
      const opts = {
        type: 'warning',
        title: 'Запуск потенциально опасного файла',
        message: `Открыть файл «${path.basename(e.savePath)}»?`,
        detail: 'Исполняемые файлы и скрипты могут нанести вред компьютеру. Запускайте файл, только если доверяете источнику.',
        buttons: ['Запустить', 'Отмена'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      };
      let res;
      try {
        res = win && !win.isDestroyed() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
      } catch {
        return false;
      }
      if (res.response !== 0) return false;
    }
    try {
      return (await shell.openPath(e.savePath)) === '';
    } catch {
      return false;
    }
  }

  showInFolder(id) {
    const e = this._find(id);
    if (e && e.state === 'completed' && e.savePath) shell.showItemInFolder(e.savePath);
  }

  openDownloadsFolder() {
    shell.openPath(app.getPath('downloads')).catch(() => {});
  }

  // Повторить: докачать прерванную (если Chromium позволяет) или начать заново с того же URL в той же сессии
  retry(id) {
    const e = this._find(id);
    if (!e || !this._canRetry(e)) return false;
    if (e.item) {
      try {
        if (e.item.canResume()) {
          e.item.resume();
          e.state = 'progressing';
          this._notify(true);
          return true;
        }
      } catch { /* перейдём к новой загрузке */ }
    }
    const ses = this._retrySession(e);
    if (!ses || typeof ses.downloadURL !== 'function') return false;
    try {
      ses.downloadURL(e.url);
    } catch (err) {
      console.error('[downloads] Не удалось повторить загрузку:', err);
      return false;
    }
    if (e.item) { try { e.item.cancel(); } catch { /* уже завершена */ } }
    this.entries = this.entries.filter((x) => x !== e); // новая запись появится сверху через will-download
    this._notify(true);
    return true;
  }

  // «Оставить всё равно…»: тот же диалог подтверждения, что и при автоматическом предупреждении
  reviewBlocked(id) {
    const e = this._find(id);
    if (e && e.verdict === 'blocked') this._promptBlocked(e);
  }

  // ---- Страница browser://downloads ----
  _status(e) {
    return e.state === 'completed' && e.verdict === 'blocked' ? 'blocked' : e.state;
  }

  _canResume(e) {
    if (!e.item || (e.state !== 'paused' && e.state !== 'interrupted')) return false;
    try { return Boolean(e.item.canResume()); } catch { return false; }
  }

  // Снимок для страницы. В обычном окне — только обычные загрузки, в Инкогнито — только инкогнито-сеанса.
  // Полные пути и URL наружу не отдаём (только имя и хост)
  async getPageModel({ incognito = false, ses = null } = {}) {
    const inc = Boolean(incognito);
    const now = Date.now();
    const entries = this._scoped(inc, ses);
    const items = await Promise.all(entries.map(async (e) => {
      const live = this._isLive(e);
      const completed = e.state === 'completed';
      const status = this._status(e);
      const exists = completed && !e.checking ? await this._fileExists(e) : false;
      let host = '';
      try {
        const u = new URL(e.url);
        if (u.protocol === 'http:' || u.protocol === 'https:') host = u.host;
      } catch { /* blob:, data: и т.п. */ }
      const shown = e.name.replace(/\.blocked$/, '');
      const speed = e.state === 'progressing' && now - (e._u || 0) < STALE_SPEED_MS ? Math.round(e.speed) : 0;
      let percent;
      if (completed) percent = 100;
      else if (e.total > 0) percent = Math.min(100, Math.floor((e.received / e.total) * 100));
      else percent = live ? -1 : 0;
      const canResume = this._canResume(e);
      return {
        id: e.id,
        name: shortenName(e.name),
        ext: path.extname(shown).slice(1).toUpperCase().slice(0, 5),
        status, // progressing | paused | completed | cancelled | interrupted | blocked
        percent, // 0..100, -1 — размер неизвестен
        received: e.received,
        total: e.total,
        speed, // байт/с
        speedText: formatSpeed(speed), // «512 КБ/с» / «3,4 МБ/с»
        etaSec: this._etaSeconds(e),
        awaitingPath: e.state === 'progressing' && !e.savePath,
        checking: Boolean(e.checking),
        reason: e.reason || '',
        missing: completed && !e.checking && !exists,
        host,
        startedAt: e.startedAt || 0,
        endedAt: e.endedAt || 0,
        incognito: Boolean(e.incognito),
        canPause: Boolean(e.item) && e.state === 'progressing',
        canResume,
        canCancel: Boolean(e.item),
        canRetry: !canResume && this._canRetry(e),
        canOpen: completed && !e.checking && e.verdict !== 'blocked' && exists,
        canShow: completed && !e.checking && Boolean(e.savePath),
        canReview: status === 'blocked' && !e.checking,
        canRemove: !live
      };
    }));
    const active = items.filter((i) => i.status === 'progressing' || i.status === 'paused');
    const totalSpeed = active.reduce((sum, i) => sum + i.speed, 0);
    return {
      items,
      incognito: inc,
      activeCount: active.length,
      busy: active.length > 0 || items.some((i) => i.checking),
      totalSpeed,
      totalSpeedText: formatSpeed(totalSpeed)
    };
  }

  pause(id) {
    const e = this._find(id);
    if (!e || !e.item || e.state !== 'progressing') return false;
    try { e.item.pause(); } catch { return false; }
    e.state = 'paused';
    e.speed = 0;
    this._notify(true);
    return true;
  }

  resume(id) {
    const e = this._find(id);
    if (!e || !this._canResume(e)) return false;
    try { e.item.resume(); } catch { return false; }
    e.state = 'progressing';
    e._t = Date.now();
    e._r = e.received;
    e._u = Date.now();
    this._notify(true);
    return true;
  }

  // «Убрать из списка»: только завершённые записи; файл на диске не трогаем
  remove(id) {
    const e = this._find(id);
    if (!e || this._isLive(e)) return false;
    if (e.item) { try { e.item.cancel(); } catch { /* уже завершена */ } }
    this.entries = this.entries.filter((x) => x !== e);
    this._notify(true);
    return true;
  }

  // «Очистить историю»: завершённые записи текущего режима (активные остаются, файлы на диске не трогаем)
  clearHistory({ incognito = false, ses = null } = {}) {
    const inScope = (e) => this._inScope(e, { incognito, ses });
    for (const e of this.entries) {
      if (inScope(e) && !this._isLive(e) && e.item) { try { e.item.cancel(); } catch { /* уже завершена */ } }
    }
    this.entries = this.entries.filter((e) => this._isLive(e) || !inScope(e));
    this._notify(true);
  }
}

module.exports = DownloadManager;
module.exports.needsLaunchConfirm = needsLaunchConfirm; // для тестов
