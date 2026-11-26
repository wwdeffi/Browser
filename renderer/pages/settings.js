'use strict';

(() => {
  const api = window.settingsApi;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const SECTIONS = ['general', 'privacy', 'network', 'permissions', 'data', 'bookmarks', 'passwords', 'extensions', 'about'];
  const SLEEP_OPTIONS = [
    [0, 'Отключено'], [1, '1 минута'], [5, '5 минут'], [15, '15 минут'], [30, '30 минут'], [60, '60 минут']
  ];

  const rulesEl = $('#rules');
  const saveBtn = $('#btn-save-rules');
  let rulesSaved = '';
  let rulesBusy = false;
  let toastTimer = null;

  function toast(message, isError) {
    const el = $('#toast');
    el.textContent = message;
    el.classList.toggle('error', Boolean(isError));
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function showSection() {
    const id = location.hash.slice(1);
    const name = SECTIONS.includes(id) ? id : SECTIONS[0];
    $$('.section').forEach((el) => { el.hidden = el.dataset.section !== name; });
    $$('.nav-item').forEach((a) => {
      const on = a.dataset.section === name;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (name === 'permissions') loadPermissions();
    if (name === 'extensions') loadExtensions();
    if (name === 'about' && typeof refreshUpdater === 'function') refreshUpdater();
    if (name === 'passwords') loadPasswords();
    else pwWipe(); // при уходе из раздела показанные пароли не остаются в DOM
  }

  function fillEngines(engines) {
    const sel = $('#sel-engine');
    const key = engines.map((e) => e.key).join(',');
    if (sel.dataset.keys === key) return;
    sel.dataset.keys = key;
    sel.replaceChildren(...engines.map((e) => new Option(e.name, e.key)));
  }

  function fillSleep(value) {
    const sel = $('#sel-sleep');
    if (!sel.options.length) {
      sel.replaceChildren(...SLEEP_OPTIONS.map(([v, label]) => new Option(label, String(v))));
    }
    // нестандартное значение из файла настроек (например, 10) не теряем
    if (!Array.from(sel.options).some((o) => o.value === String(value))) {
      sel.add(new Option(`${value} мин`, String(value)));
    }
    sel.value = String(value);
  }

  // Режим Инкогнито: предупреждение и блокировка очистки данных обычной сессии (то же проверяет main)
  let incognitoMode = false;
  const isClearLocked = (kind) => incognitoMode && kind === 'history';

  function applyIncognito(inc) {
    incognitoMode = Boolean(inc);
    $('#incognito-notice').hidden = !incognitoMode;
    $('#incognito-data-note').hidden = !incognitoMode;
    const bmNote = $('#incognito-bm-note');
    if (bmNote) bmNote.hidden = !incognitoMode;
    $$('[data-clear]').forEach((btn) => {
      const locked = isClearLocked(btn.dataset.clear);
      btn.disabled = locked;
      btn.title = locked ? 'Недоступно в режиме Инкогнито: историю обычного режима нельзя очистить отсюда' : '';
      if (locked) btn.textContent = 'Очистить';
    });
    // Импорт и экспорт работают с постоянными закладками обычного режима — в Инкогнито блокируем
    for (const id of ['#btn-bm-import', '#btn-bm-export']) {
      const el = $(id);
      if (!el) continue;
      el.disabled = incognitoMode;
      el.title = incognitoMode ? 'Недоступно в режиме Инкогнито: закладки обычного режима отсюда не изменить и не выгрузить' : '';
    }
  }

  // Эффективное состояние режима (с учётом батареи) приходит из main; между обновлениями помним последнее
  let energyActive = false;
  function setEnergyActive(active) {
    energyActive = Boolean(active);
    $('#energy-status').textContent = energyActive ? 'Сейчас: активен' : 'Сейчас: не активен';
  }

  function render(p) {
    if (!p || !p.settings) return;
    applyIncognito(p.incognito);
    const s = p.settings;
    const root = document.documentElement;
    root.dataset.theme = p.resolvedTheme === 'light' ? 'light' : 'dark';
    root.dataset.chromeTheme = p.chromeTheme || 'cyber-blue';

    fillEngines(Array.isArray(p.engines) ? p.engines : []);
    $('#sel-engine').value = s.searchEngine;
    fillSleep(s.sleepMinutes);
    $('#sel-energy').value = ['auto', 'on', 'off'].includes(s.energySaver) ? s.energySaver : 'auto';
    setEnergyActive(typeof p.energySaverActive === 'boolean' ? p.energySaverActive : energyActive);
    renderDoh(s);
    renderProxy(s);

    $$('[data-seg="theme"] [data-value]').forEach((b) => {
      b.setAttribute('aria-checked', String(b.dataset.value === s.theme));
    });
    $$('[data-toggle]').forEach((b) => {
      b.setAttribute('aria-checked', String(Boolean(s[b.dataset.toggle])));
    });

    $('#blocked-count').textContent = Number(p.blockedCount || 0).toLocaleString('ru-RU');
    $('#adblock-off-note').hidden = Boolean(s.adblock);
    // Косметика имеет смысл только вместе с блокировкой рекламы
    const cosmetic = $('[data-toggle="adblockCosmetic"]');
    if (cosmetic) {
      cosmetic.disabled = !s.adblock;
      cosmetic.title = s.adblock ? '' : 'Сначала включите блокировку рекламы и трекеров';
    }
  }

  async function update(patch) {
    try {
      render(await api.update(patch));
      return true;
    } catch {
      toast('Не удалось сохранить настройку', true);
      return false;
    }
  }

  // ---- DNS-over-HTTPS ----
  const DOH_URL_MAX = 2048;
  let dohPending = false; // выбран «Свой адрес», но валидный URL ещё не сохранён

  // Зеркало проверки в main (doh.js): только https://, хост, без логина/пароля и #фрагмента, суффикс {?dns} допустим
  function validateDohUrl(raw) {
    const s = String(raw || '').trim();
    if (!s) return { ok: false, error: 'Введите адрес DoH-сервера' };
    if (s.length > DOH_URL_MAX) return { ok: false, error: 'Адрес слишком длинный' };
    const tmpl = /\{\?dns\}$/.exec(s);
    const base = tmpl ? s.slice(0, -tmpl[0].length) : s;
    if (/[\s{}]/.test(base)) return { ok: false, error: 'Адрес содержит недопустимые символы' };
    let u;
    try { u = new URL(base); } catch { return { ok: false, error: 'Некорректный URL. Пример: https://dns.example.com/dns-query' }; }
    if (u.protocol !== 'https:') return { ok: false, error: 'Допустим только адрес с https://' };
    if (!u.hostname) return { ok: false, error: 'В адресе нет имени сервера' };
    if (u.username || u.password) return { ok: false, error: 'Не указывайте логин и пароль в адресе' };
    if (u.hash || (tmpl && u.search)) return { ok: false, error: 'Уберите из адреса фрагмент (#) и лишние параметры' };
    return { ok: true, value: tmpl ? `${u.href}{?dns}` : u.href };
  }

  function setDohError(message) {
    const inp = $('#inp-doh-url');
    $('#doh-url-error').textContent = message || '';
    if (message) inp.setAttribute('aria-invalid', 'true');
    else inp.removeAttribute('aria-invalid');
  }

  function showDohCustom(show) {
    $('#doh-custom-wrap').hidden = !show;
  }

  function renderDoh(s) {
    const off = s.dohMode === 'off';
    $('#sel-doh-mode').value = ['automatic', 'secure', 'off'].includes(s.dohMode) ? s.dohMode : 'automatic';
    if (s.dohProvider === 'custom') dohPending = false;
    const provider = dohPending ? 'custom' : s.dohProvider;
    const sel = $('#sel-doh-provider');
    sel.value = Array.from(sel.options).some((o) => o.value === provider) ? provider : 'cloudflare';
    sel.disabled = off;
    const inp = $('#inp-doh-url');
    if (s.dohCustomUrl && document.activeElement !== inp) inp.value = s.dohCustomUrl;
    inp.disabled = off;
    $('#btn-doh-save').disabled = off;
    showDohCustom(provider === 'custom');
  }

  async function saveDohCustom() {
    const r = validateDohUrl($('#inp-doh-url').value);
    setDohError(r.ok ? '' : r.error);
    if (!r.ok) return;
    dohPending = false;
    if (await update({ dohProvider: 'custom', dohCustomUrl: r.value })) toast('DNS-over-HTTPS применён');
  }

  // ---- Сеть и Прокси ----
  const PROXY_DEFAULT_BYPASS = 'localhost,127.0.0.1';
  let proxyPending = false; // выбран «Ручной», но валидная конфигурация ещё не сохранена

  // Зеркало проверки в main (proxy.js)
  function validateProxyForm() {
    const rawHost = $('#inp-proxy-host').value.trim();
    let host = null;
    if (/^\[[0-9a-f:.]+\]$/i.test(rawHost)) host = rawHost.toLowerCase();
    else if (rawHost.includes(':') && /^[0-9a-f:.]+$/i.test(rawHost)) host = `[${rawHost.toLowerCase()}]`;
    else if (rawHost.length <= 253 && /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/i.test(rawHost)) host = rawHost.toLowerCase();
    if (!host) return { ok: false, error: rawHost ? 'Некорректный хост прокси (без http://, пути и пробелов)' : 'Укажите хост прокси' };
    const rawPort = $('#inp-proxy-port').value.trim();
    const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : 0;
    if (port < 1 || port > 65535) return { ok: false, error: 'Порт должен быть числом от 1 до 65535' };
    const parts = $('#inp-proxy-bypass').value.split(/[,;\s]+/).filter(Boolean);
    if (parts.length > 128 || parts.some((p) => p.length > 255 || !/^[\w.\-*:/[\]<>]+$/.test(p))) {
      return { ok: false, error: 'Некорректный список обхода прокси' };
    }
    return {
      ok: true,
      patch: {
        proxyMode: 'manual',
        proxyProtocol: $('#sel-proxy-protocol').value === 'socks5' ? 'socks5' : 'http',
        proxyHost: host,
        proxyPort: port,
        proxyBypassRules: parts.join(','),
        proxyIncognitoOnly: $('#chk-proxy-incognito').checked
      }
    };
  }

  function setProxyError(message) {
    const el = $('#proxy-error');
    el.textContent = message || '';
    el.hidden = !message;
  }

  function renderProxy(s) {
    const saved = ['system', 'direct', 'manual'].includes(s.proxyMode) ? s.proxyMode : 'system';
    if (saved === 'manual') proxyPending = false;
    const mode = proxyPending ? 'manual' : saved;
    $('#sel-proxy-mode').value = mode;
    const form = $('#proxy-manual-wrap');
    form.hidden = mode !== 'manual';
    if (!form.contains(document.activeElement)) {
      $('#sel-proxy-protocol').value = s.proxyProtocol === 'socks5' ? 'socks5' : 'http';
      $('#inp-proxy-host').value = s.proxyHost || '';
      $('#inp-proxy-port').value = s.proxyPort ? String(s.proxyPort) : '';
      $('#inp-proxy-bypass').value = typeof s.proxyBypassRules === 'string' ? s.proxyBypassRules : PROXY_DEFAULT_BYPASS;
      $('#chk-proxy-incognito').checked = Boolean(s.proxyIncognitoOnly);
    }
    let status = 'Сейчас: системные настройки прокси';
    if (saved === 'manual') {
      status = s.proxyIncognitoOnly
        ? 'Сейчас: прокси только в Инкогнито, обычный режим — системное соединение'
        : 'Сейчас: все окна идут через прокси';
    } else if (saved === 'direct') {
      status = 'Сейчас: соединение напрямую, без прокси';
    }
    $('#proxy-status').textContent = status;
  }

  async function sendProxy(patch) {
    try {
      const p = await api.update(patch);
      render(p);
      if (p && p.proxyError) { setProxyError(p.proxyError); return false; }
      setProxyError('');
      toast('Настройки прокси применены');
      return true;
    } catch {
      toast('Не удалось сохранить настройки прокси', true);
      return false;
    }
  }

  async function saveProxyManual() {
    const r = validateProxyForm();
    setProxyError(r.ok ? '' : r.error);
    if (!r.ok) return;
    proxyPending = false;
    await sendProxy(r.patch);
  }

  function updateRulesMeta() {
    const dirty = rulesEl.value !== rulesSaved;
    const count = rulesEl.value.split('\n').filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('!') && !t.startsWith('[');
    }).length;
    $('#rules-meta').textContent = rulesBusy
      ? 'Применяю правила…'
      : `Правил: ${count}${dirty ? ' · есть несохранённые изменения' : ''}`;
    saveBtn.disabled = rulesBusy || !dirty;
  }

  async function loadRules() {
    try {
      rulesSaved = await api.getRules();
      rulesEl.value = rulesSaved;
    } catch {
      toast('Не удалось прочитать custom-filters.txt', true);
    }
    updateRulesMeta();
  }

  async function saveRules() {
    if (rulesBusy || rulesEl.value === rulesSaved) return;
    const text = rulesEl.value;
    rulesBusy = true;
    updateRulesMeta();
    try {
      const res = await api.saveRules(text);
      if (res && res.ok) {
        rulesSaved = text;
        toast('Правила сохранены и применены');
      } else {
        toast((res && res.error) || 'Не удалось сохранить правила', true);
      }
    } catch {
      toast('Не удалось сохранить правила', true);
    } finally {
      rulesBusy = false;
      updateRulesMeta();
    }
  }

  // ---- Разрешения сайтов ----
  const MEDIA_LABELS = { audio: 'Микрофон', video: 'Камера' };
  const STATE_LABELS = { allow: 'разрешено', deny: 'заблокировано' };

  function permRow(item) {
    const row = document.createElement('div');
    row.className = 'row';
    const text = document.createElement('div');
    text.className = 'row-text';
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = item.origin; // textContent: origin из файла не попадает в разметку
    const hint = document.createElement('div');
    hint.className = 'row-hint';
    hint.textContent = ['audio', 'video'].filter((k) => item[k])
      .map((k) => `${MEDIA_LABELS[k]}: ${STATE_LABELS[item[k]]}`).join(' · ');
    text.append(title, hint);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Сбросить';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await api.removeMediaPermission(item.origin); } catch { toast('Не удалось сбросить разрешение', true); }
      loadPermissions();
    });
    row.append(text, btn);
    return row;
  }

  async function loadPermissions() {
    try {
      const items = await api.listMediaPermissions();
      $('#perm-list').replaceChildren(...items.map(permRow));
      $('#perm-list').hidden = !items.length;
      $('#perm-empty').hidden = items.length > 0;
    } catch {
      toast('Не удалось загрузить разрешения', true);
    }
  }

  // ---- Очистка данных: двухшаговое подтверждение кнопкой ----
  const CLEAR_API = { cache: 'clearCache', history: 'clearHistory', 'site-data': 'clearSiteData' };

  function bindClear() {
    $$('[data-clear]').forEach((btn) => {
      const kind = btn.dataset.clear;
      const status = $(`[data-clear-status="${kind}"]`);
      let armed = null;
      const disarm = () => { clearTimeout(armed); armed = null; btn.textContent = 'Очистить'; };
      btn.addEventListener('click', async () => {
        if (isClearLocked(kind)) { status.textContent = 'Недоступно в Инкогнито'; return; }
        if (!armed) {
          status.textContent = '';
          btn.textContent = 'Подтвердить';
          armed = setTimeout(disarm, 4000);
          return;
        }
        disarm();
        btn.disabled = true;
        try {
          const res = await api[CLEAR_API[kind]]();
          if (res && res.blocked) status.textContent = 'Недоступно в Инкогнито';
          else if (res && res.ok) status.textContent = res.incognito ? 'Готово (только Инкогнито)' : 'Готово';
          else status.textContent = 'Ошибка';
        } catch {
          status.textContent = 'Ошибка';
          toast('Не удалось очистить данные', true);
        } finally {
          btn.disabled = isClearLocked(kind);
          setTimeout(() => { status.textContent = ''; }, 3000);
        }
      });
    });
  }

  // ---- Закладки ----
  // ---- Расширения ----
  function extRow(it) {
    const row = document.createElement('div');
    row.className = 'row';
    const text = document.createElement('div');
    text.className = 'row-text';
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = it.loaded ? `${it.name} ${it.version}`.trim() : 'Не загружено';
    const hint = document.createElement('div');
    hint.className = 'row-hint';
    hint.textContent = it.loaded ? it.path : `${it.error} — ${it.path}`;
    text.append(title, hint);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn danger';
    del.textContent = 'Удалить';
    del.addEventListener('click', async () => {
      del.disabled = true;
      try {
        const res = await api.removeExtension(it.path);
        if (res && res.ok) toast('Расширение удалено');
        else toast((res && res.error) || 'Не удалось удалить расширение', true);
      } catch {
        toast('Не удалось удалить расширение', true);
      }
      loadExtensions();
    });
    row.append(text, del);
    return row;
  }

  async function loadExtensions() {
    try {
      const items = (await api.listExtensions()) || [];
      $('#ext-list').replaceChildren(...items.map(extRow));
      $('#ext-list').hidden = !items.length;
      $('#ext-empty').hidden = items.length > 0;
    } catch {
      toast('Не удалось загрузить список расширений', true);
    }
  }

  function bindExtensions() {
    $('#btn-ext-add').addEventListener('click', async () => {
      try {
        const res = await api.addExtension();
        if (!res || res.canceled) return;
        if (res.blocked) { toast('Недоступно в режиме Инкогнито', true); return; }
        if (!res.ok) { toast(res.error || 'Не удалось загрузить расширение', true); return; }
        toast('Расширение добавлено');
      } catch {
        toast('Не удалось загрузить расширение', true);
      }
      loadExtensions();
    });
  }

  // ---- Обновления ----
  let updPoll = null;
  async function refreshUpdater() {
    try { applyUpdaterState(await api.getUpdaterState()); } catch { /* ignore */ }
  }

  function applyUpdaterState(s) {
    if (!s) return;
    $('#upd-current').textContent = s.currentVersion || '';
    if (s.message) $('#upd-status').textContent = s.message;
    $('#btn-upd-check').disabled = Boolean(s.busy);
    $('#btn-upd-download').hidden = s.status !== 'available';
    $('#btn-upd-download').disabled = Boolean(s.busy);
    $('#btn-upd-install').hidden = s.status !== 'downloaded';
    if (s.status === 'downloading' && !updPoll) updPoll = setInterval(refreshUpdater, 500);
    else if (s.status !== 'downloading' && updPoll) { clearInterval(updPoll); updPoll = null; }
  }

  function bindUpdates() {
    $('#btn-upd-check').addEventListener('click', async () => {
      $('#btn-upd-check').disabled = true;
      $('#upd-status').textContent = 'Проверяю обновления…';
      try { applyUpdaterState(await api.checkUpdates()); }
      catch { toast('Не удалось проверить обновления', true); $('#btn-upd-check').disabled = false; }
    });
    $('#btn-upd-download').addEventListener('click', async () => {
      const p = api.downloadUpdate();
      setTimeout(refreshUpdater, 150); // запускает опрос прогресса
      try { applyUpdaterState(await p); }
      catch { toast('Не удалось загрузить обновление', true); }
    });
    $('#btn-upd-install').addEventListener('click', async () => {
      try { await api.installUpdate(); } catch { toast('Не удалось запустить установку', true); }
    });
    refreshUpdater();
  }

  function bindBookmarks() {
    const out = $('#bm-status');
    $('#btn-bm-import').addEventListener('click', async () => {
      try {
        const res = await api.importBookmarks();
        if (res.canceled) return;
        if (res.blocked) { toast('Недоступно в режиме Инкогнито', true); return; }
        if (!res.ok) { toast(res.error || 'Не удалось импортировать', true); return; }
        out.textContent = `Импортировано ссылок: ${res.added}` +
          (res.duplicates ? ` (уже были: ${res.duplicates})` : '');
      } catch {
        toast('Не удалось импортировать закладки', true);
      }
    });
    $('#btn-bm-export').addEventListener('click', async () => {
      try {
        const res = await api.exportBookmarks();
        if (res.canceled) return;
        if (res.blocked) { toast('Недоступно в режиме Инкогнито', true); return; }
        if (!res.ok) { toast(res.error || 'Не удалось экспортировать', true); return; }
        out.textContent = `Экспортировано ссылок: ${res.count}`;
      } catch {
        toast('Не удалось экспортировать закладки', true);
      }
    });
  }

  // ---- Пароли и автозаполнение ----
  const pwApi = window.passwordsApi;
  const PW_AUTOHIDE_MS = 30000;
  let pwItems = [];
  let pwBlocked = false;

  // Ошибка всегда с готовым текстом для пользователя
  async function pwReveal(id) {
    let res;
    try { res = await pwApi.reveal(id); } catch { throw new Error('Не удалось получить пароль'); }
    if (res && res.ok && typeof res.password === 'string') return res.password;
    throw new Error((res && res.error) || 'Не удалось получить пароль');
  }

  function pwBtn(label, extra) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = extra ? `btn ${extra}` : 'btn';
    b.textContent = label;
    return b;
  }

  function pwRow(item) {
    const row = document.createElement('div');
    row.className = 'row pw-row';

    const text = document.createElement('div');
    text.className = 'row-text';
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = item.host; // textContent: данные из файла не попадают в разметку
    title.title = item.origin;
    const hint = document.createElement('div');
    hint.className = 'row-hint';
    const d = new Date(item.updatedAt);
    hint.textContent = [
      item.username || 'без логина',
      Number.isFinite(d.getTime()) && item.updatedAt > 0 ? `обновлён ${d.toLocaleDateString('ru-RU')}` : ''
    ].filter(Boolean).join(' · ');
    const secret = document.createElement('div');
    secret.className = 'row-hint pw-secret';
    secret.hidden = true;
    text.append(title, hint, secret);

    const actions = document.createElement('div');
    actions.className = 'pw-actions';
    const showBtn = pwBtn('Показать');
    const copyBtn = pwBtn('Копировать');
    const delBtn = pwBtn('Удалить', 'danger');
    actions.append(showBtn, copyBtn, delBtn);

    // Показать / скрыть (автоскрытие через 30 с, пароль в памяти страницы не кэшируется)
    let hideTimer = null;
    const hide = () => {
      clearTimeout(hideTimer);
      secret.hidden = true;
      secret.textContent = '';
      showBtn.textContent = 'Показать';
      showBtn.setAttribute('aria-pressed', 'false');
    };
    showBtn.setAttribute('aria-pressed', 'false');
    showBtn.addEventListener('click', async () => {
      if (!secret.hidden) { hide(); return; }
      showBtn.disabled = true;
      try {
        secret.textContent = await pwReveal(item.id);
        secret.hidden = false;
        showBtn.textContent = 'Скрыть';
        showBtn.setAttribute('aria-pressed', 'true');
        hideTimer = setTimeout(hide, PW_AUTOHIDE_MS);
      } catch (e) {
        toast(e.message, true);
      } finally {
        showBtn.disabled = false;
      }
    });

    copyBtn.addEventListener('click', async () => {
      copyBtn.disabled = true;
      try {
        // Пароль копирует main и сам очищает буфер через 30 с: в renderer он не попадает
        let res;
        try { res = await pwApi.copy(item.id); } catch { res = null; }
        if (!res || !res.ok) throw new Error((res && res.error) || 'Не удалось скопировать в буфер обмена');
        toast('Пароль скопирован, буфер очистится через 30 с');
      } catch (e) {
        toast(e.message, true);
      } finally {
        copyBtn.disabled = false;
      }
    });

    // Удаление: двухшаговое подтверждение, как в «Очистке данных»
    let armed = null;
    const disarm = () => {
      clearTimeout(armed);
      armed = null;
      delBtn.textContent = 'Удалить';
      delBtn.classList.remove('armed');
    };
    delBtn.addEventListener('click', async () => {
      if (!armed) {
        delBtn.textContent = 'Подтвердить';
        delBtn.classList.add('armed');
        armed = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      delBtn.disabled = true;
      try {
        const res = await pwApi.remove(item.id);
        if (res && res.ok) toast('Пароль удалён');
        else toast((res && res.error) || 'Не удалось удалить пароль', true);
      } catch {
        toast('Не удалось удалить пароль', true);
      }
      loadPasswords();
    });

    row.append(text, actions);
    return row;
  }

  function renderPasswords() {
    const q = $('#pw-search').value.trim().toLowerCase();
    const shown = q
      ? pwItems.filter((i) => i.origin.toLowerCase().includes(q) || i.username.toLowerCase().includes(q))
      : pwItems;
    const list = $('#pw-list');
    list.replaceChildren(...shown.map(pwRow));
    list.hidden = shown.length === 0;
    const empty = $('#pw-empty');
    empty.hidden = shown.length > 0;
    empty.textContent = pwBlocked
      ? 'Недоступно в режиме Инкогнито.'
      : (pwItems.length ? 'Ничего не найдено.' : 'Сохранённых паролей нет.');
    $('#pw-count').textContent = pwItems.length
      ? (q ? `${shown.length} из ${pwItems.length}` : `Записей: ${pwItems.length}`)
      : '';
    $('#btn-pw-clear').disabled = pwBlocked || !pwItems.length;
  }

  async function loadPasswords() {
    if (!pwApi) { toast('Менеджер паролей недоступен', true); return; }
    try {
      const res = await pwApi.list();
      if (!res) throw new Error('no data');
      pwBlocked = Boolean(res.blocked);
      pwItems = Array.isArray(res.items) ? res.items : [];
      $('#pw-blocked-note').hidden = !pwBlocked;
      $('#pw-unavailable-note').hidden = pwBlocked || res.available !== false;
      $('#pw-search').disabled = pwBlocked;
      $('#btn-pw-import').disabled = pwBlocked || res.available === false;
    } catch {
      pwItems = [];
      toast('Не удалось загрузить пароли', true);
    }
    renderPasswords();
  }

  function pwWipe() {
    pwItems = [];
    $('#pw-list').replaceChildren();
    $('#pw-import-status').hidden = true;
  }

  function bindPasswords() {
    $('#pw-search').addEventListener('input', renderPasswords);

    const impBtn = $('#btn-pw-import');
    const impStatus = $('#pw-import-status');
    const showImport = (msg, isError) => {
      impStatus.textContent = msg;
      impStatus.hidden = false;
      toast(msg, isError);
    };
    impBtn.addEventListener('click', async () => {
      if (!pwApi) { toast('Менеджер паролей недоступен', true); return; }
      impBtn.disabled = true;
      try {
        const res = await pwApi.importCsv();
        if (res && res.canceled) { /* диалог закрыт */ }
        else if (res && res.ok) {
          let msg = `Импортировано: ${res.imported}, обновлено: ${res.updated}, пропущено: ${res.skipped}`;
          if (res.deleted) msg += '. Исходный файл удалён';
          else if (res.deleteError) msg += '. Не удалось удалить исходный файл';
          showImport(msg, Boolean(res.deleteError));
        } else {
          showImport((res && res.error) || 'Не удалось импортировать пароли', true);
        }
      } catch {
        showImport('Не удалось импортировать пароли', true);
      }
      loadPasswords(); // обновит список и состояние кнопки
    });

    const btn = $('#btn-pw-clear');
    let armed = null;
    const disarm = () => {
      clearTimeout(armed);
      armed = null;
      btn.textContent = 'Удалить все';
      btn.classList.remove('armed');
    };
    btn.addEventListener('click', async () => {
      if (!armed) {
        btn.textContent = 'Подтвердить';
        btn.classList.add('armed');
        armed = setTimeout(disarm, 4000);
        return;
      }
      disarm();
      btn.disabled = true;
      try {
        const res = await pwApi.clear();
        if (res && res.ok) toast(`Удалено паролей: ${res.removed}`);
        else toast((res && res.error) || 'Не удалось удалить пароли', true);
      } catch {
        toast('Не удалось удалить пароли', true);
      }
      loadPasswords();
    });
  }

  function bind() {
    document.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-toggle]');
      if (sw) {
        const next = sw.getAttribute('aria-checked') !== 'true';
        sw.setAttribute('aria-checked', String(next));
        update({ [sw.dataset.toggle]: next });
        if (sw.dataset.toggle === 'blockThirdPartyCookies') toast('Разделение хранилища по сайтам применится после перезапуска');
        if (sw.dataset.toggle === 'incognitoFingerprintProtection') {
          toast(next ? 'Защита включена для Инкогнито. Открытые страницы лучше перезагрузить; некоторые сайты могут работать некорректно' : 'Защита от fingerprinting выключена');
        }
        if (sw.dataset.toggle === 'incognitoNewWindow') {
          toast(next ? 'Инкогнито будет открываться в отдельном окне' : 'Инкогнито будет переключаться в текущем окне');
        }
        return;
      }
      const seg = e.target.closest('[data-seg="theme"] [data-value]');
      if (seg) update({ theme: seg.dataset.value });
    });

    $('#sel-engine').addEventListener('change', (e) => update({ searchEngine: e.target.value }));
    $('#sel-sleep').addEventListener('change', (e) => update({ sleepMinutes: Number(e.target.value) }));
    $('#sel-energy').addEventListener('change', (e) => update({ energySaver: e.target.value }));

    $('#sel-doh-mode').addEventListener('change', async (e) => {
      if (await update({ dohMode: e.target.value })) toast('DNS-over-HTTPS применён');
    });
    $('#sel-doh-provider').addEventListener('change', async (e) => {
      const value = e.target.value;
      if (value === 'custom') {
        dohPending = true;
        showDohCustom(true);
        const r = validateDohUrl($('#inp-doh-url').value);
        if (r.ok) saveDohCustom(); // уже есть валидный адрес — применяем сразу
        else $('#inp-doh-url').focus();
        return;
      }
      dohPending = false;
      setDohError('');
      showDohCustom(false);
      if (await update({ dohProvider: value })) toast('DNS-over-HTTPS применён');
    });
    $('#btn-doh-save').addEventListener('click', saveDohCustom);
    $('#inp-doh-url').addEventListener('input', () => setDohError(''));
    $('#inp-doh-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveDohCustom(); }
    });
    $('#sel-proxy-mode').addEventListener('change', async (e) => {
      const value = e.target.value;
      setProxyError('');
      if (value !== 'manual') {
        proxyPending = false;
        $('#proxy-manual-wrap').hidden = true;
        await sendProxy({ proxyMode: value });
        return;
      }
      proxyPending = true;
      $('#proxy-manual-wrap').hidden = false;
      if (validateProxyForm().ok) saveProxyManual(); // уже есть валидные значения — применяем сразу
      else $('#inp-proxy-host').focus();
    });
    $('#btn-proxy-save').addEventListener('click', saveProxyManual);
    for (const id of ['#inp-proxy-host', '#inp-proxy-port', '#inp-proxy-bypass']) {
      $(id).addEventListener('input', () => setProxyError(''));
      $(id).addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); saveProxyManual(); }
      });
    }

    // main рассылает смену эффективного флага (переключение батарея/сеть) в страницы browser://
    window.addEventListener('energy-saver-change', (e) => setEnergyActive(e.detail && e.detail.active));

    $('#btn-sleep-now').addEventListener('click', async () => {
      try {
        await api.sleepNow();
        toast('Фоновые вкладки усыплены');
      } catch {
        toast('Не удалось усыпить вкладки', true);
      }
    });

    rulesEl.addEventListener('input', updateRulesMeta);
    rulesEl.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault();
        saveRules();
      }
    });
    saveBtn.addEventListener('click', saveRules);
    window.addEventListener('hashchange', showSection);
    bindClear();
    bindBookmarks();
    bindPasswords();
    bindExtensions();
    bindUpdates();
  }

  async function init() {
    if (!api) {
      $('#shell').hidden = true;
      $('#fatal').hidden = false;
      return;
    }
    showSection();
    bind();
    api.onChange(render);
    try {
      render(await api.get());
    } catch {
      toast('Не удалось загрузить настройки', true);
    }
    loadRules();
    // счётчик блокировок растёт сам по себе — обновляем, пока вкладка видна
    setInterval(async () => {
      if (document.hidden) return;
      try {
        // Только счётчик: полный render() сбрасывал бы открытые <select> и фокус
        const p = await api.get();
        if (p) $('#blocked-count').textContent = Number(p.blockedCount || 0).toLocaleString('ru-RU');
      } catch { /* ignore */ }
    }, 4000);
  }

  init();
})();
