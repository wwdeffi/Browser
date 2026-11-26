// Красивые Obsidian Glass / Light Paper стили для страниц поиска
// (Google + Режим ИИ + Картинки, Яндекс, DuckDuckGo, Bing + Bing Поиск ИИ).
//
// Все «хрупкие» селекторы чужой вёрстки вынесены в main/searchSelectors.js (сгруппированы по
// поисковикам и ролям). Здесь они только подставляются в шаблоны CSS: при смене вёрстки
// поисковика правится конфиг, а не этот файл.

const S = require('./searchSelectors');

// Список селекторов через запятую: sel(['a', 'b'], 'c') → "a, b, c"
const sel = (...groups) => groups.flat().join(', ');
// Добавить суффикс (':hover', '::before', ...) к каждому селектору списка
const sfx = (list, suffix) => [].concat(list).map((s) => s + suffix);
// Служебная метка, которую ставит preload/tabPreload.js на скрытые источники (это НЕ селектор чужой вёрстки)
const PT_SRC_MARKER = '[data-pt-src]';

function buildPalette(isDark) {
  if (isDark) {
    return {
      isDark: true,
      scheme: 'dark',
      bg: '#0b0c12',
      bgSticky: 'rgba(11, 12, 18, 0.96)',
      card: '#121520',
      cardHover: '#171b2a',
      surface: '#151826',
      surfaceElev: '#1b2032',
      input: '#141724',
      inputFocus: '#191d2e',
      border: 'rgba(255, 255, 255, 0.07)',
      borderHover: 'rgba(165, 180, 252, 0.25)',
      borderInput: 'rgba(255, 255, 255, 0.11)',
      text: '#eef0f8',
      muted: '#9ba3be',
      subtle: '#6e7694',
      link: '#c7d2fe',
      linkHover: '#eef2ff',
      visited: '#a78bfa',
      accent: '#a5b4fc',
      accentSoft: 'rgba(165, 180, 252, 0.14)',
      selection: 'rgba(165, 180, 252, 0.24)',
      shadow: '0 6px 24px rgba(0, 0, 0, 0.28)',
      scrollThumb: 'rgba(255, 255, 255, 0.15)',
      scrollHover: 'rgba(255, 255, 255, 0.28)'
    };
  }

  return {
    isDark: false,
    scheme: 'light',
    bg: '#f4f6fb',
    bgSticky: 'rgba(244, 246, 251, 0.96)',
    card: '#ffffff',
    cardHover: '#fcfdff',
    surface: '#eef1f8',
    surfaceElev: '#e5e9f4',
    input: '#ffffff',
    inputFocus: '#ffffff',
    border: 'rgba(15, 23, 42, 0.08)',
    borderHover: 'rgba(79, 70, 229, 0.28)',
    borderInput: 'rgba(15, 23, 42, 0.13)',
    text: '#141824',
    muted: '#4f5870',
    subtle: '#7a849e',
    link: '#4338ca',
    linkHover: '#312e81',
    visited: '#7c3aed',
    accent: '#4f46e5',
    accentSoft: 'rgba(79, 70, 229, 0.1)',
    selection: 'rgba(79, 70, 229, 0.18)',
    shadow: '0 4px 18px rgba(15, 23, 42, 0.06)',
    scrollThumb: 'rgba(15, 23, 42, 0.16)',
    scrollHover: 'rgba(15, 23, 42, 0.28)'
  };
}

