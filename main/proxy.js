'use strict';

// Встроенный менеджер прокси: проверка настроек и применение через session.setProxy().
// Модуль не зависит от storage.js (его можно безопасно require из storage.js).

const PROXY_MODES = ['system', 'direct', 'manual'];
const PROXY_PROTOCOLS = ['http', 'socks5'];
const PROXY_DEFAULT_BYPASS = 'localhost,127.0.0.1';

const PROXY_DEFAULTS = Object.freeze({
  proxyMode: 'system',
  proxyProtocol: 'http',
  proxyHost: '',
  proxyPort: 0,
  proxyBypassRules: PROXY_DEFAULT_BYPASS,
  proxyIncognitoOnly: false
});
const PROXY_KEYS = Object.keys(PROXY_DEFAULTS);

function normalizeHost(raw) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!s || s.length > 253) return null;
  if (/^\[[0-9a-f:.]+\]$/i.test(s)) return s.toLowerCase();
  if (s.includes(':') && /^[0-9a-f:.]+$/i.test(s)) return `[${s.toLowerCase()}]`; // IPv6 без скобок
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(s)) return null;
  return s.toLowerCase();
}

function normalizePort(raw) {
  const n = typeof raw === 'string' && /^\d{1,5}$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}

// Список через запятую/точку с запятой/пробел -> «a,b,c». Пустая строка допустима (обход не нужен)
function normalizeBypass(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  const parts = raw.split(/[,;\s]+/).filter(Boolean);
  if (parts.length > 128) return null;
  for (const p of parts) {
    if (p.length > 255 || !/^[\w.\-*:/[\]<>]+$/.test(p)) return null;
  }
  return parts.join(',');
}

// Значения из settings.json с откатом к значениям по умолчанию для всего невалидного
function readProxySettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const host = s.proxyHost ? normalizeHost(s.proxyHost) : null;
  const port = normalizePort(s.proxyPort);
  const bypass = s.proxyBypassRules === undefined ? PROXY_DEFAULT_BYPASS : normalizeBypass(s.proxyBypassRules);
  return {
    proxyMode: PROXY_MODES.includes(s.proxyMode) ? s.proxyMode : PROXY_DEFAULTS.proxyMode,
    proxyProtocol: PROXY_PROTOCOLS.includes(s.proxyProtocol) ? s.proxyProtocol : PROXY_DEFAULTS.proxyProtocol,
    proxyHost: host || '',
    proxyPort: port || 0,
    proxyBypassRules: bypass === null ? PROXY_DEFAULT_BYPASS : bypass,
    proxyIncognitoOnly: s.proxyIncognitoOnly === true
  };
}

// Проверка патча из IPC: { ok, clean } или { ok: false, error }
function sanitizeProxyPatch(patch, current) {
  const clean = {};
  for (const k of PROXY_KEYS) {
    if (!patch || !Object.prototype.hasOwnProperty.call(patch, k)) continue;
    const v = patch[k];
    if (k === 'proxyMode') {
      if (!PROXY_MODES.includes(v)) return { ok: false, error: 'Неизвестный режим прокси' };
      clean[k] = v;
    } else if (k === 'proxyProtocol') {
      if (!PROXY_PROTOCOLS.includes(v)) return { ok: false, error: 'Допустимы только HTTP и SOCKS5' };
      clean[k] = v;
    } else if (k === 'proxyHost') {
      if (v === '') { clean[k] = ''; continue; }
      const h = normalizeHost(v);
      if (!h) return { ok: false, error: 'Некорректный хост прокси' };
      clean[k] = h;
    } else if (k === 'proxyPort') {
      if (v === '' || v === 0 || v === null) { clean[k] = 0; continue; }
      const p = normalizePort(v);
      if (!p) return { ok: false, error: 'Порт должен быть числом от 1 до 65535' };
      clean[k] = p;
    } else if (k === 'proxyBypassRules') {
      const b = normalizeBypass(v);
      if (b === null) return { ok: false, error: 'Некорректный список обхода прокси' };
      clean[k] = b;
    } else if (k === 'proxyIncognitoOnly') {
      if (typeof v !== 'boolean') return { ok: false, error: 'Некорректное значение' };
      clean[k] = v;
    }
  }
  const eff = { ...readProxySettings(current), ...clean };
  if (eff.proxyMode === 'manual' && (!eff.proxyHost || !eff.proxyPort)) {
    return { ok: false, error: 'Для ручного режима укажите хост и порт прокси' };
  }
  return { ok: true, clean };
}

// Конфигурация для конкретной сессии. «Только Инкогнито» действует в ручном режиме:
// обычная сессия остаётся на системных настройках, Инкогнито идёт через прокси.
function buildProxyConfig(settings, { incognito = false } = {}) {
  const p = readProxySettings(settings);
  if (p.proxyMode === 'direct') return { mode: 'direct' };
  if (p.proxyMode === 'manual' && p.proxyHost && p.proxyPort && (incognito || !p.proxyIncognitoOnly)) {
    return {
      mode: 'fixed_servers',
      proxyRules: `${p.proxyProtocol}://${p.proxyHost}:${p.proxyPort}`,
      proxyBypassRules: p.proxyBypassRules
    };
  }
  return { mode: 'system' };
}

const lastApplied = new WeakMap(); // session -> JSON последней применённой конфигурации

const PROXY_FAIL_CLOSED_RULES = 'http://127.0.0.1:9'; // закрытый порт: трафик не уходит напрямую

async function failClosed(ses) {
  try {
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: PROXY_FAIL_CLOSED_RULES, proxyBypassRules: '' });
    lastApplied.set(ses, '__fail_closed__'); // следующая попытка применить реальный прокси не будет пропущена
    if (typeof ses.closeAllConnections === 'function') await ses.closeAllConnections();
  } catch (err) {
    console.error('[proxy] Не удалось включить fail-closed:', err && err.message ? err.message : err);
  }
}

async function applyProxy(ses, settings, opts = {}) {
  if (!ses) return false;
  let config = null;
  try {
    config = buildProxyConfig(settings, opts);
    const key = JSON.stringify(config);
    const prev = lastApplied.get(ses);
    if (prev === key) return true;
    await ses.setProxy(config);
    lastApplied.set(ses, key);
    // Уже открытые keep-alive соединения продолжили бы идти по старому маршруту
    if (prev !== undefined && typeof ses.closeAllConnections === 'function') {
      await ses.closeAllConnections();
    }
    return true;
  } catch (err) {
    console.error('[proxy] Не удалось применить прокси:', err && err.message ? err.message : err);
    if (config && config.mode === 'fixed_servers') await failClosed(ses);
    return false;
  }
}

module.exports = {
  PROXY_MODES,
  PROXY_PROTOCOLS,
  PROXY_DEFAULTS,
  PROXY_KEYS,
  readProxySettings,
  sanitizeProxyPatch,
  buildProxyConfig,
  applyProxy
};
