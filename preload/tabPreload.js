const { contextBridge, ipcRenderer, webFrame } = require('electron');

// Безопасность: экспортируем внутренний API ТОЛЬКО для страницы browser://newtab.
// Остальные страницы browser:// (например, browser://error) и обычные сайты (http/https) не получают доступа к IPC.
if (window.location.protocol === 'browser:' && window.location.hostname === 'newtab') {
  contextBridge.exposeInMainWorld('internalApi', {
    getNewTabData: () => ipcRenderer.invoke('internal:newtab:get'),
    saveNewTabData: (patch) => ipcRenderer.invoke('internal:newtab:save', patch),
    pickWallpaper: () => ipcRenderer.invoke('internal:newtab:pick-wallpaper'),
    clearWallpaper: () => ipcRenderer.invoke('internal:newtab:clear-wallpaper'),
    setSearchEngine: (key) => ipcRenderer.invoke('internal:set-search-engine', key),
    navigate: (input) => ipcRenderer.send('internal:navigate', input),
    // Подсказки под полем поиска: тот же попап, что у адресной строки (rect — поле поиска в координатах страницы)
    omniboxQuery: (text, rect) => ipcRenderer.send('internal:omnibox:query', String(text), {
      left: Number(rect && rect.left), bottom: Number(rect && rect.bottom), width: Number(rect && rect.width)
    }),
    omniboxWarm: () => ipcRenderer.send('internal:omnibox:warm'),
    omniboxMove: (delta) => ipcRenderer.send('internal:omnibox:move', Number(delta)),
    omniboxHide: () => ipcRenderer.send('internal:omnibox:hide'),
    omniboxBlur: () => ipcRenderer.send('internal:omnibox:blur'),
    omniboxAccept: (text) => ipcRenderer.invoke('internal:omnibox:accept', String(text)),
    openInNewTab: (url) => ipcRenderer.send('internal:open-new-tab', url),
    setTransparentChrome: (enabled) => ipcRenderer.send('internal:transparent-chrome', Boolean(enabled)),
    setChromeTheme: (id, mode, seed) => ipcRenderer.send('internal:chrome-theme', String(id), mode === 'light' ? 'light' : 'dark', seed && typeof seed === 'object' ? JSON.parse(JSON.stringify(seed)) : null),
    saveStudioPrefs: (patch) => ipcRenderer.invoke('internal:studio:save-prefs', patch && typeof patch === 'object' ? JSON.parse(JSON.stringify(patch)) : {}),
    saveStudioBookmarks: (tree) => ipcRenderer.invoke('internal:studio:save-bookmarks', tree && typeof tree === 'object' ? JSON.parse(JSON.stringify(tree)) : {}),
    migrateStudio: (legacy) => ipcRenderer.invoke('internal:studio:migrate', legacy && typeof legacy === 'object' ? JSON.parse(JSON.stringify(legacy)) : {}),
    getSiteIcon: (url) => ipcRenderer.invoke('internal:site-icon', String(url)),
    getBookmarks: () => ipcRenderer.invoke('internal:bookmarks:list'),
    removeBookmark: (url) => ipcRenderer.invoke('internal:bookmarks:remove', String(url)),
    onBookmarksChanged: (cb) => { if (typeof cb === 'function') ipcRenderer.on('internal:bookmarks:changed', (_e, list) => cb(list)); },
    onStudioBookmarksChanged: (cb) => { if (typeof cb === 'function') ipcRenderer.on('internal:studio-bm:changed', (_e, bm) => cb(bm)); },
    // Режим экономии энергии: main шлёт 'internal:energy-saver:changed' (boolean), начальное значение — energySaverActive в getNewTabData
    onEnergySaverChanged: (cb) => { if (typeof cb === 'function') ipcRenderer.on('internal:energy-saver:changed', (_e, active) => cb(Boolean(active))); }
  });

  // Глобальные запреты камеры / микрофона / геолокации (только browser://newtab)
  contextBridge.exposeInMainWorld('newtabApi', {
    getPermBlocks: () => ipcRenderer.invoke('internal:perm-blocks:get'),
    setPermBlock: (key, value) => ipcRenderer.invoke('internal:perm-blocks:set', String(key), Boolean(value)),
    onPermBlocksChanged: (cb) => { if (typeof cb === 'function') ipcRenderer.on('internal:perm-blocks:changed', (_e, state) => cb(state)); }
  });
}

// window.settingsApi — СТРОГО только для browser://settings
if (window.location.protocol === 'browser:' && window.location.hostname === 'settings') {
  contextBridge.exposeInMainWorld('settingsApi', {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch && typeof patch === 'object' ? JSON.parse(JSON.stringify(patch)) : {}),
    sleepNow: () => ipcRenderer.invoke('settings:sleep-now'),
    getRules: () => ipcRenderer.invoke('settings:adblock:get-rules'),
    saveRules: (text) => ipcRenderer.invoke('settings:adblock:save-rules', String(text)),
    listMediaPermissions: () => ipcRenderer.invoke('settings:media:list'),
    removeMediaPermission: (origin) => ipcRenderer.invoke('settings:media:remove', String(origin)),
    clearCache: () => ipcRenderer.invoke('settings:clear:cache'),
    clearHistory: () => ipcRenderer.invoke('settings:clear:history'),
    clearSiteData: () => ipcRenderer.invoke('settings:clear:site-data'),
    importBookmarks: () => ipcRenderer.invoke('settings:bookmarks:import'),
    exportBookmarks: () => ipcRenderer.invoke('settings:bookmarks:export'),
	getUpdaterState: () => ipcRenderer.invoke('settings:updater:state'),
    checkUpdates: () => ipcRenderer.invoke('settings:updater:check'),
    downloadUpdate: () => ipcRenderer.invoke('settings:updater:download'),
    installUpdate: () => ipcRenderer.invoke('settings:updater:install'),
    listExtensions: () => ipcRenderer.invoke('settings:ext:list'),
    addExtension: () => ipcRenderer.invoke('settings:ext:add'),
    removeExtension: (dirPath) => ipcRenderer.invoke('settings:ext:remove', String(dirPath || '')),

    onChange: (cb) => {
      if (typeof cb === 'function') ipcRenderer.on('settings:changed', (_e, payload) => cb(payload));
    }
  });
}

// window.passwordsApi — СТРОГО только для browser://settings
if (window.location.protocol === 'browser:' && window.location.hostname === 'settings') {
  contextBridge.exposeInMainWorld('passwordsApi', {
    list: () => ipcRenderer.invoke('passwords:list'),
    reveal: (id) => ipcRenderer.invoke('passwords:reveal', String(id)),
    copy: (id) => ipcRenderer.invoke('passwords:copy', String(id)),
    remove: (id) => ipcRenderer.invoke('passwords:remove', String(id)),
    clear: () => ipcRenderer.invoke('passwords:clear'),
    importCsv: () => ipcRenderer.invoke('passwords:import-csv')
  });
}

// window.historyApi — СТРОГО только для browser://history
if (window.location.protocol === 'browser:' && window.location.hostname === 'history') {
  contextBridge.exposeInMainWorld('historyApi', {
    get: () => ipcRenderer.invoke('history:get'),
    remove: (url) => ipcRenderer.invoke('history:remove', String(url)),
    clear: (range) => ipcRenderer.invoke('history:clear', String(range)),
    open: (url, inNewTab) => ipcRenderer.send('history:open', String(url), Boolean(inNewTab))
  });
}

// window.downloadsApi — СТРОГО только для browser://downloads
if (window.location.protocol === 'browser:' && window.location.hostname === 'downloads') {
  contextBridge.exposeInMainWorld('downloadsApi', {
    get: () => ipcRenderer.invoke('downloads:get'),
    action: (type, id) => ipcRenderer.invoke('downloads:action', String(type), Number.isInteger(id) ? id : null),
    onChanged: (cb) => {
      if (typeof cb === 'function') ipcRenderer.on('downloads:changed', () => cb());
    }
  });
}

