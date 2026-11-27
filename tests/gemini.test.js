'use strict';
// Боковая панель Gemini: какие адреса остаются в панели, ширина и место, которое она отнимает у страниц
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GeminiPanel, GEMINI_GAP, GEMINI_MIN_WIDTH, GEMINI_MAX_WIDTH, GEMINI_DEFAULT_WIDTH, isPanelUrl, clampWidth
} = require('../main/geminiPanel');
const TabManager = require('../main/tabManager');
const { UI_HEIGHT } = require('../main/constants');

test('isPanelUrl: в панели остаются только Gemini и вход в Google', () => {
  assert.ok(isPanelUrl('https://gemini.google.com/app'));
  assert.ok(isPanelUrl('https://accounts.google.com/v3/signin/identifier'));
  assert.ok(isPanelUrl('https://accounts.google.co.uk/ServiceLogin'));
  assert.ok(isPanelUrl('https://accounts.youtube.com/accounts/SetSID'));
  assert.ok(!isPanelUrl('http://gemini.google.com/app'), 'только https');
  assert.ok(!isPanelUrl('https://example.com/'));
  assert.ok(!isPanelUrl('https://gemini.google.com.evil.io/'));
  assert.ok(!isPanelUrl('https://notgoogle.com/'));
  assert.ok(!isPanelUrl('javascript:alert(1)'));
  assert.ok(!isPanelUrl('not a url'));
});

test('clampWidth: ширина в допустимых пределах', () => {
  assert.equal(clampWidth(10), GEMINI_MIN_WIDTH);
  assert.equal(clampWidth(99999), GEMINI_MAX_WIDTH);
  assert.equal(clampWidth('abc'), GEMINI_DEFAULT_WIDTH);
  assert.equal(clampWidth(500.4), 500);
});

test('GeminiPanel: закрытая панель места не занимает, открытая — ширина + зазор', () => {
  const p = new GeminiPanel({ win: null, getSession: () => null, width: 450 });
  assert.equal(p.reservedWidth(1400), 0);
  p.open = true; // без окна view не создаём — проверяем только геометрию
  assert.equal(p.reservedWidth(1400), 450 + GEMINI_GAP);
  // Узкое окно: странице остаётся не меньше 360px, но панель не уже минимума
  assert.equal(p.effectiveWidth(700), 700 - 360 - GEMINI_GAP);
  assert.equal(p.effectiveWidth(500), GEMINI_MIN_WIDTH);
});

test('layout: панель Gemini сужает страницу и получает область справа', () => {
  let bounds = null;
  let panel;
  const view = { setVisible() {}, setBounds: (b) => { bounds = b; } };
  const tm = Object.assign(Object.create(TabManager.prototype), {
    win: { isDestroyed: () => false, getContentSize: () => [1400, 900] },
    isHtmlFullscreen: false, incognito: false, activeId: 1, tabs: [{ id: 1, view }],
    getInsets: () => ({ left: 0, top: 0 }), getSettings: () => ({}),
    getRightInset: () => 426, onLayout: ({ panelRect }) => { panel = panelRect; },
    _findVisible: () => false, _getSplitTab: () => null, _getActiveAuth: () => null
  });
  tm.layout();
  assert.deepEqual(bounds, { x: 0, y: UI_HEIGHT, width: 974, height: 900 - UI_HEIGHT });
  assert.deepEqual(panel, { x: 974, y: UI_HEIGHT, width: 426, height: 900 - UI_HEIGHT });

  // HTML-fullscreen: страница на всё окно, панель спрятана
  tm.isHtmlFullscreen = true;
  tm.layout();
  assert.deepEqual(bounds, { x: 0, y: 0, width: 1400, height: 900 });
  assert.equal(panel, null);
});
