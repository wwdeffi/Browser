const { app, session } = require('electron');

// Режимы DoH: automatic — DoH с откатом на системный DNS, secure — только DoH (без отката), off — выключен
const DOH_MODES = ['automatic', 'secure', 'off'];
const DEFAULT_DOH_MODE = 'automatic';

// Адреса — RFC 8484 URI-шаблоны конечных точек DoH (а не главные страницы провайдеров)
const DOH_PROVIDERS = {
  cloudflare: { name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query' },
  quad9: { name: 'Quad9', url: 'https://dns.quad9.net/dns-query' },
  adguard: { name: 'AdGuard DNS', url: 'https://dns.adguard-dns.com/dns-query' }
};
const DOH_PROVIDER_KEYS = [...Object.keys(DOH_PROVIDERS), 'custom'];
const DEFAULT_DOH_PROVIDER = 'cloudflare';
const DOH_URL_MAX_LEN = 2048;

// Проверка «своего» адреса: только https://, есть хост, без логина/пароля и #фрагмента.
// Допускается необязательный суффикс {?dns} (шаблон RFC 8484). Возвращает нормализованную строку или null
function normalizeDohUrl(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > DOH_URL_MAX_LEN) return null;
  const tmpl = /\{\?dns\}$/.exec(s);
  const base = tmpl ? s.slice(0, -tmpl[0].length) : s;
  if (/[\s{}]/.test(base)) return null;
  let u;
  try { u = new URL(base); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname) return null;
  if (u.username || u.password || u.hash) return null;
  if (tmpl && u.search) return null;
  return tmpl ? `${u.href}{?dns}` : u.href;
}

// Настройки -> аргументы app.configureHostResolver
function resolveDohConfig(settings) {
  const s = settings || {};
  const mode = DOH_MODES.includes(s.dohMode) ? s.dohMode : DEFAULT_DOH_MODE;
  if (mode === 'off') return { secureDnsMode: 'off' };
  const url = (s.dohProvider === 'custom'
    ? normalizeDohUrl(s.dohCustomUrl)
    : DOH_PROVIDERS[s.dohProvider]?.url) || DOH_PROVIDERS[DEFAULT_DOH_PROVIDER].url;
  return { secureDnsMode: mode, secureDnsServers: [url] };
}

let lastKey = null;

// Сбрасывает DNS-кэш во всех сессиях: обычной и всех Инкогнито (у них свой кэш резолвера)
async function flushDnsEverywhere(registry) {
  let incognito = [];
  try { incognito = registry?.incognitoSessions?.() ?? []; } catch { /* реестр недоступен */ }
  const sessions = [session.defaultSession, ...incognito].filter(Boolean);
  await Promise.all(sessions.map((s) => Promise.resolve().then(() => s.clearHostResolverCache()).catch(() => {})));
}

// Применяет DoH. Вызывать только после app.whenReady(). Повторный вызов с той же конфигурацией ничего не делает
function applyDoh(settings, registry) {
  const cfg = resolveDohConfig(settings);
  const key = JSON.stringify(cfg);
  if (key === lastKey) return true;
  try {
    app.configureHostResolver(cfg);
    const hadPrevious = lastKey !== null;
    lastKey = key;
    // Мгновенный эффект: старые записи DNS-кэша не должны жить после смены резолвера
    if (hadPrevious) flushDnsEverywhere(registry).catch(() => {});
    return true;
  } catch (err) {
    console.warn('[net] Не удалось настроить DNS-over-HTTPS:', err && err.message);
    return false;
  }
}

module.exports = {
  DOH_MODES, DOH_PROVIDERS, DOH_PROVIDER_KEYS, DEFAULT_DOH_MODE, DEFAULT_DOH_PROVIDER,
  normalizeDohUrl, resolveDohConfig, applyDoh, flushDnsEverywhere
};
