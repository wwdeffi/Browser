(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Иконки 16x16, stroke = currentColor; DOM строится через createElementNS (без innerHTML)
  const ICONS = {
    search: 'M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM11 11l3.5 3.5',
    go: 'M3 8h10M9 4l4 4-4 4',
    tab: 'M2.5 3.5h11v9h-11zM2.5 6.5h11',
    bookmark: 'M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2l-3.6 1.9.7-4L2.2 6.3l4-.6z',
    history: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 4.5V8l2.2 1.5'
  };

  const list = document.getElementById('list');
  let items = [];
  let selected = 0;

  function makeIcon(type) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'icon');
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', ICONS[type] || ICONS.search);
    svg.appendChild(p);
    return svg;
  }

  function span(cls, text) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
  }

  function markSelected() {
    list.querySelectorAll('.row').forEach((row, i) => {
      const on = i === selected;
      row.classList.toggle('selected', on);
      row.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function render() {
    const rows = items.map((it, i) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'option');
      row.dataset.index = String(i);
      row.appendChild(makeIcon(it.type));
      row.appendChild(span('title', it.title));
      if (it.sub) row.appendChild(span('sub', it.sub));
      if (it.badge) row.appendChild(span('badge', it.badge));
      return row;
    });
    list.replaceChildren(...rows);
    markSelected();
  }

  window.omnibox.onItems((payload) => {
    if (!payload || !Array.isArray(payload.items)) return;
    items = payload.items.slice(0, 8).map((it) => ({
      type: String(it.type), title: String(it.title), sub: String(it.sub || ''), badge: String(it.badge || '')
    }));
    selected = Number.isInteger(payload.selected) ? payload.selected : 0;
    render();
  });

  window.omnibox.onSelect((i) => {
    if (!Number.isInteger(i) || i < 0 || i >= items.length) return;
    selected = i;
    markSelected();
  });

  window.omnibox.onTheme((t) => {
    if (!t) return;
    const root = document.documentElement;
    root.dataset.theme = t.theme === 'light' ? 'light' : 'dark';
    if (typeof t.chromeTheme === 'string' && /^[a-z0-9-]{1,40}$/.test(t.chromeTheme)) {
      root.dataset.chromeTheme = t.chromeTheme;
    }
  });

  // mousedown, а не click: фокус уходит из адресной строки уже на нажатии
  list.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const row = e.target.closest('.row');
    if (row) window.omnibox.pick(Number(row.dataset.index));
  });

  // mousemove (а не mouseover): попап, появившийся под неподвижной мышью, выделение не перехватывает
  list.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.row');
    if (!row) return;
    const i = Number(row.dataset.index);
    if (i === selected) return;
    selected = i;
    markSelected();
    window.omnibox.hover(i);
  });
})();
