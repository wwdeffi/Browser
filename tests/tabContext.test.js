'use strict';
// «Контекст текущей вкладки» для Gemini: какие адреса читаем, как режем текст и собираем блок, как работает вставка в панель
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_CONTEXT_CHARS, isExtractableUrl, looksLikePdfUrl, pageExtractor, cutText, buildContextBlock, extractTabContext, describeError
} = require('../main/tabContext');
const { GeminiPanel } = require('../main/geminiPanel');

test('isExtractableUrl: читаем http(s) и файлы, внутренние адреса — нет', () => {
  assert.ok(isExtractableUrl('https://example.com/a'));
  assert.ok(isExtractableUrl('http://example.com/'));
  assert.ok(isExtractableUrl('file:///C:/docs/a.pdf'));
  assert.ok(!isExtractableUrl('browser://newtab'));
  assert.ok(!isExtractableUrl('browser://settings'));
  assert.ok(!isExtractableUrl('javascript:alert(1)'));
  assert.ok(!isExtractableUrl('about:blank'));
  assert.ok(!isExtractableUrl('not a url'));
});

test('looksLikePdfUrl: смотрит на путь, а не на параметры', () => {
  assert.ok(looksLikePdfUrl('https://example.com/files/report.PDF'));
  assert.ok(looksLikePdfUrl('https://example.com/report.pdf?download=1'));
  assert.ok(!looksLikePdfUrl('https://example.com/page?file=report.pdf'));
  assert.ok(!looksLikePdfUrl('nope'));
});

test('cutText: короткий текст не трогаем, длинный режем по границе абзаца', () => {
  assert.deepEqual(cutText('abc', 10), { text: 'abc', truncated: false, total: 3 });
  const para = 'a'.repeat(90);
  const long = `${para}\n${'b'.repeat(500)}`;
  const cut = cutText(long, 100);
  assert.equal(cut.truncated, true);
  assert.equal(cut.total, long.length);
  assert.equal(cut.text, para, 'обрезка по переносу строки, если он близко к лимиту');
  assert.equal(cutText('x'.repeat(200), 100).text.length, 100);
});

