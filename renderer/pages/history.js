'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  // ---------- Тема оболочки ----------
  // main вызывает window.__applyChromeTheme({ id, css, mode }) после dom-ready и при каждой смене темы.
  // CSS кастомной темы кладём через constructed stylesheet: CSP страницы запрещает inline <style>, а CSSOM-стили разрешены
  const themeSheet = typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document ? new CSSStyleSheet() : null;
  if (typeof window.__applyChromeTheme !== 'function') {
    window.__applyChromeTheme = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.mode === 'light' || payload.mode === 'dark') root.dataset.theme = payload.mode;
      if (typeof payload.id === 'string') root.dataset.chromeTheme = payload.id;
      if (!themeSheet) return;
      try {
        themeSheet.replaceSync(typeof payload.css === 'string' ? payload.css : '');
        if (!document.adoptedStyleSheets.includes(themeSheet)) {
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeSheet];
        }
      } catch { /* некорректный CSS темы не должен ломать страницу */ }
    };
  }

  const api = window.historyApi;
  if (!api) {
    $('app').hidden = true;
    $('fatal').hidden = false;
    return;
  }

  // ---------- Элементы и состояние ----------
  const PAGE = 200; // сколько записей рисуем за раз
  const el = {
    search: $('search'), list: $('list'), empty: $('empty'), emptyTitle: $('empty-title'), emptyHint: $('empty-hint'),
    more: $('more'), btnMore: $('btn-more'), summary: $('summary'), scroller: $('scroller'),
    btnClear: $('btn-clear'), notice: $('incognito-notice'), toast: $('toast'), tpl: $('tpl-item'),
    dlg: $('clear-dialog'), dlgCancel: $('dlg-cancel'), dlgConfirm: $('dlg-confirm')
  };
  const state = { items: [], query: '', limit: PAGE, incognito: false, filtered: [], lastLoad: 0 };
  const rowEntry = new WeakMap(); // <li> -> запись

  // ---------- Утилиты ----------
  const plural = (n, [one, few, many]) => {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const records = (n) => `${n} ${plural(n, ['запись', 'записи', 'записей'])}`;

  const safeDecode = (s) => { try { return decodeURI(s); } catch { return s; } };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./i, ''); } catch { return ''; } };
  const prettyUrl = (u) => {
    const s = safeDecode(u).replace(/^https?:\/\/(www\.)?/i, '');
    return s.replace(/^([^/?#]+)\/$/, '$1');
  };
  const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

  const timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const dateYearFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function groupLabel(day) {
    if (!day) return 'Дата неизвестна';
    const today = dayStart(Date.now());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (day === today) return 'Сегодня';
    if (day === yesterday.getTime()) return 'Вчера';
    const sameYear = new Date(day).getFullYear() === new Date(today).getFullYear();
    return cap((sameYear ? dateFmt : dateYearFmt).format(day));
  }

  function hueOf(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h % 360;
  }

  let toastTimer = 0;
  function toast(text, isError = false) {
    el.toast.textContent = text;
    el.toast.classList.toggle('error', isError);
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }

  // Подсветка найденных фрагментов (только через текстовые узлы — заголовки сайтов недоверенные)
  function setText(node, text, tokens) {
    node.textContent = '';
    if (!tokens.length) { node.textContent = text; return; }
    const low = text.toLowerCase();
    const ranges = [];
    for (const t of tokens) {
      let i = low.indexOf(t);
      while (i !== -1) { ranges.push([i, i + t.length]); i = low.indexOf(t, i + t.length); }
    }
    if (!ranges.length) { node.textContent = text; return; }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged = [ranges[0].slice()];
    for (const r of ranges.slice(1)) {
      const last = merged[merged.length - 1];
      if (r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r.slice());
    }
    let pos = 0;
    for (const [s, e] of merged) {
      if (s > pos) node.append(text.slice(pos, s));
      const m = document.createElement('mark');
      m.textContent = text.slice(s, e);
      node.append(m);
      pos = e;
    }
    if (pos < text.length) node.append(text.slice(pos));
  }

  // ---------- Данные ----------
  function prepare(raw) {
    const out = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      if (!r || typeof r.url !== 'string' || !/^https?:\/\//i.test(r.url)) continue;
      const title = typeof r.title === 'string' ? r.title.trim() : '';
      out.push({
        url: r.url,
        title,
        shownUrl: prettyUrl(r.url),
        host: hostOf(r.url),
        visits: Math.max(1, Math.floor(Number(r.visitCount)) || 1),
        ts: Number(r.lastVisitedAt) > 0 ? Number(r.lastVisitedAt) : 0,
        hay: `${title}\n${safeDecode(r.url)}`.toLowerCase()
      });
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }

  async function load(force = false) {
    const now = Date.now();
    if (!force && now - state.lastLoad < 800) return; // focus + visibilitychange приходят вместе
    state.lastLoad = now;
    try {
      const res = await api.get();
      if (!res || typeof res !== 'object') throw new Error('no data');
      state.incognito = Boolean(res.incognito);
      state.items = prepare(res.items);
    } catch {
      toast('Не удалось загрузить историю', true);
    }
    applyMode();
    render();
  }

  function applyMode() {
    el.notice.hidden = !state.incognito;
    el.search.disabled = state.incognito;
    el.btnClear.disabled = state.incognito;
  }

  // ---------- Отрисовка ----------
  function buildRow(entry, tokens) {
    const li = el.tpl.content.firstElementChild.cloneNode(true);
    const a = li.querySelector('.item-link');
    a.href = entry.url;
    a.title = `${entry.title || entry.shownUrl}\n${safeDecode(entry.url)}`;
    li.querySelector('.item-time').textContent = entry.ts ? timeFmt.format(entry.ts) : '';
    const ico = li.querySelector('.item-ico');
    ico.textContent = (entry.host.charAt(0) || '?');
    ico.style.setProperty('--h', String(hueOf(entry.host)));
    setText(li.querySelector('.item-title'), entry.title || entry.shownUrl, tokens);
    const urlEl = li.querySelector('.item-url');
    if (entry.title) setText(urlEl, entry.shownUrl, tokens);
    else urlEl.hidden = true;
    if (entry.visits > 1) {
      const v = li.querySelector('.item-visits');
      v.textContent = `×${entry.visits}`;
      v.title = `Посещений: ${entry.visits}`;
      v.hidden = false;
    }
    rowEntry.set(li, entry);
    return li;
  }

  let rafId = 0;
  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; render(); });
  }

  function render() {
    const tokens = state.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = tokens.length ? state.items.filter((it) => tokens.every((t) => it.hay.includes(t))) : state.items;
    state.filtered = filtered;

    el.list.textContent = '';

    // Сводка и пустые состояния
    if (state.incognito) {
      el.summary.textContent = '';
    } else if (!state.items.length) {
      el.summary.textContent = '';
    } else if (tokens.length) {
      el.summary.textContent = `Найдено: ${filtered.length} из ${records(state.items.length)}`;
    } else {
      el.summary.textContent = `Всего: ${records(state.items.length)}`;
    }

    const isEmpty = filtered.length === 0;
    el.empty.hidden = !isEmpty;
    if (isEmpty) {
      if (state.incognito) {
        el.emptyTitle.textContent = 'В режиме Инкогнито история не ведётся';
        el.emptyHint.textContent = 'Откройте обычное окно, чтобы увидеть историю посещений.';
      } else if (tokens.length) {
        el.emptyTitle.textContent = 'Ничего не найдено';
        el.emptyHint.textContent = `По запросу «${state.query.trim()}» совпадений нет. Поиск идёт по заголовку и адресу страницы.`;
      } else {
        el.emptyTitle.textContent = 'История пуста';
        el.emptyHint.textContent = 'Страницы, которые вы посетите, появятся здесь.';
      }
    }

    // Счётчики по дням считаем по всему результату, а рисуем только первую порцию
    const counts = new Map();
    for (const it of filtered) {
      const day = it.ts ? dayStart(it.ts) : 0;
      counts.set(day, (counts.get(day) || 0) + 1);
    }

    const frag = document.createDocumentFragment();
    let curDay = null;
    let ul = null;
    for (const it of filtered.slice(0, state.limit)) {
      const day = it.ts ? dayStart(it.ts) : 0;
      if (ul === null || day !== curDay) {
        curDay = day;
        const section = document.createElement('section');
        section.className = 'group';
        const h = document.createElement('h2');
        h.className = 'group-title';
        h.textContent = groupLabel(day);
        const c = document.createElement('span');
        c.className = 'group-count';
        c.textContent = String(counts.get(day));
        h.append(c);
        ul = document.createElement('ul');
        ul.className = 'group-list';
        section.append(h, ul);
        frag.append(section);
      }
      ul.append(buildRow(it, tokens));
    }
    el.list.append(frag);

    el.more.hidden = filtered.length <= state.limit;
    if (!el.more.hidden && moreObserver) { // перезапуск наблюдателя: если кнопка всё ещё в зоне видимости, подгрузим следующую порцию
      moreObserver.unobserve(el.more);
      moreObserver.observe(el.more);
    }
  }

  // ---------- Подгрузка по прокрутке ----------
  function showMore() {
    state.limit += PAGE;
    render();
  }
  el.btnMore.addEventListener('click', showMore);
  const moreObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting) && !el.more.hidden) showMore();
      }, { root: el.scroller, rootMargin: '0px 0px 300px 0px' })
    : null;

  // ---------- Поиск ----------
  el.search.addEventListener('input', () => {
    state.query = el.search.value;
    state.limit = PAGE;
    el.scroller.scrollTop = 0;
    scheduleRender();
  });
  el.search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.search.value) {
      e.preventDefault();
      el.search.value = '';
      state.query = '';
      state.limit = PAGE;
      scheduleRender();
    } else if (e.key === 'Enter' && state.filtered.length) {
      e.preventDefault();
      api.open(state.filtered[0].url, e.ctrlKey || e.metaKey || e.shiftKey);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || el.dlg.open || state.incognito) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    el.search.focus();
    el.search.select();
  });

  // ---------- Открытие и удаление записей ----------
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  async function removeEntry(li, entry) {
    li.classList.add('removing');
    let res = null;
    try { res = await api.remove(entry.url); } catch { /* ниже покажем ошибку */ }
    if (!res || !res.ok) {
      li.classList.remove('removing');
      toast(res && res.blocked ? 'В режиме Инкогнито история недоступна' : 'Не удалось удалить запись', true);
      return;
    }
    state.items = state.items.filter((x) => x !== entry);
    setTimeout(render, reduceMotion ? 0 : 140);
  }

  el.list.addEventListener('click', (e) => {
    const del = e.target.closest('.item-del');
    const li = e.target.closest('.item');
    if (!li) return;
    const entry = rowEntry.get(li);
    if (!entry) return;
    if (del) {
      e.preventDefault();
      removeEntry(li, entry);
      return;
    }
    if (e.target.closest('.item-link')) {
      e.preventDefault();
      api.open(entry.url, e.ctrlKey || e.metaKey || e.shiftKey);
    }
  });
  // Средняя кнопка: фоновая вкладка, без автоскролла
  el.list.addEventListener('mousedown', (e) => {
    if (e.button === 1 && e.target.closest('.item-link')) e.preventDefault();
  });
  el.list.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const link = e.target.closest('.item-link');
    if (!link) return;
    e.preventDefault();
    const entry = rowEntry.get(link.closest('.item'));
    if (entry) api.open(entry.url, true);
  });

  // ---------- Диалог «Очистить историю» ----------
  const sinceFor = (range) => {
    if (range === 'hour') return Date.now() - 60 * 60 * 1000;
    if (range === 'today') return dayStart(Date.now());
    return 0;
  };
  const countFor = (range) => {
    const since = sinceFor(range);
    return range === 'all' ? state.items.length : state.items.filter((it) => it.ts >= since).length;
  };
  const selectedRange = () => {
    const r = el.dlg.querySelector('input[name="range"]:checked');
    return r ? r.value : 'hour';
  };

  function refreshDialog() {
    for (const span of el.dlg.querySelectorAll('[data-count]')) {
      span.textContent = records(countFor(span.dataset.count));
    }
    el.dlgConfirm.disabled = countFor(selectedRange()) === 0;
  }

  el.btnClear.addEventListener('click', () => {
    if (state.incognito) return;
    refreshDialog();
    el.dlg.showModal();
  });
  el.dlg.addEventListener('change', refreshDialog);
  el.dlgCancel.addEventListener('click', () => el.dlg.close());
  // Клик по подложке: у <dialog> нет собственных отступов, поэтому target === dialog только вне содержимого
  el.dlg.addEventListener('click', (e) => { if (e.target === el.dlg) el.dlg.close(); });

  el.dlgConfirm.addEventListener('click', async () => {
    const range = selectedRange();
    el.dlgConfirm.disabled = true;
    let res = null;
    try { res = await api.clear(range); } catch { /* ниже покажем ошибку */ }
    if (!res || !res.ok) {
      el.dlg.close();
      toast(res && res.blocked ? 'В режиме Инкогнито история недоступна' : 'Не удалось очистить историю', true);
      return;
    }
    el.dlg.close();
    state.limit = PAGE;
    await load(true);
    toast(res.removed ? `Удалено: ${records(res.removed)}` : 'Удалять было нечего');
  });

  // ---------- Обновление при возврате на вкладку ----------
  window.addEventListener('focus', () => load());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

  load(true).then(() => { if (!state.incognito) el.search.focus(); });
})();
