// Тема оболочки «из обоев»: из одной «затравки» (средний цвет обоев + главный оттенок)
// строится полный набор цветов рамки, вкладок, адресной строки и страниц поиска.

const BASE_IDS = [
  'cyber-blue', 'nebula-violet', 'obsidian-chrome', 'crimson-eclipse',
  'aurora-emerald', 'tokyo-synth', 'sakura-midnight', 'solar-gold',
  'silver-cosmos', 'aurora-voxel', 'topo-noir', 'katana-noir'
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function sanitizeSeed(seed) {
  if (!seed || typeof seed !== 'object') return null;
  const h = num(seed.h), s = num(seed.s), l = num(seed.l), ah = num(seed.ah), as = num(seed.as);
  if ([h, s, l, ah, as].some((v) => v === null)) return null;
  const base = BASE_IDS.includes(seed.base) ? seed.base : 'cyber-blue';
  return {
    h: Math.round(((h % 360) + 360) % 360),
    s: +clamp(s, 0, 1).toFixed(3),
    l: +clamp(l, 0, 1).toFixed(3),
    ah: Math.round(((ah % 360) + 360) % 360),
    as: +clamp(as, 0, 1).toFixed(3),
    neutral: Boolean(seed.neutral),
    base
  };
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 1);
  l = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const hsl = (h, s, l) => hex(hslToRgb(h, s, l));
const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;

function buildCustomTheme(rawSeed) {
  const seed = sanitizeSeed(rawSeed);
  if (!seed) return null;

  // Почти серые обои (статуя, ч/б фото): оттенок среднего цвета там случайный и даёт тёплую
  // коричнево-розовую оболочку. Для них берём холодные сине-чёрные цвета новой вкладки
  // (рамка ≈ rgb(4, 5, 7), панели и карточки ≈ rgb(10, 12, 17)). Цветные обои красят оболочку как раньше.
  const tintless = seed.neutral || seed.s < 0.2;
  const fh = tintless ? 222 : seed.h;
  const fs = tintless ? 0.26 : clamp(seed.s * 0.8, 0.08, 0.38);
  const fl = tintless ? 0.02 : clamp(seed.l * 0.38, 0.065, 0.17);

  const frame = hsl(fh, fs, fl);
  const tab = hsl(fh, fs, fl + 0.05);
  const card = hsl(fh, fs, fl + 0.035);
  const url = hsl(fh, fs, fl + 0.03);
  const urlFocus = hsl(fh, fs, fl + 0.07);

  const accRgb = seed.neutral ? hslToRgb(fh, 0.1, 0.86) : hslToRgb(seed.ah, clamp(seed.as, 0.5, 0.8), 0.7);
  const acc2Rgb = seed.neutral ? hslToRgb(fh, 0.1, 0.65) : hslToRgb(seed.ah + 35, 0.55, 0.62);
  const hoverRgb = seed.neutral ? hslToRgb(fh, 0.08, 0.95) : hslToRgb(seed.ah, clamp(seed.as, 0.5, 0.8), 0.8);
  const accent = hex(accRgb), accent2 = hex(acc2Rgb), hover = hex(hoverRgb);

  const lightFrame = hsl(fh, clamp(fs, 0.12, 0.35), 0.92);
  const accentLight = seed.neutral ? hsl(fh, 0.12, 0.32) : hsl(seed.ah, 0.55, 0.38);
  const accent2Light = seed.neutral ? hsl(fh, 0.1, 0.45) : hsl(seed.ah + 35, 0.5, 0.42);
  const accentLightRgb = seed.neutral ? hslToRgb(fh, 0.12, 0.32) : hslToRgb(seed.ah, 0.55, 0.38);

  const css = `
:root[data-chrome-theme="custom"] {
  --bg-frame: ${frame};
  --bg-toolbar: ${frame};
  --bg-surface: ${rgba(hslToRgb(fh, fs * 1.1, fl + 0.16), 0.5)};
  --bg-surface-hover: ${rgba(hslToRgb(fh, fs * 1.1, fl + 0.24), 0.66)};
  --bg-tab-active: ${tab};
  --bg-url: ${url};
  --bg-url-focus: ${urlFocus};
  --bg-card: ${card};
  --bg-page: ${hsl(fh, fs, Math.max(fl - 0.025, 0.03))};
  --border-subtle: ${rgba(accRgb, 0.12)};
  --border-strong: ${rgba(accRgb, 0.32)};
  --accent: ${accent};
  --accent-2: ${accent2};
  --accent-hover: ${hover};
  --accent-soft: ${rgba(accRgb, 0.16)};
  --accent-ring: ${rgba(accRgb, 0.28)};
  --accent-glow: ${rgba(accRgb, 0.36)};
}
:root[data-theme="light"][data-chrome-theme="custom"] {
  --bg-frame: ${lightFrame};
  --bg-toolbar: ${lightFrame};
  --bg-surface: ${rgba(hslToRgb(fh, 0.2, 0.2), 0.08)};
  --bg-surface-hover: ${rgba(hslToRgb(fh, 0.2, 0.2), 0.14)};
  --bg-tab-active: ${hsl(fh, clamp(fs, 0.12, 0.35), 0.97)};
  --bg-url: ${hsl(fh, clamp(fs, 0.12, 0.35), 0.97)};
  --bg-url-focus: #ffffff;
  --bg-card: ${hsl(fh, clamp(fs, 0.12, 0.35), 0.99)};
  --bg-page: ${hsl(fh, clamp(fs, 0.12, 0.35), 0.95)};
  --border-subtle: ${rgba(hslToRgb(fh, 0.2, 0.2), 0.12)};
  --border-strong: ${rgba(hslToRgb(fh, 0.2, 0.2), 0.26)};
  --accent: ${accentLight};
  --accent-2: ${accent2Light};
  --accent-ring: ${rgba(accentLightRgb, 0.22)};
}
`;

  return {
    seed,
    frame,
    lightFrame,
    css,
    // Токены для страниц поиска (см. themedPalette в searchTheme.js)
    search: {
      dark: {
        bg: frame, card, input: url, focus: urlFocus,
        border: rgba(accRgb, 0.26), accent, accent2, hover, soft: rgba(accRgb, 0.16)
      },
      light: { accent: accentLight, accent2: accent2Light, ring: rgba(accentLightRgb, 0.22) }
    },
    accents: { accent, accent2 }
  };
}

module.exports = { BASE_IDS, sanitizeSeed, buildCustomTheme };
