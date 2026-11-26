'use strict';

(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const panel = document.getElementById('panel');
  const listEl = document.getElementById('list');
  const crumb = document.getElementById('crumb');
  const crumbTitle = document.getElementById('crumb-title');
  const crumbBack = document.getElementById('crumb-back');
  const root = document.documentElement;

  // Иконки: набор путей в сетке 16×16 (stroke, без заливки)
  const ICONS = {
    plus: ['M8 3.2v9.6M3.2 8h9.6'],
    window: ['M2.5 3.5h11v9h-11zM2.5 6.2h11'],
    incognito: ['M2 8.2h12M4 8.2l1-4.4h6l1 4.4', 'M3.3 11.4a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0', 'M9.3 11.4a1.7 1.7 0 1 0 3.4 0 1.7 1.7 0 1 0-3.4 0'],
    split: ['M2.5 3.5h11v9h-11zM8 3.5v9'],
    reopen: ['M3.2 7.2V3.8h3.4', 'M3.5 7A5 5 0 1 1 5 11.8'],
    star: ['M8 1.9l1.84 3.88 4.26.55-3.12 2.94.78 4.22L8 11.35l-3.76 2.04.78-4.22L1.9 6.33l4.26-.55L8 1.9z'],
    history: ['M8 4.6V8l2.4 1.5', 'M2.6 8a5.4 5.4 0 1 0 1.6-3.8', 'M2.6 2.8v2.6H5.2'],
    download: ['M8 2.5v7.2M4.9 6.9L8 10l3.1-3.1M3 13h10'],
    zoom: ['M2.5 7.2a4.7 4.7 0 1 0 9.4 0 4.7 4.7 0 1 0-9.4 0', 'M11 11l3 3', 'M5.2 7.2h4'],
    print: ['M4.5 6V2.5h7V6', 'M4.5 11.5h-2v-5h11v5h-2', 'M4.5 9.5h7v4h-7z'],
    find: ['M2.7 7.2a4.5 4.5 0 1 0 9 0 4.5 4.5 0 1 0-9 0', 'M10.6 10.6l3 3'],
    devtools: ['M5.5 4.5L2 8l3.5 3.5', 'M10.5 4.5L14 8l-3.5 3.5', 'M9 3l-2 10'],
    sliders: ['M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6', 'M9 3v3M5 10v3'],
    settings: ['M8 5.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z', 'M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2'],
    exit: ['M6.5 2.5h-3v11h3', 'M9 5.5L11.5 8 9 10.5M11.5 8H6'],
    theme: ['M8 2.5a5.5 5.5 0 1 0 5.5 5.5A4 4 0 0 1 8 2.5z'],
    moon: ['M12.8 9.6A5.4 5.4 0 0 1 6.4 3.2a5.4 5.4 0 1 0 6.4 6.4z'],
    shield: ['M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z'],
    globe: ['M2.5 8a5.5 5.5 0 1 0 11 0 5.5 5.5 0 1 0-11 0', 'M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11'],
    minus: ['M3.5 8h9'],
    chevron: ['M6 3.4L10.6 8 6 12.6'],
    check: ['M3.4 8.4l3 3 6.2-6.6']
  };

  function svg(name, size = 15, sw = 1.5) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('width', String(size));
    s.setAttribute('height', String(size));
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', String(sw));
    s.setAttribute('stroke-linecap', 'round');
    s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    for (const d of ICONS[name] || []) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      s.appendChild(p);
    }
    return s;
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  let model = [];
  let path = [];          // ключи подменю от корня
  let selectedKey = null;
  let maxHeight = 640;

  const isSelectable = (it) => it && it.key && it.type !== 'sep' && it.type !== 'header' && it.enabled !== false;

  function currentLevel() {
    let items = model;
    const titles = [];
    for (const key of path) {
      const sub = items.find((i) => i.key === key && Array.isArray(i.children));
      if (!sub) return null;
      titles.push(sub.label);
      items = sub.children;
    }
    return { items, title: titles[titles.length - 1] || '' };
  }

  function render() {
    let level = currentLevel();
    if (!level) { path = []; level = currentLevel(); }
    const { items, title } = level;

    crumb.hidden = path.length === 0;
    crumbTitle.textContent = title;
    listEl.textContent = '';

    if (!items.some((i) => i.key === selectedKey && isSelectable(i))) selectedKey = null;

    for (const it of items) {
      if (it.type === 'sep') { const s = el('div', 'mm-sep'); s.setAttribute('role', 'separator'); listEl.appendChild(s); continue; }
      if (it.type === 'header') { listEl.appendChild(el('div', 'mm-header', it.label)); continue; }

      const row = el('div', 'mm-row');
      row.dataset.key = it.key;
      row.dataset.type = it.type;
      row.setAttribute('role', it.type === 'check' ? 'menuitemcheckbox' : it.type === 'radio' ? 'menuitemradio' : 'menuitem');
      if (it.type === 'check' || it.type === 'radio') row.setAttribute('aria-checked', String(it.checked));
      if (it.enabled === false) { row.classList.add('disabled'); row.setAttribute('aria-disabled', 'true'); }
      if (it.key === selectedKey) row.classList.add('selected');

      const iconSlot = el('span', 'mm-icon');
      if (it.type === 'check') { if (it.checked) iconSlot.appendChild(svg('check', 14, 1.9)); iconSlot.classList.add('mm-mark'); }
      else if (it.type === 'radio') { if (it.checked) iconSlot.appendChild(el('span', 'mm-dot')); iconSlot.classList.add('mm-mark'); }
      else if (it.icon) iconSlot.appendChild(svg(it.icon));
      row.appendChild(iconSlot);

      const text = el('span', 'mm-text');
      text.appendChild(el('span', 'mm-label', it.label));
      if (it.sub) text.appendChild(el('span', 'mm-sub', it.sub));
      row.appendChild(text);

      if (it.type === 'zoom') {
        const ctl = el('span', 'mm-zoom');
        const mk = (name, suffix, aria) => {
          const b = el('button', 'mm-zbtn');
          b.type = 'button';
          b.tabIndex = -1;
          b.setAttribute('aria-label', aria);
          b.appendChild(svg(name, 13, 1.8));
          b.addEventListener('click', (e) => { e.stopPropagation(); window.mainMenu.activate(`${it.key}:${suffix}`); });
          return b;
        };
        const val = el('button', 'mm-zval', it.value || '100%');
        val.type = 'button';
        val.tabIndex = -1;
        val.title = 'Сбросить масштаб (Ctrl+0)';
        val.addEventListener('click', (e) => { e.stopPropagation(); window.mainMenu.activate(`${it.key}:reset`); });
        ctl.append(mk('minus', 'out', 'Уменьшить'), val, mk('plus', 'in', 'Увеличить'));
        row.appendChild(ctl);
      } else if (Array.isArray(it.children)) {
        const ch = el('span', 'mm-chev');
        ch.appendChild(svg('chevron', 12, 1.7));
        row.appendChild(ch);
      } else if (it.accel) {
        row.appendChild(el('span', 'mm-accel', it.accel));
      }

      row.addEventListener('mousemove', () => { if (it.enabled !== false && selectedKey !== it.key) select(it.key, false); });
      row.addEventListener('click', () => { if (it.enabled !== false && it.type !== 'zoom') activateItem(it); });
      listEl.appendChild(row);
    }
    fit();
  }

  function fit() {
    requestAnimationFrame(() => {
      const crumbH = crumb.hidden ? 0 : crumb.offsetHeight;
      listEl.style.maxHeight = `${Math.max(120, maxHeight - crumbH)}px`;
      window.mainMenu.resize(panel.offsetHeight);
    });
  }

  function select(key, scroll = true) {
    selectedKey = key;
    for (const r of listEl.querySelectorAll('.mm-row')) {
      const on = r.dataset.key === key;
      r.classList.toggle('selected', on);
      if (on && scroll) r.scrollIntoView({ block: 'nearest' });
    }
  }

  function enter(it) { path.push(it.key); selectedKey = null; render(); selectFirst(); }
  function back() {
    if (!path.length) return;
    const from = path.pop();
    selectedKey = from;
    render();
    select(from);
  }

  function selectFirst() {
    const level = currentLevel();
    const first = level && level.items.find(isSelectable);
    if (first) select(first.key);
  }

  function activateItem(it) {
    if (!isSelectable(it)) return;
    if (Array.isArray(it.children)) { enter(it); return; }
    if (it.type === 'zoom') { window.mainMenu.activate(`${it.key}:reset`); return; }
    window.mainMenu.activate(it.key);
  }

  function move(delta) {
    const level = currentLevel();
    if (!level) return;
    const sel = level.items.filter(isSelectable);
    if (!sel.length) return;
    const idx = sel.findIndex((i) => i.key === selectedKey);
    let next;
    if (idx < 0) next = delta > 0 ? 0 : sel.length - 1;
    else next = (idx + delta + sel.length) % sel.length;
    select(sel[next].key);
  }

  function selectedItem() {
    const level = currentLevel();
    return level ? level.items.find((i) => i.key === selectedKey) : null;
  }

  function applyTheme(p) {
    if (!p) return;
    if (p.theme === 'dark' || p.theme === 'light') root.dataset.theme = p.theme;
    if (typeof p.chromeTheme === 'string' && /^[a-z0-9-]{1,40}$/i.test(p.chromeTheme)) root.dataset.chromeTheme = p.chromeTheme;
  }

  window.mainMenu.onOpen((p) => {
    applyTheme(p);
    model = Array.isArray(p.items) ? p.items : [];
    path = [];
    selectedKey = null;
    render();
    panel.focus({ preventScroll: true });
  });

  // Обновление состояния пунктов без сброса пути и выделения
  window.mainMenu.onModel((p) => {
    applyTheme(p);
    model = Array.isArray(p.items) ? p.items : [];
    render();
  });

  window.mainMenu.onReset(() => { model = []; path = []; selectedKey = null; listEl.textContent = ''; });
  window.mainMenu.onMaxHeight((h) => { if (Number.isFinite(h) && h > 120) { maxHeight = h; fit(); } });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // комбинации обрабатывает main (before-input-event)
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break;
      case 'ArrowUp': e.preventDefault(); move(-1); break;
      case 'Home': e.preventDefault(); { const l = currentLevel(); const f = l && l.items.find(isSelectable); if (f) select(f.key); } break;
      case 'End': e.preventDefault(); { const l = currentLevel(); const s = l && l.items.filter(isSelectable); if (s && s.length) select(s[s.length - 1].key); } break;
      case 'Enter':
      case ' ': {
        e.preventDefault();
        const it = selectedItem();
        if (it) activateItem(it);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        const it = selectedItem();
        if (!it) break;
        if (Array.isArray(it.children) && it.enabled !== false) enter(it);
        else if (it.type === 'zoom') window.mainMenu.activate(`${it.key}:in`);
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        const it = selectedItem();
        if (it && it.type === 'zoom') window.mainMenu.activate(`${it.key}:out`);
        else back();
        break;
      }
      case 'Backspace': e.preventDefault(); back(); break;
      case 'Escape': e.preventDefault(); window.mainMenu.close(); break;
      case 'Tab': e.preventDefault(); move(e.shiftKey ? -1 : 1); break;
      default: break;
    }
  });

  crumbBack.addEventListener('click', back);

  // Клик мимо панели (по прозрачному полю вокруг неё) закрывает меню; клик по странице/интерфейсу закрывает его через blur в main
  document.addEventListener('mousedown', (e) => {
    if (!panel.contains(e.target)) window.mainMenu.close();
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => { /* закрытие по потере фокуса выполняет main (с задержкой) */ });
})();
