'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const FILE_NAME = 'passwords.enc.json';
const FILE_VERSION = 1;
const MAX_ENTRIES = 5000;
const MAX_USERNAME = 256;
const MAX_PASSWORD = 1024;
const MAX_ENCRYPTED_B64 = 8192;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const ID_RE = /^[a-z0-9-]{1,64}$/i;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const ERR_UNAVAILABLE =
  'Безопасное хранилище ОС недоступно (Windows DPAPI / системная связка ключей), поэтому пароли не сохраняются. ' +
  'Пароли никогда не записываются на диск открытым текстом.';
const ERR_READ = 'Не удалось прочитать файл с паролями.';
const ERR_WRITE = 'Не удалось записать файл с паролями.';
const ERR_NOT_FOUND = 'Запись не найдена.';

const fail = (error) => ({ ok: false, error });

let cache = null; // Array<{ id, origin, host, username, encryptedPassword, updatedAt }>

function filePath() {
  return path.join(app.getPath('userData'), FILE_NAME);
}

// Шифрование доступно, только если ОС реально защищает ключ.
// Linux: при backend 'basic_text' Chromium хранит ключ открытым текстом — считаем это «недоступно».
function isAvailable() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text';
    }
    return true;
  } catch {
    return false;
  }
}

// Допустимы только https: и http://localhost | http://127.0.0.1. Возвращает { origin, host } или null
function normalizeOrigin(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.username || u.password || !u.hostname) return null;
  const secure = u.protocol === 'https:';
  const local = u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname);
  if (!secure && !local) return null;
  return { origin: u.origin, host: u.hostname };
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = normalizeOrigin(raw.origin);
  if (!o) return null;
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
  if (typeof raw.username !== 'string' || raw.username.length > MAX_USERNAME) return null;
  const enc = raw.encryptedPassword;
  if (typeof enc !== 'string' || !enc || enc.length > MAX_ENCRYPTED_B64 || !B64_RE.test(enc)) return null;
  return {
    id: raw.id,
    origin: o.origin,
    host: o.host,
    username: raw.username,
    encryptedPassword: enc,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  };
}

// Битый JSON не затираем молча: откладываем в сторону и начинаем с пустого списка
function quarantine() {
  try {
    const f = filePath();
    fs.renameSync(f, `${f}.corrupt-${Date.now()}`);
  } catch { /* файла уже нет */ }
}

// Бросает исключение при ошибке чтения (кроме ENOENT), чтобы пустой список не перезаписал нечитаемый файл
function load() {
  if (cache) return cache;
  let text;
  try {
    text = fs.readFileSync(filePath(), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') { cache = []; return cache; }
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    quarantine();
    cache = [];
    return cache;
  }
  const raw = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
  const byKey = new Map(); // origin + username → запись (при дублях остаётся более новая)
  for (const item of raw) {
    const e = sanitizeEntry(item);
    if (!e) continue;
    const key = `${e.origin}\n${e.username}`;
    const prev = byKey.get(key);
    if (!prev || e.updatedAt >= prev.updatedAt) byKey.set(key, e);
  }
  cache = Array.from(byKey.values()).slice(0, MAX_ENTRIES);
  return cache;
}

// Атомарная запись: временный файл → fsync → rename. В файле только base64 шифртекста
function persist(entries) {
  const target = filePath();
  const tmp = `${target}.${process.pid}.tmp`;
  let fd = null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeSync(fd, JSON.stringify({ version: FILE_VERSION, entries }, null, 2), null, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, target);
    return true;
  } catch (err) {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    console.error('[passwords] Ошибка записи:', err && err.code ? err.code : 'unknown'); // пароль и данные не логируем
    return false;
  }
}

const publicView = (e) => ({ id: e.id, origin: e.origin, host: e.host, username: e.username, updatedAt: e.updatedAt });

// Метаданные без паролей
function list() {
  try {
    return load()
      .map(publicView)
      .sort((a, b) => a.host.localeCompare(b.host) || a.username.localeCompare(b.username));
  } catch {
    return [];
  }
}

// Добавление/обновление по origin + username. Без доступного шифрования — отказ, на диск ничего не пишется
function upsert(input) {
  const src = input && typeof input === 'object' ? input : {};
  const o = normalizeOrigin(src.origin);
  if (!o) return fail('Недопустимый адрес сайта: разрешены только https:// и http://localhost / http://127.0.0.1.');
  const username = typeof src.username === 'string' ? src.username.trim() : null;
  if (username === null || username.length > MAX_USERNAME) return fail('Некорректный логин.');
  const password = src.password;
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD) return fail('Некорректный пароль.');
  if (!isAvailable()) return fail(ERR_UNAVAILABLE);

  let current;
  try { current = load(); } catch { return fail(ERR_READ); }

  let encrypted;
  try { encrypted = safeStorage.encryptString(password).toString('base64'); } catch { return fail('Не удалось зашифровать пароль.'); }

  const now = Date.now();
  const idx = current.findIndex((e) => e.origin === o.origin && e.username === username);
  if (idx === -1 && current.length >= MAX_ENTRIES) return fail(`Достигнут лимит сохранённых паролей (${MAX_ENTRIES}).`);

  const entry = {
    id: idx === -1 ? crypto.randomUUID() : current[idx].id,
    origin: o.origin,
    host: o.host,
    username,
    encryptedPassword: encrypted,
    updatedAt: now
  };
  const next = current.slice();
  if (idx === -1) next.push(entry); else next[idx] = entry;
  if (!persist(next)) return fail(ERR_WRITE);
  cache = next;
  return { ok: true, id: entry.id, created: idx === -1 };
}