const CHROME_TOKENS = {
  "dark": {
    "cyber-blue": {
      "bg": "#070a14",
      "card": "#10172b",
      "input": "#0c1222",
      "focus": "#121a30",
      "border": "rgba(56, 189, 248, 0.28)",
      "accent": "#38bdf8",
      "accent2": "#6366f1",
      "hover": "#7dd3fc",
      "soft": "rgba(56, 189, 248, 0.16)"
    },
    "nebula-violet": {
      "bg": "#090612",
      "card": "#17102a",
      "input": "#110c20",
      "focus": "#18112e",
      "border": "rgba(192, 132, 252, 0.32)",
      "accent": "#c084fc",
      "accent2": "#f472b6",
      "hover": "#d8b4fe",
      "soft": "rgba(192, 132, 252, 0.17)"
    },
    "obsidian-chrome": {
      "bg": "#08090d",
      "card": "#161821",
      "input": "#101219",
      "focus": "#161923",
      "border": "rgba(226, 232, 240, 0.22)",
      "accent": "#e2e8f0",
      "accent2": "#818cf8",
      "hover": "#ffffff",
      "soft": "rgba(226, 232, 240, 0.13)"
    },
    "crimson-eclipse": {
      "bg": "#0c0608",
      "card": "#1d0e13",
      "input": "#150a0e",
      "focus": "#200f15",
      "border": "rgba(251, 113, 133, 0.32)",
      "accent": "#fb7185",
      "accent2": "#ef4444",
      "hover": "#fda4af",
      "soft": "rgba(251, 113, 133, 0.17)"
    },
    "aurora-emerald": {
      "bg": "#050c0b",
      "card": "#0d1f1d",
      "input": "#091615",
      "focus": "#0f2321",
      "border": "rgba(52, 211, 153, 0.3)",
      "accent": "#34d399",
      "accent2": "#22d3ee",
      "hover": "#6ee7b7",
      "soft": "rgba(52, 211, 153, 0.16)"
    },
    "tokyo-synth": {
      "bg": "#0c0713",
      "card": "#1c1028",
      "input": "#140b1e",
      "focus": "#1f112d",
      "border": "rgba(244, 114, 182, 0.34)",
      "accent": "#f472b6",
      "accent2": "#38bdf8",
      "hover": "#f9a8d4",
      "soft": "rgba(244, 114, 182, 0.17)"
    },
    "sakura-midnight": {
      "bg": "#0c0811",
      "card": "#1b1222",
      "input": "#140d1a",
      "focus": "#1f1428",
      "border": "rgba(249, 168, 212, 0.3)",
      "accent": "#f9a8d4",
      "accent2": "#c084fc",
      "hover": "#fbcfe8",
      "soft": "rgba(249, 168, 212, 0.16)"
    },
    "solar-gold": {
      "bg": "#0b0a07",
      "card": "#1a160e",
      "input": "#13100a",
      "focus": "#1d180f",
      "border": "rgba(251, 191, 36, 0.32)",
      "accent": "#fbbf24",
      "accent2": "#f97316",
      "hover": "#fcd34d",
      "soft": "rgba(251, 191, 36, 0.16)"
    },
    "silver-cosmos": {
      "bg": "#050506",
      "card": "#101114",
      "input": "#0b0c0f",
      "focus": "#14151a",
      "border": "rgba(226, 232, 240, 0.24)",
      "accent": "#e5e7eb",
      "accent2": "#94a3b8",
      "hover": "#f8fafc",
      "soft": "rgba(229, 231, 235, 0.14)"
    },
    "aurora-voxel": {
      "bg": "#07061a",
      "card": "#120f30",
      "input": "#0b0a22",
      "focus": "#171340",
      "border": "rgba(167, 139, 250, 0.3)",
      "accent": "#a78bfa",
      "accent2": "#2dd4bf",
      "hover": "#c4b5fd",
      "soft": "rgba(167, 139, 250, 0.17)"
    },
    "topo-noir": {
      "bg": "#000000",
      "card": "#0d0d0d",
      "input": "#080808",
      "focus": "#121212",
      "border": "rgba(255, 255, 255, 0.22)",
      "accent": "#f5f5f5",
      "accent2": "#a3a3a3",
      "hover": "#ffffff",
      "soft": "rgba(255, 255, 255, 0.12)"
    },
    "katana-noir": {
      "bg": "#030406",
      "card": "#0d0f14",
      "input": "#080a0e",
      "focus": "#12151b",
      "border": "rgba(200, 215, 235, 0.24)",
      "accent": "#f1f5f9",
      "accent2": "#7c8da6",
      "hover": "#ffffff",
      "soft": "rgba(226, 236, 248, 0.13)"
    }
  },
  "light": {
    "cyber-blue": {
      "accent": "#4f46e5",
      "accent2": "#0ea5e9",
      "ring": "rgba(79, 70, 229, 0.22)"
    },
    "nebula-violet": {
      "accent": "#9333ea",
      "accent2": "#ec4899",
      "ring": "rgba(147, 51, 234, 0.22)"
    },
    "obsidian-chrome": {
      "accent": "#4f46e5",
      "accent2": "#0ea5e9",
      "ring": "rgba(79, 70, 229, 0.22)"
    },
    "crimson-eclipse": {
      "accent": "#e11d48",
      "accent2": "#f97316",
      "ring": "rgba(225, 29, 72, 0.22)"
    },
    "aurora-emerald": {
      "accent": "#059669",
      "accent2": "#0891b2",
      "ring": "rgba(5, 150, 105, 0.22)"
    },
    "tokyo-synth": {
      "accent": "#db2777",
      "accent2": "#8b5cf6",
      "ring": "rgba(219, 39, 119, 0.22)"
    },
    "sakura-midnight": {
      "accent": "#db2777",
      "accent2": "#8b5cf6",
      "ring": "rgba(219, 39, 119, 0.22)"
    },
    "solar-gold": {
      "accent": "#d97706",
      "accent2": "#ea580c",
      "ring": "rgba(217, 119, 6, 0.22)"
    },
    "silver-cosmos": {
      "accent": "#475569",
      "accent2": "#64748b",
      "ring": "rgba(71, 85, 105, 0.22)"
    },
    "aurora-voxel": {
      "accent": "#7c3aed",
      "accent2": "#0d9488",
      "ring": "rgba(124, 58, 237, 0.22)"
    },
    "topo-noir": {
      "accent": "#262626",
      "accent2": "#525252",
      "ring": "rgba(38, 38, 38, 0.2)"
    },
    "katana-noir": {
      "accent": "#334155",
      "accent2": "#64748b",
      "ring": "rgba(51, 65, 85, 0.22)"
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Кеш собранного CSS.
// Ключ — составная строка ВСЕХ параметров, влияющих на результат:
//   вариант поисковика (google / google:img / google:ai / alice / yandex / ddg / bing / bing:copilot),
//   светлая/тёмная тема, id темы оболочки, хэш кастомной палитры (из обоев), режим «стекло»,
//   статус блокировки рекламы (AdBlock; влияет только на Google).
// Размер ограничен (LRU): при переполнении вытесняется самая давняя запись.
// При смене/сбросе кастомной палитры кеш очищается И хэш палитры входит в ключ (двойная защита).
// ─────────────────────────────────────────────────────────────────────────────
const CSS_CACHE_MAX = 32;
const cssCache = new Map();
let customHash = '';

function cacheGet(key) {
  const hit = cssCache.get(key);
  if (hit === undefined) return undefined;
  // LRU: перемещаем запись в конец (самая свежая)
  cssCache.delete(key);
  cssCache.set(key, hit);
  return hit;
}

function cacheSet(key, css) {
  if (cssCache.has(key)) cssCache.delete(key);
  while (cssCache.size >= CSS_CACHE_MAX) {
    cssCache.delete(cssCache.keys().next().value);
  }
  cssCache.set(key, css);
}

function clearSearchCssCache() {
  cssCache.clear();
}

// Быстрый несекретный хэш (djb2) строки — для ключа кастомной палитры
function hashString(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function parseColor(c) {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) return m[1].split(',').slice(0, 3).map((x) => parseFloat(x));
  return [128, 128, 128];
}

function mixColor(a, b, t) {
  const x = parseColor(a);
  const y = parseColor(b);
  const r = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${r[0]}, ${r[1]}, ${r[2]})`;
}

function alphaColor(c, a) {
  const [r, g, b] = parseColor(c);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// «Стекло»: страница поиска прозрачна, под ней видны свои обои браузера.
// Фон страницы (bg) полностью прозрачен — одно общее затемнение (tint) рисуется на <html>,
// иначе вложенные блоки с полупрозрачным фоном наслаивались бы и закрывали обои.
//
// Тёмное «стекло» окрашено фиксированными цветами новой вкладки (глубокий чёрный фон и холодные
// сине-чёрные панели rgb(10, 12, 17)), а НЕ цветами темы оболочки: рамка темы «из обоев» тёплая
// (hue/saturation берутся из обоев) и давала на Google коричневый налёт. Акценты и ссылки по-прежнему
// берутся из выбранной темы.
const GLASS_DARK = {
  tint: 'rgba(4, 6, 11, 0.35)',
  bg: 'rgba(4, 6, 11, 0)',
  bgSticky: 'rgba(6, 8, 14, 0.82)',
  card: 'rgba(11, 14, 20, 0.86)',
  cardHover: 'rgba(16, 20, 29, 0.9)',
  surface: 'rgba(10, 13, 19, 0.8)',
  surfaceElev: 'rgba(15, 19, 27, 0.88)',
  input: 'rgba(8, 10, 15, 0.82)',
  inputFocus: 'rgba(12, 15, 22, 0.94)'
};

function glassify(p) {
  const base = {
    ...p,
    glass: true,
    // Тёмная тень карточек на прозрачном фоне выглядит грязным бруском — в режиме «стекло» без теней
    shadow: '0 0 0 0 rgba(0, 0, 0, 0)'
  };
  if (p.isDark) return { ...base, ...GLASS_DARK };
  return {
    ...base,
    tint: alphaColor(p.bg, 0.6),
    bg: alphaColor(p.bg, 0),
    bgSticky: alphaColor(p.bg, 0.8),
    card: alphaColor(p.card, 0.42),
    cardHover: alphaColor(p.cardHover, 0.52),
    surface: alphaColor(p.surface, 0.4),
    surfaceElev: alphaColor(p.surfaceElev, 0.5),
    input: alphaColor(p.input, 0.5),
    inputFocus: alphaColor(p.inputFocus, 0.72)
  };
}

// Реклама Google (текстовая, товарная, верх/низ выдачи) — скрываем целиком
const GOOGLE_ADS_HIDE_CSS = `
  ${sel(S.google.ads.aiOverviewAside, PT_SRC_MARKER)} { display: none !important; }
  ${sel(S.google.ads.blocks)} {
    display: none !important;
  }
`;

// Тёмные полосы затухания над строкой «Задайте вопрос» и кнопкой «Развернуть» в Обзоре от ИИ:
// в режиме «стекло» убираем их совсем, иначе они тёмным бруском лежат на обоях
const GOOGLE_GLASS_FIX_CSS = `
  ${PT_SRC_MARKER} { display: none !important; }
  ${sel(S.google.ai.composer.fogAbove, S.google.ai.composer.fogExpand)} {
    background: none !important;
    background-image: none !important;
  }
`;

function glassBaseCss(p) {
  return `
    html { background: ${p.tint} !important; background-color: ${p.tint} !important; }
    body { background: transparent !important; background-color: transparent !important; }
  `;
}

// Палитра страниц поиска, окрашенная в цвета выбранной темы оболочки браузера
function themedPalette(isDark, themeId, glass) {
  const p = themedPaletteSolid(isDark, themeId);
  return glass ? glassify(p) : p;
}

function themedPaletteSolid(isDark, themeId) {
  const base = buildPalette(isDark);
  const set = (isDark ? CHROME_TOKENS.dark : CHROME_TOKENS.light)[themeId];
  if (!set) return base;

  if (isDark) {
    return {
      ...base,
      bg: set.bg,
      bgSticky: alphaColor(set.bg, 0.96),
      card: set.card,
      cardHover: mixColor(set.card, '#ffffff', 0.05),
      surface: set.input,
      surfaceElev: set.focus,
      input: set.input,
      inputFocus: set.focus,
      borderHover: set.border,
      link: set.hover,
      linkHover: mixColor(set.hover, '#ffffff', 0.45),
      visited: set.accent2,
      accent: set.accent,
      accentSoft: set.soft,
      selection: alphaColor(set.accent, 0.26)
    };
  }

  return {
    ...base,
    borderHover: set.ring,
    link: mixColor(set.accent, '#000000', 0.2),
    linkHover: mixColor(set.accent, '#000000', 0.42),
    visited: mixColor(set.accent2, '#000000', 0.15),
    accent: set.accent,
    accentSoft: alphaColor(set.accent, 0.12),
    selection: alphaColor(set.accent, 0.2)
  };
}

function commonCss(p) {
  return `
    html, body {
      color-scheme: ${p.scheme} !important;
      font-family: "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif !important;
      -webkit-font-smoothing: antialiased !important;
    }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: ${p.bg}; }
    ::-webkit-scrollbar-thumb {
      background: ${p.scrollThumb};
      border-radius: 999px;
      border: 2px solid ${p.bg};
    }
    ::-webkit-scrollbar-thumb:hover { background: ${p.scrollHover}; }
  `;
}

function googleCss(p, { isImages, isAiMode }) {
  const G = S.google;
  const C = G.ai.composer;
  const M = G.ai.mode;
  const titles = G.results.titleLinkScopes;
  // «<scope> h3» (+ состояние) для каждого контейнера заголовков
  const h3 = (state = '') => sel(titles.map((s) => `${s}${state} h3`));

  const loginBtnCss = p.isDark
    ? `
      ${sel(G.buttons.login)} {
        background: ${p.accentSoft} !important;
        color: ${p.linkHover} !important;
        border: 1px solid ${p.borderHover} !important;
        border-radius: 999px !important;
        box-shadow: none !important;
      }
      ${sel(sfx(G.buttons.login, ':hover'))} {
        background: ${p.selection} !important;
      }
    `
    : '';

  const resultCardsCss = !isImages && !isAiMode
    ? `
      ${G.results.card} {
        box-sizing: border-box !important;
        background: ${p.card} !important;
        border: 1px solid ${p.border} !important;
        border-radius: 16px !important;
        padding: 16px 20px !important;
        margin-bottom: 12px !important;
        box-shadow: ${p.shadow} !important;
        transition: background-color 150ms ease, border-color 150ms ease !important;
      }
      ${G.results.card}:hover {
        background: ${p.cardHover} !important;
        border-color: ${p.borderHover} !important;
      }
      ${sel(G.results.cardInnerLayers)} {
        background: transparent !important;
        background-color: transparent !important;
        box-shadow: none !important;
      }
      ${G.results.cardInnerSpacer} {
        margin-bottom: 0 !important;
      }
    `
    : '';

  const imagesCss = isImages
    ? `
      ${G.searchBox.stickySearchForm} {
        box-shadow: none !important;
      }
      ${sel(G.images.stickyNav)} {
        background: ${p.bg} !important;
      }
    `
    : '';

  // В Режиме ИИ (udm=50) учитываем и <button>, и <div role="button"> (иконки + и микрофона Google)
  // Нижняя панель «Задайте вопрос» и её «затухание» есть и в Режиме ИИ, и в развёрнутом «Обзоре от ИИ»
  // обычной выдачи. Классы найдены через theme-probe (могут смениться при обновлении Google).
  // Правила для псевдоэлементов: JS-слой (preload/tabPreload.js) кладёт цвет в переменные --pt-*,
  // а сами ::before/::after из JS не достать — красим их отсюда.
  const adaptiveCss = `
      [data-pt-bcb]::before { background-color: var(--pt-bcb) !important; }
      [data-pt-bib]::before { background-image: var(--pt-bib) !important; }
      [data-pt-bca]::after  { background-color: var(--pt-bca) !important; }
      [data-pt-bia]::after  { background-image: var(--pt-bia) !important; }
  `;

  const composerCss = `
      /* Заливка поля ввода «Задайте вопрос» */
      ${C.inputFill} {
        background: ${p.input} !important;
        background-color: ${p.input} !important;
        box-shadow: ${p.shadow} !important;
      }
      /* Нижнее «затухание» под полем ввода и подложка панели — цвет фона страницы */
      ${C.bottomFade} {
        background: linear-gradient(rgba(0, 0, 0, 0), ${p.bg} 30px, ${p.bg}) !important;
        background-color: transparent !important;
      }
      /* Туман над строкой «Задайте вопрос» и над кнопкой «Развернуть» в Обзоре от ИИ */
      ${sel(C.fogAbove)} {
        background: linear-gradient(rgba(0, 0, 0, 0), ${p.bg} 14px) !important;
        background-color: transparent !important;
      }
      ${sel(C.fogExpand)} {
        background: linear-gradient(rgba(0, 0, 0, 0) 0px, ${alphaColor(p.bg, 0.9)} 52px, ${p.bg} 80px) !important;
        background-color: transparent !important;
      }
  `;

  const aiModeCss = isAiMode
    ? `
      ${sel(M.content)} {
        background: ${p.bg} !important;
        background-color: ${p.bg} !important;
      }
      /* Внешние прилипающие обёртки вокруг нижней панели — цвет фона страницы */
      ${sel(M.composerWrappers)} {
        background: ${p.bg} !important;
        background-color: ${p.bg} !important;
        background-image: none !important;
        border-color: transparent !important;
        box-shadow: none !important;
      }
      /* Сама внутренняя скруглённая карточка поля «Задайте вопрос» */
      ${sel(M.composerCard)} {
        background: ${p.input} !important;
        background-color: ${p.input} !important;
        border: 1px solid ${p.borderInput} !important;
        box-shadow: ${p.shadow} !important;
      }
      ${sel(M.composerInner)} {
        background: transparent !important;
        background-color: transparent !important;
        border-color: transparent !important;
      }
      ${sel(M.textInput)} {
        background: transparent !important;
        color: ${p.text} !important;
        caret-color: ${p.accent} !important;
      }
      ${sel(M.sidebarCards)} {
        background-color: ${p.card} !important;
        border-color: ${p.border} !important;
      }

      /* Левая закреплённая полоса (была #272930) */
      ${sel(M.leftRail, sfx(M.leftRail, '::before'))} {
        background: ${p.bg} !important;
        background-color: ${p.bg} !important;
        border-color: ${p.border} !important;
      }
    `
    : '';

  return `
    ${commonCss(p)}

    :root, body, [data-theme] {
      --xhUGwc: ${p.bg} !important;
      --EpFNW: ${p.bg} !important;
      --gS5jXb: ${p.border} !important;
      --YLNNHc: ${p.text} !important;
      --COEmY: ${p.text} !important;
      --bbQxAb: ${p.muted} !important;
      --IXoxUe: ${p.subtle} !important;
      --JKqx2: ${p.link} !important;
      --TMYS9: ${p.accent} !important;
      --searchbox-background: ${p.input} !important;

      --m3c1: ${p.bg} !important;
      --m3c2: ${p.card} !important;
      --m3c3: ${p.surface} !important;
      --m3c4: ${p.surfaceElev} !important;
      --m3c5: ${p.bg} !important;
      --m3c6: ${p.card} !important;
      --m3c7: ${p.surfaceElev} !important;
      --m3c10: ${p.muted} !important;
      --m3c11: ${p.text} !important;
      --m3c12: ${p.link} !important;
      --m3c15: ${p.accent} !important;
      --m3c17: ${p.border} !important;
      --m3c18: ${p.borderInput} !important;
      --m3c20: ${p.input} !important;
      --m3c21: ${p.surfaceElev} !important;
      --m3c22: ${p.card} !important;
      --m3c23: ${p.surface} !important;
      --m3c24: ${p.input} !important;
      --m3c25: ${p.surfaceElev} !important;

      --gm3-sys-color-surface: ${p.bg} !important;
      --gm3-sys-color-surface-dim: ${p.bg} !important;
      --gm3-sys-color-surface-container-lowest: ${p.bg} !important;
      --gm3-sys-color-surface-container-low: ${p.card} !important;
      --gm3-sys-color-surface-container: ${p.card} !important;
      --gm3-sys-color-surface-container-high: ${p.input} !important;
      --gm3-sys-color-surface-container-highest: ${p.surfaceElev} !important;
      --gem-sys-color--surface: ${p.bg} !important;
      --gem-sys-color--surface-container: ${p.input} !important;
      --gem-sys-color--surface-container-high: ${p.surfaceElev} !important;
    }

    ${sel(G.page, G.header, G.footer)} {
      background: ${p.bg} !important;
      background-color: ${p.bg} !important;
      border-color: ${p.border} !important;
    }

    ${G.searchBox.stickySearchForm} {
      background: ${p.bgSticky} !important;
      backdrop-filter: blur(20px) !important;
      border-bottom: 1px solid ${p.border} !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35) !important;
    }
    ${sel(G.searchBox.stickySearchFormBg)} {
      background: transparent !important;
      box-shadow: none !important;
    }

    ${G.searchBox.pill} {
      background: ${p.glass ? p.inputFocus : p.input} !important;
      border: 1px solid ${p.borderInput} !important;
      border-radius: 999px !important;
      box-shadow: ${p.shadow} !important;
      opacity: 1 !important;
      visibility: visible !important;
      transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease !important;
    }
    ${G.searchBox.pill}:hover {
      border-color: ${p.borderHover} !important;
    }
    ${G.searchBox.pill}:focus-within {
      background: ${p.inputFocus} !important;
      border-color: ${p.borderHover} !important;
      box-shadow: 0 0 0 3px ${p.accentSoft}, ${p.shadow} !important;
    }
    ${G.searchBox.pillWithSuggest} {
      border-radius: 22px 22px 0 0 !important;
    }

    ${sel(G.searchBox.suggestDropdown)} {
      background: ${p.inputFocus} !important;
      border: 1px solid ${p.borderInput} !important;
      border-top: 0 !important;
      border-radius: 0 0 22px 22px !important;
      box-shadow: 0 18px 42px rgba(0, 0, 0, 0.45) !important;
    }
    ${G.searchBox.suggestHighlight} {
      background: ${p.accentSoft} !important;
      border-radius: 10px !important;
    }

    ${resultCardsCss}
    ${imagesCss}
    ${aiModeCss}
    ${composerCss}
    ${adaptiveCss}

    ${sel(G.rightColumn.knowledgePanel)} {
      background: ${p.card} !important;
      border: 1px solid ${p.border} !important;
      border-radius: 16px !important;
      box-shadow: ${p.shadow} !important;
      overflow: hidden !important;
    }

    ${h3()} {
      color: ${p.link} !important;
      font-weight: 500 !important;
      letter-spacing: -0.01em !important;
      transition: color 120ms ease !important;
    }
    ${h3(':hover')} {
      color: ${p.linkHover} !important;
    }
    ${h3(':visited')} {
      color: ${p.visited} !important;
    }
    ${titles[0]}:hover {
      text-decoration: none !important;
    }
    ${sel(G.results.snippet)} {
      color: ${p.muted} !important;
      line-height: 1.56 !important;
    }
    ${sel(G.results.urlLine)} {
      color: ${p.subtle} !important;
    }

    ${sel(G.buttons.search)} {
      background: ${p.card} !important;
      border: 1px solid ${p.borderInput} !important;
      color: ${p.text} !important;
      border-radius: 10px !important;
    }
    ${sel(sfx(G.buttons.search, ':hover'))} {
      background: ${p.cardHover} !important;
      border-color: ${p.borderHover} !important;
    }

    ${loginBtnCss}
  `;
}

function yandexCss(p) {
  const Y = S.yandex;
  return `
    ${commonCss(p)}

    ${sel(Y.page, Y.header, Y.footer)} {
      background: ${p.bg} !important;
      background-color: ${p.bg} !important;
      color: ${p.text} !important;
    }
    ${sel(Y.header)} {
      border-bottom: 1px solid ${p.border} !important;
    }
    ${sel(Y.searchBox.inputWrapper)} {
      background: ${p.input} !important;
      border: 1px solid ${p.borderInput} !important;
      border-radius: 999px !important;
      color: ${p.text} !important;
    }
    ${sel(Y.searchBox.inputText)} {
      color: ${p.text} !important;
    }
    ${Y.results.card} {
      background: ${p.card} !important;
      border: 1px solid ${p.border} !important;
      border-radius: 16px !important;
      color: ${p.text} !important;
      box-shadow: ${p.shadow} !important;
      padding: 16px 20px !important;
      margin-bottom: 12px !important;
    }
    /* У Яндекса фавиконка вынесена влево на ~28px — даём ей место внутри карточки */
    ${Y.results.card}:has(${Y.results.favicon}) {
      padding-left: 48px !important;
    }
    /* Прячем рекламные блоки в выдаче Яндекса */
    ${Y.results.card}:has(${sel(Y.results.adMarkers)}) {
      display: none !important;
    }

    /* Вложенные слои внутри карточки — без своей рамки/фона (иначе «рамка в рамке») */
    ${sel(Y.results.cardInnerLayers)} {
      background: transparent !important;
      background-color: transparent !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      padding-left: 0 !important;
      padding-right: 0 !important;
      margin-left: 0 !important;
      margin-right: 0 !important;
    }
    ${Y.results.card}:hover {
      background: ${p.cardHover} !important;
      border-color: ${p.borderHover} !important;
    }
    ${sel(Y.results.titleLink)} {
      color: ${p.link} !important;
    }
    ${sel(Y.results.snippet)} {
      color: ${p.muted} !important;
    }
  `;
}

function aliceCss(p) {
  const A = S.alice;
  return `
    ${commonCss(p)}

    :root, body {
      --bg: ${p.bg} !important;
      --background: ${p.bg} !important;
    }
    ${sel(A.layout)} {
      background-color: ${p.bg} !important;
      color: ${p.text} !important;
      border-color: ${p.border} !important;
    }
    /* Поле ввода */
    ${sel(A.searchBox.inputCard)} {
      background: ${p.input} !important;
      border: 1px solid ${p.borderInput} !important;
      box-shadow: ${p.shadow} !important;
    }
    ${sel(A.searchBox.textInput)} {
      background: transparent !important;
      color: ${p.text} !important;
      caret-color: ${p.accent} !important;
    }

    /* ---- Найдено через theme-probe: Алиса красится через --depot-* переменные ---- */
    ${sel(':root', 'html', A.skinRoot, 'body')} {
      --depot-color-bg-primary: ${p.bg} !important;
      --depot-color-bg-overflow: ${p.bg} !important;
      --depot-color-bg-sidebar: ${p.bg} !important;
      --depot-color-bg-secondary: ${p.card} !important;
      --depot-color-bg-tertiary: ${p.card} !important;
      --depot-color-bg-code: ${p.card} !important;
      --depot-color-fill-05-solid: ${p.card} !important;
      --depot-color-alice-input-bg: ${p.input} !important;
      --depot-color-message-bg: ${p.card} !important;
      --depot-color-message-user-bg: ${p.card} !important;
      --depot-color-popup-fill-base: ${p.surfaceElev} !important;
      --depot-color-modal-bg: ${p.surfaceElev} !important;
      --depot-color-notifier-bg: ${p.surfaceElev} !important;
      --depot-color-button-opaque-bg: linear-gradient(${p.card}, ${p.card}) !important;
    }
    /* Нижняя закреплённая панель (была #18181a) и поле ввода (было #262626) */
    ${A.chat.bottomBar} {
      background: ${p.bg} !important;
      background-color: ${p.bg} !important;
    }
    ${A.chat.inputField} {
      background: ${p.input} !important;
      background-color: ${p.input} !important;
      border: 1px solid ${p.borderInput} !important;
      box-shadow: ${p.shadow} !important;
    }
  `;
}

function duckduckgoCss(p) {
  const D = S.ddg;
  return `
    ${commonCss(p)}

    :root, body {
      --theme-col-bg-page: ${p.bg} !important;
      --theme-col-bg-header: ${p.bg} !important;
      --theme-col-bg-content: ${p.bg} !important;
      --theme-col-bg-card: ${p.card} !important;
    }
    ${sel(D.page, D.header, D.answers)} {
      background: ${p.bg} !important;
      background-color: ${p.bg} !important;
      color: ${p.text} !important;
    }
    ${sel(D.searchBox.form)} {
      background: ${p.input} !important;
      border: 1px solid ${p.borderInput} !important;
      border-radius: 999px !important;
      box-shadow: ${p.shadow} !important;
    }
    /* Убираем светло-серую вставку внутри пилюли поиска DuckDuckGo */
    ${sel(D.searchBox.innerControls)} {
      background: transparent !important;
      background-color: transparent !important;
      color: ${p.text} !important;
    }
    /* Найдено через DevTools: серый овал (rgb(51,51,51), radius 24px) — обёртка вокруг input
       с несимметричным padding (слева 2px, справа 4px) → разные зазоры. Делаем прозрачной. */
    ${D.searchBox.inputWrapper} {
      background: transparent !important;
      background-color: transparent !important;
      box-shadow: none !important;
    }
    ${D.searchBox.inputWrapperPadding} {
      padding-left: 4px !important;
      padding-right: 4px !important;
    }

    ${D.results.card} {
      background: ${p.card} !important;
      border: 1px solid ${p.border} !important;
      border-radius: 16px !important;
      padding: 16px 20px !important;
      margin-bottom: 12px !important;
      box-shadow: ${p.shadow} !important;
      transition: background-color 150ms ease, border-color 150ms ease !important;
    }
    ${D.results.card}:hover {
      background: ${p.cardHover} !important;
      border-color: ${p.borderHover} !important;
    }
    ${D.results.titleLink} {
      color: ${p.link} !important;
    }
    ${D.results.titleLink}:hover {
      color: ${p.linkHover} !important;
      text-decoration: none !important;
    }
  `;
}

function bingCss(p, { isCopilot }) {
  const B = S.bing;
  const BC = S.bingCopilot;

  if (isCopilot) {
    return `
      ${commonCss(p)}

      /* Выравниваем Fluent UI токены Bing Режим ИИ, чтобы центр не отличался серым от боковой колонки */
      :root, body {
        --colorNeutralBackground1: ${p.bg} !important;
        --colorNeutralBackground2: ${p.bg} !important;
        --colorNeutralBackground3: ${p.card} !important;
        --colorNeutralBackground4: ${p.input} !important;
        --colorNeutralStroke1: ${p.border} !important;
        --colorNeutralStroke2: ${p.border} !important;
        --bg-color: ${p.bg} !important;
      }
      ${sel(BC.layout)} {
        background-color: ${p.bg} !important;
        color: ${p.text} !important;
        border-color: ${p.border} !important;
      }
      a { color: ${p.link} !important; }
      ${sel(BC.searchBox.chatCard)} {
        background-color: ${p.input} !important;
        border: 1px solid ${p.borderInput} !important;
        color: ${p.text} !important;
      }
      ${BC.searchBox.chatCardInner} {
        background: transparent !important;
      }
      ${sel(BC.searchBox.textInputs)} {
        background: transparent !important;
        color: ${p.text} !important;
        caret-color: ${p.accent} !important;
      }
      ${sel(BC.rightColumn.sideLinks)} {
        background-color: ${p.card} !important;
        border-color: ${p.border} !important;
        color: ${p.text} !important;
      }
      /* Коричневатые градиенты-«затухания» сверху/снизу и серое поле ввода */
      ${BC.fades.tintScope} {
        --gradient-tint: transparent;
      }
      ${BC.searchBox.richCard} {
        background-color: ${p.input} !important;
        background-image: none !important;
        border: 1px solid ${p.borderInput} !important;
        box-shadow: ${p.shadow} !important;
      }
      ${sel(BC.searchBox.richText)} {
        background: transparent !important;
        color: ${p.text} !important;
      }
      ${sel(BC.fades.layers)} {
        background-image: none !important;
        background-color: transparent !important;
      }

      /* ---- Найдено через theme-probe (классы Bing могут смениться) ---- */
      :root, html, body {
        --ybg: ${p.input} !important;
        --rbg: ${p.bg} !important;
      }
      /* Карточка поля ввода (была #3b3a39) */
      ${BC.probe.inputCard} {
        background: ${p.input} !important;
        background-color: ${p.input} !important;
        border: 1px solid ${p.borderInput} !important;
        box-shadow: ${p.shadow} !important;
      }
      /* Нижняя панель-композер и её «затухание» (были #1b1a19) */
      ${BC.probe.composer} {
        background: ${p.bg} !important;
        background-color: ${p.bg} !important;
      }
      ${BC.probe.composer}::before {
        background: linear-gradient(rgba(0, 0, 0, 0) 0px, ${p.bg} 100%) !important;
      }
      ${BC.probe.composer}::after {
        background: ${p.bg} !important;
        background-color: ${p.bg} !important;
      }
      /* Левая колонка (#1b1a19 и синеватая #1d2933) */
      ${sel(BC.probe.sidebar)} {
        background: ${p.bg} !important;
        background-color: ${p.bg} !important;
        border-color: ${p.border} !important;
      }
      /* Верхнее затухание под панелью вкладок */
      ${BC.probe.scopebar} {
        background-image: linear-gradient(0deg, rgba(0, 0, 0, 0) 0%, ${p.bg} 16px, ${p.bg} 100%) !important;
      }
    `;
  }

  return `
    ${commonCss(p)}

    ${sel(B.page, B.header, B.footer, B.tween)} {
      background: ${p.bg} !important;
      background-color: ${p.bg} !important;
      color: ${p.text} !important;
      border-color: ${p.border} !important;
    }
    ${sel(B.header)} {
      border-bottom: 1px solid ${p.border} !important;
    }
    ${B.searchBox.form} {
      background: ${p.input} !important;
      border: 1px solid ${p.borderInput} !important;
      border-radius: 999px !important;
      box-shadow: ${p.shadow} !important;
    }
    ${B.searchBox.input} {
      color: ${p.text} !important;
    }
    ${sel(B.searchBox.suggestDropdown)} {
      background: ${p.inputFocus} !important;
      border: 1px solid ${p.borderInput} !important;
      border-radius: 16px !important;
      color: ${p.text} !important;
    }
    ${sel(B.searchBox.suggestHover)} {
      background: ${p.accentSoft} !important;
    }

    ${sel(B.nav.mutedText)} {
      color: ${p.muted} !important;
    }
    ${sel(B.nav.activeLinks)} {
      color: ${p.link} !important;
    }

    ${sel(B.results.organicCard, B.results.answerCard, B.rightColumn.answerCard, B.rightColumn.relatedCard)} {
      background: ${p.card} !important;
      background-color: ${p.card} !important;
      border: 1px solid ${p.border} !important;
      border-radius: 16px !important;
      padding: 18px 22px !important;
      margin-bottom: 14px !important;
      color: ${p.text} !important;
      box-shadow: ${p.shadow} !important;
    }
    ${B.results.organicCard}:hover {
      background: ${p.cardHover} !important;
      border-color: ${p.borderHover} !important;
    }
    ${sel(B.results.titleLinks)} {
      color: ${p.link} !important;
    }
    ${sel(B.results.text)} {
      color: ${p.muted} !important;
    }

    ${sel(B.rightColumn.headings)} {
      color: ${p.text} !important;
    }
    ${sel(B.rightColumn.listItems)} {
      background: transparent !important;
    }
    ${sel(B.rightColumn.chipLinks, B.rightColumn.chipText)} {
      color: ${p.text} !important;
      background: ${p.surface} !important;
      border: 1px solid ${p.border} !important;
      border-radius: 10px !important;
      transition: background-color 140ms ease, border-color 140ms ease !important;
    }
    ${sel(sfx(B.rightColumn.chipLinks, ':hover'))} {
      background: ${p.surfaceElev} !important;
      border-color: ${p.borderHover} !important;
      color: ${p.linkHover} !important;
      text-decoration: none !important;
    }

    ${sel(B.rightColumn.widgets)} {
      background: ${p.surface} !important;
      background-color: ${p.surface} !important;
      border-color: ${p.border} !important;
      color: ${p.text} !important;
    }
  `;
}


// ─────────────────────────────────────────────────────────────────────────────
// JS-слои для Google (адаптивная перекраска и фильтр источников «Обзора от ИИ») живут в
// preload/tabPreload.js и выполняются в ИЗОЛИРОВАННОМ мире вкладки. Здесь только собираем
// данные для них (палитра, список доверенных сайтов): обычные JSON-объекты без кода.
// ─────────────────────────────────────────────────────────────────────────────

function getAdaptivePayload(rawUrl, resolvedTheme, chromeThemeId, glass, hideSources = true) {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  if (!(/^(www\.)?google\.[a-z.]+$/.test(host) && (pathname === '/' || pathname === '/search' || pathname === '/webhp'))) {
    return null;
  }

  const p = themedPalette(resolvedTheme !== 'light', chromeThemeId, Boolean(glass));
  return {
    dark: p.isDark,
    bg: p.bg,
    bgSticky: p.bgSticky,
    card: p.card,
    cardHover: p.cardHover,
    input: p.input,
    inputFocus: p.inputFocus,
    surface: p.surface,
    surfaceElev: p.surfaceElev,
    accent: p.accent,
    hideSources: Boolean(hideSources)
  };
}



// Домены, которым доверяем. Запись вида ".gov" — любая зона, "wikipedia.org" — домен и поддомены.
// Доверенные по названию в подписи карточки (когда домен не виден)
const TRUSTED_NAMES = ['википедия', 'викисловарь', 'wikipedia', 'wiktionary', 'britannica', 'британника', 'грамота.ру'];

const TRUSTED_SOURCES = [
  'wikipedia.org', 'wiktionary.org', 'wikimedia.org', 'wikidata.org', 'britannica.com',
  'gramota.ru', 'bigenc.ru', 'academic.ru',
  'who.int', 'un.org', 'europa.eu', 'nih.gov', 'cdc.gov',
  'nature.com', 'science.org', 'arxiv.org',
  'developer.mozilla.org', 'python.org', 'nodejs.org', 'electronjs.org', 'github.com',
  '.gov', '.edu', '.gov.ru', '.edu.ru', '.mil'
];

// CSS-половина фильтра: пока JS не вынес вердикт, карточки источников невидимы (а не «мигают»).
// Страховка: если JS не отработал, через 1.2 с карточки показываются сами.
// Строка не зависит от параметров — собирается один раз.
const SOURCE_FILTER_CSS = `
    @keyframes pt-reveal { to { visibility: visible; } }
    li:has(${S.google.ai.sources.link}):not([data-pt-ok]):not([data-pt-no]) {
      visibility: hidden;
      animation: pt-reveal 0s 1.2s forwards;
    }
    li[data-pt-no] { display: none !important; }
  `;

function getSourceFilterCss(rawUrl, enabled) {
  if (!enabled || !isGoogleSearchUrl(rawUrl)) return '';
  return SOURCE_FILTER_CSS;
}

function isGoogleSearchUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const p = u.pathname.toLowerCase();
    return /^(www\.)?google\.[a-z.]+$/.test(u.hostname.toLowerCase()) && (p === '/' || p === '/search' || p === '/webhp');
  } catch {
    return false;
  }
}

function getSourceFilterPayload(rawUrl, enabled) {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  if (!(/^(www\.)?google\.[a-z.]+$/.test(host) && (pathname === '/' || pathname === '/search' || pathname === '/webhp'))) {
    return null;
  }
  return { enabled: Boolean(enabled), allow: TRUSTED_SOURCES.slice(), names: TRUSTED_NAMES.slice() };
}

// Лёгкая проверка «это страница поисковика, которую мы стилизуем?» без сборки CSS.
// Условия обязаны совпадать с engineVariant(): getSearchEngineCss() возвращает не null ровно для этих URL.
function isSearchEngineUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) return false;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  if (/^(www\.)?google\.[a-z.]+$/.test(host)) {
    return pathname === '/' || pathname === '/search' || pathname === '/webhp';
  }
  if (/^(www\.)?(ya\.ru|yandex\.[a-z.]+)$/.test(host)) {
    return pathname.startsWith('/alice') || pathname.startsWith('/search');
  }
  if (/^(www\.)?duckduckgo\.com$/.test(host)) return true;
  if (/^(www\.)?bing\.com$/.test(host)) {
    return pathname === '/' || pathname.startsWith('/search') || pathname.startsWith('/copilotsearch');
  }
  return false;
}

// Вариант страницы поисковика — всё, что (кроме темы) влияет на итоговый CSS.
// null — страница не стилизуется.
function engineVariant(host, pathname, parsed) {
  if (/^(www\.)?google\.[a-z.]+$/.test(host) && (pathname === '/' || pathname === '/search' || pathname === '/webhp')) {
    const udm = parsed.searchParams.get('udm') || '';
    const tbm = parsed.searchParams.get('tbm') || '';
    if (udm === '2' || tbm === 'isch') return 'google:img';
    if (udm === '50') return 'google:ai';
    return 'google';
  }
  if (/^(www\.)?(ya\.ru|yandex\.[a-z.]+)$/.test(host) && pathname.startsWith('/alice')) return 'alice';
  if (/^(www\.)?(ya\.ru|yandex\.[a-z.]+)$/.test(host) && pathname.startsWith('/search')) return 'yandex';
  if (/^(www\.)?duckduckgo\.com$/.test(host)) return 'ddg';
  if (/^(www\.)?bing\.com$/.test(host) && (pathname === '/' || pathname.startsWith('/search') || pathname.startsWith('/copilotsearch'))) {
    return pathname.startsWith('/copilotsearch') ? 'bing:copilot' : 'bing';
  }
  return null;
}

function buildEngineCss(variant, palette) {
  switch (variant) {
    case 'google': return googleCss(palette, { isImages: false, isAiMode: false });
    case 'google:img': return googleCss(palette, { isImages: true, isAiMode: false });
    case 'google:ai': return googleCss(palette, { isImages: false, isAiMode: true });
    case 'alice': return aliceCss(palette);
    case 'yandex': return yandexCss(palette);
    case 'ddg': return duckduckgoCss(palette);
    case 'bing': return bingCss(palette, { isCopilot: false });
    case 'bing:copilot': return bingCss(palette, { isCopilot: true });
    default: return null;
  }
}

function getSearchEngineCss(rawUrl, resolvedTheme, chromeThemeId, glass, hideAds = true) {
  if (typeof rawUrl !== 'string' || !rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  const variant = engineVariant(host, pathname, parsed);
  if (!variant) return null;

  const isDark = resolvedTheme !== 'light';
  const isGlass = Boolean(glass);
  const isGoogle = variant.startsWith('google');
  const ads = isGoogle && hideAds ? 1 : 0; // AdBlock влияет только на Google
  const themeId = String(chromeThemeId || '');
  // Хэш кастомной палитры в ключе нужен только для темы 'custom'
  const key = [variant, isDark ? 'd' : 'l', themeId, themeId === 'custom' ? customHash : '', isGlass ? 'g' : 's', ads].join('|');

  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const palette = themedPalette(isDark, themeId, isGlass);
  const css = buildEngineCss(variant, palette);
  if (!css) return null;
  const glassFix = isGlass && isGoogle ? GOOGLE_GLASS_FIX_CSS : '';
  const result = css + (ads ? GOOGLE_ADS_HIDE_CSS : '') + (isGlass ? glassBaseCss(palette) : '') + glassFix;
  cacheSet(key, result);
  return result;
}

// Палитра «из обоев»: регистрируем как ещё одну тему оболочки с id 'custom'
// Любая смена/сброс кастомной палитры меняет хэш (ключ) и очищает кеш CSS.
function setCustomTokens(tokens) {
  if (tokens && tokens.dark && tokens.light) {
    CHROME_TOKENS.dark.custom = tokens.dark;
    CHROME_TOKENS.light.custom = { ...(CHROME_TOKENS.light['cyber-blue'] || {}), ...tokens.light };
    let json = '';
    try { json = JSON.stringify([tokens.dark, tokens.light]); } catch { json = String(Date.now()); }
    customHash = hashString(json);
  } else {
    delete CHROME_TOKENS.dark.custom;
    delete CHROME_TOKENS.light.custom;
    customHash = '';
  }
  clearSearchCssCache();
}

module.exports = { setCustomTokens, isSearchEngineUrl, getSearchEngineCss, getAdaptivePayload, getSourceFilterPayload, getSourceFilterCss, clearSearchCssCache };
