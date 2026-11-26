'use strict';

(() => {
  const tabsStrip = document.getElementById('tabs-strip');
  const tabsArea = document.getElementById('tabs-area');
  const newTabBtn = document.getElementById('newtab');
  const winMinBtn = document.getElementById('win-min');
  const winMaxBtn = document.getElementById('win-max');
  const winCloseBtn = document.getElementById('win-close');
  const vtToggleBtn = document.getElementById('btn-vtabs');
  const vtCollapseBtn = document.getElementById('vt-collapse');
  const vtCount = document.getElementById('vt-count');

  const backBtn = document.getElementById('btn-back');
  const forwardBtn = document.getElementById('btn-forward');
  const reloadBtn = document.getElementById('btn-reload');
  const reopenBtn = document.getElementById('btn-reopen');
  const incBtn = document.getElementById('btn-incognito');
  const incBadge = document.getElementById('incognito-badge');
  const themeBtn = document.getElementById('btn-theme');
  const menuBtn = document.getElementById('btn-menu');
  const downloadsBtn = document.getElementById('btn-downloads');
  const zoomBadge = document.getElementById('zoom-badge');
  const bookmarkBtn = document.getElementById('btn-bookmark');

  // Поиск по странице (панель #findbar под тулбаром)
  const findbar = document.getElementById('findbar');
  const findInput = document.getElementById('find-input');
  const findCount = document.getElementById('find-count');
  const findPrevBtn = document.getElementById('find-prev');
  const findNextBtn = document.getElementById('find-next');
  const findCaseBtn = document.getElementById('find-case');
  const findCloseBtn = document.getElementById('find-close');

  const siteBadge = document.getElementById('site-badge');
  const sitePopover = document.getElementById('site-popover');
  const spIcon = document.getElementById('sp-icon');
  const spHost = document.getElementById('sp-host');
  const spStatus = document.getElementById('sp-status');
  const spPerms = document.getElementById('sp-perms');
  const spReset = document.getElementById('sp-reset');
  const spRows = Array.from(sitePopover.querySelectorAll('.sp-row'));
  const urlEl = document.getElementById('url');
  const loadingBar = document.getElementById('loading-bar');

  // Набор статичных SVG-иконок интерфейса
  const ICONS = {
    closeTab: `
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <path d="M3 3l6 6M9 3l-6 6"/>
      </svg>`,
    sleep: `
      <svg width="7" height="7" viewBox="0 0 12 12" fill="currentColor">
        <path d="M9.6 7.8A4.6 4.6 0 0 1 4.2 2.4a4.6 4.6 0 1 0 5.4 5.4z"/>
      </svg>`,
    audio: `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6.5h2.4l3.1-2.7v8.4L5.4 9.5H3z"/>
        <path d="M11 5.8a3.2 3.2 0 0 1 0 4.4"/>
        <path d="M12.8 4.1a5.6 5.6 0 0 1 0 7.8"/>
      </svg>`,
    audioMuted: `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6.5h2.4l3.1-2.7v8.4L5.4 9.5H3z"/>
        <path d="M11.2 6.4l3.2 3.2M14.4 6.4l-3.2 3.2"/>
        <path d="M2.4 2.4l11.2 11.2"/>
      </svg>`,
    tabError: `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--danger)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="8" cy="8" r="6"/>
        <path d="M8 5v3.4M8 10.9h.01"/>
      </svg>`,
    reload: `
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13.2 8a5.2 5.2 0 1 1-1.4-3.5"/>
        <path d="M13.2 3.2v2.9h-2.9"/>
      </svg>`,
    stop: `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
        <path d="M4 4l8 8M12 4l-8 8"/>
      </svg>`,
    maximize: `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2">
        <rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1.2"/>
      </svg>`,
    restore: `
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.15">
        <rect x="2" y="3.6" width="6.4" height="6.4" rx="1"/>
        <path d="M3.8 3.6V2.5a.8.8 0 0 1 .8-.8h4.9a.8.8 0 0 1 .8.8v4.9a.8.8 0 0 1-.8.8H8.4"/>
      </svg>`,
    sun: `
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="8" cy="8" r="3"/>
        <path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1"/>
      </svg>`,
    moon: `
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 9.7A5.2 5.2 0 0 1 6.3 3a5.4 5.4 0 1 0 6.7 6.7z"/>
      </svg>`,
    badgeSecure: `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.6"/>
        <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"/>
      </svg>`,
    badgeInsecure: `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 2.4L14 13H2L8 2.4z"/>
        <path d="M8 6.3v3M8 11.2h.01"/>
      </svg>`,
    badgeError: `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
        <circle cx="8" cy="8" r="5.8"/>
        <path d="M8 5v3.2M8 10.8h.01"/>
      </svg>`,
    badgeInternal: `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M8 1.9l5 1.9v3.6c0 3-2.1 5.2-5 6.7-2.9-1.5-5-3.7-5-6.7V3.8l5-1.9z"/>
        <path d="M5.9 8l1.4 1.4L10.2 6.5"/>
      </svg>`,
    badgeSearch: `
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <circle cx="7.2" cy="7.2" r="4.5"/>
        <path d="M10.6 10.6L13.6 13.6"/>
      </svg>`
  };

  let state = {
    activeId: null,
    canGoBack: false,
    canGoForward: false,
    canReopenClosed: false,
    tabs: [],
    isMaximized: false,
    themeSetting: 'dark',
    resolvedTheme: 'dark'
  };

  // Кэш DOM-элементов вкладок (tabId -> объект узлов), чтобы не перерисовывать полосу целиком
  const tabNodes = new Map();

  let lastActiveId = null;
  let lastUrlSync = '';   // `${activeId}|${url}`, последний записанный в адресную строку
  let urlDirty = false;   // пользователь редактирует текст в омнибоксе
  let lastLoading = null;
  let lastMaximized = null;
  let lastTheme = null;
  let lastIncognito = null;
  let lastBadgeType = null;

  // Карточка безопасности сайта
  const SITE_PERMISSIONS = ['microphone', 'camera', 'notifications', 'clipboard'];
  const SITE_STATE_LABELS = { allow: 'Разрешено', block: 'Заблокировано', ask: 'Спрашивать' };
  let sitePopoverOpen = false;
  let sitePopoverToken = 0;
  let sitePopoverTabId = null;
  let sitePopoverUrl = '';
  let sitePopoverOrigin = '';
  let sitePerms = {};
  let lastDownloadsKey = null;
  let lastZoom = null;

  // Вертикальные вкладки: сайдбар слева. Ширина приходит из main (state.verticalTabs), там же считается геометрия страниц
  let vertical = false;
  let vtWidth = 0;
  let lastVtKey = null;

  // Состояние перетаскивания (Drag & Drop)
  let draggedTabId = null;
  let draggedPinned = false;
  let dragSession = null; // снимок раскладки группы вкладок на время перетаскивания
  let dragCommitted = false;

  // Флаг, чтобы первый клик по адресной строке не снимал выделение текста на mouseup
  let selectAllOnMouseUp = false;

  function getActiveTab() {
    return state.tabs.find(t => t.id === state.activeId) || null;
  }

  // ---- Drag & Drop: живое смещение соседних вкладок ----
  // Раскладка снимается один раз в dragstart (до любых transform), а позиция вставки считается
  // по исходным центрам вкладок, а не по event.target — поэтому вкладки не «дрожат» под курсором.

  function stripGap() {
    const g = parseFloat(getComputedStyle(tabsStrip).columnGap);
    return Number.isFinite(g) ? g : 0;
  }

  function buildDragSession(id) {
    const stripRect = tabsStrip.getBoundingClientRect();
    const items = [];
    for (const tab of state.tabs) {
      // Закреплённые двигаются только среди закреплённых, обычные — среди обычных
      if (Boolean(tab.pinned) !== draggedPinned) continue;
      const entry = tabNodes.get(tab.id);
      if (!entry || entry.el.classList.contains('tab-leaving')) continue;
      const r = entry.el.getBoundingClientRect();
      items.push({
        id: tab.id,
        el: entry.el,
        left: r.left - stripRect.left + tabsStrip.scrollLeft,
        top: r.top - stripRect.top + tabsStrip.scrollTop,
        width: r.width,
        height: r.height
      });
    }
    const from = items.findIndex((it) => it.id === id);
    if (from < 0) return null;
    return { items, from, gap: stripGap(), insertIndex: from, applied: null, count: state.tabs.length, vertical };
  }

  function setTabShift(el, px, py = 0) {
    el.style.setProperty('--tx', `${px}px`);
    el.style.setProperty('--ty', `${py}px`);
    el.classList.add('drag-shift');
  }

  function applyDragShift(sess) {
    const { items, from, gap } = sess;
    const p = sess.insertIndex;
    if (sess.applied === p) return;
    sess.applied = p;

    if (sess.vertical) {
      // Сетка закреплённых + список: каждая вкладка едет в «слот» (исходный прямоугольник) по новому порядку
      const order = items.map((_, i) => i).filter((i) => i !== from);
      order.splice(p, 0, from);
      items.forEach((it, i) => {
        const slot = items[order.indexOf(i)];
        setTabShift(it.el, slot.left - it.left, slot.top - it.top);
      });
      return;
    }

    const shift = items[from].width + gap;
    let selfOffset = 0;
    items.forEach((it, i) => {
      let tx = 0;
      if (i !== from) {
        if (p > from && i > from && i <= p) {
          tx = -shift;                       // уступают место слева, занимая слот перетаскиваемой
          selfOffset += it.width + gap;
        } else if (p < from && i >= p && i < from) {
          tx = shift;                        // раздвигаются вправо, освобождая место вставки
          selfOffset -= it.width + gap;
        }
      }
      setTabShift(it.el, tx);
    });
    // Сама перетаскиваемая вкладка-«плейсхолдер» переезжает в точку вставки
    setTabShift(items[from].el, selfOffset);
  }

  function updateDragOver(clientX, clientY) {
    const sess = dragSession;
    if (!sess) return;
    if (sess.vertical) {
      // Позиция вставки — ближайший по центру исходный слот (слоты зафиксированы в dragstart, поэтому без дрожания)
      const sr = tabsStrip.getBoundingClientRect();
      const px = clientX - sr.left + tabsStrip.scrollLeft;
      const py = (Number.isFinite(clientY) ? clientY : sr.top) - sr.top + tabsStrip.scrollTop;
      let best = sess.from;
      let bestDist = Infinity;
      sess.items.forEach((it, i) => {
        const dx = it.left + it.width / 2 - px;
        const dy = it.top + it.height / 2 - py;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) { bestDist = dist; best = i; }
      });
      sess.insertIndex = best;
      applyDragShift(sess);
      return;
    }
    const x = clientX - tabsStrip.getBoundingClientRect().left + tabsStrip.scrollLeft;
    let p = 0;
    sess.items.forEach((it, i) => {
      if (i !== sess.from && x > it.left + it.width / 2) p++;
    });
    sess.insertIndex = p;
    applyDragShift(sess);
  }

  function autoScrollStrip(clientX, clientY) {
    if (vertical) {
      if (tabsStrip.scrollHeight <= tabsStrip.clientHeight || !Number.isFinite(clientY)) return;
      const vr = tabsStrip.getBoundingClientRect();
      const vzone = 36;
      if (clientY < vr.top + vzone) tabsStrip.scrollTop -= 10;
      else if (clientY > vr.bottom - vzone) tabsStrip.scrollTop += 10;
      return;
    }
    if (tabsStrip.scrollWidth <= tabsStrip.clientWidth) return;
    const r = tabsStrip.getBoundingClientRect();
    const zone = 40;
    if (clientX < r.left + zone) tabsStrip.scrollLeft -= 10;
    else if (clientX > r.right - zone) tabsStrip.scrollLeft += 10;
  }

  // instant=true — сброс без transition (когда порядок в DOM уже поменян и визуально ничего не должно «прыгать»)
  function resetDragVisuals(sess, instant) {
    if (!sess) return;
    if (instant) tabsStrip.classList.add('drag-settle');
    for (const it of sess.items) {
      it.el.classList.remove('drag-shift');
      it.el.style.removeProperty('--tx');
      it.el.style.removeProperty('--ty');
    }
    if (instant) {
      void tabsStrip.offsetWidth; // фиксируем стиль без transition
      tabsStrip.classList.remove('drag-settle');
    }
  }

  function reorderStateLocally(fromId, anchorId, after) {
    const list = state.tabs.slice();
    const fi = list.findIndex((t) => t.id === fromId);
    if (fi < 0) return;
    const [moved] = list.splice(fi, 1);
    const ai = list.findIndex((t) => t.id === anchorId);
    if (ai < 0) return;
    list.splice(after ? ai + 1 : ai, 0, moved);
    state = { ...state, tabs: list };
  }

  function commitDrag() {
    const sess = dragSession;
    if (!sess || dragCommitted) return;
    dragCommitted = true;

    const dragged = sess.items[sess.from];
    const others = sess.items.filter((_, i) => i !== sess.from);
    const p = sess.insertIndex;

    if (p === sess.from || others.length === 0) {
      resetDragVisuals(sess, false); // позиция не изменилась — плавно возвращаем всё на место
      return;
    }

    const anchor = p === 0 ? others[0] : others[p - 1];
    const after = p !== 0;

    // Оптимистично меняем порядок в DOM и в state, а transform снимаем в том же кадре без transition:
    // визуально ничего не двигается, и нет вспышки старого порядка, пока main не пришлёт новое состояние
    tabsStrip.insertBefore(dragged.el, after ? anchor.el.nextSibling : anchor.el);
    reorderStateLocally(dragged.id, anchor.id, after);
    resetDragVisuals(sess, true);

    window.browser.reorderTab(dragged.id, anchor.id, after);
  }

  function endDragState() {
    const id = draggedTabId;
    draggedTabId = null;
    dragSession = null;
    const entry = id !== null ? tabNodes.get(id) : null;
    if (entry) entry.el.classList.remove('dragging');
  }

  function pointerInsideTabsArea(e) {
    const r = tabsArea.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  // Вкладку отпустили далеко за пределами панели вкладок: по вертикали (в сайдбаре — в любую сторону) → отрыв в новое окно
  const DETACH_THRESHOLD = 28;
  function isDragOutsideTabbar(e) {
    const r = tabsArea.getBoundingClientRect();
    const x = e.screenX - window.screenX;
    const y = e.screenY - window.screenY;
    const t = DETACH_THRESHOLD;
    if (vertical) return x < r.left - t || x > r.right + t || y < r.top - t || y > r.bottom + t;
    return y < r.top - t || y > r.bottom + t;
  }

  // ---- Плавное удаление вкладки: сжатие ширины + fade, соседи едут следом без скачка ----
  const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  function removeTabAnimated(entry) {
    const el = entry.el;
    if (!el.isConnected || reduceMotionQuery.matches || el.classList.contains('tab-leaving')) {
      el.remove();
      return;
    }
    const leaveRect = el.getBoundingClientRect();
    el.style.setProperty('--leave-w', `${leaveRect.width}px`);
    el.style.setProperty('--leave-h', `${leaveRect.height}px`);
    el.classList.remove('active', 'split-partner', 'dragging', 'drag-shift', 'tab-enter');
    el.classList.add('tab-leaving');
    el.draggable = false;
    el.setAttribute('aria-hidden', 'true');
    el.removeAttribute('title');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.remove();
    };
    el.addEventListener('animationend', (e) => {
      if (e.target === el && ['tabLeave', 'vtTabLeave', 'vtPinLeave'].includes(e.animationName)) finish();
    });
    setTimeout(finish, 450); // страховка, если animationend не придёт (окно скрыто и т.п.)
  }

  function createTabNode(tabId) {
    const el = document.createElement('div');
    el.className = 'tab tab-enter';
    el.setAttribute('role', 'tab');
    el.draggable = true;
    el.dataset.tabId = String(tabId);

    el.addEventListener('animationend', () => {
      el.classList.remove('tab-enter');
    }, { once: true });

    const iconWrap = document.createElement('span');
    iconWrap.className = 'icon-wrap';

    const titleEl = document.createElement('span');
    titleEl.className = 'title';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close';
    closeBtn.type = 'button';
    closeBtn.title = 'Закрыть вкладку';
    closeBtn.setAttribute('aria-label', 'Закрыть вкладку');
    closeBtn.draggable = false;
    closeBtn.innerHTML = ICONS.closeTab;

    closeBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.browser.closeTab(tabId);
    });

    el.append(iconWrap, titleEl, closeBtn);

    // ЛКМ — мгновенное переключение, СКМ — подавляем автопрокрутку Windows
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        if (state.activeId !== tabId) {
          window.browser.switchTab(tabId);
        }
      } else if (e.button === 1) {
        e.preventDefault();
      }
    });

    // Закрытие по средней кнопке мыши
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.browser.closeTab(tabId);
      }
    });

    // Контекстное меню вкладки (закрепить, дублировать, усыпить, закрыть другие)
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.browser.showTabMenu(tabId);
    });

    // Перетаскивание вкладок (Drag & Drop). dragover/drop обрабатываются делегированно на #tabs-area (см. ниже)
    el.addEventListener('dragstart', (e) => {
      const current = state.tabs.find(t => t.id === tabId);
      if (!current) return;

      draggedTabId = tabId;
      draggedPinned = Boolean(current.pinned);
      dragCommitted = false;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(tabId));

      // Снимок раскладки — синхронно, пока ни одна вкладка не сдвинута
      dragSession = buildDragSession(tabId);

      // Отложенное добавление класса, чтобы браузер снял непрозрачный «призрак» вкладки
      requestAnimationFrame(() => {
        if (draggedTabId === tabId) el.classList.add('dragging');
      });
    });

    el.addEventListener('dragend', (e) => {
      if (draggedTabId === null) {
        el.classList.remove('dragging');
        return;
      }
      // Не был принят ни одной целью (drop не сработал) и курсор далеко от полосы вкладок
      if (!dragCommitted && e.dataTransfer && e.dataTransfer.dropEffect === 'none' && isDragOutsideTabbar(e)) {
        resetDragVisuals(dragSession, true);
        el.classList.remove('dragging');
        endDragState();
        if (typeof window.browser.detachTab === 'function') window.browser.detachTab(tabId, e.screenX, e.screenY);
        return;
      }
      const sess = dragSession;
      if (sess && !dragCommitted) {
        // Резервный путь: drop мог не дойти (область перетаскивания окна), но курсор отпущен над полосой вкладок
        if (e.dataTransfer && e.dataTransfer.dropEffect === 'none' && pointerInsideTabsArea(e)) {
          updateDragOver(e.clientX, e.clientY);
          commitDrag();
        } else {
          resetDragVisuals(sess, false);
        }
      }
      el.classList.remove('dragging');
      endDragState();
    });

    return {
      el,
      iconWrap,
      titleEl,
      closeBtn,
      audioBadge: null,
      audioKey: '',
      iconKey: '',
      failedFavicon: null
    };
  }

  function updateTabIcon(entry, tab) {
    // Если favicon уже падал с ошибкой, не пытаемся загружать его повторно
    const usableFavicon = tab.favicon && tab.favicon !== entry.failedFavicon ? tab.favicon : '';
    const nextKey = `${tab.loading ? 'L' : '0'}|${tab.isError ? 'E' : '0'}|${tab.sleeping ? 'S' : '0'}|${usableFavicon}`;
    if (entry.iconKey === nextKey) return;
    entry.iconKey = nextKey;

    entry.iconWrap.replaceChildren();

    if (tab.loading) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      entry.iconWrap.append(spinner);
      return;
    }

    if (tab.isError) {
      entry.iconWrap.innerHTML = ICONS.tabError;
    } else if (usableFavicon) {
      const img = document.createElement('img');
      img.src = usableFavicon;
      img.alt = '';
      img.draggable = false;
      img.addEventListener('error', () => {
        entry.failedFavicon = usableFavicon;
        entry.iconKey = '';
        const dot = document.createElement('span');
        dot.className = 'dot';
        img.replaceWith(dot);
      }, { once: true });
      entry.iconWrap.append(img);
    } else {
      const dot = document.createElement('span');
      dot.className = 'dot';
      entry.iconWrap.append(dot);
    }

    if (tab.sleeping) {
      const sleepBadge = document.createElement('span');
      sleepBadge.className = 'sleep-badge';
      sleepBadge.innerHTML = ICONS.sleep;
      entry.iconWrap.append(sleepBadge);
    }
  }

  function renderTabs() {
    const aliveIds = new Set(state.tabs.map(t => t.id));

    // Удаляем DOM-узлы закрытых вкладок
    for (const [id, entry] of tabNodes.entries()) {
      if (!aliveIds.has(id)) {
        tabNodes.delete(id);
        removeTabAnimated(entry);
      }
    }

    // Создаём новые и синхронизируем существующие вкладки в точном порядке
    // Уходящие (анимируемые) вкладки остаются в DOM до конца анимации — при расстановке их пропускаем
    let cursor = tabsStrip.firstElementChild;
    state.tabs.forEach((tab) => {
      let entry = tabNodes.get(tab.id);
      if (!entry) {
        entry = createTabNode(tab.id);
        tabNodes.set(tab.id, entry);
      }

      const isActive = tab.id === state.activeId;
      entry.el.classList.toggle('active', isActive);
      entry.el.classList.toggle('split-partner', state.splitTabId != null && tab.id === state.splitTabId);
      entry.el.classList.toggle('pinned', Boolean(tab.pinned));
      entry.el.classList.toggle('sleeping', Boolean(tab.sleeping));
      entry.el.setAttribute('aria-selected', String(isActive));

      // Подсказка при наведении
      const tooltip = tab.sleeping
        ? `${tab.title}\nСпящая вкладка (выгружена из ОЗУ) — нажмите, чтобы разбудить`
        : (tab.url ? `${tab.title}\n${tab.url}` : tab.title);
      if (entry.el.title !== tooltip) {
        entry.el.title = tooltip;
      }

      if (entry.titleEl.textContent !== tab.title) {
        entry.titleEl.textContent = tab.title;
      }

      // Индикатор звука: виден, если звук играет или вкладка заглушена; клик включает/выключает звук
      if (tab.audible || tab.muted) {
        if (!entry.audioBadge) {
          const badge = document.createElement('button');
          badge.type = 'button';
          badge.className = 'audio-badge';
          badge.draggable = false;
          const tabId = tab.id;
          badge.addEventListener('mousedown', (e) => e.stopPropagation());
          badge.addEventListener('auxclick', (e) => e.stopPropagation());
          badge.addEventListener('click', (e) => {
            e.stopPropagation();
            window.browser.muteTab(tabId);
          });
          entry.el.insertBefore(badge, entry.closeBtn);
          entry.audioBadge = badge;
        }
        const audioKey = tab.muted ? 'M' : 'A';
        if (entry.audioKey !== audioKey) {
          entry.audioKey = audioKey;
          const label = tab.muted ? 'Включить звук вкладки' : 'Выключить звук вкладки';
          entry.audioBadge.classList.toggle('muted', Boolean(tab.muted));
          entry.audioBadge.innerHTML = tab.muted ? ICONS.audioMuted : ICONS.audio;
          entry.audioBadge.title = label;
          entry.audioBadge.setAttribute('aria-label', label);
        }
      } else if (entry.audioBadge) {
        entry.audioBadge.remove();
        entry.audioBadge = null;
        entry.audioKey = '';
      }

      updateTabIcon(entry, tab);

      // Перемещаем элемент в DOM только если его позиция реально изменилась
      while (cursor && cursor.classList.contains('tab-leaving')) cursor = cursor.nextElementSibling;
      if (cursor === entry.el) {
        cursor = cursor.nextElementSibling;
      } else {
        tabsStrip.insertBefore(entry.el, cursor);
      }
    });

    // Набор вкладок изменился посреди перетаскивания — снимок раскладки устарел, сбрасываем смещения
    if (dragSession && dragSession.count !== state.tabs.length) {
      resetDragVisuals(dragSession, true);
      dragSession = null;
    }

    // Плавно прокручиваем полосу к активной вкладке при переключении
    if (state.activeId !== lastActiveId) {
      const activeEntry = tabNodes.get(state.activeId);
      if (activeEntry) {
        activeEntry.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }
  }

  // Внутренние страницы браузера (about:blank — это пустая вкладка, не внутренняя страница)
  function isInternalUrl(url) {
    return /^(browser|chrome|devtools):/i.test(url) || (/^about:/i.test(url) && !/^about:blank/i.test(url));
  }

  function updateSiteBadge(activeTab) {
    let type = 'default';
    let title = 'Поиск или адрес';

    if (activeTab && !activeTab.isNewTab) {
      if (activeTab.isError) {
        type = 'error';
        title = 'Не удалось загрузить страницу';
      } else if (isInternalUrl(activeTab.url)) {
        type = 'internal';
        title = 'Системная страница браузера';
      } else if (activeTab.url.startsWith('https://')) {
        type = 'secure';
        title = 'Защищённое соединение (HTTPS)';
      } else if (activeTab.url.startsWith('http://')) {
        type = 'insecure';
        title = 'Незащищённое соединение (HTTP)';
      }
    }

    if (lastBadgeType === type) return;
    lastBadgeType = type;

    siteBadge.classList.remove('secure', 'insecure', 'error');
    // Клик открывает панель прав сайта; на новой вкладке и внутренних страницах замочка нет — кнопка неактивна
    siteBadge.disabled = type === 'default';
    siteBadge.title = type === 'default' ? title : `${title}. Нажмите, чтобы открыть сведения о сайте`;

    if (type === 'secure') {
      siteBadge.classList.add('secure');
      siteBadge.innerHTML = ICONS.badgeSecure;
    } else if (type === 'insecure') {
      siteBadge.classList.add('insecure');
      siteBadge.innerHTML = ICONS.badgeInsecure;
    } else if (type === 'error') {
      siteBadge.classList.add('error');
      siteBadge.innerHTML = ICONS.badgeError;
    } else if (type === 'internal') {
      siteBadge.innerHTML = ICONS.badgeInternal;
    } else {
      siteBadge.innerHTML = ICONS.badgeSearch;
    }
  }

  function renderChrome() {
    const active = getActiveTab();
    const isLoading = Boolean(active && active.loading);

    // Применяем тему к :root (CSS-переменные из tokens.css)
    const resolvedTheme = state.resolvedTheme === 'light' ? 'light' : 'dark';
    if (lastTheme !== resolvedTheme) {
      lastTheme = resolvedTheme;
      document.documentElement.dataset.theme = resolvedTheme;
      themeBtn.innerHTML = resolvedTheme === 'dark' ? ICONS.sun : ICONS.moon;
      themeBtn.title = resolvedTheme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
    }

    // Режим Инкогнито
    const isInc = Boolean(state.isIncognito);
    // Вход/выход из Инкогнито: строка Ctrl+F не должна протекать между режимами (main создаёт новый менеджер вкладок)
    if (lastIncognito !== null && lastIncognito !== isInc) {
      findInput.value = '';
      findState = { visible: false, ordinal: 0, total: 0, done: false };
      renderFind();
    }
    lastIncognito = isInc;
    document.documentElement.dataset.incognito = isInc ? '1' : '';
    incBadge.hidden = !isInc;
    incBtn.setAttribute('aria-pressed', String(isInc));
    incBtn.title = isInc ? 'Выйти из режима Инкогнито (Ctrl+Shift+N)' : 'Режим Инкогнито (Ctrl+Shift+N)';

    // Кнопка развернуть / восстановить окно
    const isMax = Boolean(state.isMaximized);
    if (lastMaximized !== isMax) {
      lastMaximized = isMax;
      winMaxBtn.innerHTML = isMax ? ICONS.restore : ICONS.maximize;
      winMaxBtn.title = isMax ? 'Восстановить' : 'Развернуть';
      winMaxBtn.setAttribute('aria-label', winMaxBtn.title);
    }

    // Кнопки навигации
    backBtn.disabled = !state.canGoBack;
    forwardBtn.disabled = !state.canGoForward;
    reopenBtn.disabled = !state.canReopenClosed;

    // Кнопка «Обновить» превращается в «Остановить» во время загрузки
    if (lastLoading !== isLoading) {
      lastLoading = isLoading;
      reloadBtn.innerHTML = isLoading ? ICONS.stop : ICONS.reload;
      reloadBtn.title = isLoading ? 'Остановить загрузку (Esc)' : 'Обновить (Ctrl+R)';
      reloadBtn.setAttribute('aria-label', isLoading ? 'Остановить загрузку' : 'Обновить');
      loadingBar.classList.toggle('active', isLoading);
    }

    // Значок безопасности и текст в адресной строке
    updateSiteBadge(active);
    // Смена вкладки или адреса закрывает карточку: она описывает конкретную страницу
    if (sitePopoverOpen && (!active || state.activeId !== sitePopoverTabId || active.url !== sitePopoverUrl)) {
      closeSitePopover();
    }
    // Карточка пароля переживает редирект после входа, но не смену вкладки и не Инкогнито
    if (pwOpen && (state.isIncognito || state.activeId !== pwTabId)) closePwPopover({ dismiss: true });

    if (active) {
      const key = `${state.activeId}|${active.isNewTab ? '' : (active.url || '')}`;
      const focused = document.activeElement === urlEl;
      const tabChanged = lastActiveId !== state.activeId;
      if (!focused || tabChanged || (key !== lastUrlSync && !urlDirty)) {
        urlEl.value = active.isNewTab || active.url === 'about:blank' ? '' : (active.url || '');
        urlDirty = false;
      }
      lastUrlSync = key;
    }

    // Индикатор загрузок
    const dl = state.downloads || {};
    const dlActive = Number(dl.activeCount) || 0;
    const dlProgress = Math.max(0, Math.min(100, Number(dl.progress) || 0));
    const dlKey = `${dlActive}|${dlProgress}`;
    if (lastDownloadsKey !== dlKey) {
      lastDownloadsKey = dlKey;
      downloadsBtn.classList.toggle('active', dlActive > 0);
      downloadsBtn.style.setProperty('--dl-progress', String(dlProgress));
      downloadsBtn.title = dlActive > 0
        ? `Загрузки: активных ${dlActive}, ${dlProgress}%`
        : 'Загрузки';
    }

    // Бейдж масштаба: только когда ≠ 100%
    const zoom = Number.isFinite(state.zoomPercent) ? Math.round(state.zoomPercent) : 100;
    if (lastZoom !== zoom) {
      lastZoom = zoom;
      zoomBadge.hidden = zoom === 100;
      zoomBadge.textContent = `${zoom}%`;
      zoomBadge.title = `Масштаб ${zoom}% — нажмите, чтобы сбросить (Ctrl+0)`;
    }

    // Звёздочка закладки: только для http/https, на новой вкладке и внутренних страницах скрыта;
    // в Инкогнито закладки не работают, поэтому кнопку скрываем целиком
    const canBookmark = !state.isIncognito && Boolean(active && /^https?:\/\//i.test(active.url || ''));
    const bookmarked = canBookmark && state.isBookmarked === true;
    bookmarkBtn.hidden = !canBookmark;
    bookmarkBtn.classList.toggle('active', bookmarked);
    bookmarkBtn.setAttribute('aria-pressed', String(bookmarked));
    bookmarkBtn.title = bookmarked ? 'Удалить из закладок (Ctrl+D)' : 'Добавить в закладки (Ctrl+D)';
    bookmarkBtn.setAttribute('aria-label', bookmarked ? 'Удалить из закладок' : 'Добавить в закладки');

    lastActiveId = state.activeId;
  }

  // ---- Split View: разделитель в 6px-зазоре между WebContentsView ----
  const splitDivider = document.getElementById('split-divider');
  const SPLIT_GAP = 6;
  let splitDragging = false;
  let splitRaf = 0;
  let splitPending = null;

  function renderSplit() {
    const on = state.splitTabId !== null && state.splitTabId !== undefined;
    splitDivider.hidden = !on;
    if (!on) return;
    const bar = document.getElementById('findbar');
    const bmb = document.getElementById('bmbar');
    const ref = bar && !bar.hidden ? bar : (bmb && !bmb.hidden ? bmb : document.getElementById('toolbar'));
    // setProperty разрешён при CSP style-src 'self' (атрибут style в разметке был бы заблокирован)
    splitDivider.style.setProperty('--split-top', `${Math.round(ref.getBoundingClientRect().bottom)}px`);
    // В вертикальном режиме страницы занимают только область справа от сайдбара
    splitDivider.style.setProperty('--split-left', `${Math.round(vtWidth + (window.innerWidth - vtWidth - SPLIT_GAP) * (state.splitRatio || 0.5))}px`);
  }

  function endSplitDrag(e) {
    if (!splitDragging) return;
    splitDragging = false;
    splitDivider.classList.remove('dragging');
    try { splitDivider.releasePointerCapture(e.pointerId); } catch { /* уже снят */ }
  }

  splitDivider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    splitDragging = true;
    splitDivider.classList.add('dragging');
    splitDivider.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  splitDivider.addEventListener('pointermove', (e) => {
    if (!splitDragging) return;
    splitPending = (e.clientX - vtWidth - SPLIT_GAP / 2) / (window.innerWidth - vtWidth - SPLIT_GAP);
    if (splitRaf) return;
    splitRaf = requestAnimationFrame(() => {
      splitRaf = 0;
      if (splitPending !== null) window.browser.splitResize(splitPending); // clamp 0.25..0.75 — в main
      splitPending = null;
    });
  });
  splitDivider.addEventListener('pointerup', endSplitDrag);
  splitDivider.addEventListener('pointercancel', endSplitDrag);
  splitDivider.addEventListener('lostpointercapture', endSplitDrag);
  splitDivider.addEventListener('dblclick', () => window.browser.splitResize(0.5));
  window.addEventListener('resize', renderSplit);

  // Сайдбар вертикальных вкладок: режим и ширина приходят из main; CSS реагирует на data-vtabs / data-vtabs-collapsed
  function renderVerticalTabs() {
    const vt = state.verticalTabs || {};
    const on = Boolean(vt.enabled);
    const collapsed = on && Boolean(vt.collapsed);
    const width = on ? Math.max(0, Math.round(Number(vt.width) || 0)) : 0;
    const key = `${on ? 1 : 0}|${collapsed ? 1 : 0}|${width}`;
    if (key !== lastVtKey) {
      lastVtKey = key;
      vertical = on;
      vtWidth = width;
      const root = document.documentElement;
      root.dataset.vtabs = on ? '1' : '';
      root.dataset.vtabsCollapsed = collapsed ? '1' : '';
      if (on) root.style.setProperty('--vt-width', `${width}px`);
      else root.style.removeProperty('--vt-width');
      tabsStrip.setAttribute('aria-orientation', on ? 'vertical' : 'horizontal');
      vtToggleBtn.setAttribute('aria-pressed', String(on));
      vtToggleBtn.title = on
        ? (collapsed ? 'Развернуть панель вкладок (ПКМ — вернуть горизонтальные)' : 'Свернуть панель вкладок (ПКМ — вернуть горизонтальные)')
        : 'Вертикальные вкладки';
      vtToggleBtn.setAttribute('aria-label', vtToggleBtn.title);
      vtCollapseBtn.title = collapsed ? 'Развернуть панель вкладок' : 'Свернуть панель вкладок';
      vtCollapseBtn.setAttribute('aria-label', vtCollapseBtn.title);
      vtCollapseBtn.setAttribute('aria-expanded', String(!collapsed));
      // Сброс незавершённого drag: раскладка вкладок изменилась
      if (dragSession) { resetDragVisuals(dragSession, true); dragSession = null; }
    }
    if (on) {
      const n = String(state.tabs.length);
      if (vtCount.textContent !== n) vtCount.textContent = n;
    }
  }

  function render() {
    renderVerticalTabs();
    renderWorkspaces();
    renderTabs();
    renderChrome();
    renderSplit();
    scheduleToastLayout();
  }

  // ---- Рабочие пространства ----
  // Стили через setProperty: атрибут style в разметке запрещён CSP (style-src 'self')
  const WS_COLORS = ['#4f9dff', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#f87171', '#22d3ee', '#94a3b8'];
  const WS_ICON_EDIT = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l.6-2.8L11 2.8a1.4 1.4 0 0 1 2 2l-7.4 7.4L3 13z"/></svg>';
  const WS_ICON_DEL = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>';
  const wsBtn = document.getElementById('ws-btn');
  const wsName = document.getElementById('ws-name');
  const wsPopover = document.getElementById('ws-popover');
  const wsList = document.getElementById('ws-list');
  const wsNewName = document.getElementById('ws-new-name');
  const wsNewBtn = document.getElementById('ws-new-btn');
  let wsOpen = false;
  let wsEditId = null;      // строка в режиме переименования
  let wsColorId = null;     // строка с раскрытой палитрой
  let wsDeleteArmed = null; // строка, ждущая второго клика «Удалить?»
  let wsSig = '';

  function wsData() {
    const w = state.workspaces;
    return w && w.enabled ? w : null;
  }

  function renderWorkspaces() {
    const ws = wsData();
    wsBtn.hidden = !ws;
    if (!ws) { closeWsPopover(); return; } // Инкогнито: пространств нет
    const cur = ws.items.find((w) => w.id === ws.active) || ws.items[0];
    if (cur) {
      wsBtn.style.setProperty('--ws-color', cur.color);
      wsName.textContent = cur.name;
      wsBtn.title = `Рабочее пространство: ${cur.name}`;
    }
    if (!wsOpen || wsEditId !== null) return; // не затираем поле переименования
    if (JSON.stringify([ws.active, ws.items]) !== wsSig) renderWsList();
  }

  function wsAction(cls, title, html, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ws-act ${cls}`.trim();
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = html; // статичный SVG, данных пользователя тут нет
    b.addEventListener('click', onClick);
    return b;
  }

  function renderWsList() {
    const ws = wsData();
    if (!ws) return;
    wsSig = JSON.stringify([ws.active, ws.items]);
    wsList.replaceChildren();

    for (const item of ws.items) {
      const li = document.createElement('li');
      li.className = 'ws-item' + (item.id === ws.active ? ' active' : '');
      li.style.setProperty('--ws-color', item.color);
      const row = document.createElement('div');
      row.className = 'ws-row';

      const dotBtn = document.createElement('button');
      dotBtn.type = 'button';
      dotBtn.className = 'ws-dot-btn';
      dotBtn.title = 'Цвет пространства';
      dotBtn.setAttribute('aria-label', 'Цвет пространства');
      dotBtn.addEventListener('click', () => {
        wsColorId = wsColorId === item.id ? null : item.id;
        renderWsList();
      });
      row.append(dotBtn);

      if (wsEditId === item.id) {
        const input = document.createElement('input');
        input.className = 'ws-edit';
        input.type = 'text';
        input.maxLength = 24;
        input.value = item.name;
        const commit = () => {
          if (wsEditId !== item.id) return; // blur после Esc/перерисовки
          wsEditId = null;
          const v = input.value.trim();
          if (v && v !== item.name) window.browser.updateWorkspace({ id: item.id, name: v });
          else renderWsList();
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); wsEditId = null; renderWsList(); }
        });
        input.addEventListener('blur', commit);
        row.append(input);
        setTimeout(() => { input.focus(); input.select(); }, 0);
      } else {
        const nameBtn = document.createElement('button');
        nameBtn.type = 'button';
        nameBtn.className = 'ws-name-btn';
        const label = document.createElement('span');
        label.className = 'ws-label';
        label.textContent = item.name;
        const cnt = document.createElement('span');
        cnt.className = 'ws-count';
        cnt.textContent = String(item.count);
        nameBtn.append(label, cnt);
        nameBtn.addEventListener('click', () => {
          closeWsPopover(); // сначала вернуть страницы, потом переключать
          if (item.id !== ws.active) window.browser.switchWorkspace(item.id);
        });
        row.append(nameBtn);
        row.append(wsAction('', 'Переименовать', WS_ICON_EDIT, () => { wsEditId = item.id; renderWsList(); }));

        if (item.id !== 'main') {
          if (wsDeleteArmed === item.id) {
            const sure = document.createElement('button');
            sure.type = 'button';
            sure.className = 'ws-act confirm';
            sure.title = 'Вкладки переедут в «Основное»';
            sure.textContent = 'Удалить?';
            sure.addEventListener('click', () => { wsDeleteArmed = null; window.browser.deleteWorkspace(item.id); });
            row.append(sure);
          } else {
            row.append(wsAction('danger', 'Удалить пространство', WS_ICON_DEL, () => {
              wsDeleteArmed = item.id;
              renderWsList();
              setTimeout(() => {
                if (wsDeleteArmed !== item.id) return;
                wsDeleteArmed = null;
                if (wsOpen && wsEditId === null) renderWsList();
              }, 3000);
            }));
          }
        }
      }
      li.append(row);

      if (wsColorId === item.id) {
        const sw = document.createElement('div');
        sw.className = 'ws-swatches';
        for (const c of WS_COLORS) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'ws-sw';
          b.setAttribute('aria-label', `Цвет ${c}`);
          b.setAttribute('aria-pressed', String(c === item.color));
          b.style.setProperty('--sw', c);
          b.addEventListener('click', () => { wsColorId = null; window.browser.updateWorkspace({ id: item.id, color: c }); });
          sw.append(b);
        }
        li.append(sw);
      }
      wsList.append(li);
    }
  }

  function positionWsPopover() {
    const r = wsBtn.getBoundingClientRect();
    const w = wsPopover.offsetWidth;
    wsPopover.style.left = `${Math.max(8, Math.min(Math.round(r.left), window.innerWidth - w - 8))}px`;
    wsPopover.style.top = `${Math.round(r.bottom + 6)}px`;
  }

  function openWsPopover() {
    if (!wsData()) return;
    bmBeginOverlay(); // гасит остальные оверлеи без IPC: страницы остаются скрытыми, мигания нет
    wsOpen = true;
    wsEditId = null;
    wsColorId = null;
    wsDeleteArmed = null;
    wsPopover.hidden = false;
    wsBtn.setAttribute('aria-expanded', 'true');
    renderWsList();
    positionWsPopover();
    window.browser.setSitePopoverOpen(true); // WebContentsView скрываются, список не уйдёт под страницу
  }

  function closeWsPopover(opts) {
    if (!wsOpen) return;
    wsOpen = false;
    wsEditId = null;
    wsColorId = null;
    wsDeleteArmed = null;
    wsSig = '';
    wsPopover.hidden = true;
    wsBtn.setAttribute('aria-expanded', 'false');
    if (!(opts && opts.fromMain)) window.browser.setSitePopoverOpen(false);
    if (opts && opts.focusBtn) wsBtn.focus();
  }

  function submitNewWorkspace() {
    const name = wsNewName.value.trim();
    if (!name) { wsNewName.focus(); return; }
    wsNewName.value = '';
    closeWsPopover();
    window.browser.createWorkspace(name);
  }

  wsBtn.addEventListener('click', () => (wsOpen ? closeWsPopover() : openWsPopover()));
  wsNewBtn.addEventListener('click', submitNewWorkspace);
  wsNewName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitNewWorkspace(); }
  });
  document.addEventListener('mousedown', (e) => {
    if (!wsOpen || wsPopover.contains(e.target) || wsBtn.contains(e.target)) return;
    closeWsPopover();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !wsOpen || wsEditId !== null || isAuthOpen()) return; // Esc в поле переименования обрабатывает само поле
    e.preventDefault();
    e.stopImmediatePropagation();
    closeWsPopover({ focusBtn: true });
  }, true);
  window.addEventListener('blur', () => closeWsPopover());
  window.addEventListener('resize', () => closeWsPopover());

  // ---- Поиск по странице ----
  // Видимость и «X из Y» приходят из main (событие find:state, источник — found-in-page активной вкладки).
  // Текст запроса и регистр принадлежат полю ввода: из main их не перезаписываем, иначе быстрый набор терял бы символы
  let findState = { visible: false, ordinal: 0, total: 0, done: false };
  let findMatchCase = false;

  function renderFind() {
    const hasQuery = findInput.value.length > 0;
    const total = hasQuery ? Math.max(0, Number(findState.total) || 0) : 0;
    const noMatch = hasQuery && Boolean(findState.done) && total === 0;

    findbar.hidden = !findState.visible;
    findbar.classList.toggle('no-match', noMatch);

    let text = '';
    if (noMatch) text = 'Нет совпадений';
    else if (total > 0) text = `${Math.max(1, Number(findState.ordinal) || 0)} из ${total}`;
    if (findCount.textContent !== text) findCount.textContent = text;

    findPrevBtn.disabled = total === 0;
    findNextBtn.disabled = total === 0;
    renderSplit(); // панель поиска сдвигает страницы вниз — меняется и top разделителя
  }

  function sendFindQuery() {
    window.browser.findQuery(findInput.value, findMatchCase);
  }

  function closeFind() {
    window.browser.findClose();
  }

  findInput.addEventListener('input', () => {
    // Сразу гасим старый счётчик; свежие числа придут из main
    findState = { ...findState, ordinal: 0, total: 0, done: false };
    renderFind();
    sendFindQuery();
  });

  findInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (findInput.value) window.browser.findNext(!e.shiftKey);
  });

  // После клика по кнопкам возвращаем фокус в поле: Enter/Shift+Enter/Esc продолжают работать
  findPrevBtn.addEventListener('click', () => {
    window.browser.findNext(false);
    findInput.focus();
  });
  findNextBtn.addEventListener('click', () => {
    window.browser.findNext(true);
    findInput.focus();
  });
  findCaseBtn.addEventListener('click', () => {
    findMatchCase = !findMatchCase;
    findCaseBtn.setAttribute('aria-pressed', String(findMatchCase));
    findCaseBtn.title = findMatchCase ? 'Учитывать регистр: включено' : 'Учитывать регистр';
    findInput.focus();
    if (findInput.value) sendFindQuery();
  });
  findCloseBtn.addEventListener('click', closeFind);

  // Esc в интерфейсе: закрывает панель (кроме адресной строки — там Esc откатывает адрес).
  // Esc, нажатый в самой странице, main обрабатывает сам (handleShortcut)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !findState.visible || e.target === urlEl) return;
    e.preventDefault();
    closeFind();
  });

  window.browser.onFindState((next) => {
    if (!next || typeof next !== 'object') return;
    findState = {
      visible: Boolean(next.visible),
      ordinal: Number(next.ordinal) || 0,
      total: Number(next.total) || 0,
      done: Boolean(next.done)
    };
    renderFind();
  });

  // Ctrl+F / «Найти на странице»: main уже прислал find:state с visible=true (IPC упорядочен), ставим фокус и выделяем текст
  window.browser.onFindFocus(() => {
    findbar.hidden = false;
    findInput.focus();
    findInput.select();
  });

  // Горизонтальная прокрутка вкладок колесом мыши
  tabsStrip.addEventListener('wheel', (e) => {
    if (vertical) return; // в сайдбаре работает обычная вертикальная прокрутка
    if (tabsStrip.scrollWidth <= tabsStrip.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      tabsStrip.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  // Обработка адресной строки
  urlEl.addEventListener('focus', () => {
    urlEl.select();
    selectAllOnMouseUp = true;
  });

  urlEl.addEventListener('mouseup', (e) => {
    if (selectAllOnMouseUp) {
      e.preventDefault();
      selectAllOnMouseUp = false;
    }
  });

  // Подсказки: сам попап рисует main (WebContentsView), здесь только запрос и клавиши
  const omniboxEl = document.getElementById('omnibox') || urlEl;
  let omniTimer = null;

  urlEl.addEventListener('input', () => {
    urlDirty = true;
    clearTimeout(omniTimer);
    omniTimer = setTimeout(() => {
      omniTimer = null;
      if (document.activeElement !== urlEl) return;
      if (!urlEl.value.trim()) { window.browser.omniboxHide(); return; }
      const r = omniboxEl.getBoundingClientRect();
      window.browser.omniboxQuery(urlEl.value, { left: r.left, bottom: r.bottom, width: r.width });
    }, 40);
  });

  urlEl.addEventListener('blur', () => {
    clearTimeout(omniTimer);
    window.browser.omniboxBlur();
    selectAllOnMouseUp = false;
    urlDirty = false;
    const active = getActiveTab();
    if (active) {
      urlEl.value = active.isNewTab || active.url === 'about:blank' ? '' : (active.url || '');
    }
  });

  urlEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      window.browser.omniboxMove(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(omniTimer);
      const text = urlEl.value;
      // main сам откроет выбранную подсказку; если попапа нет (или текст устарел) — обычный переход
      window.browser.omniboxAccept(text)
        .then((handled) => { if (!handled) window.browser.navigate(text); })
        .catch(() => window.browser.navigate(text));
      urlEl.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      clearTimeout(omniTimer);
      window.browser.omniboxHide();
      const active = getActiveTab();
      urlEl.value = active && !active.isNewTab && active.url !== 'about:blank' ? (active.url || '') : '';
      urlDirty = false;
      urlEl.blur();
    }
  });

  // Кнопки интерфейса
  newTabBtn.addEventListener('click', () => window.browser.newTab());
  // Быстрая кнопка: выкл → включить сайдбар; вкл → свернуть/развернуть. ПКМ или Shift+клик — переключить режим целиком
  vtToggleBtn.addEventListener('click', (e) => {
    if (!vertical || e.shiftKey) window.browser.toggleVerticalTabs();
    else window.browser.toggleVerticalTabsCollapsed();
  });
  vtToggleBtn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.browser.toggleVerticalTabs();
  });
  vtCollapseBtn.addEventListener('click', () => window.browser.toggleVerticalTabsCollapsed());
  backBtn.addEventListener('click', () => window.browser.back());
  forwardBtn.addEventListener('click', () => window.browser.forward());
  reloadBtn.addEventListener('click', (e) => {
    const active = getActiveTab();
    if (active && active.loading) {
      window.browser.stop();
    } else {
      window.browser.reload(e.shiftKey);
    }
  });

  reopenBtn.addEventListener('click', () => window.browser.reopenClosedTab());
  incBtn.addEventListener('click', () => window.browser.toggleIncognito());
  incBadge.addEventListener('click', () => window.browser.toggleIncognito());
  themeBtn.addEventListener('click', () => window.browser.toggleTheme());
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.addEventListener('click', () => {
    const r = menuBtn.getBoundingClientRect();
    window.browser.openQuickMenu({ left: r.left, right: r.right, bottom: r.bottom });
  });
  downloadsBtn.setAttribute('aria-haspopup', 'dialog');
  downloadsBtn.addEventListener('click', () => {
    const r = downloadsBtn.getBoundingClientRect();
    window.browser.openDownloadsMenu({ left: r.left, right: r.right, bottom: r.bottom });
  });
  zoomBadge.addEventListener('click', () => window.browser.zoomReset());
  siteBadge.addEventListener('click', () => {
    if (sitePopoverOpen) closeSitePopover();
    else openSitePopover();
  });

  // Кнопки кастомной рамки окна
  winMinBtn.addEventListener('click', () => window.browser.minimize());
  winMaxBtn.addEventListener('click', () => window.browser.toggleMaximize());
  winCloseBtn.addEventListener('click', () => window.browser.closeWindow());

  // События от main-процесса
  // ---- Обои под прозрачной оболочкой ----
  const wallVideo = document.getElementById('wall-video');
  const wallImg = document.getElementById('wall-img');
  let wallKey = '';

  function applyWallpaper() {
    const w = state && state.wallpaper;
    const root = document.documentElement;
    if (!w || !w.active || !w.url) {
      root.removeAttribute('data-transparent-chrome');
      if (wallKey) {
        wallKey = '';
        wallVideo.pause();
        wallVideo.removeAttribute('src');
        wallVideo.load();
        wallImg.removeAttribute('src');
      }
      return;
    }
    root.setAttribute('data-transparent-chrome', '1');
    root.style.setProperty('--wall-dim', String(Math.min(0.9, Math.max(0, (w.dim || 0) / 100))));
    const blur = `blur(${Math.max(0, (w.blur || 0) + (w.searchBlur || 0))}px)`;
    wallVideo.style.filter = blur;
    wallImg.style.filter = blur;
    if (wallKey !== w.url) {
      wallKey = w.url;
      wallVideo.style.display = w.video ? 'block' : 'none';
      wallImg.style.display = w.video ? 'none' : 'block';
      if (w.video) {
        wallImg.removeAttribute('src');
        wallVideo.src = w.url;
      } else {
        wallVideo.removeAttribute('src');
        wallVideo.load();
        wallImg.src = w.url;
      }
    }
    // Видео крутим только когда видно обои: на вкладке «Новая вкладка» (страница прозрачна)
    const active = state.tabs && state.tabs.find((t) => t.id === state.activeId);
    const onNewTab = !active || !active.url || Boolean(w.visible);
    if (w.video) {
      if (onNewTab && !document.hidden) wallVideo.play().catch(() => {});
      else wallVideo.pause();
    }
  }

  document.addEventListener('visibilitychange', applyWallpaper);

  // Цвет оболочки приходит из main в составе state (раньше main дёргал executeJavaScript)
  const CHROME_THEME_KEY = 'mybrowser_chrome_theme_v1';
  function applyChromeTheme(id) {
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(id)) return;
    const root = document.documentElement;
    if (root.dataset.chromeTheme === id) return;
    root.dataset.chromeTheme = id;
    try { window.localStorage.setItem(CHROME_THEME_KEY, id); } catch { /* localStorage недоступен */ }
  }

  window.browser.onState((nextState) => {
    state = nextState;
    try { applyChromeTheme(state && state.chromeTheme); } catch (e) { console.error('applyChromeTheme', e); }
    // Панель закладок — раньше render(): renderSplit() меряет её нижнюю границу
    try { renderBookmarksBar(); } catch (e) { console.error('renderBookmarksBar', e); }
    try { render(); } catch (e) { console.error('render', e); }
    try { applyWallpaper(); } catch (e) { console.error('applyWallpaper', e); }
  });

  // ---- Модалка HTTP Basic Auth (сайт или прокси) ----
  // Видимость и данные приходят из main (auth:prompt); значения полей живут только пока модалка открыта
  const authModal = document.getElementById('auth-modal');
  const authDialog = document.getElementById('auth-dialog');
  const authTitle = document.getElementById('auth-title');
  const authHost = document.getElementById('auth-host');
  const authRealm = document.getElementById('auth-realm');
  const authWarning = document.getElementById('auth-warning');
  const authUser = document.getElementById('auth-username');
  const authPass = document.getElementById('auth-password');
  const authCancelBtn = document.getElementById('auth-cancel');
  const authSubmitBtn = document.getElementById('auth-submit');
  let authRequestId = null;

  function isAuthOpen() {
    return authRequestId !== null && !authModal.hidden;
  }

  function hideAuth() {
    authRequestId = null;
    authModal.hidden = true;
    authPass.value = '';
    authUser.value = '';
  }

  function showAuth(p) {
    authRequestId = Number(p.requestId);
    authTitle.textContent = p.isProxy === true ? 'Авторизация прокси' : 'Требуется вход';

    let host = String(p.host == null ? '' : p.host);
    const port = p.port == null ? '' : String(p.port);
    if (port && !host.endsWith(`:${port}`)) host += `:${port}`;
    authHost.textContent = host;

    const realm = typeof p.realm === 'string' ? p.realm.trim() : '';
    authRealm.textContent = realm;
    authRealm.title = realm;
    authRealm.hidden = !realm;

    authWarning.hidden = p.secure !== false;

    // Старые значения не должны утечь в следующий запрос
    authUser.value = '';
    authPass.value = '';
    authModal.hidden = false;
    authUser.focus();
  }

  function submitAuth() {
    if (!isAuthOpen()) return;
    const requestId = authRequestId;
    const username = authUser.value;
    const password = authPass.value;
    hideAuth();
    window.browser.respondAuth({ requestId, username, password });
  }

  function cancelAuth() {
    if (!isAuthOpen()) return;
    const requestId = authRequestId;
    hideAuth();
    window.browser.respondAuth({ requestId, cancel: true });
  }

  authDialog.addEventListener('submit', (e) => {
    e.preventDefault();
    submitAuth();
  });
  authCancelBtn.addEventListener('click', cancelAuth);

  // Capture: Esc и Tab обрабатываем раньше остальных обработчиков (панель поиска, адресная строка)
  document.addEventListener('keydown', (e) => {
    if (!isAuthOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancelAuth();
    } else if (e.key === 'Tab') {
      // Фокус не уходит за пределы модалки
      const items = [authUser, authPass, authCancelBtn, authSubmitBtn];
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
      e.preventDefault();
      items[next].focus();
    }
  }, true);

  if (typeof window.browser.onAuthPrompt === 'function') window.browser.onAuthPrompt((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.visible === true) showAuth(payload);
    else if (payload.visible === false) hideAuth();
  });


  // ==================== Карточка безопасности сайта ====================

  function describeSite(tab) {
    const url = (tab && tab.url) || '';
    if (!url || /^about:blank/i.test(url)) return null;
    if (tab.isError) {
      let host = '';
      try { host = new URL(url).host; } catch (_) { /* не http(s) */ }
      return { kind: 'error', host: host || url, origin: '', status: 'Не удалось загрузить страницу' };
    }
    if (isInternalUrl(url)) {
      return { kind: 'internal', host: url, origin: '', status: 'Системная страница браузера' };
    }
    if (/^file:/i.test(url)) {
      return { kind: 'file', host: 'Локальный файл', origin: '', status: 'Файл на этом устройстве' };
    }
    let parsed;
    try { parsed = new URL(url); } catch (_) { return null; }
    if (parsed.protocol === 'https:') {
      return { kind: 'secure', host: parsed.host, origin: parsed.origin, status: 'Соединение защищено (HTTPS)' };
    }
    if (parsed.protocol === 'http:') {
      return { kind: 'insecure', host: parsed.host, origin: parsed.origin, status: 'Соединение не защищено (HTTP)' };
    }
    return { kind: 'file', host: parsed.protocol, origin: '', status: 'Нестандартный адрес' };
  }

  function normalizePermValue(v) {
    const s = String(v).toLowerCase();
    if (v === true || s === 'allow' || s === 'allowed' || s === 'granted') return 'allow';
    if (v === false || s === 'block' || s === 'blocked' || s === 'deny' || s === 'denied') return 'block';
    return 'ask';
  }

  // Ответ getSiteInfo: { origin?, permissions: { microphone: 'allow'|'block'|'ask', ... } } (или массив { permission, value })
  function parseSitePerms(info) {
    const out = {};
    const src = info && info.permissions;
    if (Array.isArray(src)) {
      for (const p of src) if (p && SITE_PERMISSIONS.includes(p.permission)) out[p.permission] = normalizePermValue(p.value);
    } else if (src && typeof src === 'object') {
      for (const id of SITE_PERMISSIONS) if (id in src) out[id] = normalizePermValue(src[id]);
    }
    return out;
  }

  function renderSitePerms() {
    let anySet = false;
    for (const row of spRows) {
      const value = sitePerms[row.dataset.perm] || 'ask';
      if (value !== 'ask') anySet = true;
      row.dataset.value = value;
      row.setAttribute('aria-checked', String(value === 'allow'));
      row.querySelector('.sp-row-state').textContent = SITE_STATE_LABELS[value];
    }
    spReset.disabled = !anySet;
  }

  function positionSitePopover() {
    const r = omniboxEl.getBoundingClientRect();
    const w = sitePopover.offsetWidth;
    const left = Math.max(8, Math.min(Math.round(r.left), window.innerWidth - w - 8));
    sitePopover.style.left = `${left}px`;
    sitePopover.style.top = `${Math.round(r.bottom + 6)}px`;
  }

  async function openSitePopover() {
    const tab = getActiveTab();
    const site = describeSite(tab);
    if (!site) return;
    bmBeginOverlay(); // и при открытии с клавиатуры остальные оверлеи закрываются

    const token = ++sitePopoverToken;
    sitePopoverOpen = true;
    sitePopoverTabId = state.activeId;
    sitePopoverUrl = tab.url;
    sitePopoverOrigin = site.origin;
    sitePerms = {};

    sitePopover.className = site.kind;
    spIcon.innerHTML = site.kind === 'secure' ? ICONS.badgeSecure
      : site.kind === 'insecure' ? ICONS.badgeInsecure
      : site.kind === 'error' ? ICONS.badgeError
      : ICONS.badgeInternal;
    spHost.textContent = site.host;
    spStatus.textContent = site.status;

    const hasPerms = Boolean(site.origin);
    spPerms.hidden = !hasPerms;
    renderSitePerms();

    sitePopover.hidden = false;
    siteBadge.setAttribute('aria-expanded', 'true');
    positionSitePopover();
    window.browser.setSitePopoverOpen(true);

    if (!hasPerms) return;
    let info = null;
    try { info = await window.browser.getSiteInfo(); } catch (_) { /* покажем значения по умолчанию */ }
    if (token !== sitePopoverToken || !sitePopoverOpen) return;
    if (info && typeof info.origin === 'string' && info.origin) sitePopoverOrigin = info.origin;
    if (info && info.status === 'ssl-bypass') {
      sitePopover.className = 'insecure';
      spIcon.innerHTML = ICONS.badgeInsecure;
      spStatus.textContent = 'Сертификат не проверен: открыто по вашему исключению';
    }
    sitePerms = parseSitePerms(info);
    renderSitePerms();
  }

  function closeSitePopover(opts) {
    if (!sitePopoverOpen) return;
    sitePopoverOpen = false;
    sitePopoverToken++;
    sitePopover.hidden = true;
    siteBadge.setAttribute('aria-expanded', 'false');
    if (!(opts && opts.fromMain)) window.browser.setSitePopoverOpen(false);
    if (opts && opts.focusBadge && !siteBadge.disabled) siteBadge.focus();
  }

  async function toggleSitePermission(row) {
    const permission = row.dataset.perm;
    const origin = sitePopoverOrigin;
    if (!origin || !SITE_PERMISSIONS.includes(permission)) return;
    const token = sitePopoverToken;
    const prev = sitePerms[permission] || 'ask';
    const next = prev === 'allow' ? 'block' : 'allow';

    sitePerms[permission] = next; // сразу показываем результат, откатываем при ошибке
    renderSitePerms();
    try {
      // В интерфейсе отказ называется 'block', main понимает только 'deny'
      const res = await window.browser.setSitePermission({ origin, permission, value: next === 'block' ? 'deny' : next });
      if (!res || res.ok === false) throw new Error('rejected'); // null — main отклонил запрос
    } catch (_) {
      if (token === sitePopoverToken && sitePopoverOpen && sitePerms[permission] === next) {
        sitePerms[permission] = prev;
        renderSitePerms();
      }
    }
  }

  async function resetSitePermissionsForOrigin() {
    const origin = sitePopoverOrigin;
    if (!origin || spReset.disabled) return;
    const token = sitePopoverToken;
    const before = sitePerms;
    sitePerms = {};
    renderSitePerms();
    try {
      const res = await window.browser.resetSitePermissions(origin);
      if (!res || res.ok === false) throw new Error('rejected');
    } catch (_) {
      if (token === sitePopoverToken && sitePopoverOpen) {
        sitePerms = before;
        renderSitePerms();
      }
    }
  }

  for (const row of spRows) row.addEventListener('click', () => toggleSitePermission(row));
  spReset.addEventListener('click', resetSitePermissionsForOrigin);

  // Клик вне карточки (capture: срабатывает раньше остальных обработчиков)
  document.addEventListener('mousedown', (e) => {
    if (!sitePopoverOpen) return;
    if (sitePopover.contains(e.target) || siteBadge.contains(e.target)) return;
    closeSitePopover();
  }, true);

  // Esc закрывает карточку и возвращает фокус на замочек; модалка авторизации имеет приоритет
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !sitePopoverOpen || isAuthOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeSitePopover({ focusBadge: true });
  }, true);

  // Клик в самой странице окно интерфейса не видит: потеря фокуса окна или смена размера закрывают карточку
  window.addEventListener('blur', () => closeSitePopover());
  window.addEventListener('resize', () => closeSitePopover());

  window.browser.onSitePopoverClosed(() => {
    closeSitePopover({ fromMain: true });
    closeWsPopover({ fromMain: true });
  });

  window.browser.onFocusUrl(() => {
    urlEl.focus();
    urlEl.select();
    selectAllOnMouseUp = false;
  });

  // ==================== Drag & Drop: делегированные обработчики ====================
  // Слушаем весь #tabs-area, чтобы бросок правее последней вкладки (на «+») тоже вставлял в конец

  tabsArea.addEventListener('dragover', (e) => {
    if (draggedTabId === null) return;
    if (!dragSession) dragSession = buildDragSession(draggedTabId);
    if (!dragSession) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    updateDragOver(e.clientX, e.clientY);
    autoScrollStrip(e.clientX, e.clientY);
  });

  tabsArea.addEventListener('drop', (e) => {
    if (draggedTabId === null || !dragSession) return;
    e.preventDefault();
    updateDragOver(e.clientX, e.clientY);
    commitDrag();
    endDragState();
  });

  // ==================== Тост смены цвета панели ====================
  // Тост всегда ставится ПОД панелью навигации (или под строкой поиска, если она открыта), выравнивается по кнопке
  // палитры и ограничивается шириной окна — адресная строка и кнопки управления не перекрываются на любой ширине.
  // На узком окне (< 640px) включается компактный вид: уменьшенный размер и обрезка текста многоточием.

  const themeToast = document.getElementById('chrome-theme-toast');
  const paletteBtn = document.getElementById('btn-palette');
  const toolbarEl = document.getElementById('toolbar');
  const TOAST_GAP = 6;
  const TOAST_EDGE = 8;
  const TOAST_MIN_W = 72;
  const TOAST_COMPACT_BELOW = 640;
  let toastRaf = 0;

  function layoutThemeToast() {
    toastRaf = 0;
    if (!themeToast || !toolbarEl) return;

    const vw = document.documentElement.clientWidth;
    const bmb = document.getElementById('bmbar');
    const bar = !findbar.hidden ? findbar : (bmb && !bmb.hidden ? bmb : toolbarEl);
    const top = Math.round(bar.getBoundingClientRect().bottom) + TOAST_GAP;

    let right = TOAST_EDGE + 2;
    if (paletteBtn) {
      const pr = paletteBtn.getBoundingClientRect();
      if (pr.width > 0) right = Math.round(vw - pr.right);
    }
    right = Math.max(TOAST_EDGE, Math.min(right, vw - TOAST_MIN_W - TOAST_EDGE));
    const maxW = Math.max(TOAST_MIN_W, vw - right - TOAST_EDGE);

    const compact = vw < TOAST_COMPACT_BELOW;
    if (themeToast.classList.contains('compact') !== compact) themeToast.classList.toggle('compact', compact);
    themeToast.style.setProperty('--toast-top', `${top}px`);
    themeToast.style.setProperty('--toast-right', `${right}px`);
    themeToast.style.setProperty('--toast-max', `${maxW}px`);
  }

  function scheduleToastLayout() {
    if (!toastRaf) toastRaf = requestAnimationFrame(layoutThemeToast);
  }

  if (themeToast && toolbarEl) {
    window.addEventListener('resize', scheduleToastLayout);
    if (typeof ResizeObserver === 'function') new ResizeObserver(scheduleToastLayout).observe(toolbarEl);
    // Показ тоста и смена его текста (их делает chromeTheme.js) — пересчитываем ширину/позицию
    new MutationObserver(scheduleToastLayout).observe(themeToast, {
      attributes: true, attributeFilter: ['class'], childList: true, subtree: true, characterData: true
    });
    new MutationObserver(scheduleToastLayout).observe(findbar, { attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(scheduleToastLayout).observe(document.getElementById('bmbar'), { attributes: true, attributeFilter: ['hidden'] });
    scheduleToastLayout();
  }
  // ==================== Панель закладок (#bmbar) и поповер звёздочки (#bm-popover) ====================
  // Дерево отдаёт main (без папки «Новой вкладки»). Пока открыто меню папки или поповер, страницы скрыты тем же
  // каналом, что и у карточки замочка (setSitePopoverOpen): иначе WebContentsView перекрыл бы HTML и список ушёл бы под страницу.
  const bmbar = document.getElementById('bmbar');
  const bmbarList = document.getElementById('bmbar-list');
  const bmbarEmpty = document.getElementById('bmbar-empty');
  const bmMenu = document.getElementById('bm-menu');
  const bmPopover = document.getElementById('bm-popover');
  const bmpTitle = document.getElementById('bmp-title');
  const bmpName = document.getElementById('bmp-name');
  const bmpFolders = document.getElementById('bmp-folders');
  const bmpError = document.getElementById('bmp-error');
  const bmpDone = document.getElementById('bmp-done');
  const bmpRemove = document.getElementById('bmp-remove');

  const BM_SVG_OPEN = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">';
  const BM_ICON_FOLDER = `${BM_SVG_OPEN}<path d="M1.8 4.4c0-.6.5-1.1 1.1-1.1h3l1.4 1.6h4.8c.6 0 1.1.5 1.1 1.1v5.8c0 .6-.5 1.1-1.1 1.1H2.9c-.6 0-1.1-.5-1.1-1.1V4.4z"/></svg>`;
  const BM_ICON_PAGE = `${BM_SVG_OPEN}<path d="M4 1.8h5l3 3v8.4c0 .6-.5 1-1 1H4c-.6 0-1-.4-1-1V2.8c0-.6.4-1 1-1z"/><path d="M9 1.8v3h3"/></svg>`;
  const BM_ICON_CHEVRON = `${BM_SVG_OPEN}<path d="M6 4l4 4-4 4"/></svg>`;

  let bmNodes = [];
  let bmByParent = new Map();
  let bmRevSeen = -1;
  let bmFetchToken = 0;
  let bmMenuOpen = false;
  let bmPopOpen = false;
  let bmPopTabId = null;
  let bmPopParent = null;
  let bmPopBusy = false;
  const bmOpenFolders = new Set();

  function bmIndex(nodes) {
    bmNodes = Array.isArray(nodes) ? nodes : [];
    bmByParent = new Map();
    for (const n of bmNodes) {
      const k = n.parentId || null;
      if (!bmByParent.has(k)) bmByParent.set(k, []);
      bmByParent.get(k).push(n);
    }
    for (const list of bmByParent.values()) list.sort((a, b) => a.order - b.order);
  }
  const bmKids = (id) => bmByParent.get(id || null) || [];

  function applyBmTree(res) {
    if (!res || !res.ok) return false;
    bmIndex(res.nodes);
    bmRevSeen = Number(res.rev) || 0;
    drawBookmarksBar();
    return true;
  }

  // ---- Оверлеи: одновременно открыт только один (карточка замочка / меню папки / поповер) ----
  function closeBmMenu(opts) {
    if (!bmMenuOpen) return;
    bmMenuOpen = false;
    bmMenu.hidden = true;
    bmMenu.replaceChildren();
    for (const b of bmbarList.querySelectorAll('.bm-item[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false');
    if (!(opts && opts.keepPages)) window.browser.setSitePopoverOpen(false);
  }

  function closeBmPopover(opts) {
    if (!bmPopOpen) return;
    bmPopOpen = false;
    bmPopTabId = null;
    bmPopover.hidden = true;
    bookmarkBtn.setAttribute('aria-expanded', 'false');
    if (!(opts && opts.keepPages)) window.browser.setSitePopoverOpen(false);
  }

  // Перед открытием своего оверлея гасим остальные без IPC: страницы остаются скрытыми, мигания нет
  function bmBeginOverlay() {
    closeSitePopover({ fromMain: true });
    closeWsPopover({ fromMain: true });
    closeBmMenu({ keepPages: true });
    closeBmPopover({ keepPages: true });
    closePwPopover({ keepPages: true, dismiss: true });
  }

  // ---- Панель ----
  function bmMakeIcon(svg) {
    const ico = document.createElement('span');
    ico.className = 'bm-ico';
    ico.innerHTML = svg; // статичная разметка из констант выше
    return ico;
  }

  function bmMakeItem(node) {
    const isFolder = node.type === 'folder';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = isFolder ? 'bm-item folder' : 'bm-item';
    b.dataset.id = node.id;
    b.title = isFolder ? node.title : `${node.title}\n${node.url}`;
    const label = document.createElement('span');
    label.className = 'bm-label';
    label.textContent = node.title;
    b.append(bmMakeIcon(isFolder ? BM_ICON_FOLDER : BM_ICON_PAGE), label);
    if (isFolder) {
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
    }
    return b;
  }

  function drawBookmarksBar() {
    const roots = bmKids(null);
    bmbarList.replaceChildren(...roots.map(bmMakeItem));
    bmbarEmpty.hidden = roots.length > 0;
  }

  async function refreshBookmarksBar() {
    const token = ++bmFetchToken;
    let res = null;
    try { res = await window.browser.getBookmarksTree(); } catch (_) { return; }
    if (token !== bmFetchToken) return;
    closeBmMenu(); // дерево изменилось — открытое меню устарело
    applyBmTree(res);
  }

  function renderBookmarksBar() {
    const bb = state.bookmarksBar || {};
    const visible = Boolean(bb.visible) && !state.isIncognito;
    const root = document.documentElement;
    if (visible) root.style.setProperty('--bmbar-height', `${Math.round(Number(bb.height)) || 32}px`);
    root.dataset.bmbar = visible ? '1' : '';
    if (bmbar.hidden === visible) bmbar.hidden = !visible;
    if (!visible) {
      closeBmMenu();
      bmRevSeen = -1; // при следующем показе перечитаем дерево
    } else if (state.bookmarksRev !== bmRevSeen) {
      refreshBookmarksBar();
    }
    if (bmPopOpen && (state.isIncognito || state.activeId !== bmPopTabId)) closeBmPopover();
  }

  bmbarList.addEventListener('click', (e) => {
    const btn = e.target.closest('.bm-item');
    if (!btn) return;
    const node = bmNodes.find((n) => n.id === btn.dataset.id);
    if (!node) return;
    if (node.type === 'folder') {
      if (bmMenuOpen && bmMenu.dataset.owner === node.id) closeBmMenu();
      else openBmMenu(node, btn);
    } else {
      window.browser.openBookmark(node.id, e.ctrlKey || e.metaKey);
    }
  });
  bmbarList.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // без автоскролла
  bmbarList.addEventListener('auxclick', (e) => {
    if (e.button !== 1) return;
    const btn = e.target.closest('.bm-item');
    const node = btn && bmNodes.find((n) => n.id === btn.dataset.id);
    if (node && node.type === 'bookmark') window.browser.openBookmark(node.id, true);
  });
  bmbarList.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    bmbarList.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });

  // ---- Выпадающее меню папки ----
  function renderBmMenu(rootId) {
    const frag = document.createDocumentFragment();
    const walk = (parentId, depth) => {
      const kids = bmKids(parentId);
      if (!kids.length && depth === 0) {
        const empty = document.createElement('div');
        empty.className = 'bm-empty';
        empty.textContent = 'Папка пуста';
        frag.append(empty);
      }
      for (const n of kids) {
        const isFolder = n.type === 'folder';
        const row = document.createElement('button');
        row.type = 'button';
        row.className = isFolder ? 'bm-row folder' : 'bm-row';
        row.setAttribute('role', 'menuitem');
        row.dataset.id = n.id;
        row.title = isFolder ? n.title : `${n.title}\n${n.url}`;
        row.style.setProperty('--d', String(depth));
        const label = document.createElement('span');
        label.className = 'bm-label';
        label.textContent = n.title;
        row.append(bmMakeIcon(isFolder ? BM_ICON_FOLDER : BM_ICON_PAGE), label);
        if (isFolder) {
          const open = bmOpenFolders.has(n.id);
          row.setAttribute('aria-expanded', String(open));
          const chev = bmMakeIcon(BM_ICON_CHEVRON);
          chev.classList.add('bm-chev');
          row.append(chev);
        }
        frag.append(row);
        if (isFolder && bmOpenFolders.has(n.id)) walk(n.id, depth + 1);
      }
    };
    walk(rootId, 0);
    bmMenu.replaceChildren(frag);
  }

  function openBmMenu(folder, anchor) {
    bmBeginOverlay();
    bmMenuOpen = true;
    bmMenu.dataset.owner = folder.id;
    bmOpenFolders.clear();
    anchor.setAttribute('aria-expanded', 'true');
    renderBmMenu(folder.id);
    bmMenu.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = bmMenu.offsetWidth;
    bmMenu.style.left = `${Math.max(8, Math.min(Math.round(r.left), window.innerWidth - w - 8))}px`;
    bmMenu.style.top = `${Math.round(r.bottom + 4)}px`;
    window.browser.setSitePopoverOpen(true);
  }

  bmMenu.addEventListener('click', (e) => {
    const row = e.target.closest('.bm-row');
    if (!row) return;
    const node = bmNodes.find((n) => n.id === row.dataset.id);
    if (!node) return;
    if (node.type === 'folder') {
      if (bmOpenFolders.has(node.id)) bmOpenFolders.delete(node.id);
      else bmOpenFolders.add(node.id);
      renderBmMenu(bmMenu.dataset.owner);
    } else {
      window.browser.openBookmark(node.id, e.ctrlKey || e.metaKey);
      closeBmMenu();
    }
  });

  // ---- Поповер звёздочки ----
  function positionBmPopover() {
    const r = bookmarkBtn.getBoundingClientRect();
    const w = bmPopover.offsetWidth;
    bmPopover.style.left = `${Math.max(8, Math.min(Math.round(r.right - w), window.innerWidth - w - 8))}px`;
    bmPopover.style.top = `${Math.round(r.bottom + 8)}px`;
  }

  function renderBmFolderPicker() {
    const frag = document.createDocumentFragment();
    const add = (id, title, depth) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'bmp-folder';
      b.setAttribute('role', 'option');
      b.dataset.id = id || '';
      b.setAttribute('aria-selected', String((id || null) === bmPopParent));
      b.style.setProperty('--d', String(depth));
      const label = document.createElement('span');
      label.className = 'bm-label';
      label.textContent = title;
      b.append(bmMakeIcon(BM_ICON_FOLDER), label);
      frag.append(b);
    };
    add(null, 'Корень (панель закладок)', 0);
    const walk = (pid, depth) => {
      for (const n of bmKids(pid)) {
        if (n.type !== 'folder') continue;
        add(n.id, n.title, depth);
        walk(n.id, depth + 1);
      }
    };
    walk(null, 1);
    bmpFolders.replaceChildren(frag);
  }

  function bmShowError(text) {
    bmpError.textContent = text;
    bmpError.hidden = !text;
  }

  async function openBmPopover() {
    if (isAuthOpen() || state.isIncognito) return;
    if (bmPopOpen) { bmpName.focus(); bmpName.select(); return; }
    let info = null;
    let tree = null;
    try {
      [info, tree] = await Promise.all([window.browser.getCurrentBookmark(), window.browser.getBookmarksTree()]);
    } catch (_) { return; }
    if (!info || !info.ok || !tree || !tree.ok) return;
    applyBmTree(tree);
    bmBeginOverlay();
    bmPopOpen = true;
    bmPopTabId = state.activeId;
    bmPopParent = info.parentId || null;
    bmpTitle.textContent = info.bookmarked ? 'Закладка сохранена' : 'Закладка добавлена';
    bmpName.value = info.title || '';
    bmShowError('');
    renderBmFolderPicker();
    bmPopover.hidden = false;
    bookmarkBtn.setAttribute('aria-expanded', 'true');
    positionBmPopover();
    window.browser.setSitePopoverOpen(true);
    bmpName.focus();
    bmpName.select();
  }

  async function bmPopRun(action) {
    if (bmPopBusy) return;
    bmPopBusy = true;
    bmpDone.disabled = true;
    bmpRemove.disabled = true;
    let res = null;
    try { res = await action(); } catch (_) { res = null; }
    bmPopBusy = false;
    bmpDone.disabled = false;
    bmpRemove.disabled = false;
    if (res && res.ok) closeBmPopover();
    else bmShowError((res && res.error) || 'Не удалось выполнить действие.');
  }

  bmpDone.addEventListener('click', () => bmPopRun(() => window.browser.saveCurrentBookmark({ title: bmpName.value, parentId: bmPopParent })));
  bmpRemove.addEventListener('click', () => bmPopRun(() => window.browser.removeCurrentBookmark()));
  bmpName.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    bmpDone.click();
  });
  bmpFolders.addEventListener('click', (e) => {
    const b = e.target.closest('.bmp-folder');
    if (!b) return;
    bmPopParent = b.dataset.id || null;
    for (const el of bmpFolders.children) el.setAttribute('aria-selected', String((el.dataset.id || null) === bmPopParent));
  });

  // Звёздочка: открывает/закрывает поповер (main сам добавит страницу в корень, если её ещё нет в закладках)
  bookmarkBtn.setAttribute('aria-haspopup', 'dialog');
  bookmarkBtn.setAttribute('aria-expanded', 'false');
  bookmarkBtn.addEventListener('click', () => {
    if (bmPopOpen) closeBmPopover();
    else window.browser.openBookmarkPopover();
  });
  window.browser.onBookmarkPopover(() => { openBmPopover(); }); // Ctrl+D и звёздочка приходят отсюда

  // Клик вне оверлея (capture), Esc, потеря фокуса и ресайз закрывают меню/поповер
  document.addEventListener('mousedown', (e) => {
    if (bmMenuOpen && !bmMenu.contains(e.target) && !bmbarList.contains(e.target)) closeBmMenu();
    if (bmPopOpen && !bmPopover.contains(e.target) && !bookmarkBtn.contains(e.target)) closeBmPopover();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || isAuthOpen() || (!bmMenuOpen && !bmPopOpen)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const hadPopover = bmPopOpen;
    closeBmMenu();
    closeBmPopover();
    if (hadPopover && !bookmarkBtn.hidden) bookmarkBtn.focus();
  }, true);

  window.addEventListener('blur', () => { closeBmMenu(); closeBmPopover(); });
  window.addEventListener('resize', () => { closeBmMenu(); closeBmPopover(); });
  // main закрыл оверлей сам (смена вкладки, Инкогнито, меню): страницы он уже вернул
  window.browser.onSitePopoverClosed(() => { closeBmMenu({ keepPages: true }); closeBmPopover({ keepPages: true }); });

  // ==================== Карточка «Сохранить пароль?» (#pw-popover) ====================
  // main присылает { promptId, host, username }; пароль в окно интерфейса не попадает вообще.
  // Пока карточка открыта, страницы скрыты тем же каналом, что и у остальных оверлеев (setSitePopoverOpen).
  const pwPopover = document.getElementById('pw-popover');
  const pwpHost = document.getElementById('pwp-host');
  const pwpUser = document.getElementById('pwp-user');
  const pwpError = document.getElementById('pwp-error');
  const pwpSave = document.getElementById('pwp-save');
  const pwpDismiss = document.getElementById('pwp-dismiss');
  let pwOpen = false;
  let pwPromptId = null;
  let pwTabId = null;
  let pwBusy = false;

  function positionPwPopover() {
    const r = urlEl.getBoundingClientRect();
    const w = pwPopover.offsetWidth;
    pwPopover.style.left = `${Math.max(8, Math.min(Math.round(r.left), window.innerWidth - w - 8))}px`;
    pwPopover.style.top = `${Math.round(r.bottom + 8)}px`;
  }

  // opts.keepPages — страницы уже возвращены/останутся скрытыми; opts.dismiss — сообщить main, что запрос отклонён
  function closePwPopover(opts) {
    if (!pwOpen) return;
    const id = pwPromptId;
    pwOpen = false;
    pwPromptId = null;
    pwTabId = null;
    pwPopover.hidden = true;
    if (!(opts && opts.keepPages)) window.browser.setSitePopoverOpen(false);
    if (opts && opts.dismiss && id) window.browser.respondPasswordSave(id, 'dismiss');
  }

  function openPwPopover(p) {
    if (!p || typeof p.promptId !== 'string') return;
    if (state.isIncognito || isAuthOpen()) { window.browser.respondPasswordSave(p.promptId, 'dismiss'); return; }
    // Гасим остальные оверлеи без IPC: страницы остаются скрытыми, мигания нет
    closeSitePopover({ fromMain: true });
    closeWsPopover({ fromMain: true });
    closeBmMenu({ keepPages: true });
    closeBmPopover({ keepPages: true });
    pwOpen = true;
    pwPromptId = p.promptId;
    pwTabId = state.activeId;
    pwpHost.textContent = p.host;
    pwpUser.textContent = p.username ? `Логин: ${p.username}` : 'Без логина';
    pwpError.hidden = true;
    pwpError.textContent = '';
    pwpSave.hidden = false;
    pwpSave.disabled = false;
    pwpDismiss.textContent = 'Не сейчас';
    pwPopover.hidden = false;
    positionPwPopover();
    window.browser.setSitePopoverOpen(true);
    pwpSave.focus();
  }

  async function pwSave() {
    if (!pwOpen || pwBusy || !pwPromptId) return;
    const id = pwPromptId;
    pwPromptId = null; // main снимает запрос при первом же ответе
    pwBusy = true;
    pwpSave.disabled = true;
    let res = null;
    try { res = await window.browser.respondPasswordSave(id, 'save'); } catch (_) { res = null; }
    pwBusy = false;
    if (res && res.ok) { closePwPopover(); return; }
    pwpError.textContent = (res && res.error) || 'Не удалось сохранить пароль.';
    pwpError.hidden = false;
    pwpSave.hidden = true;
    pwpDismiss.textContent = 'Закрыть';
  }

  pwpSave.addEventListener('click', pwSave);
  pwpDismiss.addEventListener('click', () => closePwPopover({ dismiss: true }));

  // Клик вне карточки (capture) и Esc = «Не сейчас»; потеря фокуса окна карточку не закрывает, ресайз её переставляет
  document.addEventListener('mousedown', (e) => {
    if (pwOpen && !pwPopover.contains(e.target)) closePwPopover({ dismiss: true });
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !pwOpen || isAuthOpen()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closePwPopover({ dismiss: true });
  }, true);
  window.addEventListener('resize', () => { if (pwOpen) positionPwPopover(); });

  // main закрыл оверлей сам (смена вкладки, Инкогнито, таймаут): страницы он уже вернул, запрос снят
  window.browser.onSitePopoverClosed(() => closePwPopover({ keepPages: true }));
  window.browser.onPasswordSavePrompt(openPwPopover);

})();