// window.bookmarksApi — СТРОГО только для browser://bookmarks
if (window.location.protocol === 'browser:' && window.location.hostname === 'bookmarks') {
  const clone = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : {});
  contextBridge.exposeInMainWorld('bookmarksApi', {
    get: () => ipcRenderer.invoke('bookmarks:get'),
    createFolder: (payload) => ipcRenderer.invoke('bookmarks:create-folder', clone(payload)),
    createBookmark: (payload) => ipcRenderer.invoke('bookmarks:create', clone(payload)),
    update: (payload) => ipcRenderer.invoke('bookmarks:update', clone(payload)),
    move: (payload) => ipcRenderer.invoke('bookmarks:move', clone(payload)),
    remove: (id) => ipcRenderer.invoke('bookmarks:remove', String(id)),
    open: (url, inNewTab) => ipcRenderer.send('bookmarks:open', String(url), Boolean(inNewTab)),
    onChanged: (cb) => {
      if (typeof cb === 'function') ipcRenderer.on('bookmarks:changed', (_e, payload) => cb(payload));
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Изоляция скриптов браузера от страницы.
// Preload при contextIsolation: true выполняется в отдельном JS-мире Electron: DOM общий со страницей,
// а window, прототипы и глобальные переменные — свои. Поэтому JS-слои (перекраска Google и фильтр
// источников) работают здесь, а НЕ внедряются в мир страницы через executeJavaScript, и не оставляют
// на window ни одного свойства (раньше это были __ptAdaptive / __ptSources): всё состояние лежит в замыканиях.
// Конфигурацию (палитра, доверенные сайты) присылает main по IPC; страница IPC не видит.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Общий хаб: ОДИН MutationObserver на все JS-слои + батчинг через requestAnimationFrame.
// Слой регистрируется методом add(api), где api = { onMutations(records) -> bool, flush() -> bool }:
//   • onMutations — дешёвый разбор записей (только складывает работу в очереди), true = нужен flush;
//   • flush — вызывается максимум раз за кадр (rAF), true = работа осталась, нужен ещё кадр.
// Наблюдатель подключён, пока активен хотя бы один слой; когда активных нет — отключается.
// Никаких setTimeout/setInterval для повторных обходов: только мутации, событие load и явный rescan.
// (Единственный таймер — страховка 100 мс для скрытой вкладки, где rAF не срабатывает.)
// ─────────────────────────────────────────────────────────────────────────────
function createHub() {
  const layers = new Set();
  const active = new Set();
  const OBS = { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'src'] };
  let mo = null;
  let connected = false;
  let watched = new WeakSet();
  let raf = 0;
  let fb = 0;

  const flush = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (fb) { clearTimeout(fb); fb = 0; }
    let more = false;
    for (const l of layers) {
      try { if (l.flush()) more = true; } catch (e) { /* сбой слоя не должен ломать остальные */ }
    }
    if (more) request();
  };

  function request() {
    if (raf || fb) return;
    raf = requestAnimationFrame(() => { raf = 0; flush(); });
    if (document.hidden) fb = setTimeout(flush, 100);
  }

  const onMut = (records) => {
    let want = false;
    for (const l of layers) {
      try { if (l.onMutations(records)) want = true; } catch (e) { /* ignore */ }
    }
    if (want) request();
  };

  const activate = (layer) => {
    active.add(layer);
    if (connected || !document.documentElement) return;
    if (!mo) mo = new MutationObserver(onMut);
    try { mo.observe(document.documentElement, OBS); connected = true; } catch (e) { /* ignore */ }
  };

  const deactivate = (layer) => {
    active.delete(layer);
    if (active.size || !connected) return;
    try { mo.disconnect(); mo.takeRecords(); } catch (e) { /* ignore */ }
    connected = false;
    watched = new WeakSet();
  };

  // Shadow DOM: подписываем тот же общий наблюдатель
  const watch = (sr) => {
    if (!connected || watched.has(sr)) return;
    watched.add(sr);
    try { mo.observe(sr, OBS); } catch (e) { /* ignore */ }
  };

  return { add: (l) => { layers.add(l); }, activate, deactivate, watch, request };
}

// ─────────────────────────────────────────────────────────────────────────────
// Слой 1. Адаптивная перекраска Google: «серые» фоны/градиенты/тени тёмной темы → палитра браузера.
// Не зависит от имён классов (их Google меняет).
// Обработка кадра строго в две фазы: READ (все getComputedStyle/getBoundingClientRect → массив задач)
// и WRITE (применение стилей/атрибутов из массива) — без чередования чтения и записи (нет layout thrashing).
// Скрытие боковой панели источников встроено в те же две фазы того же кадра.
// ─────────────────────────────────────────────────────────────────────────────
function createAdaptiveLayer(P, hub) {
  const w = window; // window ИЗОЛИРОВАННОГО мира preload: страница его не видит

  const SKIP = {
    script: 1, style: 1, noscript: 1, img: 1, video: 1, canvas: 1, iframe: 1, svg: 1,
    picture: 1, link: 1, meta: 1, input: 1, textarea: 1, select: 1, option: 1, head: 1, template: 1
  };
  const TOKEN = /rgba?\([^)]*\)/g;
  const PSEUDO = [
    { sel: '::before', ac: 'data-pt-bcb', ai: 'data-pt-bib', vc: '--pt-bcb', vi: '--pt-bib' },
    { sel: '::after', ac: 'data-pt-bca', ai: 'data-pt-bia', vc: '--pt-bca', vi: '--pt-bia' }
  ];
  const S = 0; // тип операции: inline-стиль
  const A = 1; // тип операции: атрибут
  const FULL_MIN_GAP = 300; // не чаще одного полного обхода за 300 мс (по событиям, не по таймеру)

  let pal = null;
  let keys = null;
  let dark = true;
  let hideSrc = !(P && P.hideSources === false); // скрывать боковую панель источников — только если включены «Доверенные источники»
  let done = new WeakSet();
  const touched = new Map();
  const stack = [];
  const singles = new Set();
  let fullPending = false;
  let lastFull = 0;

  const parse = (s) => {
    if (!s) return null;
    s = String(s).trim();
    let m = /^#([0-9a-f]{6})$/i.exec(s);
    if (m) {
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i.exec(s);
    if (!m) return null;
    let a = 1;
    if (m[4] !== undefined) a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3]), a];
  };
  const toCss = (c) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${+Number(c[3]).toFixed(3)})`;
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const spread = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

  const setPalette = (X) => {
    pal = {};
    const names = ['bg', 'card', 'cardHover', 'input', 'inputFocus', 'surface', 'surfaceElev', 'bgSticky'];
    for (const k of names.concat('accent')) pal[k] = parse(X[k]) || [0, 0, 0, 1];
    keys = new Set(names.map((k) => pal[k][0] + ',' + pal[k][1] + ',' + pal[k][2]));
  };
  const isPalette = (c) => keys.has(c[0] + ',' + c[1] + ',' + c[2]);
  const bucket = (c) => {
    const l = lum(c);
    return l <= 22 ? pal.bg : l <= 34 ? pal.card : pal.surfaceElev;
  };

  // Возвращает новый цвет [r,g,b,a] или null, если красить не надо
  const mapColor = (c, base) => {
    if (!c || c[3] <= 0.04 || isPalette(c) || spread(c) > 26) return null;
    if (Math.max(c[0], c[1], c[2]) <= 150) {
      const t = base || bucket(c);
      return [t[0], t[1], t[2], c[3] * (t[3] === undefined ? 1 : t[3])];
    }
    if (c[3] <= 0.35) { // светлая полупрозрачная «вуаль» (hover/state-layer) → акцент темы
      return [pal.accent[0], pal.accent[1], pal.accent[2], Math.min(c[3], 0.2)];
    }
    return null;
  };

  const remember = (el, name) => {
    let rec = touched.get(el);
    if (!rec) { rec = new Map(); touched.set(el, rec); }
    if (!rec.has(name)) {
      rec.set(name, name.startsWith('data-pt-') ? null
        : [el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]);
    }
  };
  const setStyle = (el, name, val) => {
    remember(el, name);
    el.style.setProperty(name, val, 'important');
  };
  const setAttr = (el, name) => {
    remember(el, name);
    el.setAttribute(name, '');
  };

  // ── READ-фаза ──────────────────────────────────────────────────────────────

  // Эффективный цвет фона узла «как будет после перекраски» (в READ-фазе записей ещё нет,
  // поэтому сами прогоняем через mapColor). Кэш — на один кадр: общие предки читаются один раз.
  const effectiveBg = (n, cache) => {
    let c = cache.get(n);
    if (c === undefined) {
      const raw = parse(getComputedStyle(n).backgroundColor);
      c = raw ? (mapColor(raw, null) || raw) : null;
      cache.set(n, c);
    }
    return c;
  };

  // Цвет «подложки» под элементом — чтобы затухание сливалось с тем, на чём лежит
  const backdrop = (el, cache) => {
    for (let n = el; n;) {
      const c = effectiveBg(n, cache);
      if (c && c[3] > 0.9) return c;
      n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
    }
    return pal.bg;
  };

  const rewriteGradient = (value, el, cache) => {
    if (!value || value.indexOf('gradient(') === -1 || value.indexOf('url(') !== -1) return null;
    const base = backdrop(el, cache);
    let changed = false;
    const out = value.replace(TOKEN, (tok) => {
      const m = mapColor(parse(tok), base);
      if (!m) return tok;
      changed = true;
      return toCss(m);
    });
    return changed ? out : null;
  };

  // «Стекло» (bg прозрачен): любой нейтрально-тёмный градиент/тень на прозрачном фоне — это грязный брусок, гасим
  const glassMode = () => pal.bg[3] === 0;
  const neutralDark = (str) => {
    const m = str && str.match(TOKEN);
    if (!m) return false;
    for (let i = 0; i < m.length; i++) {
      const c = parse(m[i]);
      if (c && c[3] > 0.04 && Math.max(c[0], c[1], c[2]) <= 150 && spread(c) <= 26) return true;
    }
    return false;
  };

  // Только чтение: формирует плоский список операций [тип, имя, значение, ...] и кладёт (el, ops) в tasks
  const readEl = (el, tasks, cache) => {
    try {
      const cs = getComputedStyle(el);
      const glass = glassMode();
      const ops = [];
      const bi = cs.backgroundImage;
      const sh = cs.boxShadow;
      let biNone = false;
      let shNone = false;

      if (glass) {
        if (bi && bi.indexOf('gradient(') !== -1 && bi.indexOf('url(') === -1 && neutralDark(bi)) {
          ops.push(S, 'background-image', 'none');
          biNone = true;
        }
        if (sh && sh !== 'none' && neutralDark(sh)) {
          ops.push(S, 'box-shadow', 'none');
          shNone = true;
        }
      }

      const bg = mapColor(parse(cs.backgroundColor), null);
      if (bg) ops.push(S, 'background-color', toCss(bg));

      if (!biNone) {
        const g = rewriteGradient(bi, el, cache);
        if (g) ops.push(S, 'background-image', g);
      }

      if (!shNone && sh && sh !== 'none') {
        let changed = false;
        const ns = sh.replace(TOKEN, (tok) => {
          const c = parse(tok);
          if (!c || c[3] < 0.05 || isPalette(c) || spread(c) > 26 || lum(c) < 28) return tok;
          changed = true;
          return toCss([pal.accent[0], pal.accent[1], pal.accent[2], Math.min(c[3] * 0.9, 0.5)]);
        });
        if (changed) ops.push(S, 'box-shadow', ns);
      }

      // Затухания/подложки — это абсолютно позиционированные псевдоэлементы; для статичных
      // элементов не дёргаем getComputedStyle(el, '::before/::after') (самый дорогой вызов)
      // В режиме «стекло» (bg прозрачен) проверяем и статичные: затухание Google может быть псевдоэлементом статичного блока
      if (!(cs.position === 'static' && pal.bg[3] > 0)) {
        for (const ps of PSEUDO) {
          const pcs = getComputedStyle(el, ps.sel);
          const content = pcs.content;
          if (!content || content === 'none' || content === 'normal') continue;
          const pc = mapColor(parse(pcs.backgroundColor), null);
          if (pc) ops.push(S, ps.vc, toCss(pc), A, ps.ac, '');
          const pbi = pcs.backgroundImage;
          if (glass && pbi && pbi.indexOf('gradient(') !== -1 && pbi.indexOf('url(') === -1 && neutralDark(pbi)) {
            ops.push(S, ps.vi, 'none', A, ps.ai, '');
            continue;
          }
          const pg = rewriteGradient(pbi, el, cache);
          if (pg) ops.push(S, ps.vi, pg, A, ps.ai, '');
        }
      }

      if (ops.length) tasks.push(el, ops);
    } catch (e) {
      // один сломанный элемент не должен останавливать обход
    }
  };

  // Боковое окно «источники» у Обзора от ИИ (карточка со ссылками и кнопкой «Показать все») — убираем целиком.
  // Классы у Google обфусцированы, поэтому ищем по кнопке и поднимаемся к карточке со скруглением и 2+ ссылками.
  // На мутациях разбираем только ДОБАВЛЕННЫЕ узлы (hideQueue), полный обход body — один раз при старте и на load.
  const isGoogleHost = /(^|\.)google\./.test(location.hostname);
  const isShowAllLabel = (t) => /^(показать все|показать всё|show all)$/i.test(t.replace(/\s+/g, ' ').trim());
  const hideQueue = new Set();
  let hideFull = false;

  const hideActive = () => dark && isGoogleHost && hideSrc;

  const hideCard = (el) => {
    // через setAttr/setStyle: изменения попадают в touched и откатываются в reset()
    setAttr(el, 'data-pt-src');
    setStyle(el, 'display', 'none');
  };

  // READ: ищем карточку-кандидата (размеры, скругление, число ссылок), ничего не пишем
  const findCardFromLabel = (label, seen) => {
    let cur = label;
    for (let d = 0; cur && d < 14; d++, cur = cur.parentElement) {
      if (cur === document.body || cur === document.documentElement) break;
      if (cur.hasAttribute('data-pt-src') || seen.has(cur)) break;
      const r = cur.getBoundingClientRect();
      if (r.width < 240 || r.width > 520 || r.height < 120) continue;
      if (cur.querySelectorAll('a[href]').length < 2) continue;
      const rad = parseFloat(getComputedStyle(cur).borderTopLeftRadius) || 0;
      if (rad < 14) continue;
      return cur;
    }
    return null;
  };

  const scanLabels = (root, cards, seen) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const found = [];
    let n;
    while ((n = walker.nextNode())) {
      const v = n.nodeValue;
      if (v && v.length < 20 && n.parentElement && isShowAllLabel(v)) found.push(n.parentElement);
    }
    for (let i = 0; i < found.length; i++) {
      const card = findCardFromLabel(found[i], seen);
      if (card) { seen.add(card); cards.push(card); }
    }
  };

  const readHide = (cards) => {
    try {
      const seen = new Set();
      // Атрибутный селектор по документу дёшев — его проверяем всегда
      const asides = document.querySelectorAll('[data-xid^="aim-aside"]');
      for (let i = 0; i < asides.length; i++) {
        let top = asides[i];
        for (let d = 0; d < 5; d++) {
          const par = top.parentElement;
          if (!par || par === document.body || par === document.documentElement || par.children.length !== 1) break;
          top = par;
        }
        if (!seen.has(top)) { seen.add(top); cards.push(top); }
      }
      const roots = hideFull ? [document.body || document.documentElement] : Array.from(hideQueue);
      hideQueue.clear();
      hideFull = false;
      for (let i = 0; i < roots.length; i++) {
        if (roots[i] && roots[i].isConnected) scanLabels(roots[i], cards, seen);
      }
    } catch (e) { /* ignore */ }
  };

  // ── Кадр: READ → WRITE ─────────────────────────────────────────────────────

  const flush = () => {
    if (!dark) return false;

    if (fullPending && performance.now() - lastFull >= FULL_MIN_GAP) {
      fullPending = false;
      lastFull = performance.now();
      done = new WeakSet();
      stack.push(document.documentElement);
    }

    const t0 = performance.now();
    const tasks = [];
    const cache = new Map();
    const cards = [];

    // READ: только чтение (getComputedStyle / размеры) + обход дерева
    if (singles.size) {
      for (const el of singles) if (el.isConnected) readEl(el, tasks, cache);
      singles.clear();
    }
    let n = 0;
    while (stack.length) {
      const el = stack.pop();
      if (!el || el.nodeType !== 1 || done.has(el)) continue;
      done.add(el);
      if (SKIP[el.localName]) continue;
      readEl(el, tasks, cache);
      const sr = el.shadowRoot;
      if (sr) {
        hub.watch(sr);
        for (let i = sr.children.length - 1; i >= 0; i--) stack.push(sr.children[i]);
      }
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
      if ((++n & 31) === 0 && performance.now() - t0 > 10) break;
    }
    if (hideActive() && (hideFull || hideQueue.size)) readHide(cards);

    // WRITE: только запись из собранных задач
    for (let i = 0; i < tasks.length; i += 2) {
      const el = tasks[i];
      const ops = tasks[i + 1];
      for (let j = 0; j < ops.length; j += 3) {
        if (ops[j] === S) setStyle(el, ops[j + 1], ops[j + 2]);
        else setAttr(el, ops[j + 1]);
      }
    }
    for (let i = 0; i < cards.length; i++) hideCard(cards[i]);

    if (touched.size > 3000) {
      for (const el of Array.from(touched.keys())) if (!el.isConnected) touched.delete(el);
    }
    return stack.length > 0 || singles.size > 0 || fullPending;
  };

  // Дешёвый разбор записей: только очереди, никаких обращений к стилям/раскладке
  const onMutations = (records) => {
    if (!dark) return false;
    const hide = hideActive();
    let work = false;
    for (const r of records) {
      if (r.type === 'childList') {
        for (const nd of r.addedNodes) {
          if (nd.nodeType !== 1) continue;
          if (nd.localName === 'style' || nd.localName === 'link') {
            fullPending = true;
            work = true;
          } else {
            stack.push(nd);
            work = true;
            if (hide && !SKIP[nd.localName]) hideQueue.add(nd);
            if (nd.querySelector && nd.querySelector('style')) fullPending = true;
          }
        }
      } else if (r.attributeName === 'class' && r.target && r.target.nodeType === 1) {
        done.delete(r.target);
        singles.add(r.target);
        work = true;
      }
    }
    if (hideQueue.size > 40) { hideFull = true; hideQueue.clear(); }
    return work;
  };

  // Повторный обход без сброса (идемпотентно): ловит блоки, чей стиль Google выставил уже после первого обхода
  // Вызывается по событию (pt:rescan / load), а не по таймеру
  const rescan = () => {
    if (!dark) return;
    done = new WeakSet();
    stack.push(document.documentElement);
    hub.request();
  };

  const reset = () => {
    touched.forEach((rec, el) => {
      rec.forEach((orig, name) => {
        try {
          if (orig === null) el.removeAttribute(name);
          else if (orig[0]) el.style.setProperty(name, orig[0], orig[1]);
          else el.style.removeProperty(name);
        } catch (e) { /* ignore */ }
      });
    });
    touched.clear();
    stack.length = 0;
    singles.clear();
    hideQueue.clear();
    hideFull = false;
    fullPending = false;
    done = new WeakSet();
  };

  const start = () => {
    hub.activate(api);
    stack.push(document.documentElement);
    hideFull = true; // единственный полный поиск «Показать все» при старте; дальше — только добавленные узлы
    hub.request();
  };

  const update = (X) => {
    reset();
    if (!X || !X.dark) { dark = false; hub.deactivate(api); return; }
    hideSrc = X.hideSources !== false;
    setPalette(X);
    dark = true;
    start();
  };

  const api = { update, rescan, onMutations, flush };
  hub.add(api);

  setPalette(P);
  start();
  // Один повторный обход по событию load (вместо серии setTimeout 400/1200/2500/5000 мс)
  w.addEventListener('load', () => {
    if (!dark) return;
    hideFull = true;
    rescan();
  }, { once: true });
  // Новые блоки при прокрутке (подгрузка выдачи) и так ловит общий MutationObserver.

  // Никаких свойств на window: управление возвращается только коду preload
  return api;
}

// ─────────────────────────────────────────────────────────────────────────────
// Слой 2. Фильтр источников «Обзора от ИИ»: оставляет доверенные сайты, остальные карточки скрывает.
// Структура: ul > li > div.cRH23c > a[href^="/goto?url=..."] — домена в ссылке нет, поэтому сайт
// определяется по подписи (.EsfOKc) и значку (faviconV2?url=https://домен). Не опознали — карточку НЕ трогаем.
// Работает через общий хаб: мутации → флаг dirty → один проход в rAF (READ: вердикты, WRITE: пометки).
// ─────────────────────────────────────────────────────────────────────────────
function createSourceFilterLayer(cfg, hub) {

  let allow = [];
  let names = [];
  let enabled = false;
  let dirty = false;
  const hidden = new Map(); // li -> прежний inline display
  const log = [];

  const hostTrusted = (host) => allow.some((s) => (s.charAt(0) === '.'
    ? host.endsWith(s)
    : host === s || host.endsWith('.' + s)));

  const faviconHost = (li) => {
    const img = li.querySelector('img[src*="faviconV2"]');
    if (!img) return null;
    try {
      const t = new URL(img.getAttribute('src')).searchParams.get('url');
      return t ? new URL(t).hostname.toLowerCase().replace(/^www\./, '') : null;
    } catch (e) {
      return null;
    }
  };

  const siteName = (li) => {
    const el = li.querySelector('.EsfOKc');
    return el ? String(el.textContent || '').trim().toLowerCase() : '';
  };

  // true — доверенный, false — опознан и не доверенный, null — не удалось опознать
  const verdict = (li) => {
    const fh = faviconHost(li);
    const nm = siteName(li);
    const cands = [];
    if (fh) cands.push(fh);
    if (nm && /^[^\s.]+(\.[^\s.]+)+$/.test(nm)) cands.push(nm.replace(/^www\./, ''));
    if (cands.some(hostTrusted)) return true;
    if (nm && names.indexOf(nm) !== -1) return true;
    if (fh || nm) return false;
    return null;
  };

  // CSS (getSourceFilterCss) прячет все карточки по умолчанию; здесь только выносим вердикт:
  // доверенные/неопознанные получают data-pt-ok (показываются), чужие — data-pt-no + display:none
  const mark = (el, attr, why) => {
    if (hidden.has(el)) return;
    hidden.set(el, [el.style.getPropertyValue('display'), el.style.getPropertyPriority('display'), attr]);
    el.setAttribute(attr, '');
    if (attr === 'data-pt-no') {
      el.style.setProperty('display', 'none', 'important');
      log.push(why);
    }
  };

  const restore = () => {
    hidden.forEach((prev, el) => {
      el.removeAttribute(prev[2]);
      if (prev[0]) el.style.setProperty('display', prev[0], prev[1]);
      else el.style.removeProperty('display');
    });
    hidden.clear();
    log.length = 0;
  };

  const onMutations = (records) => {
    if (!enabled) return false;
    for (const r of records) {
      if (r.type === 'childList') {
        if (r.addedNodes.length) { dirty = true; break; }
      } else if (r.attributeName === 'src') {
        dirty = true; // значок источника мог подгрузиться позже
        break;
      }
    }
    return dirty;
  };

  const flush = () => {
    if (!enabled || !dirty) return false;
    dirty = false;

    // READ: определяем вердикты (DOM-запросы без записи)
    const seen = new Set();
    const pending = []; // [li, attr, why, ...]
    document.querySelectorAll('a[href^="/goto?url="]').forEach((a) => {
      const li = a.closest('li');
      if (!li || hidden.has(li) || seen.has(li)) return;
      seen.add(li);
      const v = verdict(li);
      if (v === false) pending.push(li, 'data-pt-no', siteName(li) || faviconHost(li) || '?');
      else if (v === true) pending.push(li, 'data-pt-ok', '');
      // null — не удалось опознать: ждём (значок мог не успеть подгрузиться); CSS-страховка покажет сама
    });

    // WRITE: применяем пометки
    for (let i = 0; i < pending.length; i += 3) mark(pending[i], pending[i + 1], pending[i + 2]);
    return false;
  };

  const update = (c) => {
    dirty = false;
    restore();
    enabled = !!(c && c.enabled);
    allow = (c && Array.isArray(c.allow) ? c.allow : []).map((x) => String(x).toLowerCase());
    names = (c && Array.isArray(c.names) ? c.names : []).map((x) => String(x).toLowerCase());
    if (!enabled) { hub.deactivate(api); return; }
    hub.activate(api);
    dirty = true;
    hub.request();
  };

  const api = { update, onMutations, flush };
  hub.add(api);
  update(cfg);
  return api;
}

// ─────────────────────────────────────────────────────────────────────────────
// Тема поисковиков вшивается ДО первого кадра: preload выполняется раньше скриптов страницы,
// поэтому стиль уже на месте при первой отрисовке (никакого «серого мигания»).
// Обновление CSS (смена темы, in-page навигация Google) приходит как 'pt:inject':
// сперва вставляем новый CSS, потом убираем старый — страница ни на миг не остаётся без стиля.
// JS-слои запускает main сообщением 'pt:layers' (dom-ready и смена настроек), 'pt:rescan' — повторный обход.
// ─────────────────────────────────────────────────────────────────────────────
(function initSearchLayers() {
  // Только верхний документ: sendSync('pt:get-inject') блокирует процесс, сторонние iframe он тормозить не должен
  if (window !== window.top) return;
  if (!/^https?:$/.test(window.location.protocol)) return;
  const host = window.location.hostname.toLowerCase();
  if (!/(^|\.)(google\.[a-z.]+|ya\.ru|yandex\.[a-z.]+|duckduckgo\.com|bing\.com)$/.test(host)) return;

  // ── CSS ────────────────────────────────────────────────────────────────────
  let key = null;
  const apply = (css) => {
    const old = key;
    key = null;
    if (css) {
      try { key = webFrame.insertCSS(css, { cssOrigin: 'user' }); } catch { /* документ ещё не готов */ }
    }
    if (old) {
      try { webFrame.removeInsertedCSS(old); } catch { /* уже снят */ }
    }
  };

  ipcRenderer.on('pt:inject', (_e, css) => apply(typeof css === 'string' ? css : null));

  try {
    const res = ipcRenderer.sendSync('pt:get-inject', window.location.href);
    if (res && typeof res.css === 'string' && res.css) apply(res.css);
  } catch {
    // без стиля страница просто останется родной
  }

  // ── JS-слои (экземпляры доступны только этому замыканию) ───────────────────
  // Один общий хаб: единственный MutationObserver и единый rAF-батчинг для обоих слоёв
  const hub = createHub();
  let adaptive = null;
  let sourceFilter = null;

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  const applyAdaptive = (cfg) => {
    if (!isObj(cfg)) return;
    if (adaptive) { adaptive.update(cfg); return; }
    if (!cfg.dark) return; // слоя ещё нет, а красить не просят
    adaptive = createAdaptiveLayer(cfg, hub);
  };

  const applySourceFilter = (cfg) => {
    if (!isObj(cfg)) return;
    if (sourceFilter) { sourceFilter.update(cfg); return; }
    sourceFilter = createSourceFilterLayer(cfg, hub);
  };

  ipcRenderer.on('pt:layers', (_e, msg) => {
    if (!isObj(msg) || !document.documentElement) return;
    // Сбой нашего слоя не должен ни ломать страницу, ни просачиваться в неё
    try { applySourceFilter(msg.sources); } catch { /* ignore */ }
    try { applyAdaptive(msg.adaptive); } catch { /* ignore */ }
  });

  ipcRenderer.on('pt:rescan', () => {
    try { if (adaptive) adaptive.rescan(); } catch { /* ignore */ }
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// Защита от цифрового отпечатка (JS-уровень) — ТОЛЬКО для вкладок Инкогнито при включённом флаге в конфиге.
// Активация: main передаёт в webPreferences.additionalArguments строку '--pt-fp-seed=<hex>' ровно для
// Инкогнито-вкладок при включённой опции (seed — один на сессию Инкогнито, поэтому шум детерминирован).
// Нет аргумента → ни одной строки кода в мир страницы не внедряется, обычные вкладки не затронуты.
// Код исполняется в ОСНОВНОМ мире страницы до её скриптов; на window не остаётся ни одного свойства:
// всё состояние живёт в замыкании внедряемой функции. Подмены маскируются под нативные (toString).
// ─────────────────────────────────────────────────────────────────────────────
function ptFingerprintMain(seedStr) {
  'use strict';
  const GLOBAL = window;

  // ── детерминированный хеш на сессию ───────────────────────────────────────
  let s0 = 0x811c9dc5;
  for (let i = 0; i < seedStr.length; i++) { s0 ^= seedStr.charCodeAt(i); s0 = Math.imul(s0, 0x01000193) >>> 0; }
  const mix = (a, b) => {
    let x = (a ^ Math.imul(b | 0, 0x9e3779b1)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    return (x ^ (x >>> 16)) >>> 0;
  };

  // ── маскировка под нативный код ───────────────────────────────────────────
  const nativeSrc = new WeakMap();
  const fnToString = Function.prototype.toString;
  const maskFn = (fn, label) => { nativeSrc.set(fn, 'function ' + label + '() { [native code] }'); return fn; };
  const fakeToString = { toString() {
    const s = nativeSrc.get(this);
    return s !== undefined ? s : Reflect.apply(fnToString, this, arguments);
  } }.toString;
  maskFn(fakeToString, 'toString');
  Object.defineProperty(Function.prototype, 'toString', { value: fakeToString, writable: true, configurable: true });

  const wrapMethod = (proto, name, impl) => {
    if (!proto) return null;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== 'function') return null;
    const orig = d.value;
    const fake = { [name](...args) { return impl(orig, this, args); } }[name];
    Object.defineProperty(fake, 'length', { value: orig.length, configurable: true });
    maskFn(fake, name);
    Object.defineProperty(proto, name, { value: fake, writable: d.writable, enumerable: d.enumerable, configurable: d.configurable });
    return { orig, fake };
  };

  const wrapGetter = (proto, name, impl) => {
    if (!proto) return;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.get !== 'function') return; // например deviceMemory вне secure context — не добавляем
    const orig = d.get;
    const fake = Object.getOwnPropertyDescriptor({ get [name]() { return impl(orig, this); } }, name).get;
    maskFn(fake, 'get ' + name);
    Object.defineProperty(proto, name, { get: fake, set: d.set, enumerable: d.enumerable, configurable: d.configurable });
  };

  // константа с сохранением поведения «Illegal invocation» на чужом this
  const constGetter = (proto, name, value) => wrapGetter(proto, name, (orig, self) => { Reflect.apply(orig, self, []); return value; });

  // ── navigator ─────────────────────────────────────────────────────────────
  const NP = GLOBAL.Navigator && GLOBAL.Navigator.prototype;
  const LANGS = Object.freeze(['en-US', 'en']);
  constGetter(NP, 'hardwareConcurrency', 4);
  constGetter(NP, 'deviceMemory', 8);
  // platform выводим из UA, а не хардкодом: иначе на Mac/Linux UA и platform расходятся и сами становятся отпечатком
  const UA = String(GLOBAL.navigator.userAgent);
  constGetter(NP, 'platform', /Mac/.test(UA) ? 'MacIntel' : /Linux/.test(UA) ? 'Linux x86_64' : 'Win32');
  constGetter(NP, 'language', 'en-US');
  constGetter(NP, 'languages', LANGS);

  // navigator.userAgentData: платформа и бренды согласованы с UA, high-entropy значения урезаны до базовых
  if (NP && 'userAgentData' in NP) {
    const uaPlat = /Mac/.test(UA) ? 'macOS' : /Linux/.test(UA) ? 'Linux' : 'Windows';
    const chromeMajor = (UA.match(/Chrome\/(\d+)/) || [])[1] || '0';
    const brands = Object.freeze([
      Object.freeze({ brand: 'Chromium', version: chromeMajor }),
      Object.freeze({ brand: 'Not_A Brand', version: '24' })
    ]);
    const fakeUad = Object.freeze({
      brands, mobile: false, platform: uaPlat,
      getHighEntropyValues: maskFn(async () => ({ brands, mobile: false, platform: uaPlat }), 'getHighEntropyValues'),
      toJSON: maskFn(() => ({ brands, mobile: false, platform: uaPlat }), 'toJSON')
    });
    constGetter(NP, 'userAgentData', fakeUad);
  }

  // ── Canvas ────────────────────────────────────────────────────────────────
  // Шум зависит только от seed и координаты пикселя → один и тот же рисунок даёт один и тот же результат
  // и в getImageData, и в toDataURL/toBlob. Полностью прозрачные пиксели не трогаем.
  const noisePixels = (data, x0, y0, w) => {
    if (!w) return;
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      if (data[i + 3] === 0) continue;
      const px = x0 + (p % w);
      const py = y0 + ((p / w) | 0);
      const h = mix(s0, ((py & 0xffff) << 16) ^ (px & 0xffff));
      if ((h & 15) !== 0) continue; // ~1/16 пикселей
      const c = i + ((h >>> 4) % 3);
      const v = data[c] + ((h & 0x10000) ? 1 : -1);
      data[c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  };

  const CtxProto = GLOBAL.CanvasRenderingContext2D && GLOBAL.CanvasRenderingContext2D.prototype;
  const origGetImageData = CtxProto && CtxProto.getImageData;
  const origDrawImage = CtxProto && CtxProto.drawImage;
  const origPutImageData = CtxProto && CtxProto.putImageData;
  const origCreateElement = Document.prototype.createElement;
  const origGetContext = GLOBAL.HTMLCanvasElement && GLOBAL.HTMLCanvasElement.prototype.getContext;

  const noisyCopy = (src) => {
    try {
      const w = src.width;
      const h = src.height;
      if (!(w > 0 && h > 0) || w * h > 16777216) return null;
      const c = Reflect.apply(origCreateElement, document, ['canvas']);
      c.width = w;
      c.height = h;
      const ctx = Reflect.apply(origGetContext, c, ['2d']);
      if (!ctx) return null;
      Reflect.apply(origDrawImage, ctx, [src, 0, 0]);
      const id = Reflect.apply(origGetImageData, ctx, [0, 0, w, h]);
      noisePixels(id.data, 0, 0, w);
      Reflect.apply(origPutImageData, ctx, [id, 0, 0]);
      return c;
    } catch (e) {
      return null; // tainted canvas и т.п. — отдаём оригинал без шума
    }
  };

  if (origGetImageData && origDrawImage && origPutImageData && origGetContext) {
    wrapMethod(GLOBAL.HTMLCanvasElement && GLOBAL.HTMLCanvasElement.prototype, 'toDataURL', (orig, self, args) => {
      const c = noisyCopy(self);
      return Reflect.apply(orig, c || self, args);
    });
    wrapMethod(GLOBAL.HTMLCanvasElement && GLOBAL.HTMLCanvasElement.prototype, 'toBlob', (orig, self, args) => {
      const c = noisyCopy(self);
      return Reflect.apply(orig, c || self, args);
    });
  }
  const noisyGetImageData = (orig, self, args) => {
    const id = Reflect.apply(orig, self, args);
    try { noisePixels(id.data, +args[0] || 0, +args[1] || 0, id.width); } catch (e) { /* ignore */ }
    return id;
  };
  wrapMethod(CtxProto, 'getImageData', noisyGetImageData);
  wrapMethod(GLOBAL.OffscreenCanvasRenderingContext2D && GLOBAL.OffscreenCanvasRenderingContext2D.prototype, 'getImageData', noisyGetImageData);

  // ── Audio ─────────────────────────────────────────────────────────────────
  // Шум ~1e-7 на ~1/32 ненулевых сэмплов; каждый канал буфера зашумляется один раз.
  const noisedCh = new WeakMap();
  const abProto = GLOBAL.AudioBuffer && GLOBAL.AudioBuffer.prototype;
  const gcd = wrapMethod(abProto, 'getChannelData', (orig, self, args) => {
    const data = Reflect.apply(orig, self, args);
    const ch = args[0] | 0;
    let set = noisedCh.get(self);
    if (!set) { set = new Set(); noisedCh.set(self, set); }
    if (!set.has(ch)) {
      set.add(ch);
      for (let i = 0; i < data.length; i++) {
        if (data[i] === 0) continue;
        const h = mix(s0 ^ 0xa11d10 ^ (ch << 8), i);
        if ((h & 31) === 0) data[i] += (((h >>> 5) & 1) ? 1 : -1) * 1e-7 * (1 + ((h >>> 6) & 3));
      }
    }
    return data;
  });
  if (gcd) {
    wrapMethod(abProto, 'copyFromChannel', (orig, self, args) => {
      try { Reflect.apply(gcd.fake, self, [args[1] | 0]); } catch (e) { /* пусть оригинал бросит свою ошибку */ }
      return Reflect.apply(orig, self, args);
    });
  }

  // ── WebGL: UNMASKED_VENDOR_WEBGL / UNMASKED_RENDERER_WEBGL ────────────────
  const GL_VENDOR = 'Google Inc. (Intel)';
  const GL_RENDERER = 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
  const glImpl = (orig, self, args) => {
    const r = Reflect.apply(orig, self, args);
    if (typeof r !== 'string') return r; // расширение не включено → оригинальное поведение (null + ошибка GL)
    if (args[0] === 0x9245) return GL_VENDOR;
    if (args[0] === 0x9246) return GL_RENDERER;
    return r;
  };
  wrapMethod(GLOBAL.WebGLRenderingContext && GLOBAL.WebGLRenderingContext.prototype, 'getParameter', glImpl);
  wrapMethod(GLOBAL.WebGL2RenderingContext && GLOBAL.WebGL2RenderingContext.prototype, 'getParameter', glImpl);

  // ── Часовой пояс ──────────────────────────────────────────────────────────
  let sysTz = null;
  try { sysTz = new Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* ignore */ }
  wrapMethod(Intl.DateTimeFormat.prototype, 'resolvedOptions', (orig, self, args) => {
    const r = Reflect.apply(orig, self, args);
    // явно заданный страницей пояс (new Intl.DateTimeFormat('en', {timeZone: 'Asia/Tokyo'})) не трогаем
    if (r && typeof r === 'object' && r.timeZone === sysTz) r.timeZone = 'UTC';
    return r;
  });
  wrapMethod(Date.prototype, 'getTimezoneOffset', (orig, self, args) => {
    const r = Reflect.apply(orig, self, args);
    return r !== r ? r : 0; // Invalid Date → NaN, как в оригинале
  });
  // Строковые представления Date в формате родного toString, но в UTC (иначе в тексте виден реальный пояс).
  // Основной механизм — CDP Emulation.setTimezoneOverride в main; это запасной вариант, когда DevTools занял отладчик
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const TZ = 'GMT+0000 (Coordinated Universal Time)';
  const getTime = Date.prototype.getTime;
  const timePart = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} ${TZ}`;
  const datePart = (d) => `${DAYS[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${pad(d.getUTCDate())} ${pad(d.getUTCFullYear(), 4)}`;
  const validDate = (self) => !Number.isNaN(Reflect.apply(getTime, self, [])); // бросит TypeError на чужом this, как оригинал
  wrapMethod(Date.prototype, 'toString', (o, s) => validDate(s) ? `${datePart(s)} ${timePart(s)}` : 'Invalid Date');
  wrapMethod(Date.prototype, 'toTimeString', (o, s) => validDate(s) ? timePart(s) : 'Invalid Date');
  wrapMethod(Date.prototype, 'toDateString', (o, s) => validDate(s) ? datePart(s) : 'Invalid Date');

  // ── screen: размеры = размеру окна (main дополнительно «ступенькой» режет WebContentsView до 100×100) ──
  const SP = GLOBAL.Screen && GLOBAL.Screen.prototype;
  const viewW = () => Math.max(1, Math.round(GLOBAL.innerWidth) || 1);
  const viewH = () => Math.max(1, Math.round(GLOBAL.innerHeight) || 1);
  wrapGetter(SP, 'width', (o, s) => { Reflect.apply(o, s, []); return viewW(); });
  wrapGetter(SP, 'availWidth', (o, s) => { Reflect.apply(o, s, []); return viewW(); });
  wrapGetter(SP, 'height', (o, s) => { Reflect.apply(o, s, []); return viewH(); });
  wrapGetter(SP, 'availHeight', (o, s) => { Reflect.apply(o, s, []); return viewH(); });
  constGetter(SP, 'colorDepth', 24);
  constGetter(SP, 'pixelDepth', 24);
}

