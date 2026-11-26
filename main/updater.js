'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const state = { status: 'idle', message: '', version: null, percent: 0, busy: false };
let au = null;

const set = (patch) => Object.assign(state, patch);
const errText = (err) => String((err && err.message) || err || 'Неизвестная ошибка').split('\n')[0].slice(0, 200);

// Источник обновлений обязан быть HTTPS (для github-провайдера url в app-update.yml нет)
function feedIsHttps() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const m = /^url:\s*(\S+)/m.exec(yml);
    return !m || m[1].startsWith('https://');
  } catch {
    return false;
  }
}

// Заглушки из шаблона: url на example.com или owner/repo вида «ВАШ_…» (github-провайдер).
// Пока их не заменили на настоящие, проверять нечего
function feedIsPlaceholder() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
    const url = /^url:\s*(\S+)/m.exec(yml);
    if (url) {
      const host = new URL(url[1]).hostname.toLowerCase();
      if (host === 'example.com' || host.endsWith('.example.com')) return true;
    }
    for (const key of ['owner', 'repo']) {
      const m = new RegExp('^' + key + ':\\s*(.+)$', 'm').exec(yml);
      if (m && /^["']?\s*(ВАШ|YOUR)[_-]/i.test(m[1].trim())) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function unsupportedReason() {
  if (!app.isPackaged) return 'Проверка обновлений доступна только в установленной сборке.';
  if (process.env.PORTABLE_EXECUTABLE_DIR) return 'Portable-версия не обновляется автоматически: скачайте новую версию вручную.';
  if (!feedIsHttps()) return 'Источник обновлений должен использовать HTTPS.';
  if (feedIsPlaceholder()) return 'Адрес сервера обновлений ещё не настроен (publish в package.json).';
  return null;
}

function getAu() {
  if (au) return au;
  ({ autoUpdater: au } = require('electron-updater'));
  au.autoDownload = false;
  au.autoInstallOnAppQuit = false;
  au.allowDowngrade = false;
  au.allowPrerelease = false;
  au.disableWebInstaller = true;
  au.logger = null;
  au.on('update-available', (info) => set({
    status: 'available', version: info.version, message: `Доступна версия ${info.version}`
  }));
  au.on('update-not-available', () => set({
    status: 'uptodate', version: null, message: `Установлена последняя версия (${app.getVersion()})`
  }));
  au.on('download-progress', (p) => set({
    status: 'downloading', percent: Math.round(p.percent || 0), message: `Загрузка… ${Math.round(p.percent || 0)}%`
  }));
  au.on('update-downloaded', (info) => set({
    status: 'downloaded', percent: 100, message: `Версия ${info.version} загружена и проверена. Готова к установке`
  }));
  return au;
}

const getState = () => ({ ...state, currentVersion: app.getVersion() });

async function check() {
  if (state.busy) return getState();
  const why = unsupportedReason();
  if (why) { set({ status: 'unsupported', message: why }); return getState(); }
  set({ busy: true, status: 'checking', message: 'Проверяю обновления…' });
  try {
    await getAu().checkForUpdates();
  } catch (err) {
    set({ status: 'error', message: `Не удалось проверить обновления: ${errText(err)}` });
  } finally {
    set({ busy: false });
  }
  return getState();
}

async function download() {
  if (state.busy || state.status !== 'available') return getState();
  set({ busy: true, status: 'downloading', percent: 0, message: 'Загрузка… 0%' });
  try {
    await getAu().downloadUpdate(); // SHA-512 (и подпись на Windows) проверяются внутри electron-updater
  } catch (err) {
    set({ status: 'error', message: `Не удалось загрузить обновление: ${errText(err)}` });
  } finally {
    set({ busy: false });
  }
  return getState();
}

function install() {
  if (state.status !== 'downloaded') return getState();
  getAu().quitAndInstall(false, true); // before-quit в index.js сам сохранит сессию
  return getState();
}

module.exports = { getState, check, download, install };
