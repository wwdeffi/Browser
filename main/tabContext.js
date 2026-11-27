'use strict';

// «Контекст текущей вкладки» для панели Gemini: читаем текст, таблицы, код и открытые PDF активной вкладки
// и собираем из них блок, который кладётся в поле ввода Gemini. Дальше пользователь дописывает вопрос
// («сделай выжимку», «переведи», «объясни термины»…) и отправляет как обычно.

const fs = require('fs');
const { fileURLToPath } = require('url');

const MAX_CONTEXT_CHARS = 60000;     // сколько символов страницы отдаём в Gemini; остальное отрезаем с пометкой
const MAX_SELECTION_CHARS = 8000;
const PDF_MAX_BYTES = 60 * 1024 * 1024;
const PDF_MAX_PAGES = 120;
const TAB_CONTEXT_WORLD_ID = 1208;   // отдельный изолированный мир: скрипт не видит переменные страницы и не оставляет следов

// Читать можно только обычные страницы и файлы; внутренние browser:// и служебные адреса пропускаем
function isExtractableUrl(rawUrl) {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
  } catch {
    return false;
  }
}

function looksLikePdfUrl(rawUrl) {
  try {
    return /\.pdf$/i.test(new URL(rawUrl).pathname);
  } catch {
    return false;
  }
}

// Выполняется в изолированном мире страницы (поэтому полностью самодостаточна: внешних ссылок нет).
// Обходит видимый DOM и отдаёт текст в markdown-подобном виде: заголовки, списки, таблицы, блоки кода.
function pageExtractor(maxChars, maxSelection) {
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'IFRAME', 'VIDEO', 'AUDIO',
    'IMG', 'PICTURE', 'INPUT', 'SELECT', 'BUTTON', 'TEXTAREA', 'NAV', 'FOOTER', 'ASIDE', 'FORM', 'DIALOG']);
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD',
    'BLOCKQUOTE', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'ADDRESS', 'HR', 'BR']);

  const out = [];
  let total = 0;
  const limit = maxChars + 4000; // небольшой запас: точную обрезку делает main
  const push = (s) => { if (s) { out.push(s); total += s.length; } };
  const clean = (s) => String(s || '').replace(/[ \t\f\v ]+/g, ' ').replace(/ ?\n ?/g, '\n');

  const visible = (el) => {
    try {
      if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
      if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden';
    } catch {
      return true;
    }
  };

  const tableToMarkdown = (table) => {
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = Array.from(tr.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
      if (!cells.length) continue;
      rows.push(cells.map((c) => clean(c.innerText || c.textContent).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()));
      if (rows.length >= 200) break;
    }
    if (!rows.length) return '';
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => r.concat(Array(width - r.length).fill(''));
    const lines = rows.map((r) => `| ${pad(r).join(' | ')} |`);
    lines.splice(1, 0, `| ${Array(width).fill('---').join(' | ')} |`);
    return `\n${lines.join('\n')}\n`;
  };

  const walk = (node, listDepth) => {
    if (total > limit) return;
    if (node.nodeType === 3) {
      push(clean(node.nodeValue).replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag) || !visible(node)) return;

    if (tag === 'PRE') {
      const code = String(node.innerText || node.textContent || '').replace(/\s+$/, '');
      if (code.trim()) push(`\n\`\`\`\n${code}\n\`\`\`\n`);
      return;
    }
    if (tag === 'CODE') {
      const t = String(node.textContent || '');
      push(t.includes('\n') ? `\n\`\`\`\n${t.replace(/\s+$/, '')}\n\`\`\`\n` : `\`${t}\``);
      return;
    }
    if (tag === 'TABLE') {
      push(tableToMarkdown(node));
      return;
    }
    if (/^H[1-6]$/.test(tag)) {
      const t = clean(node.innerText || node.textContent).trim();
      if (t) push(`\n\n${'#'.repeat(Number(tag[1]))} ${t}\n`);
      return;
    }
    if (tag === 'LI') push(`\n${'  '.repeat(Math.max(0, listDepth - 1))}- `);
    else if (BLOCK.has(tag)) push('\n');

    const nextDepth = tag === 'UL' || tag === 'OL' ? listDepth + 1 : listDepth;
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c, nextDepth);
    if (BLOCK.has(tag) && tag !== 'LI') push('\n');
  };

  const isPdf = document.contentType === 'application/pdf';
  let selection = '';
  try { selection = String(window.getSelection ? window.getSelection().toString() : '').trim().slice(0, maxSelection); } catch { /* нет выделения */ }

  const base = {
    title: String(document.title || '').trim().slice(0, 300),
    url: location.href,
    lang: document.documentElement ? document.documentElement.lang || '' : '',
    selection
  };
  if (isPdf) return { ...base, kind: 'pdf', text: '' };

  // Основное содержимое: <main>/<article>, иначе вся страница (навигация, подвал и формы отброшены в SKIP)
  const root = document.querySelector('main, article, [role="main"]') || document.body || document.documentElement;
  if (root) walk(root, 0);

  let text = out.join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Страница без структуры (например, text/plain)
  if (!text && root) text = String(root.innerText || root.textContent || '').trim();
  return { ...base, kind: 'page', text };
}

function cutText(text, maxChars = MAX_CONTEXT_CHARS) {
  const s = String(text || '');
  if (s.length <= maxChars) return { text: s, truncated: false, total: s.length };
  // Режем по границе абзаца, если она не слишком далеко
  let end = maxChars;
  const nl = s.lastIndexOf('\n', maxChars);
  if (nl > maxChars * 0.8) end = nl;
  return { text: s.slice(0, end).trimEnd(), truncated: true, total: s.length };
}

