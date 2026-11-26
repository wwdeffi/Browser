'use strict';

// Единая тема оболочки. Один и тот же файл работает:
//  • в окне интерфейса (renderer/index.html, file:) — со всеми кнопками и тостом;
//  • на внутренних страницах browser://* (settings, error, newtab, ...) — только применяет тему.
//
// Подключать СИНХРОННО в <head> (без defer/async), чтобы палитра из кэша применилась до первой отрисовки.
// Main-процесс присылает актуальную палитру вызовом window.__applyChromeTheme(payload) на dom-ready и при каждой смене темы.
(() => {
  const STORAGE_KEY = 'mybrowser_chrome_theme_v1';        // легаси: только id темы
  const CACHE_KEY = 'mybrowser_chrome_theme_cache_v2';    // { id, css, mode }: последняя палитра, в т.ч. кастомная
  const IS_INTERNAL = window.location.protocol === 'browser:';

  const CHROME_THEMES = [
    { id: 'cyber-blue', name: 'Cyber Blue' },
    { id: 'nebula-violet', name: 'Nebula Violet' },
    { id: 'obsidian-chrome', name: 'Obsidian Chrome' },
    { id: 'crimson-eclipse', name: 'Crimson Eclipse' },
    { id: 'aurora-emerald', name: 'Aurora Fjord' },
    { id: 'tokyo-synth', name: 'Tokyo Synth' },
    { id: 'sakura-midnight', name: 'Sakura Moon' },
    { id: 'solar-gold', name: 'Obsidian Gold' },
    { id: 'silver-cosmos', name: 'Silver Cosmos' },
    { id: 'aurora-voxel', name: 'Aurora Voxel' },
    { id: 'topo-noir', name: 'Topo Noir' },
    { id: 'katana-noir', name: 'Katana Noir' }
  ];
  const CUSTOM_ID = 'custom';
  const CUSTOM_NAME = 'Из обоев';
  const KNOWN_IDS = new Set([...CHROME_THEMES.map((t) => t.id), CUSTOM_ID]);

  const root = document.documentElement;
  let currentId = null;
  let btnPalette = null;
  let toastEl = null;
  let toastText = null;
  let toastTimer = null;

  // ---------- Палитра: проверка, кэш, применение (без DOM-элементов, работает в <head>) ----------

  // CSS генерирует main из проверенной «затравки»; здесь — защита от мусора в кэше
  function isSafeCss(css) {
    return typeof css === 'string' && css.length <= 20000 && !/[<>]|@import|url\s*\(|expression\s*\(/i.test(css);
  }

  // → { id, css, mode } | null
  function normalize(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !KNOWN_IDS.has(p.id)) return null;
    const mode = p.mode === 'light' || p.mode === 'dark' ? p.mode : null;
    if (p.id === CUSTOM_ID) {
      if (!isSafeCss(p.css) || !p.css.trim()) return null; // кастомная тема без палитры не применяется
      return { id: CUSTOM_ID, css: p.css, mode };
    }
    return { id: p.id, css: '', mode };
  }

  function readCache() {
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function writeCache(state) {
    try {
      const mode = state.mode || root.dataset.theme || null;
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ id: state.id, css: state.css, mode }));
      window.localStorage.setItem(STORAGE_KEY, state.id);
    } catch {
      // localStorage недоступен — палитра просто придёт из main при следующем запуске
    }
  }

  // Constructable stylesheet, а не <style>: inline-стили запрещены CSP (style-src без 'unsafe-inline')
  let customSheet = null;
  function setCustomCss(css) {
    if (!css && !customSheet) return;
    if (!customSheet) {
      customSheet = new CSSStyleSheet();
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, customSheet];
    }
    customSheet.replaceSync(css || '');
  }

  // Сначала переменные, потом атрибут — промежуточного кадра с дефолтным акцентом не будет
  function applyState(state) {
    if (state.mode && root.dataset.theme !== state.mode) root.dataset.theme = state.mode;
    setCustomCss(state.css);
    if (root.dataset.chromeTheme !== state.id) root.dataset.chromeTheme = state.id;
    currentId = state.id;
    updateTitle();
  }

  // Точка входа для main (executeJavaScript на dom-ready и при смене темы)
  Object.defineProperty(window, '__applyChromeTheme', {
    configurable: true,
    value(payload) {
      const state = normalize(payload);
      if (!state) return;
      applyState(state);
      writeCache(state);
    }
  });

  // ---------- Синхронный старт: кэш → до первой отрисовки ----------
  const cached = readCache();
  if (cached) {
    applyState(cached);
  } else if (!IS_INTERNAL) {
    let legacy = null;
    try { legacy = window.localStorage.getItem(STORAGE_KEY); } catch { /* ignore */ }
    applyState({ id: legacy && legacy !== CUSTOM_ID && KNOWN_IDS.has(legacy) ? legacy : CHROME_THEMES[0].id, css: '', mode: null });
  }
  // Внутренняя страница без кэша: ждём push от main (dom-ready), дефолт из tokens.css

  // ---------- Интерфейс окна (кнопка-палитра, тост, горячая клавиша) — только не на browser:// ----------

  function themeName(id) {
    if (id === CUSTOM_ID) return CUSTOM_NAME;
    const t = CHROME_THEMES.find((x) => x.id === id);
    return t ? t.name : '';
  }

  function updateTitle() {
    if (btnPalette && currentId) {
      btnPalette.title = `Тема панели: ${themeName(currentId)} (ЛКМ — далее, ПКМ — назад)`;
    }
  }

  function showToast(name) {
    if (!toastEl || !toastText) return;
    toastText.textContent = name;
    toastEl.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('visible'), 1500);
  }

  // Смена темы пользователем (кнопка / ПКМ / Alt+Shift+T): применяем и сообщаем main-процессу,
  // чтобы он сохранил chromeTheme в settings.json и разослал тему всем внутренним страницам.
  // При старте main не уведомляем — иначе устаревший localStorage перезаписал бы настройки.
  function stepTheme(delta) {
    const idx = CHROME_THEMES.findIndex((t) => t.id === currentId);
    const len = CHROME_THEMES.length;
    // из кастомной темы «далее» — первая в списке, «назад» — последняя
    const next = idx < 0 ? (delta > 0 ? 0 : len - 1) : (idx + delta + len) % len;
    const theme = CHROME_THEMES[next];
    const state = { id: theme.id, css: '', mode: null };
    applyState(state);
    writeCache(state);
    showToast(theme.name);
    try {
      if (window.browser && typeof window.browser.setChromeTheme === 'function') {
        window.browser.setChromeTheme(theme.id);
      }
    } catch {
      // IPC недоступен — тема останется только локальной
    }
  }

  function initWindowUi() {
    if (IS_INTERNAL) return; // на внутренних страницах тему меняет только main
    btnPalette = document.getElementById('btn-palette');
    toastEl = document.getElementById('chrome-theme-toast');
    toastText = document.getElementById('chrome-theme-toast-text');
    updateTitle();

    // Если тему сменили извне (со страницы новой вкладки) — синхронизируем состояние и подсказку
    new MutationObserver(() => {
      const id = root.dataset.chromeTheme;
      if (!id || !KNOWN_IDS.has(id) || id === currentId) return;
      currentId = id;
      if (id !== CUSTOM_ID) setCustomCss(''); // не оставляем устаревшую палитру от кастомной темы
      updateTitle();
    }).observe(root, { attributes: true, attributeFilter: ['data-chrome-theme'] });

    if (btnPalette) {
      btnPalette.addEventListener('click', () => stepTheme(1));
      btnPalette.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        stepTheme(-1);
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyT') {
        e.preventDefault();
        stepTheme(1);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWindowUi, { once: true });
  } else {
    initWindowUi();
  }
})();
