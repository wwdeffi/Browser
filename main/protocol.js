const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { protocol } = require('electron');
const { APP_SCHEME, NEW_TAB_URL, INTERNAL_PAGES: BASE_INTERNAL_PAGES } = require('./constants');
const storage = require('./storage');

const PAGES_DIR = path.join(__dirname, '..', 'renderer', 'pages');
const STYLES_DIR = path.join(__dirname, '..', 'renderer', 'styles');

// browser://history регистрируем здесь, чтобы не требовать правки constants.js (если запись уже есть в INTERNAL_PAGES — просто совпадёт)
const INTERNAL_PAGES = { ...BASE_INTERNAL_PAGES, history: 'history.html', downloads: 'downloads.html', bookmarks: 'bookmarks.html' };

const ALLOWED_STYLES = {
  '/tokens.css': path.join(STYLES_DIR, 'tokens.css'),
  // его подключают внутренние страницы (settings, error, downloads, bookmarks); лежит вместе со скриптами окна
  '/chromeTheme.js': path.join(__dirname, '..', 'renderer', 'js', 'chromeTheme.js')
};

// Ресурсы страницы browser://settings: строго белый список (CSS и JS отдельными файлами, без inline)
const SETTINGS_ASSETS = {
  '/settings.css': { file: 'settings.css', type: 'text/css; charset=utf-8' },
  '/settings.js': { file: 'settings.js', type: 'application/javascript; charset=utf-8' }
};
const SETTINGS_CSP = [
  "default-src 'none'",
  `script-src 'self' ${APP_SCHEME}://styles`,
  `style-src 'self' ${APP_SCHEME}://styles`,
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// Ресурсы страницы browser://error: тот же подход, строго белый список без inline
const ERROR_ASSETS = {
  '/error.css': { file: 'error.css', type: 'text/css; charset=utf-8' },
  '/error.js': { file: 'error.js', type: 'application/javascript; charset=utf-8' }
};
const ERROR_CSP = [
  "default-src 'none'",
  `script-src 'self' ${APP_SCHEME}://styles`,
  `style-src 'self' ${APP_SCHEME}://styles`,
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// Ресурсы страницы browser://newtab (самая привилегированная страница: window.internalApi) — без inline
const NEWTAB_ASSETS = {
  '/newtab.css': { file: 'newtab.css', type: 'text/css; charset=utf-8' },
  '/newtab.js': { file: 'newtab.js', type: 'application/javascript; charset=utf-8' }
};
const NEWTAB_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'self' ${APP_SCHEME}://styles`,
  `img-src 'self' ${APP_SCHEME}: data:`,
  `media-src ${APP_SCHEME}:`,
  'connect-src https://api.open-meteo.com https://geocoding-api.open-meteo.com',
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// Ресурсы страницы browser://history: тот же подход (CSS и JS отдельными файлами, без inline, сеть закрыта).
// Внешние картинки не грузим: иконки плиток main отдаёт как data:-URL (см. siteIcons.js), поэтому img-src без внешних источников
const HISTORY_ASSETS = {
  '/history.css': { file: 'history.css', type: 'text/css; charset=utf-8' },
  '/history.js': { file: 'history.js', type: 'application/javascript; charset=utf-8' }
};
const HISTORY_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'self' ${APP_SCHEME}://styles`,
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// Ресурсы страницы browser://downloads: CSS и JS отдельными файлами, без inline, сеть закрыта.
// script-src дополнительно разрешает browser://styles — оттуда грузится chromeTheme.js (единая тема оболочки)
const DOWNLOADS_ASSETS = {
  '/downloads.css': { file: 'downloads.css', type: 'text/css; charset=utf-8' },
  '/downloads.js': { file: 'downloads.js', type: 'application/javascript; charset=utf-8' }
};
const DOWNLOADS_CSP = [
  "default-src 'none'",
  `script-src 'self' ${APP_SCHEME}://styles`,
  `style-src 'self' ${APP_SCHEME}://styles`,
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// Ресурсы страницы browser://bookmarks: CSS и JS отдельными файлами, без inline, сеть закрыта.
// script-src дополнительно разрешает browser://styles — оттуда грузится chromeTheme.js (единая тема оболочки)
const BOOKMARKS_ASSETS = {
  '/bookmarks.css': { file: 'bookmarks.css', type: 'text/css; charset=utf-8' },
  '/bookmarks.js': { file: 'bookmarks.js', type: 'application/javascript; charset=utf-8' }
};
const BOOKMARKS_CSP = [
  "default-src 'none'",
  `script-src 'self' ${APP_SCHEME}://styles`,
  `style-src 'self' ${APP_SCHEME}://styles`,
  "img-src 'self' data:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

// Белые списки ресурсов по хостам внутренних страниц
const PAGE_ASSETS = {
  settings: SETTINGS_ASSETS,
  error: ERROR_ASSETS,
  newtab: NEWTAB_ASSETS,
  history: HISTORY_ASSETS,
  downloads: DOWNLOADS_ASSETS,
  bookmarks: BOOKMARKS_ASSETS
};

// Внутренние страницы нельзя встраивать во фреймы чужих сайтов
const FRAME_ANCESTORS_CSP = "frame-ancestors 'none'";

// Запросы к browser:// от внешних сайтов (cross-site или http(s)-origin/referer) отклоняем
function isForeignWebRequest(request, host = '') {
  const h = request.headers;
  // Окно интерфейса (file:) и sandbox-контексты шлют литерал «null» вместо Origin — это «источника нет», а не чужой сайт
  const rawOrigin = h.get('origin') || '';
  const origin = rawOrigin.toLowerCase() === 'null' ? '' : rawOrigin;
  const referer = h.get('referer') || '';
  // Внешний сайт всегда имеет http(s)-источник — такие запросы отклоняем безусловно
  if (/^https?:\/\//i.test(origin) || /^https?:\/\//i.test(referer)) return true;
  if ((h.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') {
    // Между разными хостами browser:// (например, newtab -> wallpaper) Chromium тоже ставит cross-site.
    // То же для окна интерфейса, загруженного по file:. Источник явно внутренний — пропускаем
    const isInternalSource = (v) => v.startsWith(`${APP_SCHEME}:`) || v.startsWith('file:');
    if (isInternalSource(origin) || isInternalSource(referer)) return false;
    // Окно интерфейса (file:) не шлёт ни Origin, ни Referer для <img>/<video> (Chromium прячет не-http(s) referrer),
    // поэтому запрос обоев как медиа без источника пропускаем. Читать пиксели чужой страницей нельзя:
    // CORS-запросы несут Origin (отклоняются выше), а no-cors медиа остаются непрозрачными
    if (host === 'wallpaper' && !origin && !referer) {
      const dest = (h.get('sec-fetch-dest') || '').toLowerCase();
      if (dest === 'image' || dest === 'video') return false;
    }
    return true;
  }
  return false;
}

function pageCsp(host) {
  if (host === 'settings') return SETTINGS_CSP;
  if (host === 'error') return ERROR_CSP;
  if (host === 'newtab') return NEWTAB_CSP;
  if (host === 'history') return HISTORY_CSP;
  if (host === 'downloads') return DOWNLOADS_CSP;
  if (host === 'bookmarks') return BOOKMARKS_CSP;
  return FRAME_ANCESTORS_CSP;
}

function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ]);
}

function registerProtocolHandler(ses) {
  ses.protocol.handle(APP_SCHEME, async (request) => {
    try {
      let requestHost = '';
      try { requestHost = new URL(request.url).hostname.toLowerCase(); } catch { /* разберём ниже */ }
      if (isForeignWebRequest(request, requestHost)) {
        return new Response('Forbidden', {
          status: 403,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' }
        });
      }

      const parsed = new URL(request.url);
      const host = parsed.hostname.toLowerCase();

      if (host === 'styles' && ALLOWED_STYLES[parsed.pathname]) {
        const cssPath = ALLOWED_STYLES[parsed.pathname];
        const css = await fs.promises.readFile(cssPath, 'utf8');
        const isJs = parsed.pathname.endsWith('.js');
        return new Response(css, {
          status: 200,
          headers: {
            'content-type': isJs ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8',
            'x-content-type-options': 'nosniff'
          }
        });
      }

      if (host === 'wallpaper') {
        const wp = storage.getCustomWallpaper();
        if (!wp) {
          return new Response('Not Found', { status: 404 });
        }
        // Потоковая отдача с поддержкой Range — без неё <video> не умеет перематывать и зацикливаться
        const { size } = await fs.promises.stat(wp.filePath);
        if (size <= 0) return new Response('Not Found', { status: 404 }); // пустой файл: end = -1 ломает createReadStream
        const headers = {
          'content-type': wp.mime,
          'cache-control': 'no-store',
          'accept-ranges': 'bytes',
          'x-content-type-options': 'nosniff',
          // нужен, чтобы страница могла снять цвет с кадра обоев (canvas без «tainted»):
          // только для новой вкладки, а не для любого сайта
          'access-control-allow-origin': NEW_TAB_URL,
          vary: 'Origin'
        };
        const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
        let start = 0;
        let end = size - 1;
        let status = 200;
        if (m && (m[1] || m[2])) {
          if (m[1]) {
            start = Number(m[1]);
            if (m[2]) end = Math.min(Number(m[2]), size - 1);
          } else {
            start = Math.max(size - Number(m[2]), 0);
          }
          if (start > end || start >= size) {
            return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
          }
          status = 206;
          headers['content-range'] = `bytes ${start}-${end}/${size}`;
        }
        headers['content-length'] = String(end - start + 1);
        const stream = Readable.toWeb(fs.createReadStream(wp.filePath, { start, end }));
        return new Response(stream, { status, headers });
      }

      const pageAssets = Object.hasOwn(PAGE_ASSETS, host) ? PAGE_ASSETS[host] : null;
      if (pageAssets) {
        const asset = Object.hasOwn(pageAssets, parsed.pathname) ? pageAssets[parsed.pathname] : null;
        if (asset) {
          const body = await fs.promises.readFile(path.join(PAGES_DIR, asset.file), 'utf8');
          return new Response(body, {
            status: 200,
            headers: { 'content-type': asset.type, 'x-content-type-options': 'nosniff' }
          });
        }
        if (parsed.pathname !== '/' && parsed.pathname !== '') {
          return new Response('Not Found', { status: 404 });
        }
      }

      const pageFile = Object.hasOwn(INTERNAL_PAGES, host) ? INTERNAL_PAGES[host] : null;
      if (pageFile) {
        const htmlPath = path.join(PAGES_DIR, pageFile);
        const html = await fs.promises.readFile(htmlPath, 'utf8');
        return new Response(html, {
          status: 200,
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': pageCsp(host)
          }
        });
      }

      return new Response('<h1>404 — Внутренняя страница не найдена</h1>', {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': FRAME_ANCESTORS_CSP }
      });
    } catch (err) {
      // Подробности только в консоль: пути ОС и тексты ошибок не должны попадать на страницу
      console.error('[protocol] Ошибка обработки запроса', request.url, err);
      return new Response('<h1>Ошибка загрузки</h1><p>Не удалось загрузить внутреннюю страницу.</p>', {
        status: 500,
        headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': FRAME_ANCESTORS_CSP }
      });
    }
  });
}

module.exports = {
  registerSchemePrivileges,
  registerProtocolHandler
};