test('buildContextBlock: заголовок, адрес, выделение, содержимое; в конце место для вопроса', () => {
  const block = buildContextBlock({
    kind: 'page', title: 'Статья', url: 'https://example.com/a', selection: 'важное', text: '# Заголовок\nТекст'
  });
  assert.match(block, /^\[Контекст текущей вкладки браузера\]/);
  assert.match(block, /Тип: веб-страница/);
  assert.match(block, /Заголовок: Статья/);
  assert.match(block, /Адрес: https:\/\/example\.com\/a/);
  assert.match(block, /Выделенный пользователем фрагмент:\n"""\nважное\n"""/);
  assert.match(block, /Содержимое:\n# Заголовок\nТекст/);
  assert.ok(block.endsWith('[Конец контекста]\n\n'), 'после блока — пустая строка для вопроса');
  assert.ok(!/Выделенный/.test(buildContextBlock({ kind: 'page', text: 'x' })), 'без выделения раздела нет');
});

test('buildContextBlock: PDF с числом страниц и пометка об обрезке', () => {
  const block = buildContextBlock(
    { kind: 'pdf', title: 'Договор', url: 'file:///a.pdf', pages: 200, pagesRead: 120, text: 'z'.repeat(500) },
    { maxChars: 100 }
  );
  assert.match(block, /Тип: PDF-документ/);
  assert.match(block, /Страниц в документе: 200 \(прочитано 120\)/);
  assert.match(block, /Текст обрезан: показано 100 из 500 символов/);
  assert.match(buildContextBlock({ kind: 'page', text: '' }), /\(текст не найден\)/);
  assert.ok(MAX_CONTEXT_CHARS >= 10000);
});

test('describeError: понятные причины', () => {
  assert.match(describeError(new Error('unsupported')), /внутренние страницы/);
  assert.match(describeError(new Error('pdf-engine-missing')), /pdfjs-dist/);
  assert.match(describeError(new Error('pdf-too-large')), /слишком большой/);
  assert.match(describeError(new Error('pdf-http-403')), /PDF/);
  assert.match(describeError(new Error('что-то ещё')), /Не удалось прочитать/);
});

test('pageExtractor: самодостаточная функция, которую можно отправить в страницу как строку', () => {
  const src = `(${pageExtractor.toString()})(1000, 100)`;
  assert.doesNotThrow(() => new Function(`return ${src}`), 'синтаксис корректен');
  assert.ok(!/require\(/.test(src), 'внешних зависимостей нет');
});

test('extractTabContext: внутренние страницы и уничтоженные вкладки отклоняются', async () => {
  await assert.rejects(extractTabContext(null), /no-tab/);
  await assert.rejects(extractTabContext({ isDestroyed: () => true }), /no-tab/);
  const wc = { isDestroyed: () => false, getURL: () => 'browser://newtab' };
  await assert.rejects(extractTabContext(wc), /unsupported/);
});

test('extractTabContext: обычная страница возвращается как есть, PDF без движка даёт понятную ошибку', async () => {
  const page = { kind: 'page', title: 'T', url: 'https://example.com/', selection: '', text: 'hello' };
  const wc = {
    isDestroyed: () => false, getURL: () => 'https://example.com/',
    executeJavaScriptInIsolatedWorld: async () => JSON.stringify(page)
  };
  assert.deepEqual(await extractTabContext(wc), page);

  // Изолированный мир отдал пустоту (объект не доехал) — читаем в основном мире
  const fallback = {
    isDestroyed: () => false, getURL: () => 'https://example.com/',
    executeJavaScriptInIsolatedWorld: async () => undefined,
    executeJavaScript: async () => JSON.stringify(page)
  };
  assert.deepEqual(await extractTabContext(fallback), page);

  // Оба пути не дали результата — понятная ошибка с причиной
  const broken = {
    isDestroyed: () => false, getURL: () => 'https://example.com/',
    executeJavaScriptInIsolatedWorld: async () => { throw new Error('world gone'); },
    executeJavaScript: async () => { throw new Error('frame detached'); }
  };
  await assert.rejects(extractTabContext(broken), /read-failed: frame detached/);
  assert.match(describeError(new Error('read-failed: frame detached')), /прочитать вкладку \(read-failed: frame detached\)/);

  const pdfWc = {
    isDestroyed: () => false, getURL: () => 'https://example.com/a.pdf', getTitle: () => 'a.pdf',
    executeJavaScriptInIsolatedWorld: async () => { throw new Error('заблокировано'); },
    executeJavaScript: async () => { throw new Error('заблокировано'); }
  };
  // pdfjs-dist в тестовом окружении не установлен — ждём именно эту причину, а не падение
  await assert.rejects(extractTabContext(pdfWc), /pdf-engine-missing|pdf-/);
});

test('GeminiPanel.insertText: без панели или без текста — отказ без ожидания', async () => {
  const none = new GeminiPanel({ win: null, getSession: () => null });
  assert.deepEqual(await none.insertText('текст'), { ok: false, reason: 'no-panel' });

  const p = new GeminiPanel({ win: null, getSession: () => null });
  p.view = { webContents: { isDestroyed: () => false, getURL: () => 'https://accounts.google.com/signin' } };
  const started = Date.now();
  // Пустой текст не ждём вообще
  assert.deepEqual(await p.insertText(''), { ok: false, reason: 'no-panel' });
  assert.ok(Date.now() - started < 200);
});

test('GeminiPanel.insertText: вставка работает, даже если в Electron нет clipboard.readHTML', async () => {
  const calls = [];
  const clipboard = {
    readText: () => 'старый буфер',
    writeText: (v) => calls.push(['writeText', v]),
    write: (d) => calls.push(['write', d]),
    clear: () => calls.push(['clear'])
    // readHTML и readImage отсутствуют намеренно
  };
  // Заглушка electron из helpers отдаёт новый объект на каждый require, поэтому подменяем загрузчик модулей на время теста
  const Module = require('module');
  const prevLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return { WebContentsView: class {}, clipboard };
    return prevLoad.call(this, request, ...rest);
  };
  let Panel;
  try {
    delete require.cache[require.resolve('../main/geminiPanel')];
    Panel = require('../main/geminiPanel').GeminiPanel;
  } finally {
    Module._load = prevLoad;
    delete require.cache[require.resolve('../main/geminiPanel')]; // другим тестам — модуль с обычной заглушкой
  }
  const p = new Panel({ win: null, getSession: () => null });
  let pasted = false;
  p.view = {
    getBounds: () => ({ width: 400, height: 800 }),
    webContents: {
      isDestroyed: () => false, getURL: () => 'https://gemini.google.com/app', focus() {},
      executeJavaScriptInIsolatedWorld: async () => true, paste: () => { pasted = true; }
    }
  };
  assert.deepEqual(await p.insertText('блок'), { ok: true });
  assert.ok(pasted);
  assert.deepEqual(calls[0], ['writeText', 'блок']);
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(calls[1], ['write', { text: 'старый буфер' }], 'прежний текст из буфера вернулся');
});

test('buildContextFile: имя из заголовка, без служебных символов; содержимое и пометка об обрезке', () => {
  const { buildContextFile } = require('../main/tabContext');
  const f = buildContextFile({ kind: 'page', title: 'Мона Лиза: Википедия/тест', url: 'https://x.org/a', text: 'абв'.repeat(10) }, { maxChars: 10 });
  assert.equal(f.name, 'Мона Лиза Википедия тест.md');
  assert.match(f.text, /^# Мона Лиза/);
  assert.match(f.text, /Адрес: https:\/\/x\.org\/a/);
  assert.match(f.text, /Текст обрезан/);
});

test('buildAttachScript: валидный JS, файл и событие paste', () => {
  const { buildAttachScript } = require('../main/geminiPanel');
  const code = buildAttachScript('a "q".md', 'текст\n`x`', 'text/markdown');
  assert.doesNotThrow(() => new Function(code));
  assert.match(code, /new ClipboardEvent\('paste'/);
});
