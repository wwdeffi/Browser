// Вставьте в консоль DevTools ВКЛАДКИ (F12 на странице Google), когда видна реклама справа.
// Результат копируется в буфер обмена — пришлите его мне.
(() => {
  const short = (el) => {
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return el.localName + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  };
  const out = {
    // Слои браузера живут в изолированном мире preload и не оставляют глобальных свойств на window,
    // поэтому состояние фильтра смотрим по меткам в DOM (DOM общий со страницей)
    filterMarked: document.querySelectorAll('[data-pt-ok], [data-pt-no]').length,
    hidden: [...document.querySelectorAll('[data-pt-no]')].map((el) => short(el)),
    chains: []
  };
  const links = [...document.querySelectorAll('a[href]')].filter((a) => /privet\.ru/i.test(a.href)).slice(0, 2);
  for (const a of links) {
    const chain = [];
    for (let n = a, i = 0; n && n !== document.body && i < 14; n = n.parentElement, i++) {
      chain.push(short(n) + ' [ext-links=' + n.querySelectorAll('a[href^="http"]').length + (n.querySelector('h3') ? ', h3' : '') + (n.style.display === 'none' ? ', HIDDEN' : '') + ']');
    }
    out.chains.push({ href: a.href.slice(0, 100), chain });
  }
  const json = JSON.stringify(out, null, 1);
  try { copy(json); console.log('Скопировано в буфер обмена'); } catch { console.log(json); }
  console.dir(out);
})();
