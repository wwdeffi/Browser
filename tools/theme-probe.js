// Вставьте целиком в консоль DevTools ВКЛАДКИ (не окна браузера), когда проблема видна на экране.
// Скрипт сам копирует результат в буфер обмена — пришлите его мне.
(() => {
  const W = innerWidth, H = innerHeight;
  // Точки проверки (доли ширины/высоты) — подберите под ваши проблемные места
  const points = {
    'центр-середина':   [0.40, 0.45],
    'центр-низ(градиент)': [0.40, 0.90],
    'поле ввода':       [0.40, 0.93],
    'левая полоса':     [0.02, 0.50],
    'правая панель':    [0.88, 0.50],
    'верх-под вкладками': [0.40, 0.03],
  };

  const short = (el) => {
    const cls = (typeof el.className === 'string' ? el.className : '')
      .trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls : '');
  };

  const paints = (cs) => {
    const bg = cs.backgroundColor;
    const transparent = bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent';
    return {
      bg: transparent ? '' : bg,
      img: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 120) : '',
      mask: (cs.maskImage && cs.maskImage !== 'none') ? 'mask' : '',
      opacity: cs.opacity !== '1' ? cs.opacity : '',
      pos: cs.position !== 'static' ? cs.position : '',
      z: cs.zIndex !== 'auto' ? cs.zIndex : '',
    };
  };

  const out = {};
  for (const [name, [fx, fy]] of Object.entries(points)) {
    const stack = document.elementsFromPoint(W * fx, H * fy).slice(0, 14);
    const layers = [];
    for (const el of stack) {
      const p = paints(getComputedStyle(el));
      if (p.bg || p.img || p.mask) layers.push({ el: short(el), ...p });
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content !== 'none' && ps.content !== 'normal') {
          const pp = paints(ps);
          if (pp.bg || pp.img) layers.push({ el: short(el) + pseudo, ...pp });
        }
      }
      if (el.shadowRoot) layers.push({ el: short(el) + ' ⚠ SHADOW ROOT (CSS страницы/вашей темы туда не попадает)' });
    }
    out[name] = layers;
  }

  // Переменные на :root, которые содержат цвета
  const rootVars = {};
  const rs = getComputedStyle(document.documentElement);
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (r.style && /^(:root|html|body)/.test(r.selectorText || '')) {
        for (const n of r.style) {
          if (n.startsWith('--') && /color|surface|bg|background|fill|neutral/i.test(n))
            rootVars[n] = rs.getPropertyValue(n).trim();
        }
      }
    }
  }
  out.__rootColorVars = rootVars;
  out.__meta = { url: location.href, scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', W, H };

  const json = JSON.stringify(out, null, 1);
  try { copy(json); console.log('Скопировано в буфер обмена'); } catch { console.log(json); }
  console.dir(out);
})();