// Расшифровка одного пароля по id (по запросу, в памяти открытый текст не хранится)
function reveal(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return fail(ERR_NOT_FOUND);
  let current;
  try { current = load(); } catch { return fail(ERR_READ); }
  const e = current.find((x) => x.id === id);
  if (!e) return fail(ERR_NOT_FOUND);
  if (!isAvailable()) return fail(ERR_UNAVAILABLE);
  try {
    return { ok: true, password: safeStorage.decryptString(Buffer.from(e.encryptedPassword, 'base64')) };
  } catch {
    return fail('Не удалось расшифровать пароль: данные повреждены или созданы под другой учётной записью ОС.');
  }
}

// true, если для origin + username уже сохранён ровно такой пароль (сравнение после расшифровки, ничего не кэшируется)
function isSaved(origin, username, password) {
  const o = normalizeOrigin(origin);
  if (!o || typeof username !== 'string' || typeof password !== 'string' || !isAvailable()) return false;
  let current;
  try { current = load(); } catch { return false; }
  const e = current.find((x) => x.origin === o.origin && x.username === username.trim());
  if (!e) return false;
  try {
    const a = Buffer.from(safeStorage.decryptString(Buffer.from(e.encryptedPassword, 'base64')), 'utf8');
    const b = Buffer.from(password, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function samePassword(entry, password) {
  try {
    const a = Buffer.from(safeStorage.decryptString(Buffer.from(entry.encryptedPassword, 'base64')), 'utf8');
    const b = Buffer.from(password, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// RFC 4180: кавычки "", запятые и переводы строк внутри полей, CRLF/LF/CR, BOM
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"' && field === '') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = ''; rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

// Импорт CSV из Chrome (name,url,username,password). Одна запись на диск в конце
function importFromCsv(csvText) {
  if (typeof csvText !== 'string' || !csvText.trim()) return fail('Файл пуст.');
  if (!isAvailable()) return fail(ERR_UNAVAILABLE);
  const rows = parseCsv(csvText);
  const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
  const ci = { url: head.indexOf('url'), user: head.indexOf('username'), pass: head.indexOf('password') };
  if (ci.url < 0 || ci.user < 0 || ci.pass < 0) {
    return fail('Это не CSV-экспорт паролей Chrome (нужны колонки name, url, username, password).');
  }
  let current;
  try { current = load(); } catch { return fail(ERR_READ); }

  const next = current.slice();
  const index = new Map(next.map((e, n) => [`${e.origin}\n${e.username}`, n]));
  const seen = new Set();
  const stats = { imported: 0, updated: 0, skipped: 0 };
  const now = Date.now();

  for (const r of rows.slice(1)) {
    const o = normalizeOrigin(r[ci.url]);
    const username = typeof r[ci.user] === 'string' ? r[ci.user].trim() : null;
    const password = r[ci.pass];
    if (!o || username === null || username.length > MAX_USERNAME ||
        typeof password !== 'string' || !password || password.length > MAX_PASSWORD) { stats.skipped++; continue; }
    const key = `${o.origin}\n${username}`;
    if (seen.has(key)) { stats.skipped++; continue; }
    seen.add(key);
    const idx = index.get(key);
    if (idx !== undefined && samePassword(next[idx], password)) { stats.skipped++; continue; }
    if (idx === undefined && next.length >= MAX_ENTRIES) { stats.skipped++; continue; }
    let enc;
    try { enc = safeStorage.encryptString(password).toString('base64'); } catch { stats.skipped++; continue; }
    if (enc.length > MAX_ENCRYPTED_B64) { stats.skipped++; continue; }
    const entry = {
      id: idx === undefined ? crypto.randomUUID() : next[idx].id,
      origin: o.origin, host: o.host, username, encryptedPassword: enc, updatedAt: now
    };
    if (idx === undefined) { index.set(key, next.push(entry) - 1); stats.imported++; }
    else { next[idx] = entry; stats.updated++; }
  }

  if (stats.imported || stats.updated) {
    if (!persist(next)) return fail(ERR_WRITE);
    cache = next;
  }
  return { ok: true, ...stats };
}

// remove/clear только удаляют, поэтому работают и без доступного шифрования
function remove(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return fail(ERR_NOT_FOUND);
  let current;
  try { current = load(); } catch { return fail(ERR_READ); }
  if (!current.some((e) => e.id === id)) return fail(ERR_NOT_FOUND);
  const next = current.filter((e) => e.id !== id);
  if (!persist(next)) return fail(ERR_WRITE);
  cache = next;
  return { ok: true };
}

function clear() {
  let current;
  try { current = load(); } catch { return fail(ERR_READ); }
  if (!persist([])) return fail(ERR_WRITE);
  cache = [];
  return { ok: true, removed: current.length };
}

module.exports = { isAvailable, normalizeOrigin, list, upsert, reveal, isSaved, importFromCsv, remove, clear };
