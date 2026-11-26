(() => {
  'use strict';

  const api = window.bookmarksApi;
  const $ = (id) => document.getElementById(id);
  const treeEl = $('tree');
  const listEl = $('list');
  const crumbsEl = $('crumbs');
  const emptyEl = $('empty');
  const noteEl = $('note');
  const searchEl = $('search');
  const btnFolder = $('btn-add-folder');
  const btnBookmark = $('btn-add-bookmark');
  const NT_ROOT = 'nt_root';
  const STORE_KEY = 'mybrowser_bm_ui_v1';

  if (!api || typeof api.get !== 'function') {
    $('app').hidden = true;
    $('fatal').hidden = false;
    return;
  }

  /* ---------- Иконки (только статичные строки) ---------- */
  const SVG = {
    folder: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.7 2H16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z"/></svg>',
    all: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/></svg>',
    chev: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 1.5l3.5 3.5L3 8.5"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 3.5l3 3L7 16H4v-3z"/></svg>',
    trash: '<svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M8 6V4h4v2M6 6l.7 10h6.6L14 6"/></svg>'
  };
  const svgEl = (markup) => {
    const span = document.createElement('span');
    span.className = 'ico';
    span.innerHTML = markup; // только константы SVG выше
    return span;
  };

  /* ---------- Состояние ---------- */
  const state = {
    nodes: [],
    byId: new Map(),
    kids: new Map(), // parentId|'' → отсортированные дети
    rev: -1,
    incognito: false,
    currentId: null,
    query: '',
    expanded: new Set()
  };
  let dragId = null;
  let expandTimer = 0;

  function loadUi() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.expanded)) state.expanded = new Set(raw.expanded.filter((v) => typeof v === 'string'));
        if (typeof raw.current === 'string') state.currentId = raw.current;
      }
    } catch { /* хранилище недоступно */ }
  }
  function saveUi() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ expanded: [...state.expanded], current: state.currentId }));
    } catch { /* ignore */ }
  }

  function build(nodes) {
    state.nodes = Array.isArray(nodes) ? nodes : [];
    state.byId = new Map(state.nodes.map((n) => [n.id, n]));
    state.kids = new Map();
    for (const n of state.nodes) {
      const k = n.parentId === null ? '' : n.parentId;
      if (!state.kids.has(k)) state.kids.set(k, []);
      state.kids.get(k).push(n);
    }
    for (const list of state.kids.values()) list.sort((a, b) => a.order - b.order);
    if (state.currentId !== null && !state.byId.has(state.currentId)) state.currentId = null;
  }

  const childrenOf = (id) => state.kids.get(id === null ? '' : id) || [];
  const isFolder = (n) => n && n.type === 'folder';

  function ancestors(id) { // от корня к узлу, включая сам узел
    const out = [];
    let cur = state.byId.get(id);
    while (cur) {
      out.unshift(cur);
      cur = cur.parentId === null ? null : state.byId.get(cur.parentId);
    }
    return out;
  }
  const isInside = (id, ancestorId) => ancestors(id).some((n) => n.id === ancestorId);

  function ntLevel(id) { // -1 вне «Новой вкладки»; корень = 0, папка = 1, группа = 2
    if (id === null) return -1;
    const chain = ancestors(id);
    const i = chain.findIndex((n) => n.id === NT_ROOT);
    return i < 0 ? -1 : chain.length - 1 - i;
  }
  const canAddBookmarkIn = (id) => { const l = ntLevel(id); return l < 0 || l === 2; };
  const canAddFolderIn = (id) => { const l = ntLevel(id); return l < 0 || l === 0 || l === 1; };

  function countDeep(id) {
    let folders = 0;
    let bookmarks = 0;
    const walk = (pid) => {
      for (const c of childrenOf(pid)) {
        if (isFolder(c)) { folders++; walk(c.id); } else bookmarks++;
      }
    };
    walk(id);
    return { folders, bookmarks };
  }

  const hostOf = (url) => String(url || '').replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  const plural = (n, one, few, many) => {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };

  /* ---------- Toast ---------- */
  let toastTimer = 0;
  function toast(text, isError) {
    const el = $('toast');
    el.textContent = text;
    el.classList.toggle('error', Boolean(isError));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), isError ? 4500 : 2200);
  }

  /* ---------- Связь с main ---------- */
  function apply(res) {
    state.rev = typeof res.rev === 'number' ? res.rev : state.rev;
    state.incognito = Boolean(res.incognito);
    build(res.nodes);
    render();
  }

  async function load() {
    try {
      const res = await api.get();
      if (res && res.ok && !(state.rev >= 0 && res.rev === state.rev && Boolean(res.incognito) === state.incognito)) apply(res);
    } catch (err) {
      console.error('bookmarks: не удалось загрузить', err);
    }
  }

  async function run(call, okMessage) {
    if (state.incognito) { toast('Недоступно в режиме Инкогнито.', true); return null; }
    try {
      const res = await call();
      if (res && res.ok) {
        apply(res);
        if (okMessage) toast(okMessage);
        return res;
      }
      toast((res && res.error) || 'Не удалось выполнить действие.', true);
    } catch (err) {
      console.error('bookmarks: ошибка запроса', err);
      toast('Ошибка связи с браузером.', true);
    }
    return null;
  }

  function openUrl(url, inNewTab) {
    if (typeof api.open === 'function') api.open(url, Boolean(inNewTab));
  }

  /* ---------- Отрисовка ---------- */
  function render() {
    renderTree();
    renderCrumbs();
    renderList();
    const dis = state.incognito;
    noteEl.hidden = !dis;
    noteEl.textContent = dis ? 'В режиме Инкогнито обычные закладки не показываются и не меняются. Закройте Инкогнито, чтобы работать с ними.' : '';
    const target = state.currentId;
    btnFolder.disabled = dis || Boolean(state.query) || !canAddFolderIn(target);
    btnBookmark.disabled = dis || Boolean(state.query) || !canAddBookmarkIn(target);
    btnFolder.title = btnFolder.disabled && !dis && !state.query ? 'Здесь можно создавать только группы ссылок или папки верхнего уровня' : '';
    btnBookmark.title = btnBookmark.disabled && !dis && !state.query ? 'В «Новой вкладке» ссылки лежат внутри групп — откройте или создайте группу' : '';
  }

  function treeRow(node, depth) {
    const id = node ? node.id : null;
    const row = document.createElement('div');
    row.className = 'tree-row' + (state.currentId === id && !state.query ? ' active' : '');
    row.setAttribute('role', 'treeitem');
    row.tabIndex = 0;
    row.dataset.id = id === null ? '' : id;
    row.style.paddingLeft = `${8 + depth * 16}px`;
    const subfolders = childrenOf(id).filter(isFolder);
    const chev = document.createElement('button');
    chev.type = 'button';
    chev.className = 'tree-chev' + (subfolders.length && id !== null ? '' : ' empty');
    chev.tabIndex = -1;
    chev.setAttribute('aria-label', 'Развернуть или свернуть');
    chev.setAttribute('aria-expanded', state.expanded.has(id) ? 'true' : 'false');
    chev.appendChild(svgEl(SVG.chev));
    chev.addEventListener('click', (e) => { e.stopPropagation(); toggleExpand(id); });
    const name = document.createElement('span');
    name.className = 'tree-name';
    name.textContent = node ? node.title : 'Все закладки';
    const count = document.createElement('span');
    count.className = 'tree-count';
    const total = id === null ? state.nodes.filter((n) => n.type === 'bookmark').length : childrenOf(id).length;
    count.textContent = String(total);
    row.append(chev, svgEl(node ? SVG.folder : SVG.all), name, count);
    row.addEventListener('click', () => selectFolder(id));
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFolder(id); }
      else if (e.key === 'ArrowRight' && subfolders.length && !state.expanded.has(id)) toggleExpand(id);
      else if (e.key === 'ArrowLeft' && state.expanded.has(id)) toggleExpand(id);
    });
    attachFolderDrop(row, () => id, id !== null && subfolders.length ? () => { if (!state.expanded.has(id)) toggleExpand(id); } : null);
    return row;
  }

  function renderTree() {
    treeEl.textContent = '';
    treeEl.appendChild(treeRow(null, 0));
    const walk = (pid, depth) => {
      for (const f of childrenOf(pid).filter(isFolder)) {
        treeEl.appendChild(treeRow(f, depth));
        if (state.expanded.has(f.id)) walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
  }

  function renderCrumbs() {
    crumbsEl.textContent = '';
    if (state.query) {
      const c = document.createElement('span');
      c.className = 'crumb current';
      c.textContent = 'Результаты поиска';
      crumbsEl.appendChild(c);
      return;
    }
    const chain = [{ id: null, title: 'Все закладки' }, ...ancestors(state.currentId === null ? '' : state.currentId)];
    chain.forEach((n, i) => {
      if (i) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '›';
        crumbsEl.appendChild(sep);
      }
      const b = document.createElement('button');
      b.type = 'button';
      const last = i === chain.length - 1;
      b.className = 'crumb' + (last ? ' current' : '');
      b.textContent = n.title;
      if (!last) b.addEventListener('click', () => selectFolder(n.id));
      attachFolderDrop(b, () => n.id, null);
      crumbsEl.appendChild(b);
    });
  }

  function searchResults() {
    const tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    return state.nodes.filter((n) => {
      const hay = `${n.title} ${n.type === 'bookmark' ? n.url : ''}`.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    }).slice(0, 300);
  }

  function badgeColor(text) {
    let h = 0;
    for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `hsl(${h} 70% 62%)`;
  }

  function rowFor(node, searching) {
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'listitem');
    row.tabIndex = 0;
    row.dataset.id = node.id;
    row.draggable = node.id !== NT_ROOT;

    const ico = document.createElement('div');
    ico.className = 'row-ico ico' + (isFolder(node) ? ' folder' : '');
    if (isFolder(node)) {
      ico.appendChild(svgEl(SVG.folder));
    } else {
      const label = (node.title || hostOf(node.url) || '?').trim().charAt(0).toUpperCase() || '?';
      ico.textContent = label; // иконки сайтов не запрашиваем: только цветная буква
      ico.style.color = badgeColor(hostOf(node.url) || label);
    }

    const main = document.createElement('div');
    main.className = 'row-main';
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = node.title || hostOf(node.url);
    if (node.system) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.textContent = 'системная';
      title.appendChild(b);
    }
    const sub = document.createElement('div');
    sub.className = 'row-sub';
    if (isFolder(node)) {
      const c = childrenOf(node.id).length;
      sub.textContent = `${c} ${plural(c, 'элемент', 'элемента', 'элементов')}`;
    } else {
      sub.textContent = hostOf(node.url);
      sub.title = node.url;
    }
    if (searching && node.parentId !== null) {
      sub.textContent += ` · ${ancestors(node.parentId).map((a) => a.title).join(' / ')}`;
    }
    main.append(title, sub);
    row.append(ico, main);

    if (!node.system) {
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const edit = iconButton(SVG.edit, isFolder(node) ? 'Переименовать' : 'Изменить', () => editNode(node));
      const del = iconButton(SVG.trash, 'Удалить', () => deleteNode(node));
      del.classList.add('danger');
      actions.append(edit, del);
      row.appendChild(actions);
    }

    row.addEventListener('click', (e) => {
      if (e.target.closest('.row-actions')) return;
      if (isFolder(node)) selectFolder(node.id);
      else openUrl(node.url, e.ctrlKey || e.metaKey);
    });
    row.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    row.addEventListener('auxclick', (e) => {
      if (e.button === 1 && !isFolder(node)) { e.preventDefault(); openUrl(node.url, true); }
    });
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return;
      if (e.key === 'Enter') { if (isFolder(node)) selectFolder(node.id); else openUrl(node.url, e.ctrlKey || e.metaKey); }
      else if (e.key === 'F2' && !node.system) { e.preventDefault(); editNode(node); }
      else if (e.key === 'Delete' && !node.system) { e.preventDefault(); deleteNode(node); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (row.nextElementSibling || row).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (row.previousElementSibling || row).focus(); }
    });
    attachRowDnd(row, node, searching);
    return row;
  }

  function iconButton(markup, label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.appendChild(svgEl(markup));
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    b.addEventListener('dblclick', (e) => e.stopPropagation());
    return b;
  }

  function renderList() {
    listEl.textContent = '';
    const searching = Boolean(state.query);
    const items = searching ? searchResults() : childrenOf(state.currentId);
    for (const n of items) listEl.appendChild(rowFor(n, searching));
    emptyEl.hidden = items.length > 0;
    if (!items.length) {
      emptyEl.textContent = state.incognito
        ? 'Недоступно в режиме Инкогнито.'
        : searching ? 'Ничего не найдено.' : 'Папка пуста. Добавьте закладку или перетащите сюда элементы.';
    }
  }

  /* ---------- Навигация по папкам ---------- */
  function toggleExpand(id) {
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    saveUi();
    renderTree();
  }

  function selectFolder(id) {
    state.currentId = id;
    if (state.query) { state.query = ''; searchEl.value = ''; }
    for (const a of ancestors(id === null ? '' : id).slice(0, -1)) state.expanded.add(a.id); // раскрываем путь
    saveUi();
    render();
  }

  /* ---------- Диалог ---------- */
  const modal = $('modal');
  const form = $('modal-form');
  const inTitle = $('in-title');
  const inUrl = $('in-url');
  let modalSubmit = null;
  let modalReturnFocus = null;

  function openDialog({ title, text, okLabel, danger, showTitle, showUrl, titleValue, urlValue, titleLabel, onSubmit }) {
    $('modal-title').textContent = title;
    const t = $('modal-text');
    t.hidden = !text;
    t.textContent = text || '';
    $('fld-title').hidden = !showTitle;
    $('fld-url').hidden = !showUrl;
    $('fld-title').firstElementChild.textContent = titleLabel || 'Название';
    inTitle.value = titleValue || '';
    inUrl.value = urlValue || '';
    $('modal-error').hidden = true;
    const ok = $('modal-ok');
    ok.textContent = okLabel || 'Сохранить';
    ok.classList.toggle('danger', Boolean(danger));
    ok.classList.toggle('primary', !danger);
    modalSubmit = onSubmit;
    modalReturnFocus = document.activeElement;
    modal.hidden = false;
    setTimeout(() => (showTitle ? inTitle : ok).focus(), 0);
    if (showTitle) setTimeout(() => inTitle.select(), 0);
  }

  function closeDialog() {
    modal.hidden = true;
    modalSubmit = null;
    if (modalReturnFocus && typeof modalReturnFocus.focus === 'function' && document.contains(modalReturnFocus)) modalReturnFocus.focus();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!modalSubmit) return;
    const err = await modalSubmit({ title: inTitle.value, url: inUrl.value });
    if (err) {
      const box = $('modal-error');
      box.textContent = err;
      box.hidden = false;
    } else {
      closeDialog();
    }
  });
  $('modal-cancel').addEventListener('click', closeDialog);
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeDialog(); });

  // Ответ main (успех → null, ошибка → текст для диалога)
  async function submitResult(call, okMessage) {
    if (state.incognito) return 'Недоступно в режиме Инкогнито.';
    try {
      const res = await call();
      if (res && res.ok) { apply(res); if (okMessage) toast(okMessage); return null; }
      return (res && res.error) || 'Не удалось выполнить действие.';
    } catch {
      return 'Ошибка связи с браузером.';
    }
  }

  function addFolder() {
    const parentId = state.currentId;
    openDialog({
      title: 'Новая папка', okLabel: 'Создать', showTitle: true, titleLabel: 'Название папки',
      onSubmit: ({ title }) => {
        if (!title.trim()) return 'Введите название папки.';
        return submitResult(() => api.createFolder({ title, parentId }));
      }
    });
  }

  function addBookmark() {
    const parentId = state.currentId;
    openDialog({
      title: 'Новая закладка', okLabel: 'Добавить', showTitle: true, showUrl: true,
      onSubmit: ({ title, url }) => {
        if (!url.trim()) return 'Введите адрес сайта.';
        return submitResult(() => api.createBookmark({ title, url, parentId }));
      }
    });
  }

  function editNode(node) {
    if (node.system) return;
    if (isFolder(node)) {
      openDialog({
        title: 'Переименовать папку', showTitle: true, titleLabel: 'Название папки', titleValue: node.title,
        onSubmit: ({ title }) => {
          if (!title.trim()) return 'Введите название папки.';
          return submitResult(() => api.update({ id: node.id, title }));
        }
      });
    } else {
      openDialog({
        title: 'Изменить закладку', showTitle: true, showUrl: true, titleValue: node.title, urlValue: node.url,
        onSubmit: ({ title, url }) => {
          if (!url.trim()) return 'Введите адрес сайта.';
          return submitResult(() => api.update({ id: node.id, title, url }));
        }
      });
    }
  }

  function deleteNode(node) {
    if (node.system) return;
    if (!isFolder(node)) {
      run(() => api.remove(node.id), 'Закладка удалена');
      return;
    }
    const { folders, bookmarks } = countDeep(node.id);
    const parts = [];
    if (bookmarks) parts.push(`${bookmarks} ${plural(bookmarks, 'закладка', 'закладки', 'закладок')}`);
    if (folders) parts.push(`${folders} ${plural(folders, 'вложенная папка', 'вложенные папки', 'вложенных папок')}`);
    openDialog({
      title: `Удалить папку «${node.title}»?`, danger: true, okLabel: 'Удалить',
      text: parts.length ? `Вместе с папкой будет удалено: ${parts.join(' и ')}. Это действие нельзя отменить.` : 'Папка пуста.',
      onSubmit: () => submitResult(() => api.remove(node.id), 'Папка удалена')
    });
  }

  btnFolder.addEventListener('click', addFolder);
  btnBookmark.addEventListener('click', addBookmark);

  /* ---------- Поиск ---------- */
  let searchTimer = 0;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.query = searchEl.value.trim();
      render();
    }, 120);
  });
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchEl.value = '';
      state.query = '';
      render();
    } else if (e.key === 'ArrowDown') {
      const first = listEl.querySelector('.row');
      if (first) { e.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) { e.preventDefault(); closeDialog(); return; }
    const tag = (e.target && e.target.tagName) || '';
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && tag !== 'INPUT' && tag !== 'TEXTAREA' && modal.hidden) {
      e.preventDefault();
      searchEl.focus();
      searchEl.select();
    }
  });

  /* ---------- Drag-and-drop ---------- */
  const dragging = () => (dragId ? state.byId.get(dragId) : null);

  function canDropInto(folderId) { // клиентская проверка; окончательное решение — за main
    const node = dragging();
    if (!node || state.incognito) return false;
    if (folderId === null) return true;
    const target = state.byId.get(folderId);
    if (!target || !isFolder(target)) return false;
    if (isFolder(node) && (folderId === node.id || isInside(folderId, node.id))) return false;
    return true;
  }

  function clearDropMarks() {
    for (const el of document.querySelectorAll('.drop-into, .drop-before, .drop-after, .drop-end')) {
      el.classList.remove('drop-into', 'drop-before', 'drop-after', 'drop-end');
    }
  }

  async function doMove(id, parentId, index) {
    const node = state.byId.get(id);
    if (!node) return;
    if (node.parentId === parentId && index === undefined && childrenOf(parentId).at(-1)?.id === id) return; // уже последний
    await run(() => api.move({ id, parentId, index }));
  }

  // Папка (в дереве слева или в «хлебных крошках») как цель сброса «внутрь»
  function attachFolderDrop(el, getId, onHoverExpand) {
    el.addEventListener('dragover', (e) => {
      if (!canDropInto(getId())) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!el.classList.contains('drop-into')) { clearDropMarks(); el.classList.add('drop-into'); }
    });
    el.addEventListener('dragenter', () => {
      clearTimeout(expandTimer);
      if (onHoverExpand && canDropInto(getId())) expandTimer = setTimeout(onHoverExpand, 700); // авто-раскрытие папки
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) { el.classList.remove('drop-into'); clearTimeout(expandTimer); }
    });
    el.addEventListener('drop', (e) => {
      if (!canDropInto(getId())) return;
      e.preventDefault();
      e.stopPropagation();
      const id = dragId;
      clearTimeout(expandTimer);
      clearDropMarks();
      doMove(id, getId(), undefined);
    });
  }

  // Строка списка: перетаскиваемый источник и цель «до / после / внутрь папки»
  function dropZone(e, row, node) {
    const rect = row.getBoundingClientRect();
    const y = (e.clientY - rect.top) / Math.max(1, rect.height);
    if (isFolder(node)) return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'into';
    return y < 0.5 ? 'before' : 'after';
  }

  function attachRowDnd(row, node, searching) {
    row.addEventListener('dragstart', (e) => {
      if (state.incognito || node.system) { e.preventDefault(); return; }
      dragId = node.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', node.id);
      setTimeout(() => row.classList.add('dragging'), 0);
    });
    row.addEventListener('dragend', () => {
      dragId = null;
      clearTimeout(expandTimer);
      row.classList.remove('dragging');
      clearDropMarks();
    });
    if (searching) return; // в результатах поиска порядок не меняем — только перенос в папки слева
    row.addEventListener('dragover', (e) => {
      const drag = dragging();
      if (!drag || drag.id === node.id) return;
      let zone = dropZone(e, row, node);
      if (zone === 'into' && !canDropInto(node.id)) zone = 'after';
      if (zone !== 'into' && !canDropInto(state.currentId)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const cls = `drop-${zone}`;
      if (!row.classList.contains(cls)) { clearDropMarks(); row.classList.add(cls); }
    });
    row.addEventListener('dragleave', (e) => {
      if (!row.contains(e.relatedTarget)) row.classList.remove('drop-into', 'drop-before', 'drop-after');
    });
    row.addEventListener('drop', (e) => {
      const drag = dragging();
      if (!drag || drag.id === node.id) return;
      e.preventDefault();
      e.stopPropagation();
      let zone = dropZone(e, row, node);
      if (zone === 'into' && !canDropInto(node.id)) zone = 'after';
      clearDropMarks();
      if (zone === 'into') {
        doMove(drag.id, node.id, undefined);
        return;
      }
      const siblings = childrenOf(state.currentId).filter((c) => c.id !== drag.id); // main считает индекс без самого узла
      const idx = siblings.findIndex((c) => c.id === node.id);
      doMove(drag.id, state.currentId, zone === 'after' ? idx + 1 : idx);
    });
  }

  // Пустое место списка: перенос в конец текущей папки
  listEl.addEventListener('dragover', (e) => {
    if (state.query || !canDropInto(state.currentId)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!listEl.classList.contains('drop-end') && !e.target.closest('.row')) { clearDropMarks(); listEl.classList.add('drop-end'); }
  });
  listEl.addEventListener('dragleave', (e) => { if (!listEl.contains(e.relatedTarget)) listEl.classList.remove('drop-end'); });
  listEl.addEventListener('drop', (e) => {
    if (state.query || !canDropInto(state.currentId)) return;
    e.preventDefault();
    const id = dragId;
    clearDropMarks();
    doMove(id, state.currentId, undefined);
  });
  document.addEventListener('dragover', (e) => { if (dragId) e.preventDefault(); }); // не даём окну «открыть» перетаскиваемое
  document.addEventListener('drop', (e) => { if (dragId) e.preventDefault(); });

  /* ---------- Запуск ---------- */
  if (typeof api.onChanged === 'function') {
    api.onChanged((payload) => {
      // Собственные изменения уже применены по ответу main (та же ревизия) — перечитываем только чужие
      if (payload && typeof payload.rev === 'number' && payload.rev === state.rev) return;
      load();
    });
  }
  window.addEventListener('focus', () => { if (state.rev >= 0) load(); });

  loadUi();
  load();
})();
