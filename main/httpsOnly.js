'use strict';

// Режим «Только HTTPS»: чистая логика без зависимостей от Electron.
// Что делать с вкладкой при сбое HTTPS, решает tabManager.js; здесь только правила.

// Сколько ждём ответа по HTTPS, прежде чем считать, что сайт его не поддерживает
// (порт 443 может молча отбрасывать пакеты, тогда ошибки не будет вообще).
const HTTPS_UPGRADE_TIMEOUT_MS = 6000;

// Исключения «Всё равно перейти» живут только в памяти процесса, то есть до закрытия браузера.
// Обычный режим и Инкогнито не делят исключения: из Инкогнито ничего не попадает в обычный режим.
const exceptions = { normal: new Set(), incognito: new Set() };

function bucket(incognito) {
  return incognito ? exceptions.incognito : exceptions.normal;
}

// IPv4-литерал вида a.b.c.d
function isIpv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

// 10.*, 127.*, 192.168.*, 169.254.*, 172.16–31.*
function isPrivateIpv4(host) {
  const o = host.split('.').map(Number);
  if (o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = o;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31);
}

// Адреса, для которых HTTPS заведомо недоступен или бессмыслен (у них не бывает публичных сертификатов).
// Их не апгрейдим: иначе localhost:3000, роутер и сервисы в локальной сети перестали бы открываться.
function isLocalOrPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  if (host.includes(':')) return true; // IPv6-литерал
  if (isIpv4(host)) return isPrivateIpv4(host); // публичные IPv4 тоже апгрейдим до https
  if (!host.includes('.')) return true; // имя без точки: хост интранета
  return false;
}

// Ключ исключения: host вместе с нестандартным портом (example.com или example.com:8080)
function exceptionKey(rawUrl) {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

function hasException(rawUrl, incognito) {
  const key = exceptionKey(rawUrl);
  return key !== null && bucket(incognito).has(key);
}

function addException(rawUrl, incognito) {
  const key = exceptionKey(rawUrl);
  if (key !== null) bucket(incognito).add(key);
}

function clearIncognitoExceptions() {
  exceptions.incognito.clear();
}

// true, если этот http: адрес нужно сначала попробовать открыть по https:
function shouldUpgrade(rawUrl, { enabled, incognito = false } = {}) {
  if (!enabled || typeof rawUrl !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:') return false;
  if (isLocalOrPrivateHost(parsed.hostname)) return false;
  if (hasException(rawUrl, incognito)) return false;
  return true;
}

// http://example.com:8080/a?b#c -> https://example.com:8080/a?b#c
// Порт 80 (по умолчанию для http) URL-парсер убирает сам, а нестандартный порт сохраняем как есть.
function toHttps(rawUrl) {
  const parsed = new URL(rawUrl);
  parsed.protocol = 'https:';
  return parsed.href;
}

// Коды ошибок Chromium, при которых нет смысла предлагать небезопасный вариант:
// -3 отмена, -21 смена сети, -105/-137 имя не найдено (по HTTP тоже не откроется), -106 нет интернета
const NON_FALLBACK_ERRORS = new Set([-3, -21, -105, -106, -137]);

function isFallbackError(errorCode) {
  return typeof errorCode === 'number' && !NON_FALLBACK_ERRORS.has(errorCode);
}

module.exports = {
  HTTPS_UPGRADE_TIMEOUT_MS,
  shouldUpgrade,
  toHttps,
  isFallbackError,
  addException,
  hasException,
  clearIncognitoExceptions,
  isLocalOrPrivateHost
};
