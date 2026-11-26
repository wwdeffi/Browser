'use strict';

// Иконки сайтов для плиток «Быстрый доступ».
// Приватность: иконку берём напрямую с самого сайта (его главная страница и /favicon.ico),
// без сторонних сервисов вроде Google S2: никто, кроме самого сайта, не узнаёт, какие плитки у вас есть.
// Найденная иконка кэшируется на диск, повторных запросов к сайту нет.

const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const { isLocalOrPrivateHost } = require('./httpsOnly');

const FETCH_TIMEOUT_MS = 10000;
const MAX_PARALLEL = 3; // много сайтов сразу душат сеть и обрывают запросы по таймауту
const MAX_HTML_BYTES = 256 * 1024;
const MAX_ICON_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const NEGATIVE_TTL_MS = 10 * 60 * 1000; // не нашли — повторяем не чаще раза в час (сбой сети не должен «залипать» надолго)

const memory = new Map(); // host -> { dataUrl|null, at }
const inflight = new Map(); // host -> Promise

// Иконки лежат на диске обычными файлами: <userData>/browser-data/site-icons/<домен>.png|ico|svg|...
// Скачанная иконка больше не запрашивается из сети — при каждом запуске берётся из папки.
const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/x-icon': 'ico', 'image/svg+xml': 'svg'
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

let cacheDirPromise = null;
function cacheDir() {
  if (!cacheDirPromise) {
    const dir = path.join(app.getPath('userData'), 'browser-data', 'site-icons');
    cacheDirPromise = fs.promises.mkdir(dir, { recursive: true }).then(() => dir, (err) => { cacheDirPromise = null; throw err; });
  }
  return cacheDirPromise;
}

function safeName(host) {
  return String(host).toLowerCase().replace(/[^a-z0-9.-]/g, '_').slice(0, 120);
}

async function readCache(host) {
  if (memory.has(host)) return memory.get(host);
  try {
    const dir = await cacheDir();
    const base = safeName(host);
    for (const ext of Object.keys(MIME_BY_EXT)) {
      const file = path.join(dir, `${base}.${ext}`);
      let buf;
      try { buf = await fs.promises.readFile(file); } catch { continue; } // файла с таким расширением нет
      // Тип проверяем по содержимому, а не по расширению файла
      const mime = sniffImage(buf);
      if (!mime) continue;
      const at = (await fs.promises.stat(file).catch(() => null))?.mtimeMs || Date.now();
      if (memory.has(host)) return memory.get(host); // пока читали, writeCache успел положить свежую запись
      const entry = { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, at };
      memory.set(host, entry);
      return entry;
    }
  } catch { /* кэш необязателен */ }
  return null;
}

// В память кладём сразу, на диск пишем в фоне (вызывающему ждать не нужно)
async function writeCache(host, dataUrl) {
  const entry = { dataUrl, at: Date.now() };
  memory.set(host, entry);
  if (!dataUrl) return; // «не нашли» держим только в памяти: при следующем запуске попробуем снова
  try {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
    if (!m || !EXT_BY_MIME[m[1]]) return;
    const dir = await cacheDir();
    const base = safeName(host);
    await Promise.all(Object.keys(MIME_BY_EXT).map((ext) => fs.promises.unlink(path.join(dir, `${base}.${ext}`)).catch(() => { /* не было */ })));
    await fs.promises.writeFile(path.join(dir, `${base}.${EXT_BY_MIME[m[1]]}`), Buffer.from(m[2], 'base64'));
  } catch { /* кэш необязателен */ }
}

function isFresh(entry) {
  if (!entry) return false;
  // Найденная иконка действительна всегда; «не найдена» — повторяем не чаще, чем раз в NEGATIVE_TTL_MS
  return entry.dataUrl ? true : Date.now() - entry.at < NEGATIVE_TTL_MS;
}

// ---- Разбор HTML: чистая функция (покрыта тестами) ----

function attr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