// Маскировка под Firefox + отключение автозапроса Passkey. Только домены входа Google (список дублирует security.js)
function ptFirefoxMainWorld(ua) {
  'use strict';
  // Подмены выглядят как нативный код: Function.prototype.toString возвращает «[native code]» для всех наших функций.
  // Функция исполняется в главном мире страницы сама по себе, поэтому хелперы объявлены внутри (внешних ссылок нет)
  const nativeSrc = new WeakMap();
  const fnToString = Function.prototype.toString;
  const mask = (fn, label) => { nativeSrc.set(fn, 'function ' + label + '() { [native code] }'); return fn; };
  const fakeToString = { toString() {
    const s = nativeSrc.get(this);
    return s !== undefined ? s : Reflect.apply(fnToString, this, arguments);
  } }.toString;
  mask(fakeToString, 'toString');
  Object.defineProperty(Function.prototype, 'toString', { value: fakeToString, writable: true, configurable: true });

  const NP = Navigator.prototype;
  const defGet = (obj, name, value) => {
    const g = Object.getOwnPropertyDescriptor({ get [name]() { return value; } }, name).get;
    mask(g, 'get ' + name);
    Object.defineProperty(obj, name, { get: g, set: undefined, enumerable: true, configurable: true });
  };
  if (ua) {
    try { delete NP.userAgentData; } catch (e) { /* ignore */ }
    if ('userAgentData' in navigator) defGet(NP, 'userAgentData', undefined);
    defGet(NP, 'userAgent', ua);
    defGet(NP, 'appVersion', '5.0 (Windows)');
    defGet(NP, 'vendor', '');
    defGet(NP, 'vendorSub', '');
    defGet(NP, 'productSub', '20100101');
    defGet(NP, 'oscpu', 'Windows NT 10.0; Win64; x64');
    defGet(NP, 'buildID', '20181001000000');
    try { delete window.chrome; } catch (e) { /* ignore */ }
    if ('chrome' in window) Object.defineProperty(window, 'chrome', { value: undefined, configurable: true });
  }

  // Chrome-режим: у Electron в navigator.userAgentData.brands нет «Google Chrome» (у настоящего Chrome он есть)
  if (!ua && window.NavigatorUAData) {
    try {
      const UP = NavigatorUAData.prototype;
      const withChrome = (list) => {
        if (!list || typeof list.length !== 'number') return list;
        const arr = Array.from(list, (b) => ({ brand: b.brand, version: b.version }));
        if (arr.some((b) => b.brand === 'Google Chrome')) return list;
        const i = arr.findIndex((b) => b.brand === 'Chromium');
        if (i < 0) return list;
        arr.splice(i + 1, 0, { brand: 'Google Chrome', version: arr[i].version });
        return Object.freeze(arr.map((b) => Object.freeze(b)));
      };
      const bd = Object.getOwnPropertyDescriptor(UP, 'brands');
      if (bd && bd.get) {
        const origBrands = bd.get;
        const g = Object.getOwnPropertyDescriptor({ get brands() { return withChrome(Reflect.apply(origBrands, this, [])); } }, 'brands').get;
        mask(g, 'get brands');
        Object.defineProperty(UP, 'brands', { get: g, set: undefined, enumerable: true, configurable: true });
      }
      const origHev = UP.getHighEntropyValues;
      if (typeof origHev === 'function') {
        const hev = { getHighEntropyValues() {
          return Reflect.apply(origHev, this, arguments).then((r) => {
            try {
              if (r && r.brands) r.brands = withChrome(r.brands);
              if (r && r.fullVersionList) r.fullVersionList = withChrome(r.fullVersionList);
            } catch (e) { /* ignore */ }
            return r;
          });
        } }.getHighEntropyValues;
        mask(hev, 'getHighEntropyValues');
        Object.defineProperty(UP, 'getHighEntropyValues', { value: hev, writable: true, configurable: true, enumerable: true });
      }
      const origJson = UP.toJSON;
      if (typeof origJson === 'function') {
        const tj = { toJSON() {
          const r = Reflect.apply(origJson, this, arguments);
          try { if (r && r.brands) r.brands = withChrome(r.brands); } catch (e) { /* ignore */ }
          return r;
        } }.toJSON;
        mask(tj, 'toJSON');
        Object.defineProperty(UP, 'toJSON', { value: tj, writable: true, configurable: true, enumerable: true });
      }
    } catch (e) { /* ignore */ }
  }

  // Passkey/WebAuthn: без автозапроса Windows не показывает окно «Electron (GitHub, Inc.)»
  const deny = () => Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
  if (window.CredentialsContainer) {
    const origGet = CredentialsContainer.prototype.get;
    const get = { get(opts) { return opts && opts.publicKey ? deny() : Reflect.apply(origGet, this, arguments); } }.get;
    mask(get, 'get');
    Object.defineProperty(CredentialsContainer.prototype, 'get', { value: get, writable: true, configurable: true });
  }
  if (window.PublicKeyCredential) {
    for (const n of ['isUserVerifyingPlatformAuthenticatorAvailable', 'isConditionalMediationAvailable']) {
      if (typeof PublicKeyCredential[n] === 'function') {
        const stub = { [n]() { return Promise.resolve(false); } }[n];
        mask(stub, n);
        Object.defineProperty(PublicKeyCredential, n, { value: stub, writable: true, configurable: true });
      }
    }
  }
}

