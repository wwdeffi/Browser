// ─────────────────────────────────────────────────────────────────────────────
// Конфиг CSS-селекторов страниц поиска (Google, Яндекс, Алиса, DuckDuckGo, Bing).
//
// Здесь собраны ВСЕ «хрупкие» селекторы — те, что завязаны на вёрстку чужих сайтов и ломаются
// при её обновлении (обфусцированные классы Google вроде .RNNXgb / .G8GJkb, BEM-классы Яндекса,
// классы Bing Copilot и т.п.). Если после обновления поисковика тема «поехала», чинить нужно ТОЛЬКО
// этот файл: searchTheme.js лишь подставляет селекторы в шаблоны CSS и от вёрстки не зависит.
//
// Правила файла:
//   • значение — строка (один селектор) или массив строк (список селекторов через запятую);
//   • группировка: поисковик → логическая роль (page / header / footer / searchBox / results /
//     rightColumn / buttons / ai / ...);
//   • «производные» селекторы (:hover, ::before, дочерние) НЕ дублируются — searchTheme.js
//     достраивает их из базового (см. комментарии «+ :hover» и т.п.);
//   • служебные атрибуты самого браузера (data-pt-*) сюда не входят — это не селекторы чужой
//     вёрстки, а метки, которые ставит preload/tabPreload.js; они остаются в searchTheme.js.
//
// ВНИМАНИЕ: preload/tabPreload.js работает в изолированном мире вкладки и подключает только
// 'electron' (локальные модули из него не загрузить), поэтому несколько Google-селекторов там
// продублированы строками. При смене вёрстки Google правьте их В ОБОИХ местах:
//   google.ads.aiOverviewAside       ↔ tabPreload.js: querySelectorAll('[data-xid^="aim-aside"]')
//   google.ai.sources.link           ↔ tabPreload.js: querySelectorAll('a[href^="/goto?url="]')
//   google.ai.sources.siteName       ↔ tabPreload.js: li.querySelector('.EsfOKc')
//   google.ai.sources.favicon        ↔ tabPreload.js: li.querySelector('img[src*="faviconV2"]')
// (siteName и favicon в CSS не используются, перечислены здесь только как справка о связи.)
// ─────────────────────────────────────────────────────────────────────────────

function deepFreeze(obj) {
  Object.values(obj).forEach((v) => {
    if (v && typeof v === 'object') deepFreeze(v);
  });
  return Object.freeze(obj);
}

// Общие куски, которые повторяются внутри одного поисковика
const GOOGLE_RESULT_ROW = '#rso .MjjYud';
const YANDEX_CARD = 'li.serp-item';
const DDG_CARD = 'article[data-testid="result"]';
const BING_CHAT_BOX = 'div:has(textarea):has(button, [role="button"]):not(:has(div:has(textarea):has(button, [role="button"])))';
const BING_RICH_BOX = 'div:has([role="textbox"], [contenteditable="true"]):has(button, [role="button"]):not(:has(div:has([role="textbox"], [contenteditable="true"]):has(button, [role="button"])))';