// Возвращает абсолютные адреса иконок из <link rel="...icon...">, лучшие (крупнее, apple-touch) первыми
function parseIconLinks(html, baseUrl) {
  if (typeof html !== 'string') return [];
  const head = html.slice(0, MAX_HTML_BYTES);
  const found = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(head))) {
    const tag = m[0];
    const rel = attr(tag, 'rel').toLowerCase();
    if (!/\bicon\b/.test(rel) && !rel.includes('apple-touch-icon')) continue;
    if (rel.includes('mask-icon')) continue;
    const href = attr(tag, 'href').trim();
    if (!href || /^(?:data|javascript|blob):/i.test(href)) continue;
    let abs;
    try { abs = new URL(href.replace(/&amp;/g, '&'), baseUrl); } catch { continue; }
    if (abs.protocol !== 'https:' && abs.protocol !== 'http:') continue;
    const sizes = /(\d+)x(\d+)/.exec(attr(tag, 'sizes'));
    const size = sizes ? Math.min(Number(sizes[1]), Number(sizes[2])) : 0;
    let score = size >= 32 && size <= 512 ? size : (size > 512 ? 300 : size || 48);
    if (rel.includes('apple-touch-icon')) score += 40; // обычно крупные и чёткие
    if (/\.svg(?:$|\?)/i.test(abs.pathname + abs.search)) score -= 1000; // SVG — только если растровых нет (многие современные сайты отдают только его)
    found.push({ url: abs.href, score });
  }
  found.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return found.filter((f) => !seen.has(f.url) && seen.add(f.url)).map((f) => f.url);
}

// Определяем тип по сигнатуре, а не по заголовку сервера
function sniffImage(buf) {
  if (buf.length < 8) return null;
  // SVG безопасен только внутри <img> (скрипты и внешние ресурсы там не выполняются) — именно так он и показывается
  const head = buf.subarray(0, 512).toString('utf8').replace(/^\uFEFF/, '').trimStart();
  if (/^<svg[\s>]/i.test(head) || (/^<\?xml/i.test(head) && /<svg[\s>]/i.test(buf.subarray(0, 2048).toString('utf8')))) return 'image/svg+xml';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'image/x-icon';
  return null;
}

// ---- Сеть ----

function hostAllowed(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !isLocalOrPrivateHost(u.hostname);
  } catch { return false; }
}

// GET с ручной обработкой редиректов: каждый переход проверяем (не уходим на локальные адреса)
let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= MAX_PARALLEL) await new Promise((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; const next = waiters.shift(); if (next) next(); }
}

// stats — счётчик сетевых сбоев одного поиска (параллельные поиски не влияют друг на друга)
async function safeGet(startUrl, limit, stats) {
  return withSlot(() => safeGetOnce(startUrl, limit, stats));
}

// Один GET через net.request: каждый редирект проверяем сами (в Electron net.fetch с redirect:'manual' падает с «Redirect was cancelled»).
// Возвращает { url, body, type } | null (HTTP-ошибка/запрещённый адрес) | { netError: true } (таймаут, обрыв, блокировка сети)
function safeGetOnce(startUrl, limit, stats) {
  return new Promise((resolve) => {
    if (!hostAllowed(startUrl)) return resolve(null);
    let settled = false;
    let hops = 0;
    let current = startUrl;
    let request;
    const timer = setTimeout(() => fail(new Error('timeout'), true), FETCH_TIMEOUT_MS);
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (err, isNet) => {
      if (settled) return;
      if (isNet) { if (stats) stats.netFailures++; console.warn('[site-icons]', current, '—', err && err.message); }
      try { request.abort(); } catch { /* уже завершён */ }
      finish(isNet ? { netError: true } : null);
    };
    try {
      request = net.request({ url: startUrl, redirect: 'manual', credentials: 'omit', useSessionCookies: false });
    } catch (err) { return fail(err, true); }
    request.setHeader('Accept', 'text/html,image/*;q=0.9,*/*;q=0.5');
    request.setHeader('Accept-Language', 'ru,en;q=0.8');
    request.on('redirect', (status, method, redirectUrl) => {
      hops++;
      if (hops > MAX_REDIRECTS || !hostAllowed(redirectUrl)) return fail(new Error('redirect refused'), false);
      current = redirectUrl;
      try { request.followRedirect(); } catch (err) { fail(err, true); }
    });
    request.on('response', (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) { try { request.abort(); } catch { /* ignore */ } return finish(null); }
      const hdr = res.headers['content-type'];
      const type = String(Array.isArray(hdr) ? hdr[0] : hdr || '').toLowerCase();
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        chunks.push(chunk);
        total += chunk.length;
        if (total >= limit) {
          try { request.abort(); } catch { /* ignore */ }
          finish({ url: current, body: Buffer.concat(chunks).subarray(0, limit), type });
        }
      });
      res.on('end', () => finish({ url: current, body: Buffer.concat(chunks).subarray(0, limit), type }));
      res.on('error', (err) => fail(err, true));
    });
    request.on('error', (err) => fail(err, true));
    request.end();
  });
}