// Блок, который попадает в поле Gemini. Заканчивается пустой строкой — туда пользователь пишет вопрос
function buildContextBlock(ctx, { maxChars = MAX_CONTEXT_CHARS } = {}) {
  const kind = ctx.kind === 'pdf' ? 'PDF-документ' : 'веб-страница';
  const body = cutText(ctx.text, maxChars);
  const lines = [
    '[Контекст текущей вкладки браузера]',
    `Тип: ${kind}`
  ];
  if (ctx.title) lines.push(`Заголовок: ${ctx.title}`);
  if (ctx.url) lines.push(`Адрес: ${ctx.url}`);
  if (ctx.pages) lines.push(`Страниц в документе: ${ctx.pages}${ctx.pagesRead < ctx.pages ? ` (прочитано ${ctx.pagesRead})` : ''}`);
  if (ctx.selection) lines.push('', 'Выделенный пользователем фрагмент:', `"""\n${ctx.selection}\n"""`);
  lines.push('', 'Содержимое:', body.text || '(текст не найден)');
  if (body.truncated) lines.push('', `[Текст обрезан: показано ${body.text.length} из ${body.total} символов]`);
  lines.push('[Конец контекста]', '', '');
  return lines.join('\n');
}

// ---- PDF ----

let pdfjsPromise = null;
function loadPdfjs() {
  // Необязательная зависимость: если пакета нет, PDF просто не читается, остальное работает
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').catch(() => null);
  return pdfjsPromise;
}

async function readPdfBytes(wc, url) {
  if (/^file:/i.test(url)) {
    const file = fileURLToPath(url);
    const st = await fs.promises.stat(file);
    if (st.size > PDF_MAX_BYTES) throw new Error('pdf-too-large');
    return new Uint8Array(await fs.promises.readFile(file));
  }
  // Тем же сеансом, что у вкладки: куки и вход на сайте сохраняются (документы за авторизацией читаются)
  const res = await wc.session.fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`pdf-http-${res.status}`);
  const len = Number(res.headers.get('content-length'));
  if (len > PDF_MAX_BYTES) throw new Error('pdf-too-large');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > PDF_MAX_BYTES) throw new Error('pdf-too-large');
  return buf;
}

async function extractPdfText(wc, url, maxChars = MAX_CONTEXT_CHARS) {
  const pdfjs = await loadPdfjs();
  if (!pdfjs) throw new Error('pdf-engine-missing');
  const data = await readPdfBytes(wc, url);
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
  try {
    const pages = doc.numPages;
    const parts = [];
    let chars = 0;
    let read = 0;
    for (let i = 1; i <= Math.min(pages, PDF_MAX_PAGES) && chars <= maxChars; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      let text = '';
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        line += item.str;
        if (item.hasEOL) { text += `${line}\n`; line = ''; }
      }
      text += line;
      page.cleanup();
      read = i;
      const t = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (t) { parts.push(`--- Страница ${i} ---\n${t}`); chars += t.length; }
    }
    return { text: parts.join('\n\n'), pages, pagesRead: read };
  } finally {
    try { await doc.destroy(); } catch { /* уже закрыт */ }
  }
}

// Понятные причины отказа: попадают в подсказку кнопки
function describeError(err) {
  const code = String((err && err.message) || err || '');
  if (code === 'unsupported') return 'Эту страницу прочитать нельзя: внутренние страницы браузера недоступны.';
  if (code === 'no-tab') return 'Нет открытой вкладки.';
  if (code === 'pdf-engine-missing') return 'Чтение PDF не установлено: выполните npm install pdfjs-dist.';
  if (code === 'pdf-too-large') return 'PDF слишком большой (больше 60 МБ).';
  if (code.startsWith('pdf-http-')) return 'Не удалось скачать PDF для чтения.';
  return 'Не удалось прочитать вкладку.';
}

// Главная функция: читает активную вкладку (webContents) и возвращает { kind, title, url, text, selection, ... }
async function extractTabContext(wc, { maxChars = MAX_CONTEXT_CHARS } = {}) {
  if (!wc || wc.isDestroyed()) throw new Error('no-tab');
  const url = wc.getURL();
  if (!isExtractableUrl(url)) throw new Error('unsupported');

  let ctx;
  try {
    const code = `(${pageExtractor.toString()})(${Number(maxChars)}, ${MAX_SELECTION_CHARS})`;
    ctx = await wc.executeJavaScriptInIsolatedWorld(TAB_CONTEXT_WORLD_ID, [{ code }]);
  } catch {
    // PDF-просмотрщик и подобные документы могут не пустить скрипт: тогда ориентируемся на адрес
    ctx = looksLikePdfUrl(url) ? { kind: 'pdf', title: wc.getTitle(), url, selection: '', text: '' } : null;
  }
  if (!ctx || typeof ctx !== 'object') throw new Error('read-failed');

  if (ctx.kind === 'pdf') {
    const pdf = await extractPdfText(wc, ctx.url || url, maxChars);
    return { ...ctx, ...pdf };
  }
  return ctx;
}

module.exports = {
  MAX_CONTEXT_CHARS,
  TAB_CONTEXT_WORLD_ID,
  isExtractableUrl,
  looksLikePdfUrl,
  pageExtractor,
  cutText,
  buildContextBlock,
  extractTabContext,
  describeError
};
