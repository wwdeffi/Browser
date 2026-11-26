'use strict';

(() => {
  const PREFS_KEY = 'mybrowser_nt_studio_v2';
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const DEFAULT_PREFS = {
    themeId: null,
    accentId: 'cyber-blue',
    autoAccentFor: 0,
    wallSeed: null,
    customAccent: null,
    cardColor: null,
    clockColor: null,
    textMode: 'auto',
    animateBg: !prefersReducedMotion,
    parallax: !prefersReducedMotion,
    linksLayout: 'grid',
    glassAlpha: 56,
    hudBlur: true,
    hudBorder: true,
    showWeather: true,
    showSideDock: true,
    showSavedBm: true,
    weatherPlace: null,
    showSeconds: true,
    showGreeting: true
  };

  const LEGACY_MAP = {
    'obsidian-mist': 'cyber-blue',
    'shadow-monolith': 'obsidian-chrome',
    'eclipse-noir': 'crimson-eclipse',
    'abyss-aurora': 'aurora-emerald',
    'pure-carbon': 'solar-gold'
  };

  // Звёздное небо для Silver Cosmos: детерминированный генератор, чтобы звёзды не «прыгали»
  function buildCosmosSvg() {
    let seed = 20261119;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let stars = '';
    for (let i = 0; i < 520; i++) {
      const x = (rnd() * 1600).toFixed(1);
      const y = (rnd() * 900).toFixed(1);
      const big = rnd();
      const r = big > 0.985 ? 2.1 : big > 0.9 ? 1.25 : 0.7;
      const o = (0.28 + rnd() * 0.72).toFixed(2);
      stars += `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" fill-opacity="${o}"/>`;
    }
    return `
      <defs>
        <radialGradient id="sc-halo" cx="50%" cy="58%" r="46%">
          <stop offset="0%" stop-color="#e2e8f0" stop-opacity="0.16"/>
          <stop offset="55%" stop-color="#64748b" stop-opacity="0.05"/>
          <stop offset="100%" stop-color="#050506" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="sc-chrome" cx="34%" cy="26%" r="78%">
          <stop offset="0%" stop-color="#f8fafc"/>
          <stop offset="14%" stop-color="#9aa4b4"/>
          <stop offset="34%" stop-color="#1c1f27"/>
          <stop offset="52%" stop-color="#727c8c"/>
          <stop offset="70%" stop-color="#0d0f14"/>
          <stop offset="100%" stop-color="#030304"/>
        </radialGradient>
        <linearGradient id="sc-rim" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.85"/>
          <stop offset="50%" stop-color="#94a3b8" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.5"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#sc-halo)"/>
      ${stars}
      <circle cx="1260" cy="860" r="330" fill="url(#sc-chrome)" fill-opacity="0.9"/>
      <circle cx="1260" cy="860" r="330" fill="none" stroke="url(#sc-rim)" stroke-width="1.6"/>
      <ellipse cx="1130" cy="640" rx="120" ry="40" transform="rotate(-28 1130 640)" fill="#fff" fill-opacity="0.14"/>
      <path d="M1060,720 C1130,690 1230,690 1310,730" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="2.4" stroke-linecap="round"/>
    `;
  }

  const THEMES = [
    {
      id: 'cyber-blue',
      name: 'Cyber Blue',
      sub: 'Неоновый киберпанк',
      accent: '#38bdf8',
      accent2: '#6366f1',
      accentSoft: 'rgba(56, 189, 248, 0.17)',
      accentGlow: 'rgba(56, 189, 248, 0.44)',
      glassRgb: '8, 13, 28',
      clockGrad: 'linear-gradient(135deg, #ffffff 10%, #bae6fd 65%, #818cf8 100%)',
      isLight: false,
      effect: 'cyber',
      thumb: 'radial-gradient(circle at 60% 34%, rgba(56,189,248,0.65), rgba(37,99,235,0.45) 45%, #060b1a 88%)',
      bg: 'radial-gradient(ellipse 75% 65% at 54% 38%, #10254a 0%, #091126 52%, #040712 100%)',
      svg: `
        <defs>
          <radialGradient id="cb-core" cx="53%" cy="43%" r="44%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.46"/>
            <stop offset="38%" stop-color="#2563eb" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#040712" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="cb-aura" cx="62%" cy="22%" r="36%">
            <stop offset="0%" stop-color="#818cf8" stop-opacity="0.26"/>
            <stop offset="100%" stop-color="#040712" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="cb-beam" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#1d4ed8" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="cb-floor" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.2"/>
            <stop offset="45%" stop-color="#0f172a" stop-opacity="0.72"/>
            <stop offset="100%" stop-color="#03050c" stop-opacity="0.98"/>
          </linearGradient>
          <filter id="cb-glow"><feGaussianBlur stdDeviation="8"/></filter>
        </defs>
        <rect width="1600" height="900" fill="url(#cb-core)"/>
        <rect width="1600" height="900" fill="url(#cb-aura)"/>
        <polygon points="730,0 970,0 1230,900 470,900" fill="url(#cb-beam)"/>
        <circle cx="845" cy="410" r="230" fill="none" stroke="#38bdf8" stroke-opacity="0.18" stroke-width="1.5"/>
        <circle cx="845" cy="410" r="192" fill="none" stroke="#7dd3fc" stroke-opacity="0.42" stroke-width="2" stroke-dasharray="95 28 36 28"/>
        <circle cx="845" cy="410" r="165" fill="none" stroke="#6366f1" stroke-opacity="0.34" stroke-width="1.2" stroke-dasharray="14 14"/>
        <circle cx="845" cy="410" r="136" fill="#071226" fill-opacity="0.62" stroke="#38bdf8" stroke-opacity="0.5" stroke-width="1.5"/>
        <circle cx="845" cy="410" r="138" fill="none" stroke="#38bdf8" stroke-opacity="0.45" stroke-width="6" filter="url(#cb-glow)"/>
        <path d="M0,715 L95,715 L95,620 L145,620 L145,675 L210,675 L210,560 L265,560 L265,650 L360,650 L360,610 L420,610 L420,690 L520,690 L520,575 L575,540 L615,575 L615,675 L740,675 L740,630 L940,630 L940,680 L1055,680 L1055,545 L1120,545 L1120,640 L1210,640 L1210,585 L1280,585 L1280,665 L1380,665 L1380,600 L1455,600 L1455,690 L1600,690 L1600,900 L0,900 Z" fill="#060b18" fill-opacity="0.92"/>
        <rect y="710" width="1600" height="190" fill="url(#cb-floor)"/>
        <g stroke="#38bdf8" stroke-opacity="0.16" stroke-width="1">
          <line x1="0" y1="745" x2="1600" y2="745"/>
          <line x1="0" y1="790" x2="1600" y2="790"/>
          <line x1="0" y1="848" x2="1600" y2="848"/>
          <line x1="845" y1="710" x2="120" y2="900"/>
          <line x1="845" y1="710" x2="480" y2="900"/>
          <line x1="845" y1="710" x2="845" y2="900"/>
          <line x1="845" y1="710" x2="1210" y2="900"/>
          <line x1="845" y1="710" x2="1520" y2="900"/>
        </g>
      `
    },
    {
      id: 'nebula-violet',
      name: 'Nebula Violet',
      sub: 'Космическая туманность',
      accent: '#c084fc',
      accent2: '#f472b6',
      accentSoft: 'rgba(192, 132, 252, 0.18)',
      accentGlow: 'rgba(192, 132, 252, 0.46)',
      glassRgb: '18, 10, 34',
      clockGrad: 'linear-gradient(135deg, #ffffff 10%, #e9d5ff 62%, #f472b6 100%)',
      isLight: false,
      effect: 'starfield',
      thumb: 'radial-gradient(circle at 50% 42%, rgba(217,70,239,0.68), rgba(109,40,217,0.5) 48%, #090516 90%)',
      bg: 'radial-gradient(ellipse 80% 70% at 52% 40%, #241046 0%, #100822 54%, #06030e 100%)',
      svg: `
        <defs>
          <radialGradient id="nv-c1" cx="50%" cy="42%" r="44%">
            <stop offset="0%" stop-color="#e879f9" stop-opacity="0.44"/>
            <stop offset="45%" stop-color="#7c3aed" stop-opacity="0.22"/>
            <stop offset="100%" stop-color="#06030e" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="nv-c2" cx="34%" cy="58%" r="38%">
            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#06030e" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="nv-c3" cx="68%" cy="32%" r="35%">
            <stop offset="0%" stop-color="#f472b6" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="#06030e" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="nv-ring" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#f472b6" stop-opacity="0.08"/>
            <stop offset="50%" stop-color="#f5d0fe" stop-opacity="0.72"/>
            <stop offset="100%" stop-color="#a855f7" stop-opacity="0.08"/>
          </linearGradient>
          <linearGradient id="nv-planet" x1="25%" y1="15%" x2="80%" y2="85%">
            <stop offset="0%" stop-color="#c084fc" stop-opacity="0.52"/>
            <stop offset="45%" stop-color="#2e1065"/>
            <stop offset="100%" stop-color="#090414"/>
          </linearGradient>
          <filter id="nv-blur"><feGaussianBlur stdDeviation="24"/></filter>
        </defs>
        <rect width="1600" height="900" fill="url(#nv-c1)"/>
        <rect width="1600" height="900" fill="url(#nv-c2)"/>
        <rect width="1600" height="900" fill="url(#nv-c3)"/>
        <path d="M120,620 C390,340 680,290 940,420 C1180,540 1350,300 1560,210 L1600,480 C1280,680 940,590 610,680 C340,750 140,730 0,690 Z" fill="#a855f7" fill-opacity="0.16" filter="url(#nv-blur)"/>
        <ellipse cx="810" cy="415" rx="340" ry="62" transform="rotate(-17 810 415)" fill="none" stroke="url(#nv-ring)" stroke-width="5"/>
        <circle cx="810" cy="415" r="142" fill="url(#nv-planet)" stroke="#e9d5ff" stroke-opacity="0.32" stroke-width="1.5"/>
        <path d="M510,505 C690,468 955,382 1105,326" fill="none" stroke="url(#nv-ring)" stroke-width="4" stroke-linecap="round"/>
        <path d="M0,785 Q340,685 690,745 T1360,720 L1600,765 L1600,900 L0,900 Z" fill="#090516" fill-opacity="0.92"/>
      `
    },
    {
      id: 'obsidian-chrome',
      name: 'Obsidian Chrome',
      sub: 'Тёмный металл и лёд',
      accent: '#e2e8f0',
      accent2: '#818cf8',
      accentSoft: 'rgba(226, 232, 240, 0.15)',
      accentGlow: 'rgba(203, 213, 225, 0.36)',
      glassRgb: '11, 13, 19',
      clockGrad: 'linear-gradient(135deg, #ffffff 15%, #cbd5e1 68%, #94a3b8 100%)',
      isLight: false,
      effect: 'shards',
      thumb: 'linear-gradient(145deg, #090a0e 0%, #2a2f42 52%, #06070a 100%)',
      bg: 'radial-gradient(ellipse 70% 62% at 50% 34%, #1e2230 0%, #0d0f16 54%, #050609 100%)',
      svg: `
        <defs>
          <radialGradient id="oc-halo" cx="50%" cy="40%" r="44%">
            <stop offset="0%" stop-color="#f8fafc" stop-opacity="0.3"/>
            <stop offset="48%" stop-color="#64748b" stop-opacity="0.1"/>
            <stop offset="100%" stop-color="#050609" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="oc-slash" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
            <stop offset="50%" stop-color="#cbd5e1" stop-opacity="0.06"/>
            <stop offset="100%" stop-color="#050609" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="oc-prism-l" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#080a0f"/>
          </linearGradient>
          <linearGradient id="oc-prism-r" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#040508"/>
          </linearGradient>
          <filter id="oc-glow"><feGaussianBlur stdDeviation="7"/></filter>
        </defs>
        <rect width="1600" height="900" fill="url(#oc-halo)"/>
        <polygon points="410,0 640,0 1160,900 910,900" fill="url(#oc-slash)"/>
        <polygon points="1030,0 1180,0 680,900 540,900" fill="url(#oc-slash)" opacity="0.55"/>
        <polygon points="800,155 685,430 800,670" fill="url(#oc-prism-l)" stroke="#e2e8f0" stroke-opacity="0.34" stroke-width="1.2"/>
        <polygon points="800,155 915,430 800,670" fill="url(#oc-prism-r)" stroke="#94a3b8" stroke-opacity="0.24" stroke-width="1.2"/>
        <line x1="800" y1="155" x2="800" y2="670" stroke="#ffffff" stroke-opacity="0.55" stroke-width="1.4"/>
        <polygon points="800,155 915,430 800,670 685,430" fill="none" stroke="#e2e8f0" stroke-opacity="0.3" stroke-width="5" filter="url(#oc-glow)"/>
        <polygon points="565,335 612,370 578,425" fill="#181c28" stroke="#cbd5e1" stroke-opacity="0.28"/>
        <polygon points="1025,295 1068,355 1005,375" fill="#141824" stroke="#cbd5e1" stroke-opacity="0.24"/>
        <path d="M0,750 L290,665 L580,740 L800,685 L1060,745 L1350,670 L1600,745 L1600,900 L0,900 Z" fill="#06070b"/>
      `
    },
    {
      id: 'crimson-eclipse',
      name: 'Crimson Eclipse',
      sub: 'Алое затмение',
      accent: '#fb7185',
      accent2: '#ef4444',
      accentSoft: 'rgba(244, 63, 94, 0.18)',
      accentGlow: 'rgba(244, 63, 94, 0.46)',
      glassRgb: '22, 9, 13',
      clockGrad: 'linear-gradient(135deg, #ffffff 10%, #fecdd3 64%, #fb7185 100%)',
      isLight: false,
      effect: 'embers',
      thumb: 'radial-gradient(circle at 50% 45%, #070406 20%, rgba(244,63,94,0.85) 33%, #19070d 72%)',
      bg: 'radial-gradient(ellipse 75% 65% at 50% 40%, #2a0a14 0%, #120509 55%, #060204 100%)',
      svg: `
        <defs>
          <radialGradient id="ce-corona" cx="50%" cy="41%" r="34%">
            <stop offset="40%" stop-color="#fb7185" stop-opacity="0.62"/>
            <stop offset="58%" stop-color="#e11d48" stop-opacity="0.24"/>
            <stop offset="100%" stop-color="#060204" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="ce-water" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#f43f5e" stop-opacity="0.22"/>
            <stop offset="45%" stop-color="#14060a" stop-opacity="0.88"/>
            <stop offset="100%" stop-color="#050203"/>
          </linearGradient>
          <filter id="ce-glow"><feGaussianBlur stdDeviation="10"/></filter>
        </defs>
        <circle cx="800" cy="370" r="340" fill="url(#ce-corona)"/>
        <circle cx="800" cy="370" r="142" fill="#070204" stroke="#fda4af" stroke-opacity="0.88" stroke-width="3"/>
        <circle cx="800" cy="370" r="145" fill="none" stroke="#f43f5e" stroke-opacity="0.7" stroke-width="10" filter="url(#ce-glow)"/>
        <path d="M0,700 L220,565 L440,655 L680,520 L800,590 L980,505 L1250,640 L1440,575 L1600,675 L1600,900 L0,900 Z" fill="#110509"/>
        <path d="M0,750 L310,675 L640,720 L980,670 L1320,730 L1600,695 L1600,900 L0,900 Z" fill="#090306"/>
        <g fill="#050203">
          <path d="M718,622 Q800,636 882,622 L877,634 Q800,646 723,634 Z"/>
          <rect x="742" y="646" width="116" height="8" rx="2"/>
          <rect x="756" y="634" width="11" height="92"/>
          <rect x="833" y="634" width="11" height="92"/>
          <rect x="795" y="634" width="10" height="18"/>
        </g>
        <rect y="730" width="1600" height="170" fill="url(#ce-water)"/>
        <g fill="#fb7185" fill-opacity="0.34">
          <rect x="740" y="756" width="120" height="2" rx="1"/>
          <rect x="762" y="778" width="76" height="2" rx="1"/>
          <rect x="776" y="802" width="48" height="2" rx="1"/>
          <rect x="786" y="828" width="28" height="2" rx="1"/>
        </g>
      `
    },
    {
      id: 'aurora-emerald',
      name: 'Aurora Fjord',
      sub: 'Северное сияние',
      accent: '#34d399',
      accent2: '#22d3ee',
      accentSoft: 'rgba(52, 211, 153, 0.17)',
      accentGlow: 'rgba(52, 211, 153, 0.42)',
      glassRgb: '7, 20, 19',
      clockGrad: 'linear-gradient(135deg, #ffffff 10%, #a7f3d0 62%, #22d3ee 100%)',
      isLight: false,
      effect: 'aurora',
      thumb: 'linear-gradient(155deg, #051116 0%, #0f4c45 48%, #10b981 82%, #040b0e 100%)',
      bg: 'radial-gradient(ellipse 80% 66% at 50% 22%, #0c2c30 0%, #06141a 56%, #03070b 100%)',
      svg: `
        <defs>
          <linearGradient id="ae-rib1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#06b6d4" stop-opacity="0"/>
            <stop offset="30%" stop-color="#34d399" stop-opacity="0.48"/>
            <stop offset="68%" stop-color="#22d3ee" stop-opacity="0.36"/>
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="ae-rib2" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#34d399" stop-opacity="0"/>
            <stop offset="50%" stop-color="#10b981" stop-opacity="0.34"/>
            <stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="ae-lake" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#2dd4bf" stop-opacity="0.16"/>
            <stop offset="100%" stop-color="#03070b" stop-opacity="0.96"/>
          </linearGradient>
          <filter id="ae-blur"><feGaussianBlur stdDeviation="20"/></filter>
        </defs>
        <path d="M-80,310 C220,120 560,360 890,190 C1180,50 1420,250 1680,150 L1680,360 C1380,450 1120,280 840,390 C520,510 210,330 -80,460 Z" fill="url(#ae-rib1)" filter="url(#ae-blur)"/>
        <path d="M120,420 C440,260 760,460 1120,280 C1340,170 1500,290 1660,240 L1660,410 C1380,490 1050,390 730,520 C450,620 260,470 120,530 Z" fill="url(#ae-rib2)" filter="url(#ae-blur)"/>
        <path d="M0,705 L210,515 L390,635 L585,480 L760,645 L975,465 L1190,625 L1390,530 L1600,675 L1600,900 L0,900 Z" fill="#050e12"/>
        <path d="M0,740 L260,640 L510,725 L805,665 L1085,730 L1380,650 L1600,730 L1600,900 L0,900 Z" fill="#03090c"/>
        <rect y="730" width="1600" height="170" fill="url(#ae-lake)"/>
      `
    },
    {
      id: 'tokyo-synth',
      name: 'Tokyo Synth',
      sub: 'Неоновый закат',
      accent: '#f472b6',
      accent2: '#38bdf8',
      accentSoft: 'rgba(244, 114, 182, 0.18)',
      accentGlow: 'rgba(244, 114, 182, 0.46)',
      glassRgb: '20, 10, 29',
      clockGrad: 'linear-gradient(135deg, #fde68a 5%, #f472b6 58%, #38bdf8 100%)',
      isLight: false,
      effect: 'synth',
      thumb: 'linear-gradient(180deg, #1b0b32 0%, #9d174d 58%, #0c0716 100%)',
      bg: 'linear-gradient(180deg, #0b0618 0%, #240d3a 52%, #3d123d 68%, #0a0614 100%)',
      svg: `
        <defs>
          <linearGradient id="ts-sun" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#fde047"/>
            <stop offset="45%" stop-color="#fb7185"/>
            <stop offset="100%" stop-color="#c026d3"/>
          </linearGradient>
          <radialGradient id="ts-glow" cx="50%" cy="56%" r="36%">
            <stop offset="0%" stop-color="#f472b6" stop-opacity="0.46"/>
            <stop offset="100%" stop-color="#0b0618" stop-opacity="0"/>
          </radialGradient>
          <clipPath id="ts-sun-clip">
            <circle cx="800" cy="485" r="168"/>
          </clipPath>
        </defs>
        <rect width="1600" height="900" fill="url(#ts-glow)"/>
        <g clip-path="url(#ts-sun-clip)">
          <rect x="620" y="310" width="360" height="350" fill="url(#ts-sun)"/>
          <rect x="620" y="492" width="360" height="8" fill="#1c0a2e"/>
          <rect x="620" y="514" width="360" height="11" fill="#1c0a2e"/>
          <rect x="620" y="540" width="360" height="15" fill="#1c0a2e"/>
          <rect x="620" y="571" width="360" height="19" fill="#1c0a2e"/>
        </g>
        <path d="M0,655 L110,655 L110,590 L165,590 L165,640 L245,640 L245,545 L305,545 L305,625 L395,625 L395,575 L465,575 L465,645 L580,645 L580,610 L650,610 L650,655 L950,655 L950,605 L1030,605 L1030,645 L1140,645 L1140,565 L1215,565 L1215,635 L1320,635 L1320,580 L1395,580 L1395,648 L1600,648 L1600,900 L0,900 Z" fill="#0b0614"/>
        <g stroke="#38bdf8" stroke-opacity="0.28" stroke-width="1.2">
          <line x1="0" y1="655" x2="1600" y2="655" stroke="#f472b6" stroke-opacity="0.55" stroke-width="1.8"/>
          <line x1="0" y1="688" x2="1600" y2="688"/>
          <line x1="0" y1="732" x2="1600" y2="732"/>
          <line x1="0" y1="790" x2="1600" y2="790"/>
          <line x1="0" y1="864" x2="1600" y2="864"/>
          <line x1="800" y1="655" x2="-120" y2="900"/>
          <line x1="800" y1="655" x2="220" y2="900"/>
          <line x1="800" y1="655" x2="520" y2="900"/>
          <line x1="800" y1="655" x2="800" y2="900"/>
          <line x1="800" y1="655" x2="1080" y2="900"/>
          <line x1="800" y1="655" x2="1380" y2="900"/>
          <line x1="800" y1="655" x2="1720" y2="900"/>
        </g>
      `
    },
    {
      id: 'sakura-midnight',
      name: 'Sakura Moon',
      sub: 'Ночная сакура',
      accent: '#f9a8d4',
      accent2: '#c084fc',
      accentSoft: 'rgba(249, 168, 212, 0.17)',
      accentGlow: 'rgba(249, 168, 212, 0.42)',
      glassRgb: '20, 12, 26',
      clockGrad: 'linear-gradient(135deg, #ffffff 15%, #fbcfe8 65%, #d8b4fe 100%)',
      isLight: false,
      effect: 'petals',
      thumb: 'radial-gradient(circle at 55% 36%, rgba(251,207,232,0.7), rgba(107,33,168,0.4) 50%, #0d0814 90%)',
      bg: 'radial-gradient(ellipse 74% 64% at 54% 34%, #251535 0%, #120b1d 55%, #07050d 100%)',
      svg: `
        <defs>
          <radialGradient id="sm-moon-glow" cx="54%" cy="38%" r="32%">
            <stop offset="0%" stop-color="#fce7f3" stop-opacity="0.5"/>
            <stop offset="48%" stop-color="#f472b6" stop-opacity="0.16"/>
            <stop offset="100%" stop-color="#07050d" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="sm-moon" cx="42%" cy="38%" r="60%">
            <stop offset="0%" stop-color="#fff5f9"/>
            <stop offset="70%" stop-color="#fbcfe8"/>
            <stop offset="100%" stop-color="#f472b6" stop-opacity="0.88"/>
          </radialGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#sm-moon-glow)"/>
        <circle cx="850" cy="345" r="134" fill="url(#sm-moon)"/>
        <path d="M1600,90 C1410,130 1280,195 1135,275 C1065,315 1015,320 965,345" fill="none" stroke="#130a1b" stroke-width="11" stroke-linecap="round"/>
        <path d="M1345,175 C1270,135 1205,125 1140,145" fill="none" stroke="#130a1b" stroke-width="6" stroke-linecap="round"/>
        <path d="M1215,232 C1165,275 1130,320 1080,355" fill="none" stroke="#130a1b" stroke-width="5" stroke-linecap="round"/>
        <g fill="#f9a8d4" fill-opacity="0.62">
          <circle cx="1145" cy="146" r="18"/><circle cx="1178" cy="134" r="13"/>
          <circle cx="1095" cy="282" r="21"/><circle cx="1055" cy="312" r="15"/>
          <circle cx="978" cy="342" r="17"/><circle cx="1275" cy="196" r="22"/>
          <circle cx="1365" cy="148" r="24"/><circle cx="1084" cy="355" r="14"/>
        </g>
        <path d="M0,745 Q400,665 780,730 T1600,700 L1600,900 L0,900 Z" fill="#0d0815" fill-opacity="0.9"/>
        <path d="M0,805 Q460,745 920,800 T1600,785 L1600,900 L0,900 Z" fill="#07040c"/>
      `
    },
    {
      id: 'abyss-matrix',
      name: 'Emerald Pulse',
      sub: 'Цифровая бездна',
      accent: '#10b981',
      accent2: '#06b6d4',
      accentSoft: 'rgba(16, 185, 129, 0.17)',
      accentGlow: 'rgba(16, 185, 129, 0.42)',
      glassRgb: '6, 17, 14',
      clockGrad: 'linear-gradient(135deg, #ffffff 12%, #6ee7b7 62%, #06b6d4 100%)',
      isLight: false,
      effect: 'rain',
      thumb: 'radial-gradient(circle at 50% 45%, rgba(16,185,129,0.58), rgba(6,95,70,0.42) 48%, #040b09 90%)',
      bg: 'radial-gradient(ellipse 74% 66% at 50% 44%, #082922 0%, #051310 56%, #020807 100%)',
      svg: `
        <defs>
          <radialGradient id="am-core" cx="50%" cy="46%" r="42%">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0.34"/>
            <stop offset="55%" stop-color="#06b6d4" stop-opacity="0.1"/>
            <stop offset="100%" stop-color="#020807" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="am-wave" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#10b981" stop-opacity="0"/>
            <stop offset="50%" stop-color="#34d399" stop-opacity="0.44"/>
            <stop offset="100%" stop-color="#06b6d4" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#am-core)"/>
        <g fill="none" stroke="url(#am-wave)" stroke-width="1.5">
          <path d="M0,510 C320,390 580,620 880,480 C1140,360 1380,530 1600,450"/>
          <path d="M0,555 C340,435 600,665 900,525 C1160,405 1400,575 1600,495" opacity="0.72"/>
          <path d="M0,600 C360,480 620,710 920,570 C1180,450 1420,620 1600,540" opacity="0.46"/>
          <path d="M0,645 C380,525 640,755 940,615 C1200,495 1440,665 1600,585" opacity="0.28"/>
        </g>
        <polygon points="800,260 930,415 800,570 670,415" fill="#041511" fill-opacity="0.58" stroke="#34d399" stroke-opacity="0.45" stroke-width="1.5"/>
        <polygon points="800,300 895,415 800,530 705,415" fill="none" stroke="#22d3ee" stroke-opacity="0.34" stroke-width="1.2"/>
      `
    },
    {
      id: 'solar-gold',
      name: 'Obsidian Gold',
      sub: 'Карбон и золото',
      accent: '#fbbf24',
      accent2: '#f97316',
      accentSoft: 'rgba(251, 191, 36, 0.16)',
      accentGlow: 'rgba(251, 191, 36, 0.38)',
      glassRgb: '16, 13, 9',
      clockGrad: 'linear-gradient(135deg, #fffbeb 12%, #fde68a 60%, #f59e0b 100%)',
      isLight: false,
      effect: 'gold',
      thumb: 'radial-gradient(circle at 50% 42%, rgba(251,191,36,0.62), rgba(146,64,14,0.38) 46%, #090806 90%)',
      bg: 'radial-gradient(ellipse 72% 62% at 50% 42%, #241a0b 0%, #100c07 54%, #060503 100%)',
      svg: `
        <defs>
          <radialGradient id="sg-glow" cx="50%" cy="46%" r="42%">
            <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.34"/>
            <stop offset="52%" stop-color="#d97706" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#060503" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="sg-silk" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fbbf24" stop-opacity="0"/>
            <stop offset="48%" stop-color="#fde68a" stop-opacity="0.56"/>
            <stop offset="100%" stop-color="#f97316" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#sg-glow)"/>
        <circle cx="800" cy="435" r="196" fill="none" stroke="url(#sg-silk)" stroke-width="2.2"/>
        <circle cx="800" cy="435" r="244" fill="none" stroke="url(#sg-silk)" stroke-opacity="0.45" stroke-width="1.2"/>
        <path d="M-40,635 C340,480 620,695 960,550 C1240,430 1440,545 1640,485" fill="none" stroke="url(#sg-silk)" stroke-width="2.4"/>
        <path d="M-40,695 C380,555 680,750 1010,605 C1280,490 1460,600 1640,545" fill="none" stroke="url(#sg-silk)" stroke-opacity="0.42" stroke-width="1.4"/>
      `
    },
    {
      id: 'silver-cosmos',
      name: 'Silver Cosmos',
      sub: 'Хром и звёздная пустота',
      accent: '#e5e7eb',
      accent2: '#94a3b8',
      accentSoft: 'rgba(229, 231, 235, 0.15)',
      accentGlow: 'rgba(226, 232, 240, 0.4)',
      glassRgb: '8, 9, 12',
      clockGrad: 'linear-gradient(135deg, #ffffff 10%, #cbd5e1 55%, #7c8798 100%)',
      isLight: false,
      effect: 'cosmos',
      thumb: 'radial-gradient(circle at 36% 34%, #f1f5f9 0%, #7c8798 22%, #14161c 52%, #030304 90%)',
      bg: 'radial-gradient(ellipse 80% 70% at 50% 60%, #0e1015 0%, #07080a 56%, #020203 100%)',
      svg: buildCosmosSvg()
    },
    {
      id: 'arctic-glass',
      name: 'Arctic Glass',
      sub: 'Светлое матовое стекло',
      accent: '#4f46e5',
      accent2: '#0ea5e9',
      accentSoft: 'rgba(79, 70, 229, 0.13)',
      accentGlow: 'rgba(79, 70, 229, 0.24)',
      glassRgb: '255, 255, 255',
      clockGrad: 'linear-gradient(135deg, #0f172a 10%, #4338ca 72%, #0284c7 100%)',
      isLight: true,
      effect: 'frost',
      thumb: 'linear-gradient(145deg, #ffffff 0%, #dbeafe 52%, #e0e7ff 100%)',
      bg: 'radial-gradient(ellipse 80% 70% at 50% 15%, #ffffff 0%, #eaf1fc 54%, #dbe5f7 100%)',
      svg: `
        <defs>
          <radialGradient id="ag-s1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#818cf8" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="#818cf8" stop-opacity="0"/>
          </radialGradient>
          <radialGradient id="ag-s2" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.26"/>
            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="ag-hill" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#c7d2fe" stop-opacity="0.5"/>
            <stop offset="100%" stop-color="#dbe5f7" stop-opacity="0.9"/>
          </linearGradient>
        </defs>
        <circle cx="620" cy="310" r="340" fill="url(#ag-s1)"/>
        <circle cx="1010" cy="430" r="320" fill="url(#ag-s2)"/>
        <path d="M0,730 Q400,620 820,705 T1600,670 L1600,900 L0,900 Z" fill="url(#ag-hill)"/>
        <path d="M0,805 Q480,735 960,795 T1600,775 L1600,900 L0,900 Z" fill="#cfdcf3" fill-opacity="0.65"/>
      `
    }
  ];

  const THEMES_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t]));
  const LINK_COLORS = ['#38bdf8', '#c084fc', '#fb7185', '#34d399', '#fbbf24', '#818cf8', '#f472b6'];

  /* ==================== Безопасный API-адаптер (Electron + Demo) ==================== */
  const realApi = window.internalApi;
  const fallbackState = {
    wallpaperType: 'preset',
    wallpaperPreset: 'cyber-blue',
    customWallpaperFile: null,
    wallpaperVersion: 1,
    dim: 22,
    blur: 0,
    widgets: { clock: true, links: true, search: true, todo: true },
    links: [
      { id: 'd1', title: 'YouTube', url: 'https://youtube.com', color: '#ef4444' },
      { id: 'd2', title: 'GitHub', url: 'https://github.com', color: '#a5b4fc' },
      { id: 'd3', title: 'ChatGPT', url: 'https://chatgpt.com', color: '#34d399' },
      { id: 'd4', title: 'Telegram', url: 'https://web.telegram.org', color: '#38bdf8' },
      { id: 'd5', title: 'Twitch', url: 'https://twitch.tv', color: '#c084fc' },
      { id: 'd6', title: 'Spotify', url: 'https://open.spotify.com', color: '#22c55e' }
    ],
    todos: [
      { id: 't1', text: 'Проверить новые темы браузера', done: true },
      { id: 't2', text: 'Добавить любимые сайты в плитки', done: false }
    ]
  };

  const api = realApi || {
    getNewTabData: async () => ({
      state: fallbackState,
      searchEngine: 'google',
      engines: [
        { key: 'google', name: 'Google', short: 'G', color: '#60a5fa' },
        { key: 'yandex', name: 'Яндекс', short: 'Я', color: '#fb7185' },
        { key: 'duckduckgo', name: 'DuckDuckGo', short: 'D', color: '#fb923c' }
      ]
    }),
    saveNewTabData: async (patch) => {
      Object.assign(fallbackState, patch, {
        widgets: patch.widgets ? { ...fallbackState.widgets, ...patch.widgets } : fallbackState.widgets
      });
      return { state: { ...fallbackState } };
    },
    setSearchEngine: async (key) => ({ searchEngine: key }),
    navigate: (q) => { window.location.href = /^https?:\/\//i.test(q) ? q : `https://www.google.com/search?q=${encodeURIComponent(q)}`; },
    openInNewTab: (u) => window.open(u, '_blank', 'noopener'),
    getBookmarks: async () => [],
    removeBookmark: async () => [],
    onBookmarksChanged: () => {},
    pickWallpaper: async () => ({ canceled: true }),
    clearWallpaper: async () => ({ state: fallbackState })
  };

  /* ==================== DOM-ссылки ==================== */
  const sceneEl = document.getElementById('scene');
  const stageEl = document.getElementById('backdrop-stage');
  const bgSlots = [document.getElementById('bg-slot-0'), document.getElementById('bg-slot-1')];
  const canvasEl = document.getElementById('ambient-canvas');
  const ctx = canvasEl.getContext('2d');

  const weekdayEl = document.getElementById('date-weekday');
  const dayEl = document.getElementById('date-day');
  const monthEl = document.getElementById('date-month');
  const clockHmEl = document.getElementById('clock-hm');
  const clockSecEl = document.getElementById('clock-sec');
  const greetingEl = document.getElementById('clock-greeting');

  const widgetClock = document.getElementById('widget-clock');
  const widgetLinks = document.getElementById('widget-links');
  const widgetSearch = document.getElementById('widget-search');
  const widgetTodo = document.getElementById('widget-todo');

  const linksList = document.getElementById('links-list');
  const showAddLinkBtn = document.getElementById('btn-show-add-link');
  const addLinkForm = document.getElementById('add-link-form');
  const linkTitleInput = document.getElementById('link-title-input');
  const linkUrlInput = document.getElementById('link-url-input');
  const cancelLinkBtn = document.getElementById('btn-cancel-link');

  const searchForm = document.getElementById('search-form');
  const searchInput = document.getElementById('search-input');
  const engineBtn = document.getElementById('engine-btn');
  const engineBadge = document.getElementById('engine-badge');
  const engineMenu = document.getElementById('engine-menu');
  const enginePicker = document.getElementById('engine-picker');

  const todoForm = document.getElementById('todo-form');
  const todoInput = document.getElementById('todo-input');
  const todoList = document.getElementById('todo-list');
  const todoCount = document.getElementById('todo-count');
  const todoProgressFill = document.getElementById('todo-progress-fill');
  const clearDoneBtn = document.getElementById('btn-clear-done');

  const customizeBtn = document.getElementById('customize-btn');
  const drawer = document.getElementById('customize-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  const closeDrawerBtn = document.getElementById('btn-close-drawer');
  const presetsGrid = document.getElementById('presets-grid');
  const pickWpBtn = document.getElementById('btn-pick-wallpaper');
  const clearWpBtn = document.getElementById('btn-clear-wallpaper');
  const wpError = document.getElementById('wallpaper-error');
  const customAccentGroup = document.getElementById('custom-accent-group');
  const accentSwatches = document.getElementById('accent-swatches');

  const dimSlider = document.getElementById('dim-slider');
  const dimValue = document.getElementById('dim-value');
  const blurSlider = document.getElementById('blur-slider');
  const blurValue = document.getElementById('blur-value');
  const glassSlider = document.getElementById('glass-slider');
  const glassValue = document.getElementById('glass-value');

  const layoutBtnGrid = document.getElementById('layout-btn-grid');
  const layoutBtnList = document.getElementById('layout-btn-list');

  const toggleAnimate = document.getElementById('toggle-animate');
  const toggleParallax = document.getElementById('toggle-parallax');
  const toggleClock = document.getElementById('toggle-clock');
  const toggleSeconds = document.getElementById('toggle-seconds');
  const toggleGreeting = document.getElementById('toggle-greeting');
  const toggleLinks = document.getElementById('toggle-links');
  const toggleSearch = document.getElementById('toggle-search');
  const toggleTodo = document.getElementById('toggle-todo');

  /* ==================== Состояние ==================== */
  let ntState = null;
  // Настройки Студии тем приходят из main (файл newtab-studio.json) в init(); до этого — значения по умолчанию.
  // localStorage остаётся только запасным вариантом, если preload без API хранилища (отладка вне браузера)
  let prefs = { ...DEFAULT_PREFS };
  const hasStudioApi = Boolean(realApi && typeof realApi.saveStudioPrefs === 'function' &&
    typeof realApi.saveStudioBookmarks === 'function' && typeof realApi.migrateStudio === 'function');
  let activeThemeId = 'cyber-blue';
  let currentEngineKey = 'google';
  let enginesList = [];
  let activeBgSlot = 0;
  let lastRenderedBgKey = '';

  function loadLegacyPrefs() {
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function savePrefs(patch) {
    prefs = { ...prefs, ...patch };
    if (hasStudioApi) {
      // main проверяет значения, склеивает частые записи и в Инкогнито держит изменения только в памяти
      Promise.resolve(realApi.saveStudioPrefs(patch)).catch((err) => console.error('newtab: не удалось сохранить настройки', err));
      return;
    }
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage restrictions
    }
  }

  /* ==================== Часы и приветствие ==================== */
  function getGreeting(hour) {
    if (hour >= 5 && hour < 12) return 'Доброе утро';
    if (hour >= 12 && hour < 18) return 'Добрый день';
    if (hour >= 18 && hour < 23) return 'Добрый вечер';
    return 'Доброй ночи';
  }

  function updateClock() {
    if (document.hidden) return; // скрытая вкладка часы не обновляет
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    clockHmEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    clockSecEl.textContent = prefs.showSeconds ? `:${pad(now.getSeconds())}` : '';
    greetingEl.textContent = getGreeting(now.getHours());

    const wd = now.toLocaleDateString('ru-RU', { weekday: 'short' }).replace('.', '');
    weekdayEl.textContent = wd.toUpperCase();
    dayEl.textContent = String(now.getDate());
    const monthRaw = now.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
    monthEl.textContent = monthRaw[0].toUpperCase() + monthRaw.slice(1);
  }

  updateClock();
  setInterval(() => { if (!document.hidden) updateClock(); }, 1000); // в фоне не будим рендерер; при возврате visibilitychange обновит время

  /* ==================== Живой 60fps Canvas-движок ==================== */
  let particles = [];
  let shootingStar = null;
  let currentEffect = 'cyber';
  let rafId = null;
  let lastFrameTime = 0;
  let canvasW = 0;
  let canvasH = 0;

  /* Режим экономии энергии (energySaverActive): ~22 FPS, вдвое меньше частиц, стоп при document.hidden */
  const ENERGY_SAVER_FRAME_MS = 1000 / 22;
  const ENERGY_SAVER_PARTICLE_RATIO = 0.5;
  let energySaver = false;

  function setEnergySaver(active) {
    const next = Boolean(active);
    document.documentElement.setAttribute('data-energy-saver', next ? 'true' : 'false');
    if (next === energySaver) return;
    energySaver = next;
    // До первой отрисовки сцены (init ещё идёт) ничего не пересоздаём — applyTheme сделает это сам
    if (!sceneEl.classList.contains('ready')) return;
    if (currentEffect !== 'none') initParticles(currentEffect);
    syncCanvas();
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvasW = window.innerWidth;
    canvasH = window.innerHeight;
    canvasEl.width = Math.floor(canvasW * dpr);
    canvasEl.height = Math.floor(canvasH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function initParticles(effect) {
    currentEffect = effect;
    shootingStar = null;
    particles = [];
    const w = canvasW || window.innerWidth;
    const h = canvasH || window.innerHeight;

    if (effect === 'cyber') {
      for (let i = 0; i < 58; i++) {
        particles.push({
          x: rand(0, w), y: rand(0, h),
          vx: rand(-10, 14), vy: rand(-26, -7),
          r: rand(1.1, 3.2),
          alpha: rand(0.2, 0.72),
          phase: rand(0, Math.PI * 2),
          color: Math.random() > 0.35 ? '56,189,248' : '129,140,248'
        });
      }
    } else if (effect === 'starfield' || effect === 'cosmos' || effect === 'aurora') {
      const count = effect === 'cosmos' ? 130 : effect === 'starfield' ? 88 : 56;
      for (let i = 0; i < count; i++) {
        particles.push({
          x: rand(0, w), y: rand(0, effect === 'aurora' ? h * 0.68 : h),
          vx: rand(-3, 3), vy: rand(-2, 2),
          r: rand(0.7, 2.3),
          alpha: rand(0.25, 0.9),
          phase: rand(0, Math.PI * 2),
          speed: rand(1.2, 3.2),
          color: effect === 'cosmos'
            ? (Math.random() > 0.7 ? '203,213,225' : '255,255,255')
            : effect === 'starfield'
            ? (Math.random() > 0.65 ? '233,213,255' : '255,255,255')
            : (Math.random() > 0.5 ? '167,243,208' : '255,255,255')
        });
      }
    } else if (effect === 'embers') {
      for (let i = 0; i < 62; i++) {
        particles.push({
          x: rand(0, w), y: rand(0, h),
          vx: rand(-12, 12), vy: rand(-52, -16),
          r: rand(1.1, 2.9),
          alpha: rand(0.3, 0.85),
          phase: rand(0, Math.PI * 2),
          color: Math.random() > 0.3 ? '251,113,133' : '251,191,36'
        });
      }
    } else if (effect === 'petals') {
      for (let i = 0; i < 38; i++) {
        particles.push({
          x: rand(0, w), y: rand(0, h),
          vx: rand(-38, -14), vy: rand(18, 42),
          rx: rand(4.5, 8), ry: rand(2.4, 4.2),
          rot: rand(0, Math.PI * 2), vrot: rand(-1.6, 1.6),
          alpha: rand(0.32, 0.72),
          phase: rand(0, Math.PI * 2)
        });
      }
    } else if (effect === 'rain') {
      for (let i = 0; i < 36; i++) {
        particles.push({
          x: rand(0, w), y: rand(0, h),
          vy: rand(95, 210), len: rand(34, 92),
          alpha: rand(0.14, 0.42),
          color: Math.random() > 0.35 ? '52,211,153' : '34,211,238'
        });
      }
    } else {
      // shards, synth, gold, frost
      const palette = effect === 'synth'
        ? ['244,114,182', '56,189,248']
        : effect === 'gold'
          ? ['251,191,36', '253,230,138']
          : effect === 'frost'
            ? ['99,102,241', '56,189,248']
            : ['226,232,240', '148,163,184'];
      for (let i = 0; i < 50; i++) {
        particles.push({
          x: rand(0, w), y: rand(0, h),
          vx: rand(-10, 10), vy: rand(-20, -6),
          r: effect === 'frost' ? rand(2.5, 7.5) : rand(1.1, 3.2),
          alpha: effect === 'frost' ? rand(0.1, 0.28) : rand(0.22, 0.72),
          phase: rand(0, Math.PI * 2),
          color: palette[i % palette.length]
        });
      }
    }

    if (energySaver && particles.length > 1) {
      particles.length = Math.max(1, Math.ceil(particles.length * ENERGY_SAVER_PARTICLE_RATIO));
    }
  }

  function drawCanvas(now) {
    if (!prefs.animateBg || document.hidden) {
      rafId = null;
      return;
    }
    // Энергосбережение: пропускаем кадры, пока не прошёл интервал (~22 FPS)
    if (energySaver && lastFrameTime && now - lastFrameTime < ENERGY_SAVER_FRAME_MS - 2) {
      rafId = requestAnimationFrame(drawCanvas);
      return;
    }
    const dt = lastFrameTime ? Math.min((now - lastFrameTime) / 1000, 0.05) : 0.016;
    lastFrameTime = now;
    const t = now * 0.001;

    ctx.clearRect(0, 0, canvasW, canvasH);

    if (currentEffect === 'aurora') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let wave = 0; wave < 2; wave++) {
        ctx.beginPath();
        const baseY = canvasH * (0.24 + wave * 0.11);
        ctx.moveTo(0, baseY);
        for (let x = 0; x <= canvasW; x += 64) {
          const y = baseY + Math.sin(x * 0.0032 + t * (0.55 + wave * 0.25)) * 38 + Math.sin(x * 0.0071 - t * 0.4) * 16;
          ctx.lineTo(x, y);
        }
        for (let x = canvasW; x >= 0; x -= 64) {
          const y = baseY + 150 + Math.sin(x * 0.004 + t * 0.5 + wave) * 30;
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, baseY - 50, 0, baseY + 170);
        grad.addColorStop(0, wave === 0 ? 'rgba(52, 211, 153, 0.20)' : 'rgba(34, 211, 238, 0.14)');
        grad.addColorStop(1, 'rgba(52, 211, 153, 0)');
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.restore();
    }

    if ((currentEffect === 'starfield' || currentEffect === 'cosmos') && !prefersReducedMotion) {
      if (!shootingStar && Math.random() < 0.004) {
        shootingStar = { x: rand(canvasW * 0.3, canvasW), y: rand(0, canvasH * 0.35), vx: -rand(520, 760), vy: rand(220, 340), life: 1 };
      }
      if (shootingStar) {
        shootingStar.x += shootingStar.vx * dt;
        shootingStar.y += shootingStar.vy * dt;
        shootingStar.life -= dt * 1.4;
        if (shootingStar.life <= 0) {
          shootingStar = null;
        } else {
          const tail = ctx.createLinearGradient(shootingStar.x, shootingStar.y, shootingStar.x - shootingStar.vx * 0.12, shootingStar.y - shootingStar.vy * 0.12);
          tail.addColorStop(0, `rgba(255,255,255,${0.85 * shootingStar.life})`);
          tail.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.strokeStyle = tail;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(shootingStar.x, shootingStar.y);
          ctx.lineTo(shootingStar.x - shootingStar.vx * 0.12, shootingStar.y - shootingStar.vy * 0.12);
          ctx.stroke();
        }
      }
    }

    for (const p of particles) {
      if (currentEffect === 'rain') {
        p.y += p.vy * dt;
        if (p.y - p.len > canvasH) { p.y = -rand(10, 80); p.x = rand(0, canvasW); }
        ctx.strokeStyle = `rgba(${p.color},${p.alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - 3, p.y - p.len);
        ctx.stroke();
        continue;
      }

      if (currentEffect === 'petals') {
        p.x += (p.vx + Math.sin(t * 0.9 + p.phase) * 14) * dt;
        p.y += p.vy * dt;
        p.rot += p.vrot * dt;
        if (p.y > canvasH + 12 || p.x < -12) { p.x = rand(canvasW * 0.2, canvasW + 40); p.y = -12; }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `rgba(251,182,206,${p.alpha})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const limitY = currentEffect === 'aurora' ? canvasH * 0.68 : canvasH;
      if (p.x < -10) p.x = canvasW + 10;
      if (p.x > canvasW + 10) p.x = -10;
      if (p.y < -10) p.y = limitY + 10;
      if (p.y > limitY + 10) p.y = -10;
      const tw = 0.62 + 0.38 * Math.sin(t * (p.speed || 1.4) + p.phase);
      ctx.fillStyle = `rgba(${p.color},${(p.alpha * tw).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    rafId = requestAnimationFrame(drawCanvas);
  }

  function startCanvas() {
    if (rafId || !prefs.animateBg || document.hidden) return;
    lastFrameTime = 0;
    rafId = requestAnimationFrame(drawCanvas);
  }

  function stopCanvas() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    ctx.clearRect(0, 0, canvasW, canvasH);
  }

  function syncCanvas() {
    syncVideo();
    const noEffect = currentEffect === 'none';
    canvasEl.classList.toggle('hidden', !prefs.animateBg || noEffect);
    if (prefs.animateBg && !noEffect) startCanvas();
    else stopCanvas();
  }

  window.addEventListener('resize', () => {
    resizeCanvas();
    if (currentEffect !== 'none') initParticles(currentEffect);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCanvas();
    else { syncCanvas(); updateClock(); }
  });

  /* ==================== Темы и фон ==================== */
  const ACCENTS = [
    { id: 'cyber-blue', accent: '#38bdf8', accent2: '#6366f1' },
    { id: 'nebula-violet', accent: '#c084fc', accent2: '#f472b6' },
    { id: 'crimson-eclipse', accent: '#fb7185', accent2: '#f59e0b' },
    { id: 'aurora-emerald', accent: '#34d399', accent2: '#22d3ee' },
    { id: 'solar-gold', accent: '#fbbf24', accent2: '#fb923c' },
    { id: 'obsidian-chrome', accent: '#cbd5e1', accent2: '#94a3b8' },
    { id: 'silver-cosmos', accent: '#e5e7eb', accent2: '#94a3b8' },
    { id: 'tokyo-synth', accent: '#f472b6', accent2: '#38bdf8' }
  ];

  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const n = parseInt(full.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function resolveThemeId() {
    if (prefs.themeId && THEMES_BY_ID[prefs.themeId]) return prefs.themeId;
    const legacy = ntState && LEGACY_MAP[ntState.wallpaperPreset];
    return legacy && THEMES_BY_ID[legacy] ? legacy : 'cyber-blue';
  }

  function isCustomWallpaper() {
    return Boolean(ntState && ntState.wallpaperType === 'custom' && ntState.customWallpaperFile);
  }

  function setCssVars(vars) {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  }

  function applyGlass() {
    const root = document.documentElement;
    const alpha = Math.min(1, Math.max(0, prefs.glassAlpha / 100));
    root.style.setProperty('--glass-alpha', String(alpha));
    root.classList.toggle('hud-noblur', prefs.hudBlur === false);
    root.classList.toggle('hud-flat', prefs.hudBorder === false);
    root.classList.toggle('hud-clear', alpha < 0.12);
    // Свой цвет окошек работает на любых темах и обоях
    const names = ['--glass-bg', '--glass-bg-strong', '--glass-tile', '--glass-menu'];
    const rgb = hexToRgb(prefs.cardColor);
    if (!rgb) {
      // Тема сама задаёт цвет, но прозрачность должна работать и без своего цвета
      const base = (getComputedStyle(root).getPropertyValue('--glass-rgb') || '9, 13, 26').trim();
      root.style.setProperty('--glass-bg', `rgba(${base}, ${alpha})`);
      root.style.setProperty('--glass-bg-strong', `rgba(${base}, ${Math.min(0.92, alpha + 0.28 * Math.min(1, alpha * 4))})`);
      root.style.setProperty('--glass-tile', `rgba(${base}, ${alpha * 0.92})`);
      root.style.setProperty('--glass-menu', `rgba(${base}, 0.96)`);
      root.classList.remove('card-ink-dark', 'card-ink-light');
      return;
    }
    const c = rgb.join(', ');
    root.style.setProperty('--glass-rgb', c);
    root.style.setProperty('--glass-bg', `rgba(${c}, ${alpha})`);
    root.style.setProperty('--glass-bg-strong', `rgba(${c}, ${Math.min(0.92, alpha + 0.28 * Math.min(1, alpha * 4))})`);
    root.style.setProperty('--glass-tile', `rgba(${c}, ${alpha * 0.92})`);
    root.style.setProperty('--glass-menu', `rgba(${c}, 0.96)`);
    const darkInk = hexLum(prefs.cardColor) > 0.55;
    root.classList.toggle('card-ink-dark', darkInk);
    root.classList.toggle('card-ink-light', !darkInk);
  }

  // Версия обоев попадает в URL и ключи кэша: только число
  function wallpaperVersionNum() {
    return Number(ntState && ntState.wallpaperVersion) || 0;
  }

  function applyBackdrop() {
    const custom = isCustomWallpaper();
    const theme = THEMES_BY_ID[activeThemeId];
    const key = custom
      ? `custom:${wallpaperVersionNum()}`
      : `preset:${activeThemeId}`;
    if (key === lastRenderedBgKey) return;
    lastRenderedBgKey = key;

    const next = 1 - activeBgSlot;
    const slot = bgSlots[next];
    const fill = slot.querySelector('.bg-slot-fill');
    const svg = slot.querySelector('.bg-slot-svg');

    fill.textContent = '';
    fill.classList.toggle('has-video', custom && isVideoWallpaper());
    if (custom) {
      const url = `browser://wallpaper?v=${wallpaperVersionNum()}`;
      svg.innerHTML = '';
      autoAccentFromWallpaper(url, isVideoWallpaper(), wallpaperVersionNum());
      if (isVideoWallpaper()) {
        fill.style.backgroundImage = 'none';
        const v = document.createElement('video');
        v.className = 'bg-video';
        v.muted = true;
        v.defaultMuted = true;
        v.loop = true;
        v.autoplay = true;
        v.playsInline = true;
        v.disablePictureInPicture = true;
        v.preload = 'auto';
        v.src = url;
        fill.appendChild(v);
      } else {
        fill.style.backgroundImage = `url("${url}")`;
      }
    } else {
      fill.style.backgroundImage = theme.bg;
      svg.innerHTML = theme.svg;
    }

    const prev = bgSlots[activeBgSlot];
    slot.classList.add('active');
    prev.classList.remove('active');
    activeBgSlot = next;
    syncVideo();

    // Старое видео после затухания останавливаем и освобождаем (иначе декодер крутится зря)
    setTimeout(() => {
      if (prev.classList.contains('active')) return;
      prev.querySelectorAll('video').forEach((v) => {
        v.pause();
        v.removeAttribute('src');
        v.load();
        v.remove();
      });
    }, 700);
  }

  // ---- Цвет оболочки по своим обоям -------------------------------------------------
  // Снимаем несколько кадров (видео) или саму картинку, находим доминирующий оттенок и
  // подбираем ближайшую готовую тему оболочки. Работает один раз на каждые новые обои;
  // потом цвет можно сменить вручную в «Темы и вид».
  function accentThemeFromHue(h, neutral) {
    if (neutral) return 'silver-cosmos';
    if (h < 12 || h >= 340) return 'crimson-eclipse';
    if (h < 70) return 'solar-gold';
    if (h < 165) return 'aurora-emerald';
    if (h < 255) return 'cyber-blue';
    if (h < 295) return 'nebula-violet';
    return 'tokyo-synth';
  }

  function analyseCanvas(ctx, w, h, acc) {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const v = max / 255;
      if (((i / 4) / 64 | 0) < 15) { acc.topSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; acc.topN += 1; }
      if (v < 0.16) continue;
      const s = (max - min) / max;
      let hue;
      const d = max - min;
      if (d === 0) hue = 0;
      else if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= Math.PI / 3;
      const wgt = s * s * v;
      acc.cos += Math.cos(hue) * wgt;
      acc.sin += Math.sin(hue) * wgt;
      acc.sat += s * v;
      acc.lit += v;
      acc.r += r; acc.g += g; acc.b += b; acc.n += 1;
    }
  }

  function sampleVideoFrames(url, acc) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous';
      v.muted = true;
      v.preload = 'auto';
      const cv = document.createElement('canvas');
      cv.width = 64; cv.height = 36;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      const stops = [0.25, 0.5, 0.75];
      let idx = 0;
      const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 10000);
      function cleanup() { clearTimeout(timer); v.removeAttribute('src'); v.load(); }
      v.addEventListener('error', () => { cleanup(); reject(new Error('video')); });
      v.addEventListener('loadedmetadata', () => { v.currentTime = Math.min(v.duration * stops[0], 60); });
      v.addEventListener('seeked', () => {
        try {
          ctx.drawImage(v, 0, 0, 64, 36);
          analyseCanvas(ctx, 64, 36, acc);
        } catch (e) { cleanup(); reject(e); return; }
        idx += 1;
        if (idx >= stops.length) { cleanup(); resolve(); return; }
        v.currentTime = Math.min(v.duration * stops[idx], 60);
      });
      v.src = url;
    });
  }

  function sampleImage(url, acc) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = 64; cv.height = 36;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, 64, 36);
          analyseCanvas(ctx, 64, 36, acc);
          resolve();
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('image'));
      img.src = url;
    });
  }

  async function autoAccentFromWallpaper(url, isVideo, version) {
    if (prefs.autoAccentFor === version && prefs.wallSeed && typeof prefs.wallSeed.top === 'number') return;
    const acc = { cos: 0, sin: 0, sat: 0, lit: 0, r: 0, g: 0, b: 0, n: 0, topSum: 0, topN: 0 };
    try {
      if (isVideo) await sampleVideoFrames(url, acc);
      else await sampleImage(url, acc);
    } catch {
      savePrefs({ autoAccentFor: version });
      return;
    }
    // обои могли успеть поменять, пока считали
    if (!isCustomWallpaper() || wallpaperVersionNum() !== version) return;
    const meanSat = acc.lit > 0 ? acc.sat / acc.lit : 0;
    let hue = Math.atan2(acc.sin, acc.cos) * 180 / Math.PI;
    if (hue < 0) hue += 360;
    const neutral = meanSat < 0.2 || (acc.cos === 0 && acc.sin === 0);
    const id = accentThemeFromHue(hue, neutral);
    // Средний цвет обоев -> HSL: из него основная часть оболочки получает оттенок обоев
    const n = Math.max(acc.n, 1);
    const rr = acc.r / n / 255, gg = acc.g / n / 255, bb = acc.b / n / 255;
    const mx = Math.max(rr, gg, bb), mn = Math.min(rr, gg, bb), dl = mx - mn;
    const l = (mx + mn) / 2;
    const s2 = dl === 0 ? 0 : dl / (1 - Math.abs(2 * l - 1));
    let h2 = 0;
    if (dl !== 0) {
      if (mx === rr) h2 = ((gg - bb) / dl) % 6;
      else if (mx === gg) h2 = (bb - rr) / dl + 2;
      else h2 = (rr - gg) / dl + 4;
      h2 *= 60; if (h2 < 0) h2 += 360;
    }
    const seed = { h: h2, s: s2, l, top: acc.topN ? acc.topSum / acc.topN : l, ah: hue, as: Math.min(1, meanSat * 1.6), neutral, base: id };
    const fresh = prefs.autoAccentFor !== version; // новые обои — сбрасываем ручные цвета
    savePrefs({ accentId: fresh ? id : prefs.accentId, autoAccentFor: version, wallSeed: seed,
      ...(fresh ? { customAccent: null, cardColor: null, clockColor: null } : {}) });
    applyTheme();
    renderAccentSwatches();
    // Цвет оболочки меняем только для новых обоев; при обычном открытии вкладки выбор пользователя не трогаем
    if (fresh) pushChromeTheme(false);
  }

  // Светлые ли свои обои. Решает яркость верхней части кадра (там часы и поиск),
  // а вручную можно переопределить: «Светлый» = светлый текст, «Тёмный» = тёмный текст
  const LIGHT_WALL = 0.55;
  function wallLum() {
    const sd = prefs.wallSeed;
    if (!sd) return 0;
    return typeof sd.top === 'number' ? sd.top : sd.l;
  }
  function wallIsLight() {
    if (!isCustomWallpaper()) return false;
    if (prefs.textMode === 'lightText') return false;
    if (prefs.textMode === 'darkText') return true;
    return Boolean(prefs.wallSeed && wallLum() > LIGHT_WALL);
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(c) {
    return '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function hexLum(hex) {
    const c = hexToRgb(hex);
    return c ? (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 : 0;
  }
  function hexToHsl(hex) {
    const c = hexToRgb(hex) || [0, 0, 0];
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    const l = (mx + mn) / 2;
    const sat = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    return [h, sat, l];
  }
  function hslToHex(h, sat, l) {
    h = ((h % 360) + 360) % 360;
    const c = (1 - Math.abs(2 * l - 1)) * sat;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
  }
  function shiftHue(hex, deg) {
    const [h, sat, l] = hexToHsl(hex);
    return hslToHex(h + deg, sat, l);
  }

  function darkenHex(hex, amount) {
    const c = hexToRgb(hex);
    if (!c) return hex;
    return rgbToHex(c.map((v) => v * (1 - amount)));
  }

  function isVideoWallpaper() {
    return Boolean(isCustomWallpaper() && /\.(mp4|webm)$/i.test(ntState.customWallpaperFile || ''));
  }

  // Видеообои играют только пока включена анимация фона и вкладка видна
  function syncVideo() {
    const play = prefs.animateBg && !document.hidden && !document.documentElement.classList.contains('chrome-wall');
    document.querySelectorAll('.bg-slot.active video').forEach((v) => {
      if (play) v.play().catch(() => {});
      else v.pause();
    });
  }

  function applyTheme() {
    const custom = isCustomWallpaper();
    const theme = THEMES_BY_ID[activeThemeId];
    const root = document.documentElement;
    const accentPick = ACCENTS.find((a) => a.id === prefs.accentId) || ACCENTS[0];

    let accent = theme.accent;
    let accent2 = theme.accent2;
    let glassRgb = theme.glassRgb;
    let clockGrad = theme.clockGrad;
    let light = theme.isLight;

    if (custom) {
      const lightUi = wallIsLight();
      if (prefs.customAccent) {
        accent = prefs.customAccent;
        accent2 = shiftHue(prefs.customAccent, 40);
      } else {
        accent = lightUi ? darkenHex(accentPick.accent, 0.5) : accentPick.accent;
        accent2 = lightUi ? darkenHex(accentPick.accent2, 0.45) : accentPick.accent2;
      }
      glassRgb = lightUi ? '255, 255, 255' : '9, 13, 26';
      clockGrad = lightUi
        ? `linear-gradient(135deg, #0b1220 10%, ${darkenHex(accent, 0.25)} 95%)`
        : `linear-gradient(135deg, #ffffff 15%, ${accent} 100%)`;
      if (prefs.clockColor) clockGrad = `linear-gradient(135deg, ${prefs.clockColor}, ${prefs.clockColor})`;
      // для света текста контурная тень, для тёмного — светлая подложка: время не сливается с обоями
      const inkDarkClock = prefs.clockColor ? hexLum(prefs.clockColor) > 0.55 : lightUi;
      document.documentElement.style.setProperty('--nt-clock-shadow', inkDarkClock
        ? 'drop-shadow(0 1px 2px rgba(255,255,255,0.85)) drop-shadow(0 0 10px rgba(255,255,255,0.45))'
        : 'drop-shadow(0 2px 5px rgba(0,0,0,0.7)) drop-shadow(0 0 14px rgba(0,0,0,0.35))');
      document.documentElement.style.setProperty('--nt-text-shadow', lightUi
        ? '0 1px 3px rgba(255,255,255,0.8)'
        : '0 1px 4px rgba(0,0,0,0.75)');
      light = lightUi;
    } else {
      document.documentElement.style.removeProperty('--nt-clock-shadow');
      document.documentElement.style.removeProperty('--nt-text-shadow');
    }

    root.classList.toggle('light-mode', light);
    setCssVars({
      '--nt-accent': accent,
      '--nt-accent-2': accent2,
      '--nt-accent-soft': hexToRgba(accent, 0.17),
      '--nt-accent-glow': hexToRgba(accent, 0.44),
      '--nt-clock-grad': clockGrad,
      '--glass-rgb': glassRgb
    });
    applyGlass();
    applyBackdrop();

    const effect = custom ? 'none' : theme.effect;
    if (effect !== currentEffect || particles.length === 0) {
      if (effect === 'none') {
        currentEffect = 'none';
        particles = [];
      } else {
        initParticles(effect);
      }
    }
    syncCanvas();
    renderPresets();
    renderAccentSwatches();
  }

  // Темы страницы -> темы оболочки браузера (вкладки, адресная строка, кнопки)
  const CHROME_THEME_MAP = { 'abyss-matrix': 'aurora-emerald', 'arctic-glass': 'obsidian-chrome' };
  function showNotice(text) {
    let el = document.getElementById('nt-notice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'nt-notice';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('is-visible');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.classList.remove('is-visible'); }, 7000);
  }

  function pushChromeTheme(userAction) {
    try {
      const id = isCustomWallpaper() ? prefs.accentId : activeThemeId;
      const chromeId = CHROME_THEME_MAP[id] || id;
      const light = !isCustomWallpaper() && Boolean(THEMES_BY_ID[activeThemeId] && THEMES_BY_ID[activeThemeId].isLight);
      if (isCustomWallpaper() && prefs.wallSeed && api && typeof api.setChromeTheme === 'function') {
        // цвет оболочки целиком берётся из обоев; светлые обои -> светлая оболочка
        const seed = { ...prefs.wallSeed };
        if (prefs.customAccent) {
          const [ah, as] = hexToHsl(prefs.customAccent);
          seed.ah = ah; seed.as = as; seed.neutral = false;
        }
        api.setChromeTheme('custom', wallIsLight() ? 'light' : 'dark', seed);
      } else if (api && typeof api.setChromeTheme === 'function') {
        api.setChromeTheme(chromeId, light ? 'light' : 'dark');
      } else if (userAction) {
        showNotice('Цвет оболочки не обновился: браузер использует старый preload/tabPreload.js. Замените файл и перезапустите браузер.');
      }
    } catch { /* ignore */ }
  }

  function chooseTheme(id) {
    if (!THEMES_BY_ID[id]) return;
    activeThemeId = id;
    savePrefs({ themeId: id });
    if (isCustomWallpaper()) {
      ntState = { ...ntState, wallpaperType: 'preset' };
      api.saveNewTabData({ wallpaperType: 'preset' }).catch(() => {});
    }
    applyTheme();
    syncDrawerControls();
    pushChromeTheme(true);
  }

  function renderPresets() {
    presetsGrid.textContent = '';
    for (const t of THEMES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'preset-card' + (t.isLight ? ' is-light-preview' : '') +
        (t.id === activeThemeId && !isCustomWallpaper() ? ' active' : '');
      card.style.background = t.thumb;
      const dot = document.createElement('span');
      dot.className = 'preset-dot';
      dot.style.background = t.accent;
      const name = document.createElement('span');
      name.className = 'preset-name';
      name.textContent = t.name;
      const sub = document.createElement('span');
      sub.className = 'preset-sub';
      sub.textContent = t.sub;
      card.append(dot, name, sub);
      card.addEventListener('click', () => chooseTheme(t.id));
      presetsGrid.appendChild(card);
    }
  }

  let transparentChrome = false;
  let isIncognito = false; // в Инкогнито сетевые виджеты (погода) отключены

  function applyTransparentMode() {
    const custom = isCustomWallpaper();
    document.getElementById('transparent-group').classList.toggle('is-hidden', !custom);
    document.getElementById('toggle-transparent').checked = transparentChrome;
    document.documentElement.classList.toggle('chrome-wall', transparentChrome && custom);
    syncVideo();
  }

  function syncColorControls() {
    const accentNow = prefs.customAccent || (ACCENTS.find((x) => x.id === prefs.accentId) || ACCENTS[0]).accent;
    document.getElementById('pick-accent').value = accentNow;
    document.getElementById('pick-card').value = prefs.cardColor || '#0a0e1a';
    document.getElementById('pick-clock').value = prefs.clockColor || (wallIsLight() ? '#0b1220' : '#ffffff');
    document.querySelectorAll('#text-mode-row .mini-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === (prefs.textMode || 'auto'));
    });
  }

  function renderAccentSwatches() {
    applyTransparentMode();
    syncColorControls();
    const custom = isCustomWallpaper();
    customAccentGroup.classList.toggle('is-hidden', !custom);
    accentSwatches.textContent = '';
    if (!custom) return;
    for (const a of ACCENTS) {
      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'accent-swatch' + (a.id === prefs.accentId ? ' active' : '');
      sw.style.background = `linear-gradient(135deg, ${a.accent}, ${a.accent2})`;
      sw.setAttribute('aria-label', a.id);
      sw.addEventListener('click', () => {
        savePrefs({ accentId: a.id, customAccent: null });
        applyTheme();
        pushChromeTheme(true);
      });
      accentSwatches.appendChild(sw);
    }
  }

  /* ==================== Виджеты: видимость ==================== */
  function applyWidgets() {
    const w = (ntState && ntState.widgets) || {};
    widgetClock.classList.toggle('is-hidden', w.clock === false);
    widgetLinks.classList.toggle('is-hidden', w.links === false);
    widgetSearch.classList.toggle('is-hidden', w.search === false);
    widgetTodo.classList.toggle('is-hidden', w.todo === false);
    greetingEl.classList.toggle('is-hidden', !prefs.showGreeting);
    document.getElementById('widget-weather').classList.toggle('is-hidden', !prefs.showWeather);
    document.getElementById('widget-saved-bm').classList.toggle('is-hidden', prefs.showSavedBm === false);
    document.getElementById('side-dock').classList.toggle('is-hidden', !prefs.showSideDock);
    updateClock();
  }

  function applyLayout() {
    const list = prefs.linksLayout === 'list';
    linksList.classList.toggle('layout-grid', !list);
    linksList.classList.toggle('layout-list', list);
    layoutBtnGrid.classList.toggle('active', !list);
    layoutBtnList.classList.toggle('active', list);
    showAddLinkBtn.classList.toggle('is-hidden', !list || !addLinkForm.classList.contains('is-hidden'));
    renderLinks();
  }

  function applyAtmosphere() {
    const dim = ntState ? ntState.dim : 22;
    const blur = ntState ? ntState.blur : 0;
    setCssVars({ '--bg-dim': String(dim / 100), '--bg-blur': `${blur}px` });
    dimValue.textContent = `${dim}%`;
    blurValue.textContent = `${blur} px`;
    glassValue.textContent = `${prefs.glassAlpha}%`;
  }

  function syncDrawerControls() {
    const dim = ntState ? ntState.dim : 22;
    const blur = ntState ? ntState.blur : 0;
    const w = (ntState && ntState.widgets) || {};
    dimSlider.value = String(dim);
    blurSlider.value = String(blur);
    glassSlider.value = String(prefs.glassAlpha);
    document.getElementById('toggle-hud-blur').checked = prefs.hudBlur !== false;
    document.getElementById('toggle-hud-border').checked = prefs.hudBorder !== false;
    syncHudPresets();
    toggleAnimate.checked = Boolean(prefs.animateBg);
    toggleParallax.checked = Boolean(prefs.parallax);
    toggleClock.checked = w.clock !== false;
    toggleSeconds.checked = Boolean(prefs.showSeconds);
    toggleGreeting.checked = Boolean(prefs.showGreeting);
    toggleLinks.checked = w.links !== false;
    toggleSearch.checked = w.search !== false;
    toggleTodo.checked = w.todo !== false;
    document.getElementById('toggle-weather').checked = Boolean(prefs.showWeather);
    document.getElementById('toggle-saved-bm').checked = prefs.showSavedBm !== false;
    document.getElementById('toggle-sidedock').checked = Boolean(prefs.showSideDock);
    clearWpBtn.classList.toggle('is-hidden', !isCustomWallpaper());
    applyAtmosphere();
  }

  // Накопление патчей: несколько изменений за 250 мс (например, два переключателя виджетов)
  // уходят одним объектом, а не затирают друг друга
  let saveTimer = null;
  let pendingPatch = null;

  function mergePatch(base, patch) {
    const merged = { ...(base || {}), ...patch };
    // widgets сливаем глубоко, чтобы {widgets:{clock:false}} + {widgets:{todo:false}} не потеряли первое
    if ((base && base.widgets) || patch.widgets) {
      merged.widgets = { ...((base && base.widgets) || {}), ...(patch.widgets || {}) };
    }
    return merged;
  }

  function flushSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!pendingPatch) return;
    const patch = pendingPatch;
    pendingPatch = null;
    try {
      Promise.resolve(api.saveNewTabData(patch)).catch(() => {});
    } catch { /* IPC недоступен */ }
  }

  function saveState(patch) {
    ntState = { ...ntState, ...patch, widgets: { ...ntState.widgets, ...(patch.widgets || {}) } };
    pendingPatch = mergePatch(pendingPatch, patch);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 250);
  }

  // Не теряем накопленное, если вкладку закрыли раньше, чем сработал таймер
  window.addEventListener('pagehide', flushSave);

  /* ==================== Быстрые ссылки ==================== */
  // Разрешены только http: и https: (file:, browser:, javascript:, data: и т.п. отклоняются — возвращаем '')
  function normalizeUrl(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
    try {
      const u = new URL(candidate);
      if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return '';
    } catch {
      return '';
    }
    return candidate;
  }

  function hostOf(url) {
    try { return new URL(url).hostname; } catch { return ''; }
  }

  function openLink(url, newTab) {
    if (newTab) api.openInNewTab(url);
    else api.navigate(url);
  }

  // Иконки сайтов приходят из main (прямо с сайта, без сторонних сервисов) в виде data:-URL.
  // Пока иконки нет или она не нашлась, остаётся цветная буква.
  const siteIconCache = new Map(); // host -> Promise<string|null>
  function loadSiteIcon(url) {
    const host = hostOf(url);
    if (!host || !realApi || typeof realApi.getSiteIcon !== 'function') return Promise.resolve(null);
    if (!siteIconCache.has(host)) {
      siteIconCache.set(host, realApi.getSiteIcon(url).then((v) => {
        const ok = typeof v === 'string' && v.startsWith('data:image/');
        if (!ok) setTimeout(() => siteIconCache.delete(host), 20000); // через 20 с можно спросить снова
        return ok ? v : null;
      }).catch(() => { siteIconCache.delete(host); return null; }));
    }
    return siteIconCache.get(host);
  }

  function buildIcon(link) {
    const icon = document.createElement('span');
    icon.className = 'link-icon';
    const letter = (link.title || '?').trim().charAt(0).toUpperCase() || '?';
    icon.textContent = letter;
    icon.style.color = link.color;
    loadSiteIcon(link.url).then((src) => {
      if (!src || !icon.isConnected) return;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.addEventListener('load', () => { icon.textContent = ''; icon.append(img); });
      img.src = src; // при ошибке декодирования остаётся буква
    });
    return icon;
  }

  function renderLinks() {
    const links = (ntState && ntState.links) || [];
    const list = prefs.linksLayout === 'list';
    linksList.textContent = '';

    links.forEach((link) => {
      const el = document.createElement('div');
      el.className = list ? 'link-row' : 'link-tile';
      el.tabIndex = 0;
      el.setAttribute('role', 'link');
      el.title = link.url;

      const title = document.createElement('span');
      title.className = 'link-title';
      title.textContent = link.title;

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'link-del';
      del.title = 'Удалить';
      del.setAttribute('aria-label', 'Удалить ссылку');
      del.innerHTML = '<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        saveState({ links: ntState.links.filter((l) => l.id !== link.id) });
        renderLinks();
      });

      el.append(buildIcon(link), title, del);
      el.addEventListener('click', (e) => openLink(link.url, e.ctrlKey || e.metaKey));
      el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openLink(link.url, true); } });
      el.addEventListener('keydown', (e) => { if (e.target !== el) return; if (e.key === 'Enter') openLink(link.url, false); });
      linksList.appendChild(el);
    });

    if (!list && links.length < 20) {
      const add = document.createElement('div');
      add.className = 'link-tile add-tile';
      add.tabIndex = 0;
      add.title = 'Добавить сайт';
      add.innerHTML = '<span class="link-icon"><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg></span><span class="link-title">Добавить</span>';
      add.addEventListener('click', openAddLinkForm);
      add.addEventListener('keydown', (e) => { if (e.key === 'Enter') openAddLinkForm(); });
      linksList.appendChild(add);
    }
  }

  function openAddLinkForm() {
    addLinkForm.classList.remove('is-hidden');
    showAddLinkBtn.classList.add('is-hidden');
    linkTitleInput.focus();
  }

  function closeAddLinkForm() {
    addLinkForm.classList.add('is-hidden');
    addLinkForm.reset();
    showAddLinkBtn.classList.toggle('is-hidden', prefs.linksLayout !== 'list');
  }

  showAddLinkBtn.addEventListener('click', openAddLinkForm);
  cancelLinkBtn.addEventListener('click', closeAddLinkForm);
  addLinkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = linkTitleInput.value.trim();
    const url = normalizeUrl(linkUrlInput.value);
    if (!title || !url) return;
    const link = {
      id: `l_${Date.now().toString(36)}`,
      title: title.slice(0, 40),
      url,
      color: LINK_COLORS[(ntState.links.length) % LINK_COLORS.length]
    };
    saveState({ links: [...ntState.links, link].slice(0, 20) });
    closeAddLinkForm();
    renderLinks();
  });

  /* ==================== Поиск ==================== */
  function renderEngines() {
    engineMenu.textContent = '';
    const current = enginesList.find((e) => e.key === currentEngineKey) || enginesList[0];
    if (current) {
      engineBadge.textContent = current.short;
      engineBadge.style.background = current.color;
      engineBadge.style.color = '#070a14';
    }
    for (const eng of enginesList) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'engine-option' + (eng.key === currentEngineKey ? ' active' : '');
      opt.textContent = eng.name;
      opt.addEventListener('click', async () => {
        engineMenu.classList.add('is-hidden');
        try {
          const res = await api.setSearchEngine(eng.key);
          currentEngineKey = (res && res.searchEngine) || eng.key;
        } catch {
          currentEngineKey = eng.key;
        }
        renderEngines();
        searchInput.focus();
      });
      engineMenu.appendChild(opt);
    }
  }

  engineBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    engineMenu.classList.toggle('is-hidden');
  });

  document.addEventListener('click', (e) => {
    if (!enginePicker.contains(e.target)) engineMenu.classList.add('is-hidden');
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    api.navigate(q);
  });

  /* ==================== Подсказки как в адресной строке ==================== */
  // Список рисует main (попап omnibox поверх страницы): вкладки, закладки, история и подсказки поисковика.
  // Со старым preload методов нет — тогда всё работает как раньше (Enter просто ищет).
  const hasOmni = Boolean(api) && typeof api.omniboxQuery === 'function';
  let omniOpen = false;

  const omniRect = () => {
    const r = searchForm.getBoundingClientRect();
    return { left: r.left, bottom: r.bottom, width: r.width };
  };
  const omniHide = () => {
    if (!hasOmni || !omniOpen) return;
    omniOpen = false;
    try { api.omniboxHide(); } catch { /* ignore */ }
  };
  const omniQuery = () => {
    if (!hasOmni) return;
    if (!searchInput.value.trim()) { omniHide(); return; }
    omniOpen = true;
    try { api.omniboxQuery(searchInput.value, omniRect()); } catch { /* ignore */ }
  };

  if (hasOmni) {
    searchInput.addEventListener('input', omniQuery);
    searchInput.addEventListener('focus', () => { try { api.omniboxWarm && api.omniboxWarm(); } catch { /* ignore */ } });
    searchInput.addEventListener('blur', () => { if (omniOpen) { try { api.omniboxBlur(); } catch { /* ignore */ } } });
    searchForm.addEventListener('submit', omniHide);
    window.addEventListener('resize', omniHide);
    window.addEventListener('pagehide', omniHide);
    searchInput.addEventListener('keydown', async (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!searchInput.value.trim()) return;
        e.preventDefault();
        if (!omniOpen) omniQuery();
        else api.omniboxMove(e.key === 'ArrowDown' ? 1 : -1);
      } else if (e.key === 'Escape') {
        omniHide();
      } else if (e.key === 'Enter' && omniOpen) {
        e.preventDefault(); // вместо отправки формы: Enter применяет выбранную строку списка
        const text = searchInput.value;
        omniOpen = false;
        let handled = false;
        try { handled = await api.omniboxAccept(text); } catch { /* ignore */ }
        if (!handled && text.trim()) api.navigate(text.trim());
      }
    });
  }

  document.querySelectorAll('.bang-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      searchInput.value = chip.dataset.bang || '';
      searchInput.focus();
    });
  });

  document.addEventListener('keydown', (e) => {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (e.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === 'Escape') {
      closeDrawer();
      engineMenu.classList.add('is-hidden');
    }
  });

  /* ==================== Задачи ==================== */
  const CHECK_SVG = '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.3l2.4 2.4 4.6-5"/></svg>';

  function saveTodos(todos) {
    saveState({ todos });
    renderTodos();
  }

  function renderTodos() {
    const todos = (ntState && ntState.todos) || [];
    const done = todos.filter((t) => t.done).length;
    todoCount.textContent = `${done}/${todos.length}`;
    todoProgressFill.style.width = todos.length ? `${Math.round((done / todos.length) * 100)}%` : '0%';
    clearDoneBtn.classList.toggle('is-hidden', done === 0);
    todoList.textContent = '';

    if (!todos.length) {
      const empty = document.createElement('div');
      empty.className = 'todo-empty';
      empty.textContent = 'Пока пусто. Добавьте первую задачу выше.';
      todoList.appendChild(empty);
      return;
    }

    for (const todo of todos) {
      const item = document.createElement('div');
      item.className = 'todo-item' + (todo.done ? ' done' : '');

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'todo-check';
      check.innerHTML = todo.done ? CHECK_SVG : '';
      check.setAttribute('aria-label', 'Отметить выполненной');
      check.addEventListener('click', () => {
        saveTodos(ntState.todos.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
      });

      const text = document.createElement('span');
      text.className = 'todo-text';
      text.textContent = todo.text;
      text.addEventListener('click', () => {
        saveTodos(ntState.todos.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)));
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'todo-del';
      del.title = 'Удалить';
      del.setAttribute('aria-label', 'Удалить задачу');
      del.innerHTML = '<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';
      del.addEventListener('click', () => saveTodos(ntState.todos.filter((t) => t.id !== todo.id)));

      item.append(check, text, del);
      todoList.appendChild(item);
    }
  }

  todoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = todoInput.value.trim();
    if (!text) return;
    saveTodos([{ id: `t_${Date.now().toString(36)}`, text: text.slice(0, 160), done: false }, ...ntState.todos].slice(0, 50));
    todoInput.value = '';
  });

  clearDoneBtn.addEventListener('click', () => saveTodos(ntState.todos.filter((t) => !t.done)));

  /* ==================== Панель «Темы и вид» ==================== */
  function openDrawer() {
    syncDrawerControls();
    drawer.classList.add('open');
    backdrop.classList.add('open');
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
  }

  customizeBtn.addEventListener('click', () => {
    if (drawer.classList.contains('open')) closeDrawer();
    else openDrawer();
  });
  closeDrawerBtn.addEventListener('click', closeDrawer);
  backdrop.addEventListener('click', closeDrawer);

  function showWpError(msg) {
    wpError.textContent = msg || '';
    wpError.classList.toggle('is-hidden', !msg);
  }

  function adoptPayload(payload) {
    if (!payload || !payload.state) return;
    ntState = payload.state;
    lastRenderedBgKey = '';
    applyTheme();
    applyWidgets();
    syncDrawerControls();
  }

  pickWpBtn.addEventListener('click', async () => {
    showWpError('');
    try {
      const res = await api.pickWallpaper();
      if (!res || res.canceled) return;
      if (res.error) { showWpError(res.error); return; }
      adoptPayload(res);
    } catch {
      showWpError('Не удалось загрузить обои.');
    }
  });

  clearWpBtn.addEventListener('click', async () => {
    showWpError('');
    try {
      adoptPayload(await api.clearWallpaper());
      // Без своих обоев прозрачная оболочка не нужна; цвет оболочки возвращаем к теме пресета
      transparentChrome = false;
      applyTransparentMode();
      try {
        if (api && typeof api.setTransparentChrome === 'function') api.setTransparentChrome(false);
      } catch { /* ignore */ }
      pushChromeTheme(true);
    } catch {
      showWpError('Не удалось сбросить обои.');
    }
  });

  dimSlider.addEventListener('input', () => { saveState({ dim: Number(dimSlider.value) }); applyAtmosphere(); });
  blurSlider.addEventListener('input', () => { saveState({ blur: Number(blurSlider.value) }); applyAtmosphere(); });
  function syncHudPresets() {
    document.querySelectorAll('#hud-presets .mini-btn').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.alpha) === Number(prefs.glassAlpha));
    });
  }
  function setHudAlpha(v) {
    savePrefs({ glassAlpha: v });
    glassSlider.value = String(v);
    applyGlass();
    glassValue.textContent = `${prefs.glassAlpha}%`;
    syncHudPresets();
  }
  glassSlider.addEventListener('input', () => setHudAlpha(Number(glassSlider.value)));
  document.querySelectorAll('#hud-presets .mini-btn').forEach((b) => {
    b.addEventListener('click', () => setHudAlpha(Number(b.dataset.alpha)));
  });
  document.getElementById('toggle-hud-blur').addEventListener('change', (e) => { savePrefs({ hudBlur: e.target.checked }); applyGlass(); });
  document.getElementById('toggle-hud-border').addEventListener('change', (e) => { savePrefs({ hudBorder: e.target.checked }); applyGlass(); });

  document.getElementById('toggle-transparent').addEventListener('change', (e) => {
    transparentChrome = e.target.checked;
    applyTransparentMode();
    try {
      if (api && typeof api.setTransparentChrome === 'function') api.setTransparentChrome(transparentChrome);
      else showNotice('Прозрачная оболочка не включилась: замените preload/tabPreload.js и перезапустите браузер.');
    } catch { /* ignore */ }
  });
  // ---- Свои цвета (акцент, окошки, время, текст) ----
  let chromePushTimer = null;
  function colorChanged(patch, remote) {
    savePrefs(patch);
    applyTheme();
    clearTimeout(chromePushTimer);
    chromePushTimer = setTimeout(() => pushChromeTheme(remote), 250);
  }
  document.getElementById('pick-accent').addEventListener('input', (e) => colorChanged({ customAccent: e.target.value }, false));
  document.getElementById('pick-card').addEventListener('input', (e) => colorChanged({ cardColor: e.target.value }, false));
  document.getElementById('pick-clock').addEventListener('input', (e) => colorChanged({ clockColor: e.target.value }, false));
  document.getElementById('reset-card').addEventListener('click', () => colorChanged({ cardColor: null }, false));
  document.getElementById('reset-clock').addEventListener('click', () => colorChanged({ clockColor: null }, false));
  document.querySelectorAll('#text-mode-row .mini-btn').forEach((b) => {
    b.addEventListener('click', () => colorChanged({ textMode: b.dataset.mode }, true));
  });

  toggleAnimate.addEventListener('change', () => { savePrefs({ animateBg: toggleAnimate.checked }); syncCanvas(); });
  toggleParallax.addEventListener('change', () => {
    savePrefs({ parallax: toggleParallax.checked });
    if (!prefs.parallax) stageEl.style.transform = '';
  });
  toggleSeconds.addEventListener('change', () => { savePrefs({ showSeconds: toggleSeconds.checked }); updateClock(); });
  toggleGreeting.addEventListener('change', () => { savePrefs({ showGreeting: toggleGreeting.checked }); applyWidgets(); });
  toggleClock.addEventListener('change', () => { saveState({ widgets: { clock: toggleClock.checked } }); applyWidgets(); });
  toggleLinks.addEventListener('change', () => { saveState({ widgets: { links: toggleLinks.checked } }); applyWidgets(); });
  toggleSearch.addEventListener('change', () => { saveState({ widgets: { search: toggleSearch.checked } }); applyWidgets(); });
  toggleTodo.addEventListener('change', () => { saveState({ widgets: { todo: toggleTodo.checked } }); applyWidgets(); });

  layoutBtnGrid.addEventListener('click', () => { savePrefs({ linksLayout: 'grid' }); applyLayout(); });
  layoutBtnList.addEventListener('click', () => { savePrefs({ linksLayout: 'list' }); applyLayout(); });

  /* ==================== Параллакс ==================== */
  // mousemove только запоминает координаты, а стиль пишется не чаще одного раза за кадр
  let parallaxX = 0;
  let parallaxY = 0;
  let parallaxFrame = 0;
  window.addEventListener('mousemove', (e) => {
    if (!prefs.parallax || prefersReducedMotion) return;
    parallaxX = (e.clientX / window.innerWidth - 0.5) * -14;
    parallaxY = (e.clientY / window.innerHeight - 0.5) * -10;
    if (parallaxFrame) return;
    parallaxFrame = requestAnimationFrame(() => {
      parallaxFrame = 0;
      if (!prefs.parallax || prefersReducedMotion) return; // успели выключить до кадра
      stageEl.style.transform = `translate(${parallaxX.toFixed(1)}px, ${parallaxY.toFixed(1)}px)`;
    });
  }, { passive: true });


  /* ==================== Папки и группы закладок ==================== */
  const BM_KEY = 'mybrowser_nt_bookmarks_v1';
  const bmBar = document.getElementById('bm-bar');
  const bmGroups = document.getElementById('bm-groups');
  const X_SVG = '<svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7"/></svg>';
  const bmUid = () => `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function bmDefaults() {
    const L = (title, url) => ({ id: bmUid(), title, url });
    return {
      active: 'home',
      folders: [
        { id: bmUid(), name: 'Dev & Code', groups: [
          { id: bmUid(), title: 'Разработка', links: [L('GitHub', 'https://github.com'), L('Stack Overflow', 'https://stackoverflow.com'), L('MDN', 'https://developer.mozilla.org'), L('npm', 'https://www.npmjs.com')] },
          { id: bmUid(), title: 'ИИ', links: [L('ChatGPT', 'https://chatgpt.com'), L('Gemini', 'https://gemini.google.com'), L('Claude', 'https://claude.ai')] }
        ] },
        { id: bmUid(), name: 'Развлечения', groups: [
          { id: bmUid(), title: 'Стриминг', links: [L('YouTube', 'https://youtube.com'), L('Twitch', 'https://twitch.tv'), L('Netflix', 'https://netflix.com'), L('Spotify', 'https://open.spotify.com')] },
          { id: bmUid(), title: 'Игры', links: [L('Steam', 'https://store.steampowered.com'), L('Epic Games', 'https://store.epicgames.com'), L('GOG', 'https://gog.com')] }
        ] },
        { id: bmUid(), name: 'Новости', groups: [
          { id: bmUid(), title: 'Tech News', links: [L('Hacker News', 'https://news.ycombinator.com'), L('The Verge', 'https://theverge.com'), L('Хабр', 'https://habr.com'), L('vc.ru', 'https://vc.ru')] }
        ] }
      ]
    };
  }

  function loadLegacyBm() {
    try {
      const raw = window.localStorage.getItem(BM_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.folders)) return d;
      }
    } catch { /* ignore */ }
    return null;
  }

  // Реальные папки приходят из main в init(); до этого и при отсутствии сохранённых — набор по умолчанию
  let bm = bmDefaults();
  let bmAddingFolder = false;
  let bmOpenForm = null; // { type: 'link', gid } | { type: 'group' }

  function saveBm() {
    if (hasStudioApi) {
      Promise.resolve(realApi.saveStudioBookmarks(bm)).catch((err) => console.error('newtab: не удалось сохранить папки закладок', err));
      return;
    }
    try { window.localStorage.setItem(BM_KEY, JSON.stringify(bm)); } catch { /* ignore */ }
  }

  function activeFolder() {
    return bm.folders.find((f) => f.id === bm.active) || null;
  }

  function bmIcon(link, idx) {
    const ico = document.createElement('span');
    ico.className = 'bm-ico';
    ico.style.color = LINK_COLORS[idx % LINK_COLORS.length];
    ico.textContent = (link.title || '?').trim().charAt(0).toUpperCase() || '?';
    // Иконка берётся прямо с сайта (main/siteIcons.js), пока её нет — цветная буква
    loadSiteIcon(link.url).then((src) => {
      if (!src || !ico.isConnected) return;
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.addEventListener('load', () => { ico.textContent = ''; ico.classList.add('has-img'); ico.append(img); });
      img.src = src;
    });
    return ico;
  }

  function xButton(title, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'bm-x';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = X_SVG;
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  }

  function renderBmBar() {
    bmBar.textContent = '';
    const mk = (id, name, custom) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'bm-pill' + (bm.active === id ? ' active' : '') + (custom ? ' custom' : '');
      const label = document.createElement('span');
      label.textContent = name;
      pill.appendChild(label);
      if (custom) {
        const x = document.createElement('span');
        x.className = 'bm-pill-x';
        x.title = 'Удалить папку';
        x.innerHTML = X_SVG;
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          bm.folders = bm.folders.filter((f) => f.id !== id);
          bm.active = 'home';
          saveBm();
          renderBookmarks();
        });
        pill.appendChild(x);
      }
      pill.addEventListener('click', () => {
        if (bm.active === id) return;
        bm.active = id;
        bmOpenForm = null;
        saveBm();
        renderBookmarks();
      });
      bmBar.appendChild(pill);
    };

    mk('home', 'Главная', false);
    bm.folders.forEach((f) => mk(f.id, f.name, true));

    if (bmAddingFolder) {
      const input = document.createElement('input');
      input.className = 'bm-pill-input';
      input.maxLength = 24;
      input.placeholder = 'Название папки';
      const done = (commit) => {
        const name = input.value.trim();
        bmAddingFolder = false;
        if (commit && name && bm.folders.length < 12) {
          const f = { id: bmUid(), name: name.slice(0, 24), groups: [] };
          bm.folders.push(f);
          bm.active = f.id;
          saveBm();
        }
        renderBookmarks();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); done(true); }
        else if (e.key === 'Escape') { e.stopPropagation(); done(false); }
      });
      input.addEventListener('blur', () => { if (bmAddingFolder) done(Boolean(input.value.trim())); });
      bmBar.appendChild(input);
      setTimeout(() => input.focus(), 0);
    } else if (bm.folders.length < 12) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'bm-pill add';
      add.title = 'Новая папка';
      add.textContent = '+';
      add.addEventListener('click', () => { bmAddingFolder = true; renderBmBar(); });
      bmBar.appendChild(add);
    }
  }

  function parseBulk(text) {
    // каждая строка: «адрес» или «Название адрес» или «Название | адрес»
    const out = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      let title = '';
      let url = '';
      if (line.includes('|')) {
        const [a, b] = line.split('|');
        title = a.trim(); url = b.trim();
      } else {
        const parts = line.split(/\s+/);
        url = parts.pop();
        title = parts.join(' ');
      }
      const full = normalizeUrl(url);
      if (!full || !hostOf(full)) continue;
      if (!title) title = hostOf(full).replace(/^www\./, '');
      out.push({ id: bmUid(), title: title.slice(0, 40), url: full });
    }
    return out;
  }

  function groupCard(folder, g) {
    const card = document.createElement('div');
    card.className = 'bm-card';

    const head = document.createElement('div');
    head.className = 'bm-card-head';
    const title = document.createElement('h3');
    title.className = 'bm-card-title';
    title.textContent = g.title;
    head.append(title, xButton('Удалить группу', () => {
      folder.groups = folder.groups.filter((x) => x.id !== g.id);
      saveBm(); renderBmGroups();
    }));
    card.appendChild(head);

    g.links.forEach((link, i) => {
      const row = document.createElement('div');
      row.className = 'bm-row';
      row.tabIndex = 0;
      row.title = link.url;
      const name = document.createElement('span');
      name.className = 'bm-name';
      name.textContent = link.title;
      row.append(bmIcon(link, i), name, xButton('Удалить ссылку', () => {
        g.links = g.links.filter((l) => l.id !== link.id);
        saveBm(); renderBmGroups();
      }));
      row.addEventListener('click', (e) => openLink(link.url, e.ctrlKey || e.metaKey));
      row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openLink(link.url, true); } });
      row.addEventListener('keydown', (e) => { if (e.target !== row) return; if (e.key === 'Enter') openLink(link.url, false); });
      card.appendChild(row);
    });

    if (bmOpenForm && bmOpenForm.type === 'link' && bmOpenForm.gid === g.id) {
      const form = document.createElement('form');
      form.className = 'bm-form';
      const t = document.createElement('input'); t.placeholder = 'Название'; t.maxLength = 40;
      const u = document.createElement('input'); u.placeholder = 'Адрес (например, site.com)'; u.maxLength = 512;
      const actions = document.createElement('div'); actions.className = 'bm-form-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'bm-btn'; cancel.textContent = 'Отмена';
      const ok = document.createElement('button'); ok.type = 'submit'; ok.className = 'bm-btn solid'; ok.textContent = 'Добавить';
      cancel.addEventListener('click', () => { bmOpenForm = null; renderBmGroups(); });
      actions.append(cancel, ok);
      form.append(t, u, actions);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const url = normalizeUrl(u.value);
        if (!url || !hostOf(url)) { u.focus(); return; }
        const name = t.value.trim() || hostOf(url).replace(/^www\./, '');
        g.links.push({ id: bmUid(), title: name.slice(0, 40), url });
        bmOpenForm = { type: 'link', gid: g.id };
        saveBm(); renderBmGroups();
      });
      card.appendChild(form);
      setTimeout(() => t.focus(), 0);
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'bm-add-link';
      add.textContent = '+ Добавить ссылку';
      add.addEventListener('click', () => { bmOpenForm = { type: 'link', gid: g.id }; renderBmGroups(); });
      card.appendChild(add);
    }
    return card;
  }

  function newGroupCard(folder) {
    const card = document.createElement('div');
    card.className = 'bm-card new';
    if (bmOpenForm && bmOpenForm.type === 'group') {
      const form = document.createElement('form');
      form.className = 'bm-form';
      const t = document.createElement('input'); t.placeholder = 'Название группы'; t.maxLength = 32;
      const ta = document.createElement('textarea'); ta.rows = 4;
      ta.placeholder = 'Ссылки по одной в строке (можно массово):\nyoutube.com\nGitHub | github.com';
      const actions = document.createElement('div'); actions.className = 'bm-form-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'bm-btn'; cancel.textContent = 'Отмена';
      const ok = document.createElement('button'); ok.type = 'submit'; ok.className = 'bm-btn solid'; ok.textContent = 'Создать';
      cancel.addEventListener('click', () => { bmOpenForm = null; renderBmGroups(); });
      actions.append(cancel, ok);
      form.append(t, ta, actions);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = t.value.trim();
        if (!title) { t.focus(); return; }
        folder.groups.push({ id: bmUid(), title: title.slice(0, 32), links: parseBulk(ta.value).slice(0, 200) });
        bmOpenForm = null;
        saveBm(); renderBmGroups();
      });
      card.appendChild(form);
      setTimeout(() => t.focus(), 0);
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'bm-add-link';
      add.textContent = '+ Новая группа';
      add.addEventListener('click', () => { bmOpenForm = { type: 'group' }; renderBmGroups(); });
      card.appendChild(add);
    }
    return card;
  }

  function renderBmGroups() {
    const folder = activeFolder();
    bmGroups.textContent = '';
    if (!folder) return;
    if (!folder.groups.length && !(bmOpenForm && bmOpenForm.type === 'group')) {
      const empty = document.createElement('div');
      empty.className = 'bm-empty';
      empty.textContent = 'Папка пуста. Создайте группу и вставьте список ссылок.';
      bmGroups.appendChild(empty);
    }
    folder.groups.forEach((g) => bmGroups.appendChild(groupCard(folder, g)));
    bmGroups.appendChild(newGroupCard(folder));
  }

  function renderBookmarks() {
    if (!activeFolder()) bm.active = 'home';
    const home = bm.active === 'home';
    widgetLinks.classList.toggle('bm-away', !home);
    bmGroups.classList.toggle('is-hidden', home);
    renderBmBar();
    if (!home) renderBmGroups();
  }

  /* ==================== Закладки (★ из bookmarks.json) ==================== */
  const sbmList = document.getElementById('sbm-list');
  const sbmCount = document.getElementById('sbm-count');
  let savedBm = [];

  function renderSavedBm() {
    sbmCount.textContent = String(savedBm.length);
    sbmList.textContent = '';
    if (!savedBm.length) {
      const e = document.createElement('div');
      e.className = 'todo-empty';
      e.textContent = 'Нажмите ★ в адресной строке (Ctrl+D), чтобы закрепить сайт';
      sbmList.appendChild(e);
      appendManagerLink();
      return;
    }
    savedBm.forEach((b, i) => {
      const row = document.createElement('div');
      row.className = 'bm-row';
      row.title = b.folder ? `${b.folder} · ${b.url}` : b.url; // папка из диспетчера закладок
      row.tabIndex = 0;
      const name = document.createElement('span');
      name.className = 'bm-name';
      name.textContent = b.title || b.url;
      row.append(bmIcon(b, i), name, xButton('Удалить закладку', () => {
        Promise.resolve(api.removeBookmark(b.url)).then(setSavedBm).catch(() => {});
      }));
      row.addEventListener('click', (e) => openLink(b.url, e.ctrlKey || e.metaKey));
      row.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
      row.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); openLink(b.url, true); } });
      row.addEventListener('keydown', (e) => { if (e.target !== row) return; if (e.key === 'Enter') openLink(b.url, e.ctrlKey || e.metaKey); });
      sbmList.appendChild(row);
    });
    appendManagerLink();
  }

  // Ссылка на диспетчер закладок (browser://bookmarks) внизу списка ★
  function appendManagerLink() {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'bm-add-link';
    more.textContent = 'Все закладки и папки…';
    more.title = 'Диспетчер закладок (Ctrl+Shift+O)';
    more.addEventListener('click', (e) => openLink('browser://bookmarks', e.ctrlKey || e.metaKey));
    sbmList.appendChild(more);
  }

  function setSavedBm(list) {
    savedBm = Array.isArray(list)
      ? list.filter((b) => b && typeof b.url === 'string' && /^https?:\/\//i.test(b.url))
      : [];
    renderSavedBm();
  }

  function loadSavedBm() {
    if (typeof api.getBookmarks !== 'function') return;
    Promise.resolve(api.getBookmarks()).then(setSavedBm).catch(() => {});
  }
  if (typeof api.onBookmarksChanged === 'function') api.onBookmarksChanged(setSavedBm);

  // Папки, группы и ссылки изменили в диспетчере закладок (browser://bookmarks) или в другой вкладке Новой вкладки.
  // Просто перерисовываем: saveBm() здесь не вызывается, чтобы не отправить обновление обратно
  if (hasStudioApi && typeof realApi.onStudioBookmarksChanged === 'function') {
    realApi.onStudioBookmarksChanged((next) => {
      if (!next || !Array.isArray(next.folders)) return;
      const keep = bm.active;
      bm = { ...next, active: keep === 'home' || next.folders.some((f) => f.id === keep) ? keep : 'home' };
      const stillThere = (gid) => bm.folders.some((f) => f.groups.some((g) => g.id === gid));
      if (bmOpenForm && bmOpenForm.type === 'link' && !stillThere(bmOpenForm.gid)) bmOpenForm = null;
      renderBookmarks();
    });
  }
  document.getElementById('toggle-saved-bm').addEventListener('change', (e) => {
    savePrefs({ showSavedBm: e.target.checked });
    applyWidgets();
  });

  /* ==================== Запреты (камера / микрофон / геолокация) ==================== */
  const permApi = window.newtabApi || null;
  const permState = { blockCamera: false, blockMicrophone: false, blockGeolocation: false };
  const permCard = document.getElementById('widget-perms');
  const permCountEl = document.getElementById('perm-count');
  const permRows = Array.from(document.querySelectorAll('.perm-row'));
  const permFab = document.getElementById('perm-fab');
  const permFabCount = document.getElementById('perm-fab-count');
  const permClose = document.getElementById('perm-close');

  // Панель «Запреты» выезжает снизу по кнопке; закрывается повторным нажатием, кнопкой ▾, Esc или кликом вне панели
  function setPermOpen(open) {
    permCard.classList.toggle('open', open);
    permCard.setAttribute('aria-hidden', String(!open));
    permFab.setAttribute('aria-expanded', String(open));
  }
  permFab.addEventListener('click', () => setPermOpen(!permCard.classList.contains('open')));
  permClose.addEventListener('click', () => { setPermOpen(false); permFab.focus(); });
  document.addEventListener('pointerdown', (e) => {
    if (!permCard.classList.contains('open')) return;
    if (permCard.contains(e.target) || permFab.contains(e.target)) return;
    setPermOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && permCard.classList.contains('open')) { setPermOpen(false); permFab.focus(); }
  });

  function renderPerms() {
    let n = 0;
    permRows.forEach((row) => {
      const on = Boolean(permState[row.dataset.perm]);
      if (on) n++;
      row.classList.toggle('is-blocked', on);
      row.setAttribute('aria-pressed', String(on));
      // геолокацию security.js запрещает всегда, поэтому «По запросу» для неё не показываем
      const idle = row.dataset.perm === 'blockGeolocation' ? 'Недоступно сайтам' : 'По запросу';
      row.querySelector('.perm-state').textContent = on ? 'Запрещено' : idle;
    });
    permCountEl.textContent = `${n}/3`;
    permCard.classList.toggle('has-blocks', n > 0);
    permFabCount.textContent = String(n);
    permFab.classList.toggle('has-blocks', n > 0);
  }

  function applyPermState(next) {
    if (!next || typeof next !== 'object') return;
    for (const k of Object.keys(permState)) {
      if (typeof next[k] === 'boolean') permState[k] = next[k];
    }
    renderPerms();
  }

  permRows.forEach((row) => {
    if (!permApi) { row.disabled = true; return; }
    row.addEventListener('click', async () => {
      const key = row.dataset.perm;
      const want = !permState[key];
      permState[key] = want;
      renderPerms(); // сразу, без ожидания main
      try {
        applyPermState(await permApi.setPermBlock(key, want));
      } catch (err) {
        permState[key] = !want;
        renderPerms();
        console.error('newtab: не удалось изменить запрет', err);
      }
    });
  });

  if (permApi) {
    permApi.getPermBlocks().then(applyPermState).catch(() => {});
    permApi.onPermBlocksChanged(applyPermState);
  }
  renderPerms();

  /* ==================== Запуск ==================== */
  // Студия тем и папки закладок хранятся в файле через main. При первом открытии после обновления
  // переносим старые данные из localStorage (один раз), чтобы папки и настройки не пропали
  async function loadStudioData(data) {
    if (!hasStudioApi) {
      // Запасной режим без хранилища в main: читаем прежний localStorage
      prefs = { ...DEFAULT_PREFS, ...(loadLegacyPrefs() || {}) };
      bm = loadLegacyBm() || bmDefaults();
      return;
    }
    let studio = data && data.studio;
    if (studio && studio.migrated === false && !isIncognito) {
      const legacyPrefs = loadLegacyPrefs();
      const legacyBm = loadLegacyBm();
      try {
        const res = await realApi.migrateStudio({ prefs: legacyPrefs, bm: legacyBm });
        if (res && res.migrated === true) {
          studio = res;
          // Данные сохранены в файле — старые ключи больше не нужны (и не смогут «воскресить» устаревшие значения)
          try { window.localStorage.removeItem(PREFS_KEY); window.localStorage.removeItem(BM_KEY); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error('newtab: не удалось перенести данные из localStorage', err);
      }
      // Перенос не удался: на этот сеанс остаёмся на старых данных, ключи localStorage не трогаем — повторим при следующем открытии
      if (studio && studio.migrated === false) {
        studio = { ...studio, prefs: { ...(legacyPrefs || {}) }, bm: legacyBm };
      }
    }
    if (studio && typeof studio === 'object') {
      prefs = { ...DEFAULT_PREFS, ...(studio.prefs && typeof studio.prefs === 'object' ? studio.prefs : {}) };
      if (studio.bm && Array.isArray(studio.bm.folders)) bm = studio.bm;
    }
  }

  async function init() {
    resizeCanvas();
    ntState = { ...fallbackState };
    try {
      const data = await api.getNewTabData();
      if (data && data.state) {
        ntState = data.state;
        enginesList = data.engines || [];
        currentEngineKey = data.searchEngine || 'google';
        transparentChrome = Boolean(data.transparentChrome);
        isIncognito = Boolean(data.incognito);
        setEnergySaver(data.energySaverActive);
      }
      await loadStudioData(data);
    } catch (err) {
      console.error('newtab: не удалось загрузить данные', err);
    }

    activeThemeId = resolveThemeId();
    applyTheme();
    applyWidgets();
    applyLayout();
    renderBookmarks();
    renderTodos();
    loadSavedBm();
    renderEngines();
    syncDrawerControls();
    // pushChromeTheme() здесь намеренно нет: открытие вкладки не должно сбрасывать тему и режим оболочки
    loadWeather(false);
    sceneEl.classList.add('ready');
  }


  /* ==================== Погода (Open-Meteo, без ключа) ==================== */
  const WEATHER_CACHE_KEY = 'mybrowser_nt_weather_v1';
  const WMO = {
    0: ['☀️', 'Ясно'], 1: ['🌤️', 'Преимущественно ясно'], 2: ['⛅', 'Переменная облачность'], 3: ['☁️', 'Пасмурно'],
    45: ['🌫️', 'Туман'], 48: ['🌫️', 'Изморозь'],
    51: ['🌦️', 'Морось'], 53: ['🌦️', 'Морось'], 55: ['🌦️', 'Сильная морось'],
    56: ['🌧️', 'Ледяная морось'], 57: ['🌧️', 'Ледяная морось'],
    61: ['🌧️', 'Дождь'], 63: ['🌧️', 'Дождь'], 65: ['🌧️', 'Сильный дождь'],
    66: ['🌧️', 'Ледяной дождь'], 67: ['🌧️', 'Ледяной дождь'],
    71: ['🌨️', 'Снег'], 73: ['🌨️', 'Снег'], 75: ['❄️', 'Сильный снег'], 77: ['🌨️', 'Снежная крупа'],
    80: ['🌦️', 'Ливень'], 81: ['🌧️', 'Ливень'], 82: ['⛈️', 'Сильный ливень'],
    85: ['🌨️', 'Снегопад'], 86: ['❄️', 'Сильный снегопад'],
    95: ['⛈️', 'Гроза'], 96: ['⛈️', 'Гроза с градом'], 99: ['⛈️', 'Гроза с градом']
  };
  const wEl = {
    temp: document.getElementById('weather-temp'),
    city: document.getElementById('weather-city'),
    desc: document.getElementById('weather-desc'),
    icon: document.getElementById('weather-icon'),
    stats: document.getElementById('weather-stats'),
    feels: document.getElementById('weather-feels'),
    hum: document.getElementById('weather-hum'),
    wind: document.getElementById('weather-wind'),
    form: document.getElementById('weather-form'),
    input: document.getElementById('weather-input'),
    msg: document.getElementById('weather-msg')
  };

  function setWeatherMsg(text, isErr) {
    wEl.msg.textContent = text || '';
    wEl.msg.classList.toggle('err', Boolean(isErr));
  }

  function renderWeather(d) {
    const info = WMO[d.code] || ['🌡️', ''];
    wEl.temp.textContent = `${Math.round(d.temp)}°`;
    wEl.icon.textContent = info[0];
    wEl.desc.textContent = info[1];
    wEl.feels.textContent = `${Math.round(d.feels)}°`;
    wEl.hum.textContent = `${Math.round(d.hum)}%`;
    wEl.wind.textContent = `${Math.round(d.wind)} м/с`;
    wEl.stats.classList.remove('is-hidden');
  }

  async function loadWeather(force) {
    if (isIncognito) {
      wEl.city.textContent = 'Погода отключена в Инкогнито';
      wEl.form.classList.add('is-hidden');
      return;
    }
    const place = prefs.weatherPlace;
    if (!place) {
      wEl.city.textContent = 'Выбрать город';
      wEl.form.classList.remove('is-hidden');
      return;
    }
    wEl.city.textContent = place.name;
    try {
      const cached = JSON.parse(window.localStorage.getItem(WEATHER_CACHE_KEY) || 'null');
      if (!force && cached && cached.key === `${place.lat},${place.lon}` && Date.now() - cached.at < 15 * 60 * 1000) {
        renderWeather(cached.data);
        return;
      }
    } catch { /* ignore */ }
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
        `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&wind_speed_unit=ms`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('http ' + res.status);
      const j = (await res.json()).current;
      const data = { temp: j.temperature_2m, feels: j.apparent_temperature, hum: j.relative_humidity_2m, code: j.weather_code, wind: j.wind_speed_10m };
      renderWeather(data);
      try { window.localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify({ key: `${place.lat},${place.lon}`, at: Date.now(), data })); } catch { /* ignore */ }
    } catch {
      wEl.desc.textContent = 'Не удалось загрузить погоду';
    }
  }

  async function searchCity(query) {
    if (isIncognito) { setWeatherMsg('В Инкогнито погода отключена', true); return; }
    setWeatherMsg('Ищу...');
    try {
      const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=ru`);
      const j = await res.json();
      if (!j.results || !j.results.length) { setWeatherMsg('Город не найден', true); return; }
      const r = j.results[0];
      savePrefs({ weatherPlace: { name: r.name, lat: r.latitude, lon: r.longitude } });
      setWeatherMsg('');
      wEl.input.value = '';
      wEl.form.classList.add('is-hidden');
      loadWeather(true);
    } catch {
      setWeatherMsg('Нет связи с сервисом погоды', true);
    }
  }

  wEl.city.addEventListener('click', () => {
    wEl.form.classList.toggle('is-hidden');
    if (!wEl.form.classList.contains('is-hidden')) wEl.input.focus();
  });
  wEl.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = wEl.input.value.trim();
    if (q) searchCity(q);
  });
  wEl.input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && prefs.weatherPlace) wEl.form.classList.add('is-hidden');
  });

  /* ==================== Боковая мини-панель ==================== */
  document.getElementById('side-themes').addEventListener('click', () => customizeBtn.click());
  document.getElementById('side-search').addEventListener('click', () => document.getElementById('search-input').focus());
  document.getElementById('side-todo').addEventListener('click', () => document.getElementById('todo-input').focus());
  document.getElementById('side-gemini').addEventListener('click', () => api.navigate('https://gemini.google.com/app'));
  document.getElementById('side-weather').addEventListener('click', () => {
    if (!prefs.showWeather) { savePrefs({ showWeather: true }); applyWidgets(); syncDrawerControls(); }
    wEl.form.classList.remove('is-hidden');
    wEl.input.focus();
  });
  document.getElementById('toggle-weather').addEventListener('change', (e) => { savePrefs({ showWeather: e.target.checked }); applyWidgets(); });
  document.getElementById('toggle-sidedock').addEventListener('change', (e) => { savePrefs({ showSideDock: e.target.checked }); applyWidgets(); });
  // Периодическое обновление погоды: только пока вкладка видна. При возврате — сразу обновляем, если данные устарели
  const WEATHER_REFRESH_MS = 15 * 60 * 1000;
  let weatherTimer = null;
  let weatherLastTick = Date.now();
  function weatherTick() {
    weatherLastTick = Date.now();
    if (prefs.showWeather && prefs.weatherPlace) loadWeather(false);
  }
  function startWeatherTimer() {
    if (weatherTimer || document.hidden) return;
    weatherTimer = setInterval(weatherTick, WEATHER_REFRESH_MS);
  }
  function stopWeatherTimer() {
    if (!weatherTimer) return;
    clearInterval(weatherTimer);
    weatherTimer = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopWeatherTimer();
    } else {
      if (Date.now() - weatherLastTick >= WEATHER_REFRESH_MS) weatherTick();
      startWeatherTimer();
    }
  });
  startWeatherTimer();

  // Живая реакция на включение/выключение энергосбережения без перезагрузки страницы
  if (typeof api.onEnergySaverChanged === 'function') api.onEnergySaverChanged(setEnergySaver);

  init().catch((err) => {
    console.error('newtab init failed', err);
    sceneEl.classList.add('ready');
  });
})();