(function initGoogleAuthFirefoxMask() {
  const h = window.location.hostname.toLowerCase();
  if (window.location.protocol !== 'https:') return;
  // Список доменов и флаг должны совпадать с main/security.js (preload в песочнице не может его подключить)
  const GOOGLE_AUTH_HOST_RE = /^accounts\.google\.(?:com|[a-z]{2}|(?:co|com)\.[a-z]{2})$/;
  if (!(h === 'accounts.youtube.com' || h === 'myaccount.google.com' || GOOGLE_AUTH_HOST_RE.test(h))) return;
  // Пустая строка = не менять UA и navigator.*: тогда JS совпадает с HTTP-заголовками. Passkey отключается в любом случае
  const GOOGLE_FIREFOX_UA = false;
  const UA = GOOGLE_FIREFOX_UA ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0' : '';
  try {
    if (typeof contextBridge.executeInMainWorld === 'function') {
      contextBridge.executeInMainWorld({ func: ptFirefoxMainWorld, args: [UA] });
    } else {
      webFrame.executeJavaScript('(' + ptFirefoxMainWorld.toString() + ')(' + JSON.stringify(UA) + ');', false).catch(() => {});
    }
  } catch { /* сбой маски не должен ломать страницу */ }
})();

(function initFingerprintProtection() {
  if (window.location.protocol === 'browser:') return; // внутренние страницы не маскируем
  let seed = '';
  try {
    for (const a of process.argv) {
      if (typeof a === 'string' && a.startsWith('--pt-fp-seed=')) { seed = a.slice('--pt-fp-seed='.length); break; }
    }
  } catch { /* process.argv недоступен — защита выключена */ }
  seed = String(seed).replace(/[^0-9a-zA-Z_-]/g, '').slice(0, 64);
  if (!seed) return; // флаг выключен / не Инкогнито → ничего не внедряем

  try {
    if (typeof contextBridge.executeInMainWorld === 'function') {
      contextBridge.executeInMainWorld({ func: ptFingerprintMain, args: [seed] });
    } else {
      webFrame.executeJavaScript('(' + ptFingerprintMain.toString() + ')(' + JSON.stringify(seed) + ');', false).catch(() => {});
    }
  } catch { /* сбой защиты не должен ломать страницу */ }
})();