async function downloadIcon(iconUrl, stats) {
  const res = await safeGet(iconUrl, MAX_ICON_BYTES, stats);
  if (!res || res.netError || !res.body.length) return null;
  const mime = sniffImage(res.body);
  if (!mime) return null;
  return `data:${mime};base64,${res.body.toString('base64')}`;
}

async function discover(origin, stats) {
  const page = await safeGet(`${origin}/`, MAX_HTML_BYTES, stats);
  // Сайт недоступен по сети (таймаут/блокировка) — остальные запросы к нему бессмысленны и только тормозят
  if (page && page.netError) return null;
  const candidates = [];
  if (page && (page.type.includes('html') || page.type === '')) {
    candidates.push(...parseIconLinks(page.body.toString('utf8'), page.url).slice(0, 4));
  }
  candidates.push(`${origin}/favicon.ico`, `${origin}/apple-touch-icon.png`);
  for (const url of candidates) {
    const dataUrl = await downloadIcon(url, stats);
    if (dataUrl) return dataUrl;
  }
  return null;
}

// Запасные адреса, если у поддомена (gemini.google.com) своей иконки нет: www-вариант и главный домен
function fallbackOrigins(origin) {
  let u;
  try { u = new URL(origin); } catch { return []; }
  const host = u.hostname;
  const out = [];
  if (host.split('.').length === 2) out.push(`${u.protocol}//www.${host}`); // www. только для голых доменов (www.news.site.com не существует)
  const parts = host.replace(/^www\./i, '').split('.');
  const twoPart = ['co', 'com', 'org', 'net', 'gov'];
  const keep = parts.length > 2 && twoPart.includes(parts[parts.length - 2]) ? 3 : 2;
  if (parts.length > keep) out.push(`${u.protocol}//${parts.slice(-keep).join('.')}`);
  return out;
}

// Последний шанс для сайтов, до которых не достучаться напрямую (блокировка, сбой TLS): готовые иконки из публичных сервисов.
// Сервис узнаёт только домен плитки, и только если сам сайт не отдал иконку. Выключается: ALLOW_PUBLIC_ICON_SERVICES = false
const ALLOW_PUBLIC_ICON_SERVICES = false;
function publicServiceUrls(host) {
  const h = encodeURIComponent(host);
  return [
    `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${h}&size=64`,
    `https://icons.duckduckgo.com/ip3/${h}.ico`
  ];
}

async function discoverWithFallback(origin, stats) {
  const direct = await discover(origin, stats);
  if (direct) return direct;
  for (const alt of fallbackOrigins(origin)) {
    const found = await discover(alt, stats);
    if (found) return found;
  }
  if (ALLOW_PUBLIC_ICON_SERVICES) {
    let host = '';
    try { host = new URL(origin).hostname; } catch { /* ignore */ }
    if (host) {
      for (const url of publicServiceUrls(host)) {
        const found = await downloadIcon(url, stats);
        if (found) return found;
      }
    }
  }
  return null;
}

// url — адрес плитки. allowNetwork=false (Инкогнито): только то, что уже лежит в кэше, и ни одного запроса
async function getIcon(rawUrl, { allowNetwork = true } = {}) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname || isLocalOrPrivateHost(u.hostname)) return null;
  const host = u.hostname.toLowerCase();

  const cached = await readCache(host);
  if (cached && (isFresh(cached) || !allowNetwork)) return cached.dataUrl;
  if (!allowNetwork) return null;

  if (!inflight.has(host)) {
    const stats = { netFailures: 0 };
    const task = discoverWithFallback(`https://${u.host}`, stats)
      .then((dataUrl) => {
        if (dataUrl) { writeCache(host, dataUrl).catch(() => {}); return dataUrl; }
        // Ничего не нашли из-за сетевых сбоев — не запоминаем «нет иконки», попробуем при следующем открытии
        if (stats.netFailures > 0) { return (cached && cached.dataUrl) || null; }
        writeCache(host, (cached && cached.dataUrl) || null).catch(() => {});
        return memory.get(host).dataUrl; // writeCache кладёт запись в память синхронно, до первого await
      })
      .catch(() => null)
      .finally(() => inflight.delete(host));
    inflight.set(host, task);
  }
  return inflight.get(host);
}

module.exports = { getIcon, parseIconLinks, sniffImage, fallbackOrigins };
