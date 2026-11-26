'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_EXTENSIONS = 50;
const listFile = () => path.join(app.getPath('userData'), 'extensions.json');
const loaded = new Map(); // ключ пути -> { id, name, version }
const errors = new Map(); // ключ пути -> текст ошибки
const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const errText = (err) => String((err && err.message) || err || 'Ошибка').split('\n')[0].slice(0, 200);
// Electron 35+: session.extensions.loadExtension; старый session.loadExtension — запасной вариант
const extApi = (ses) => (ses.extensions && typeof ses.extensions.loadExtension === 'function' ? ses.extensions : ses);

function readList() {
  try {
    const arr = JSON.parse(fs.readFileSync(listFile(), 'utf8'));
    return Array.isArray(arr) ? arr.filter((p) => typeof p === 'string' && p.length < 1024).slice(0, MAX_EXTENSIONS) : [];
  } catch {
    return [];
  }
}

function writeList(list) {
  const f = listFile();
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, f);
}

async function loadOne(ses, dir) {
  try {
    const st = await fs.promises.stat(dir);
    if (!st.isDirectory()) throw new Error('Это не папка');
    let manifest;
    try {
      manifest = JSON.parse(await fs.promises.readFile(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      throw new Error('В папке нет корректного manifest.json');
    }
    if (!manifest || typeof manifest.manifest_version !== 'number') throw new Error('manifest.json некорректен');
    const ext = await extApi(ses).loadExtension(dir, { allowFileAccess: false });
    loaded.set(key(dir), { id: ext.id, name: ext.name, version: ext.version });
    errors.delete(key(dir));
    return { ok: true };
  } catch (err) {
    loaded.delete(key(dir));
    errors.set(key(dir), errText(err));
    return { ok: false, error: errText(err) };
  }
}

// Автозагрузка при старте: одна сломанная папка не мешает остальным
async function loadSaved(ses) {
  for (const dir of readList()) await loadOne(ses, dir);
}

function list() {
  return readList().map((dir) => {
    const info = loaded.get(key(dir));
    return {
      path: dir,
      loaded: Boolean(info),
      name: info ? info.name : '',
      version: info ? info.version : '',
      error: info ? '' : (errors.get(key(dir)) || 'Не загружено')
    };
  });
}

async function add(ses, rawDir) {
  const dir = path.resolve(String(rawDir || ''));
  const saved = readList();
  if (saved.some((p) => key(p) === key(dir))) return { ok: false, error: 'Это расширение уже добавлено.' };
  if (saved.length >= MAX_EXTENSIONS) return { ok: false, error: `Максимум расширений: ${MAX_EXTENSIONS}.` };
  const r = await loadOne(ses, dir);
  if (!r.ok) { errors.delete(key(dir)); return r; }
  writeList([...saved, dir]);
  return { ok: true };
}

async function remove(ses, dir) {
  if (typeof dir !== 'string') return { ok: false, error: 'Некорректный запрос.' };
  const saved = readList();
  const target = saved.find((p) => key(p) === key(dir));
  if (!target) return { ok: false, error: 'Расширение не найдено.' };
  const info = loaded.get(key(target));
  if (info) {
    try { await extApi(ses).removeExtension(info.id); } catch { /* уже выгружено */ }
  }
  loaded.delete(key(target));
  errors.delete(key(target));
  writeList(saved.filter((p) => p !== target));
  return { ok: true };
}

module.exports = { loadSaved, list, add, remove };