// ─────────────────────────────────────────────────────────────────────────────
// Менеджер паролей: автоподстановка и «Сохранить пароль?».
// Только верхний фрейм, https: или http://localhost | 127.0.0.1. Инкогнито отсекает main (pw:accounts вернёт []),
// origin main берёт сам из event.senderFrame.url. Список живёт в closed Shadow DOM,
// подстановка — только после доверенного (isTrusted) клика по пункту.
// ─────────────────────────────────────────────────────────────────────────────
(function initPasswordAutofill() {
  if (window !== window.top) return;
  const hostName = window.location.hostname.toLowerCase();
  const okOrigin = window.location.protocol === 'https:' ||
    (window.location.protocol === 'http:' && (hostName === 'localhost' || hostName === '127.0.0.1'));
  if (!okOrigin) return;

  const MAX_USER = 256;
  const MAX_PASS = 1024;
  const TEXT_TYPES = new Set(['text', 'email', 'tel']);
  const SUBMIT_RE = /log\s?-?in|sign\s?-?in|submit|continue|вход|войти|далее|продолжить|register|sign\s?-?up|регистр/i;
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const CSS = `
    .box{position:fixed;box-sizing:border-box;max-width:320px;max-height:220px;overflow:auto;padding:4px;border-radius:10px;
      border:1px solid rgba(128,128,128,.35);background:rgba(28,30,38,.97);color:#e8eaf0;
      font:13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.4)}
    @media (prefers-color-scheme:light){.box{background:rgba(255,255,255,.98);color:#1c1e26}}
    .hd{padding:4px 8px 2px;font-size:11px;opacity:.65}
    .it{display:block;width:100%;box-sizing:border-box;text-align:left;padding:7px 8px;border:0;border-radius:6px;
      background:transparent;color:inherit;font:inherit;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .it:hover{background:rgba(120,140,255,.22)}`;

  const isInput = (el) => el instanceof HTMLInputElement;
  const isPwd = (el) => isInput(el) && (el.type === 'password' || /^(current|new)-password$/.test(el.autocomplete));
  const isLoginText = (el) => isInput(el) && TEXT_TYPES.has(el.type);
  const isUsable = (el) => {
    try {
      return el.isConnected && !el.disabled && !el.readOnly && el.getClientRects().length > 0 &&
        getComputedStyle(el).visibility !== 'hidden';
    } catch { return false; }
  };

  // Ближайшее предшествующее текстовое поле логина в той же форме/контейнере
  function findUsername(pw) {
    let root = pw.form || pw.parentElement;
    for (let i = 0; root && i < 6; i++, root = root.parentElement) {
      const c = Array.from(root.querySelectorAll('input')).filter((el) =>
        isLoginText(el) && isUsable(el) && (el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (c.length) return c.find((el) => /username|email/.test(el.autocomplete)) || c[c.length - 1];
      if (pw.form) break;
    }
    return null;
  }

  // Поле пароля, следующее за полем логина
  function findPassword(user) {
    let root = user.form || user.parentElement;
    for (let i = 0; root && i < 6; i++, root = root.parentElement) {
      const pw = Array.from(root.querySelectorAll('input')).find((el) =>
        isPwd(el) && isUsable(el) && (user.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING));
      if (pw) return pw;
      if (user.form) break;
    }
    return null;
  }

  function resolveFields(el) {
    if (isPwd(el)) return el.autocomplete === 'new-password' ? null : { user: findUsername(el), pw: el };
    if (isLoginText(el)) {
      const pw = findPassword(el);
      return pw && pw.autocomplete !== 'new-password' ? { user: el, pw } : null;
    }
    return null;
  }

  function setValue(el, v) {
    valueSetter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Список сохранённых логинов ─────────────────────────────────────────────
  let hostEl = null;
  let box = null;
  let active = null; // { input, fields }
  let shown = false;
  let shownAt = 0; // защита от кликджекинга: клик сразу после показа игнорируется
  let seq = 0;

  function ensureUi() {
    if (hostEl) return;
    hostEl = document.createElement('div');
    // CSSOM и constructable stylesheet вместо атрибута style и <style>: их не блокирует строгий CSP сайта
    for (const [prop, value] of [['all', 'initial'], ['position', 'fixed'], ['top', '0'], ['left', '0'],
      ['width', '0'], ['height', '0'], ['z-index', '2147483647']]) {
      hostEl.style.setProperty(prop, value, 'important');
    }
    const root = hostEl.attachShadow({ mode: 'closed' });
    box = document.createElement('div');
    box.className = 'box';
    box.setAttribute('role', 'listbox');
    root.append(box);
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
    } catch {
      const st = document.createElement('style'); // запасной путь
      st.textContent = CSS;
      root.prepend(st);
    }
    box.addEventListener('mousedown', (e) => e.preventDefault()); // фокус остаётся в поле
    box.addEventListener('click', onPick);
  }

  function place() {
    if (!shown || !active || !isUsable(active.input)) { hide(); return; }
    const r = active.input.getBoundingClientRect();
    box.style.minWidth = `${Math.round(Math.max(r.width, 200))}px`;
    const h = box.offsetHeight;
    const left = Math.max(4, Math.min(r.left, window.innerWidth - box.offsetWidth - 4));
    let top = r.bottom + 2;
    if (top + h > window.innerHeight - 4 && r.top - h - 2 > 4) top = r.top - h - 2;
    box.style.left = `${Math.round(left)}px`;
    box.style.top = `${Math.round(top)}px`;
  }

  function hide() {
    seq++;
    if (!shown) return;
    shown = false;
    active = null;
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    if (hostEl && hostEl.isConnected) hostEl.remove();
  }

  async function show(input, fields) {
    const my = ++seq;
    let list;
    try { list = await ipcRenderer.invoke('pw:accounts'); } catch { return; }
    if (my !== seq || document.activeElement !== input) return;
    const items = Array.isArray(list)
      ? list.filter((a) => a && typeof a.id === 'string' && typeof a.username === 'string')
      : [];
    if (!items.length) { hide(); return; }
    ensureUi();
    box.replaceChildren();
    const hd = document.createElement('div');
    hd.className = 'hd';
    hd.textContent = 'Сохранённые пароли';
    box.append(hd);
    for (const a of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'it';
      b.dataset.id = a.id;
      b.setAttribute('role', 'option');
      b.textContent = a.username || 'Без логина';
      box.append(b);
    }
    active = { input, fields };
    if (!hostEl.isConnected) (document.documentElement || document).appendChild(hostEl);
    if (!shown) {
      shown = true;
      window.addEventListener('scroll', place, true);
      window.addEventListener('resize', place);
    }
    place();
    shownAt = performance.now();
  }

  async function fill(id, f) {
    let res = null;
    try { res = await ipcRenderer.invoke('pw:fill', String(id)); } catch { return; }
    if (!res || !res.ok || typeof res.password !== 'string') return;
    if (f.user && isUsable(f.user) && typeof res.username === 'string') setValue(f.user, res.username);
    if (isUsable(f.pw)) setValue(f.pw, res.password);
  }

  function onPick(e) {
    const b = e.target instanceof Element ? e.target.closest('.it') : null;
    if (!b || !e.isTrusted || !active) return; // синтетические клики страницы игнорируем
    if (performance.now() - shownAt < 400) return; // кликджекинг: первые 400 мс после показа не принимаем
    const id = b.dataset.id;
    const f = active.fields;
    hide();
    fill(id, f);
  }

  document.addEventListener('focusin', (e) => {
    const t = e.target;
    const f = isInput(t) ? resolveFields(t) : null;
    if (!f || !isUsable(t)) { hide(); return; }
    show(t, f);
  }, true);
  document.addEventListener('focusout', () => hide(), true);

  // ── Отправка формы → «Сохранить пароль?» ───────────────────────────────────
  let lastKey = '';
  let lastAt = 0;

  function collect(scope) {
    if (!scope || typeof scope.querySelectorAll !== 'function') return;
    const pws = Array.from(scope.querySelectorAll('input')).filter((el) => isPwd(el) && el.value);
    if (!pws.length) return;
    const pw = pws.length >= 3 ? pws[1] : pws[0]; // «старый / новый / повтор» → берём новый
    const password = pw.value;
    const u = findUsername(pw);
    const username = u ? u.value.trim() : '';
    if (!password || password.length > MAX_PASS || username.length > MAX_USER) return;
    const key = `${username}\n${password}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < 2000) return; // submit + click дают дубль
    lastKey = key;
    lastAt = now;
    try { ipcRenderer.send('pw:submit', { username, password }); } catch { /* ignore */ }
  }

  function passwordScope(el) {
    let root = el.parentElement;
    for (let i = 0; root && i < 6; i++, root = root.parentElement) {
      if (Array.from(root.querySelectorAll('input')).some(isPwd)) return root;
    }
    return null;
  }

  document.addEventListener('submit', (e) => {
    if (e.isTrusted && e.target instanceof HTMLFormElement) collect(e.target);
  }, true);

  document.addEventListener('click', (e) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const b = e.target.closest('button, input[type="submit"], input[type="button"], [role="button"]');
    if (!b) return;
    if (b.form) { if (b.type === 'submit') collect(b.form); return; }
    const label = String(b.value || b.textContent || b.getAttribute('aria-label') || '').slice(0, 60);
    if (b.getAttribute('type') === 'submit' || SUBMIT_RE.test(label)) collect(passwordScope(b));
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && shown) { hide(); return; }
    if (e.key === 'Enter' && e.isTrusted && isPwd(e.target) && !e.target.form) collect(passwordScope(e.target));
  }, true);
})();