const SELECTORS = {
  // ═══════════════════════════════════════════════════════════════════════════
  // GOOGLE  (обычная выдача, Картинки udm=2/tbm=isch, Режим ИИ udm=50, Обзор от ИИ)
  // ═══════════════════════════════════════════════════════════════════════════
  google: {
    // Фон страницы и крупные контейнеры (красятся цветом bg)
    page: ['html', 'body', '#main', '#cnt', '#rcnt'],

    // Шапка: только панель вкладок и доп. полосы. Слои строки поиска (.sfbg/.yg51vc/.CvDJxb) НЕ красим
    header: ['#appbar', '#extabar', '#top_nav', '#hdtb', '#hdtb-msb'],

    // Футер: нижняя навигация и подвалы (в т.ч. контейнер главной)
    footer: ['#botabar', '#fbar', '.f6F9Be', 'footer', '.c93Gbe', '.o3j99', '.L3eUgb'],

    // Строка поиска
    searchBox: {
      stickySearchForm: '#searchform.minidiv',                          // прилипающая шапка с поиском при прокрутке
      stickySearchFormBg: ['#searchform.minidiv .sfbg', '.minidiv .sfbg'], // её внутренняя подложка (делаем прозрачной)
      pill: '.RNNXgb',                                                   // «пилюля» поля ввода (+ :hover, :focus-within)
      pillWithSuggest: '.emcav .RNNXgb',                                 // пилюля при открытых подсказках (скругление только сверху)
      suggestDropdown: ['.UUbT9', '.aajZCb'],                            // выпадающий список подсказок
      suggestHighlight: '.sbhl'                                          // подсвеченная часть подсказки
    },

    // Карточки выдачи
    results: {
      // Карточка обычного результата (+ :hover); :has(a, #wob_wc) — чтобы не рамить пустые блоки; #wob_wc — виджет погоды
      card: `${GOOGLE_RESULT_ROW}:not(:has(.MjjYud)):has(a, #wob_wc)`,
      // Внутренний слой карточки с нижним отступом (в карточке отступ обнуляется)
      cardInnerSpacer: `${GOOGLE_RESULT_ROW} .Ww4FFb`,
      // Вложенные слои карточки: без своего фона/тени, иначе «рамка в рамке»
      cardInnerLayers: [
        `${GOOGLE_RESULT_ROW} .Ww4FFb`,
        `${GOOGLE_RESULT_ROW} .vt6azd`,
        `${GOOGLE_RESULT_ROW} .tF2Cxc`,
        `${GOOGLE_RESULT_ROW} .hlcw0c`,
        `${GOOGLE_RESULT_ROW} .kvH3mc`,
        `${GOOGLE_RESULT_ROW} .g`,
        '#wob_wc'
      ],
      // Контейнеры ссылок заголовков; из них строятся «<scope> h3», «<scope>:hover h3», «<scope>:visited h3»
      // (для «<scope>:hover» без h3 используется ПЕРВЫЙ элемент списка)
      titleLinkScopes: ['#search a', '#rso a'],
      snippet: ['.VwiC3b', '.lEBKkf'],               // описание под заголовком
      urlLine: ['cite', '.qLRx3b', '.VuuXrf']        // строка с адресом / «хлебные крошки»
    },

    // Правая колонка (панель знаний)
    rightColumn: {
      knowledgePanel: ['#rhs .kp-wholepage', '#rhs .osrp-blk']
    },

    // Вкладка «Картинки»
    images: {
      stickyNav: ['div[role="navigation"]', '.IUOThf']  // панель фильтров над сеткой
    },

    // Кнопки и чипсы
    buttons: {
      search: ['.gNO89b', '.RNmpXc'],                   // «Поиск в Google», «Мне повезёт» (+ :hover)
      // Кнопка «Войти» (красится только в тёмной теме; + :hover)
      login: ['a[href*="accounts.google.com/ServiceLogin"]', 'a.gb_Aa', 'a.gb_Ba']
    },

    // ИИ: «Обзор от ИИ» в обычной выдаче и Режим ИИ (udm=50)
    ai: {
      // Поле «Задайте вопрос» и его окружение (общее для Режима ИИ и развёрнутого Обзора).
      // Классы найдены через theme-probe — могут смениться при обновлении Google.
      composer: {
        inputFill: 'span.G8GJkb',            // заливка поля ввода
        bottomFade: 'div.Zze5V',             // нижнее «затухание» под полем и подложка панели
        fogAbove: ['div.bPlg5e'],            // туман над строкой «Задайте вопрос»
        fogExpand: ['div.iIXkZe.LrrQLb', 'div.LrrQLb'] // туман над кнопкой «Развернуть»
      },

      // Только Режим ИИ (udm=50)
      mode: {
        content: ['main', '[role="main"]', '#cnt', '#rcnt', '#center_col'],
        // Внешние прилипающие обёртки вокруг нижней панели
        composerWrappers: [
          'div:has(> div:has(textarea):has(button, [role="button"])):not(:has([role="navigation"]))',
          'div:has(> div > div:has(textarea):has(button, [role="button"])):not(:has([role="navigation"]))',
          'div:has(> form textarea):not(:has([role="navigation"]))'
        ],
        // Внутренняя скруглённая карточка поля «Задайте вопрос»
        composerCard: [
          'div:has(textarea):has(button, [role="button"]):not(:has(div:has(textarea):has(button, [role="button"]))):not(:has(h1, h2, h3, table, [role="navigation"]))',
          'div:has([contenteditable="true"]):has(button, [role="button"]):not(:has(div:has([contenteditable="true"]):has(button, [role="button"]))):not(:has(h1, h2, h3, table, [role="navigation"]))',
          'form:has(textarea):not(:has([role="navigation"]))'
        ],
        // Прямые обёртки самого textarea (делаем прозрачными)
        composerInner: [
          'div:has(> textarea)',
          'div:has(> div > textarea):not(:has(button, [role="button"]))',
          'div:has(> [contenteditable="true"])'
        ],
        textInput: ['textarea', '[contenteditable="true"]'],
        // Карточки в боковой панели / «правой колонке» Режима ИИ
        sidebarCards: ['[role="complementary"] a', 'aside a', '#rhs li', '#rhs a[data-hveid]'],
        // Левая закреплённая полоса (+ её ::before)
        leftRail: 'div.qEn1od'
      },

      // Карточки источников в Обзоре от ИИ (их фильтрует preload/tabPreload.js)
      sources: {
        link: 'a[href^="/goto?url="]',      // ссылка-источник; карточка = ближайший li
        siteName: '.EsfOKc',                // подпись сайта в карточке (используется только в preload)
        favicon: 'img[src*="faviconV2"]'    // значок источника (используется только в preload)
      }
    },

    // Реклама (скрывается целиком при включённом AdBlock)
    ads: {
      aiOverviewAside: '[data-xid^="aim-aside"]', // боковая врезка в ИИ-ответе (то же ищет preload)
      blocks: [
        '#tads', '#tadsb', '#bottomads', '#tvcap', '#taw', '#rhs_ads',
        '#rso > div:has(> [data-text-ad])',
        '[data-text-ad]',
        '.commercial-unit-desktop-top', '.commercial-unit-desktop-rhs',
        '.cu-container', '.pla-unit-container', '.pla-hovercard-content-ph', '[data-pla="1"]',
        'div[aria-label="Реклама"]', 'div[aria-label="Ads"]', 'div[aria-label="Sponsored"]'
      ]
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ЯНДЕКС  (ya.ru / yandex.* → /search)
  // ═══════════════════════════════════════════════════════════════════════════
  yandex: {
    page: ['html', 'body', '.main', '.content'],
    header: ['.serp-header', '.HeaderDesktop'],
    footer: ['.FooterDesktop'],

    // Строка поиска
    searchBox: {
      inputWrapper: ['.search3__input-wrapper', '.HeaderDesktopForm-InputBox', '.mini-suggest__input'],
      inputText: ['.search3__input', '.input__control']
    },

    // Карточки выдачи
    results: {
      card: YANDEX_CARD,                                       // (+ :hover)
      // Фавиконка вынесена за левый край карточки — даём ей место (padding-left)
      favicon: '[class*="favicon" i]',
      // Рекламные блоки (карточка с таким маркером скрывается)
      adMarkers: ['[aria-label="Реклама"]', '.AdvLabel', '[class*="AdvLabel"]'],
      // Вложенные слои внутри карточки — без своей рамки/фона
      cardInnerLayers: [
        `${YANDEX_CARD} .serp-item__card`,
        `${YANDEX_CARD} .Organic`,
        `${YANDEX_CARD} .Organic-Content`,
        `${YANDEX_CARD} .organic__content-wrapper`
      ],
      titleLink: ['.OrganicTitle-LinkText', '.OrganicTitleContentSpan', `${YANDEX_CARD} h2 a`],
      snippet: ['.OrganicTextContentSpan', '.TextContainer']
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // АЛИСА  (ya.ru / yandex.* → /alice)
  // ═══════════════════════════════════════════════════════════════════════════
  alice: {
    // Крупные контейнеры чата (фон + цвет текста); [class*=...] — нестрогие, ловят хэшированные классы
    layout: [
      'html', 'body', '#root', '#app', 'main', 'aside', 'nav', 'header',
      '[class*="Layout"]', '[class*="Sidebar"]', '[class*="Chat"]'
    ],

    // Корневой элемент со скином Яндекса: на нём лежат --depot-* переменные (найдено через theme-probe)
    skinRoot: 'html[class*="i-ua_skin"]',

    // Поле ввода (сообщение Алисе)
    searchBox: {
      inputCard: [
        'div:has(textarea):has(button, [role="button"]):not(:has(div:has(textarea):has(button, [role="button"]))):not(:has(h1, h2, h3, nav))',
        'div:has([contenteditable="true"]):has(button, [role="button"]):not(:has(div:has([contenteditable="true"]):has(button, [role="button"]))):not(:has(h1, h2, h3, nav))'
      ],
      textInput: ['textarea', '[contenteditable="true"]']
    },

    // Нейроответы / чат: нижняя закреплённая панель и её поле ввода (были #18181a и #262626)
    chat: {
      bottomBar: 'div.Standalone.Standalone_type_chat.Standalone_has-input',
      inputField: 'div.AliceInput.StandaloneRichInput'
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DUCKDUCKGO
  // ═══════════════════════════════════════════════════════════════════════════
  ddg: {
    page: ['html', 'body', '.site-wrapper', '.body--serp', '#web_content_wrapper'],
    header: ['#header_wrapper', '.header-wrap', '#duckbar', '#duckbar_static', '.header__search-wrap', '.header--aside'],
    answers: ['.zci-wrapper'],   // блок мгновенных ответов (красится как страница)

    // Строка поиска
    searchBox: {
      form: ['#search_form', '#search_form_homepage'],
      // Внутренние элементы пилюли — прозрачные (убираем светло-серую вставку)
      innerControls: ['#search_form_input', '#search_form_input_homepage', '.search__input', '.search__clear', '.search__button'],
      // Серый овал-обёртка вокруг input (найдено через DevTools) — делаем прозрачной
      inputWrapper: '#search_form div:has(input[name="q"])',
      // Та же обёртка, но с несимметричным padding — выравниваем
      inputWrapperPadding: '#search_form div:has(> div > div > input[name="q"])'
    },

    // Карточки выдачи
    results: {
      card: DDG_CARD,                  // (+ :hover)
      titleLink: `${DDG_CARD} h2 a`    // (+ :hover)
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BING  (классическая выдача /search)
  // ═══════════════════════════════════════════════════════════════════════════
  bing: {
    page: ['html', 'body', '#b_content'],
    header: ['#b_header'],            // + нижняя граница
    footer: ['#b_footer'],
    tween: '#b_tween',                // полоса «Результатов: N» под шапкой (красится как страница)

    // Строка поиска
    searchBox: {
      form: '.b_searchboxForm',
      input: '#sb_form_q',
      suggestDropdown: ['#sw_as .sa_as', '.sa_drw'],
      suggestHover: ['.sa_sg:hover', '.sa_hv']
    },

    // Приглушённый текст шапки и вкладок
    nav: {
      mutedText: ['.b_scopebar li a', '#b_tween', '#b_tween a', '#sp_requery', '.b_sp_txt', '.b_topTitle'],
      activeLinks: ['#sp_requery a', '.b_scopebar .b_active a']
    },

    // Карточки выдачи
    results: {
      organicCard: '#b_results > li.b_algo',   // (+ :hover)
      answerCard: '#b_results > li.b_ans',
      titleLinks: ['#b_results h2 a', '#b_context h2 a', '#b_results a strong'],
      text: ['#b_results p', '#b_results .b_caption', '#b_results .b_factrow', '#b_results cite']
    },

    // Правая колонка (#b_context)
    rightColumn: {
      answerCard: '#b_context > li.b_ans',
      relatedCard: '#b_context .b_rs',
      headings: ['#b_context', '#b_context h2', '#b_context h3', '.b_rs h2'],
      listItems: ['#b_context .b_rs li', '#b_context .b_vList li', '.b_rs li'],  // прозрачные элементы списков
      // Чипсы «Похожие запросы»: ссылки (+ :hover) и текстовые подсказки
      chipLinks: ['#b_context .b_rs a', '#b_context .b_vList a', '.b_rs a'],
      chipText: ['.b_suggestionText'],
      // Виджеты и карточки (погода, сущности, подмодули)
      widgets: ['.wtr_card', '.b_wpt_bg', '.b_cards', '.b_cards2', '.b_subModule', '.b_entityTP']
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BING COPILOT / «Поиск ИИ»  (/copilotsearch)
  // ═══════════════════════════════════════════════════════════════════════════
  bingCopilot: {
    // Крупные контейнеры страницы и колонок
    layout: [
      'html', 'body', 'main', 'header', 'nav', 'aside', 'section',
      '[role="main"]', '[role="navigation"]', '#b_header', '#b_content'
    ],

    // Поле ввода запроса
    searchBox: {
      chatCard: [
        `${BING_CHAT_BOX}:not(:has(h1, h2, h3, [role="navigation"]))`,
        'form:has(textarea)'
      ],
      chatCardInner: 'div:has(> textarea)',                 // прямая обёртка textarea (прозрачная)
      textInputs: ['textarea', 'input[type="text"]', 'input[type="search"]'],
      // Многострочное поле (textbox / contenteditable) и его скруглённая карточка
      richCard: `${BING_RICH_BOX}:not(:has(h1, h2, h3, [role="navigation"]))`,
      richText: ['[role="textbox"]', '[contenteditable="true"]']
    },

    // Ссылки и карточки в боковой колонке
    rightColumn: {
      sideLinks: ['aside a', '[role="complementary"] a']
    },

    // Коричневатые градиенты-«затухания» сверху/снизу
    fades: {
      tintScope: 'html *:not(img):not(svg):not(path):not(button)',
      layers: ['div[class*="gradient" i]', 'div[class*="fade" i]', 'div[class*="scrim" i]']
    },

    // Найдено через theme-probe (классы Bing могут смениться)
    probe: {
      inputCard: 'div.b_uc',                                         // карточка поля ввода (была #3b3a39)
      composer: 'div.b_copilot_composer',                            // нижняя панель (+ ::before/::after — затухание), была #1b1a19
      sidebar: ['div#b_copilot_sidebar', 'div.b_copilot_sidebar', 'div.b_cpsv2_left_panel'], // левая колонка
      scopebar: 'div.b_cpsv2_scopebar'                               // верхнее затухание под панелью вкладок
    }
  }
};

module.exports = deepFreeze(SELECTORS);
