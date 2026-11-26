'use strict';
// Единственный владелец webRequest-слушателей сессии: security и adblock работают через него.
const EVENTS = ['onBeforeRequest', 'onBeforeSendHeaders', 'onHeadersReceived'];
const hubs = new WeakMap();

const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

// Шаблон match-pattern (как в Chrome) -> RegExp. null — шаблон некорректен и ничего не совпадает.
// Результат кэшируется: matches() вызывается на каждый запрос
const patternCache = new Map();
function compilePattern(p) {
  if (typeof p !== 'string') return null;
  if (patternCache.has(p)) return patternCache.get(p);
  const re = buildPattern(p);
  if (patternCache.size > 500) patternCache.clear();
  patternCache.set(p, re);
  return re;
}

function buildPattern(p) {
  if (p === '<all_urls>') return /^(?:https?|wss?|ftp):\/\//i;
  const m = /^(\*|https?|wss?|ftp|file):\/\/([^/]*)(\/.*)$/i.exec(p);
  if (!m) return null;
  const scheme = m[1] === '*' ? 'https?|wss?' : esc(m[1]);
  const host = m[2];
  let hostRe;
  if (host === '*' || host === '') hostRe = '[^/]*';
  else if (host.startsWith('*.')) hostRe = '(?:[^/]*\\.)?' + esc(host.slice(2));
  else hostRe = esc(host);
  if (hostRe !== '[^/]*' && !/:\d+$/.test(host)) hostRe += '(?::\\d+)?';
  const pathRe = esc(m[3]).replace(/\*/g, '.*');
  return new RegExp(`^(?:${scheme}):\\/\\/${hostRe}${pathRe}$`, 'i');
}

function matches(filter, url) {
  const urls = filter && Array.isArray(filter.urls) ? filter.urls : null;
  if (!urls || !urls.length) return true;
  return urls.some((p) => compilePattern(p)?.test(url));
}

function run(map, event, details, callback) {
  const list = [...map.values()].filter((h) => matches(h.filter, details.url));
  const acc = {};
  let i = 0, done = false;
  const finish = (r) => { if (!done) { done = true; callback(r); } };
  const next = () => {
    if (i >= list.length) return finish(acc);
    const h = list[i++];
    let called = false;
    const cb = (resp) => {
      if (called || done) return;
      called = true;
      resp = resp || {};
      if (resp.cancel || resp.redirectURL) return finish(resp);
      if (resp.requestHeaders) { acc.requestHeaders = resp.requestHeaders; details = { ...details, requestHeaders: resp.requestHeaders }; }
      if (resp.responseHeaders) { acc.responseHeaders = resp.responseHeaders; details = { ...details, responseHeaders: resp.responseHeaders }; }
      if (resp.statusLine) acc.statusLine = resp.statusLine;
      next();
    };
    try { h.listener(details, cb); } catch (err) { console.error('[webRequest]', err && err.message); cb({}); }
  };
  next();
}

function getHub(ses) {
  let hub = hubs.get(ses);
  if (hub) return hub;
  const handlers = Object.fromEntries(EVENTS.map((e) => [e, new Map()]));
  const installed = new Set();
  hub = {
    // owner: 'security' | 'adblock'; listener === null снимает только слушатель этого владельца
    on(owner, event, filter, listener) {
      if (typeof filter === 'function') { listener = filter; filter = null; }
      if (!listener) { handlers[event].delete(owner); return; }
      handlers[event].set(owner, { filter, listener });
      if (!installed.has(event)) {
        installed.add(event);
        ses.webRequest[event]({ urls: ['<all_urls>'] }, (d, cb) => run(handlers[event], event, d, cb));
      }
    }
  };
  const wr = new Proxy(ses.webRequest, {
    get(t, p) {
      if (EVENTS.includes(p)) return (a, b) => hub.on('adblock', p, a, b);
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
  hub.adblockSession = new Proxy(ses, {
    get(t, p) {
      if (p === 'webRequest') return wr;
      const v = Reflect.get(t, p);
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
  hubs.set(ses, hub);
  return hub;
}

module.exports = { getHub, matches, compilePattern, adblockSession: (ses) => getHub(ses).adblockSession };
