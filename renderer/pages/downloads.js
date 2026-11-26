// browser://downloads — страница загрузок. Мост window.downloadsApi подключается preload-скриптом внутренних страниц:
//   get() -> Promise<model>, action(type, id) -> Promise<{ ok, message, model }>, onChanged(cb) (необязательно)
(() => {
  'use strict';

  const api = window.downloadsApi;
  const $ = (id) => document.getElementById(id);
  const els = {
    shell: $('shell'), fatal: $('fatal'), list: $('list'), empty: $('empty'),
    emptyTitle: $('empty-title'), emptyHint: $('empty-hint'), search: $('search'),
    clear: $('btn-clear'), folder: $('btn-folder'), summary: $('summary'),
    notice: $('incognito-notice'), toast: $('toast')
  };

  function showFatal() {
    els.shell.hidden = true;
    els.fatal.hidden = false;
  }
  if (!api || typeof api.get !== 'function' || typeof api.action !== 'function') { showFatal(); return; }

  const POLL_BUSY_MS = 500;
  const POLL_IDLE_MS = 3000;
  const CLEAR_CONFIRM_MS = 4000;

  let model = { items: [], incognito: false, activeCount: 0, busy: false, totalSpeedText: '' };
  let query = '';
  let inflight = false;
  let queued = false;
  let pollTimer = null;
  let pushTimer = null;
  let toastTimer = null;
  let clearTimer = null;
  const rows = new Map(); // id -> { el, icon, name, meta, warn, bar, fill, actions, sig }
  let headings = new Map(); // подпись группы -> <li>

  // ---- Форматирование ----
  function fmtBytes(n) {
    if (!(n > 0)) return '0 Б';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    const s = i === 0 || v >= 100 ? String(Math.round(v)) : v.toFixed(1);
    return `${s.replace('.', ',')} ${units[i]}`;
  }

  function fmtEta(sec) {
    if (sec < 60) return `${sec} с`;
    if (sec < 3600) return `${Math.round(sec / 60)} мин`;
    const h = Math.floor(sec / 3600);
    return `${h} ч ${Math.round((sec % 3600) / 60)} мин`;
  }

  const dayStart = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };

  function groupLabel(ts) {
    if (!ts) return 'Ранее';
    const today = dayStart(Date.now());
    const day = dayStart(ts);
    const diff = Math.round((today - day) / 86400000);
    if (diff <= 0) return 'Сегодня';
    if (diff === 1) return 'Вчера';
    const d = new Date(ts);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('ru-RU', sameYear
      ? { day: 'numeric', month: 'long', weekday: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' });
  }

  const fmtTime = (ts) => (ts ? new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

  // ---- DOM-помощники (все тексты через textContent: имена файлов приходят из сети) ----
  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function toast(text, isError) {
    els.toast.textContent = text;
    els.toast.classList.toggle('error', Boolean(isError));
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  // ---- Строка загрузки ----
  const BUTTONS = [
    { flag: 'canResume', act: 'resume', label: 'Возобновить', cls: 'primary' },
    { flag: 'canPause', act: 'pause', label: 'Пауза' },
    { flag: 'canRetry', act: 'retry', label: 'Повторить', cls: 'primary' },
    { flag: 'canOpen', act: 'open', label: 'Открыть файл', cls: 'primary' },
    { flag: 'canShow', act: 'show', label: 'Показать в папке' },
    { flag: 'canReview', act: 'review', label: 'Что делать с файлом…' },
    { flag: 'canCancel', act: 'cancel', label: 'Отмена', cls: 'danger' },
    { flag: 'canRemove', act: 'remove', label: 'Убрать из списка' }
  ];

  function createRow() {
    const el = h('li', 'row');
    const icon = h('div', 'badge');
    icon.setAttribute('aria-hidden', 'true');
    const body = h('div', 'body');
    const name = h('div', 'name');
    const meta = h('div', 'meta');
    const warn = h('div', 'warn');
    warn.hidden = true;
    const bar = h('div', 'bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    const fill = document.createElement('i');
    bar.appendChild(fill);
    const actions = h('div', 'actions');
    body.append(name, meta, warn, bar, actions);
    el.append(icon, body);
    return { el, icon, name, meta, warn, bar, fill, actions, sig: null };
  }

  function sizeText(it) {
    if (it.total > 0) return `${fmtBytes(it.received)} из ${fmtBytes(it.total)}`;
    return it.received > 0 ? fmtBytes(it.received) : '';
  }

  // [статус, остальное]: статус красится через CSS по data-status
  function metaParts(it) {
    let st = '';
    const rest = [];
    switch (it.status) {
      case 'progressing':
        if (it.awaitingPath) { st = 'Ожидание выбора места сохранения…'; break; }
        st = it.percent >= 0 ? `${it.percent}%` : 'Загрузка…';
        rest.push(sizeText(it));
        if (it.speedText) rest.push(it.speedText);
        if (it.etaSec > 0) rest.push(`осталось ${fmtEta(it.etaSec)}`);
        break;
      case 'paused':
        st = 'Приостановлено';
        rest.push(sizeText(it));
        break;
      case 'completed':
        st = it.checking ? 'Проверка файла…' : (it.missing ? 'Файл удалён или перемещён' : 'Завершено');
        if (it.total > 0) rest.push(fmtBytes(it.total));
        break;
      case 'cancelled':
        st = 'Отменено';
        rest.push(sizeText(it));
        break;
      case 'interrupted':
        st = 'Прервано';
        rest.push(sizeText(it));
        break;
      case 'blocked':
        st = 'Заблокировано';
        if (it.total > 0) rest.push(fmtBytes(it.total));
        break;
      default:
        st = it.status;
    }
    if (it.host) rest.push(it.host);
    const time = fmtTime(it.endedAt || it.startedAt);
    if (time && it.status !== 'progressing' && it.status !== 'paused') rest.push(time);
    return { st, rest: rest.filter(Boolean) };
  }

  function setMeta(row, it) {
    const { st, rest } = metaParts(it);
    const key = `${st}\u0001${rest.join('\u0001')}`;
    if (row.metaKey === key) return;
    row.metaKey = key;
    row.meta.textContent = '';
    row.meta.appendChild(h('span', 'st', st));
    if (rest.length) row.meta.appendChild(document.createTextNode(` · ${rest.join(' · ')}`));
  }

  function updateRow(row, it) {
    row.el.dataset.id = String(it.id);
    row.el.dataset.status = it.status;
    row.el.dataset.missing = it.missing ? 'true' : 'false';
    setText(row.icon, it.ext || '•');
    setText(row.name, it.name);
    row.name.title = it.name;
    setMeta(row, it);

    const warnText = it.status === 'blocked' || it.reason ? it.reason : '';
    setText(row.warn, warnText);
    row.warn.hidden = !warnText;

    const live = it.status === 'progressing' || it.status === 'paused';
    row.bar.hidden = !live;
    if (live) {
      const unknown = it.percent < 0;
      row.bar.classList.toggle('indeterminate', unknown && it.status === 'progressing');
      const p = unknown ? 0 : it.percent;
      row.fill.style.setProperty('transform', unknown && it.status === 'progressing' ? 'none' : `scaleX(${p / 100})`);
      if (unknown) row.bar.removeAttribute('aria-valuenow');
      else row.bar.setAttribute('aria-valuenow', String(p));
      row.bar.setAttribute('aria-label', `Загрузка ${it.name}`);
    }

    const sig = BUTTONS.map((b) => (it[b.flag] ? '1' : '0')).join('');
    if (sig !== row.sig) {
      row.sig = sig;
      row.actions.textContent = '';
      for (const b of BUTTONS) {
        if (!it[b.flag]) continue;
        const btn = h('button', `btn sm${b.cls ? ` ${b.cls}` : ''}`, b.label);
        btn.type = 'button';
        btn.dataset.act = b.act;
        row.actions.appendChild(btn);
      }
    }
  }

  // ---- Список ----
  function reconcile(parent, desired) {
    let ref = parent.firstChild;
    for (const node of desired) {
      if (node === ref) ref = ref.nextSibling;
      else parent.insertBefore(node, ref);
    }
    while (ref) {
      const next = ref.nextSibling;
      parent.removeChild(ref);
      ref = next;
    }
  }

  function heading(label, next) {
    let el = headings.get(label) || next.get(label);
    if (!el) { el = h('li', 'group', label); el.setAttribute('role', 'presentation'); }
    next.set(label, el);
    return el;
  }

  function renderSummary() {
    const total = model.items.length;
    const parts = [];
    if (model.activeCount > 0) {
      parts.push(`Активных: ${model.activeCount}`);
      if (model.totalSpeedText) parts.push(model.totalSpeedText);
    } else if (total > 0) {
      parts.push('Активных загрузок нет');
    }
    if (total > 0) parts.push(`Всего: ${total}`);
    setText(els.summary, parts.join(' · '));
  }

  function render() {
    els.notice.hidden = !model.incognito;
    const q = query.trim().toLowerCase();
    const visible = model.items.filter((it) =>
      !q || it.name.toLowerCase().includes(q) || (it.host || '').toLowerCase().includes(q));

    const desired = [];
    const used = new Set();
    const nextHeadings = new Map();
    let lastGroup = null;
    for (const it of visible) {
      const g = groupLabel(it.startedAt || it.endedAt);
      if (g !== lastGroup) { desired.push(heading(g, nextHeadings)); lastGroup = g; }
      let row = rows.get(it.id);
      if (!row) { row = createRow(); rows.set(it.id, row); }
      updateRow(row, it);
      desired.push(row.el);
      used.add(it.id);
    }
    for (const id of Array.from(rows.keys())) if (!used.has(id)) rows.delete(id);
    headings = nextHeadings;
    reconcile(els.list, desired);

    const empty = visible.length === 0;
    els.empty.hidden = !empty;
    if (empty) {
      if (model.items.length === 0) {
        setText(els.emptyTitle, 'Загрузок пока нет');
        setText(els.emptyHint, 'Файлы, которые вы скачаете, появятся здесь.');
      } else {
        setText(els.emptyTitle, 'Ничего не найдено');
        setText(els.emptyHint, 'Измените запрос: поиск идёт по имени файла и сайту.');
      }
    }
    els.clear.disabled = !model.items.some((it) => it.canRemove);
    renderSummary();
  }

  // ---- Обмен с main ----
  function schedule() {
    clearTimeout(pollTimer);
    if (document.hidden) return;
    pollTimer = setTimeout(refresh, model.busy ? POLL_BUSY_MS : POLL_IDLE_MS);
  }

  async function refresh() {
    if (inflight) { queued = true; return; }
    inflight = true;
    try {
      const m = await api.get();
      if (m === null) { showFatal(); return; }
      if (m && Array.isArray(m.items)) { model = m; render(); }
    } catch {
      /* страница закрывается или main недоступен: повторим на следующем тике */
    } finally {
      inflight = false;
      if (queued) { queued = false; refresh(); } else schedule();
    }
  }

  async function act(type, id) {
    try {
      const res = await api.action(type, id === undefined ? null : id);
      if (res && res.model && Array.isArray(res.model.items)) { model = res.model; render(); } else refresh();
      if (res && res.ok === false && res.message) toast(res.message, true);
      return res;
    } catch {
      toast('Не удалось выполнить действие', true);
      return null;
    }
  }

  // ---- События ----
  els.list.addEventListener('click', (ev) => {
    const btn = ev.target instanceof Element ? ev.target.closest('button[data-act]') : null;
    if (!btn) return;
    const li = btn.closest('li.row');
    const id = li ? Number(li.dataset.id) : NaN;
    if (!Number.isInteger(id)) return;
    btn.disabled = true; // защита от двойного клика; следующий рендер обновит кнопки
    act(btn.dataset.act, id).finally(() => { btn.disabled = false; });
  });

  els.search.addEventListener('input', () => { query = els.search.value; render(); });
  els.search.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && els.search.value) {
      ev.preventDefault();
      els.search.value = '';
      query = '';
      render();
    }
  });

  els.folder.addEventListener('click', () => { act('open-folder'); });

  function disarmClear() {
    clearTimeout(clearTimer);
    clearTimer = null;
    els.clear.classList.remove('armed');
    els.clear.textContent = 'Очистить историю';
  }

  els.clear.addEventListener('click', async () => {
    if (!clearTimer) {
      els.clear.classList.add('armed');
      els.clear.textContent = 'Нажмите ещё раз для подтверждения';
      clearTimer = setTimeout(disarmClear, CLEAR_CONFIRM_MS);
      return;
    }
    disarmClear();
    const res = await act('clear');
    if (res && res.ok) toast('История очищена. Скачанные файлы на диске не тронуты');
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(pollTimer);
    else refresh();
  });

  if (typeof api.onChanged === 'function') {
    api.onChanged(() => {
      clearTimeout(pushTimer);
      pushTimer = setTimeout(refresh, 80);
    });
  }

  render();
  refresh();
})();
