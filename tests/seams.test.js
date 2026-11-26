'use strict';
// Тесты на стыки модулей: preload ↔ main, пути и CSP протокола, раскладка вкладок, изоляция Инкогнито, adblock
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'deffi-test-'));
const sent = [];
let exposed = null;
const ipcHandlers = new Map();
let protocolHandler = null;
let lastPrefs = null;

const fakeBlocker = () => ({
  config: {},
  on() {},
  serialize: () => new Uint8Array(1),
  // как в библиотеке: enable регистрирует общие ipcMain-обработчики, disable их снимает
  enableBlockingInSession() {
    ipcHandlers.set('@ghostery/adblocker/inject-cosmetic-filters', () => 'real');
    ipcHandlers.set('@ghostery/adblocker/is-mutation-observer-enabled', () => 'real');
  },
  disableBlockingInSession() { ipcHandlers.clear(); }
});

const electron = {
  app: { getPath: () => userData, isPackaged: false, on() {} },
  ipcMain: {
    handle: (c, f) => { if (ipcHandlers.has(c)) throw new Error('second handler ' + c); ipcHandlers.set(c, f); },
    removeHandler: (c) => ipcHandlers.delete(c),
    on() {}
  },
  ipcRenderer: { send: (c, p) => sent.push([c, p]), invoke: async () => null, on() {}, sendSync() {} },
  contextBridge: { exposeInMainWorld: (_n, api) => { exposed = api; } },
  protocol: { registerSchemesAsPrivileged() {} },
  net: { fetch: async () => ({ ok: true, text: async () => '||ads.example^\n'.repeat(40) }) },
  WebContentsView: class {
    constructor(o) { lastPrefs = o.webPreferences; }
    setBackgroundColor() { throw new Error('stop'); } // нужны только webPreferences
  },
  dialog: {}, shell: {}, BrowserWindow: class {}, safeStorage: {}, session: {}, Menu: {}, clipboard: {}, nativeTheme: {}
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electron;
  if (request === 'tldts') return { getDomain: (h) => (h ? h.split('.').slice(-2).join('.') : null) };
  if (request === '@ghostery/adblocker-electron') return { ElectronBlocker: { parse: fakeBlocker, deserialize: fakeBlocker } };
  return origLoad.call(this, request, ...rest);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('respondAuth отправляет числовой requestId', () => {
  global.window = { location: { protocol: 'file:' } };
  global.document = { documentElement: { dataset: {} }, addEventListener() {} };
  exposed = null;
  require('../preload/uiPreload');
  exposed.respondAuth({ requestId: 7, cancel: true });
  const [channel, payload] = sent.at(-1);
  assert.equal(channel, 'auth:respond');
  assert.equal(Number.isInteger(payload.requestId), true);
  delete global.window;
  delete global.document;
});

test('все внутренние страницы получают chromeTheme.js и разрешают его в CSP', async () => {
  require('../main/protocol').registerProtocolHandler({ protocol: { handle: (_s, f) => { protocolHandler = f; } } });
  const get = (url) => protocolHandler({ url, headers: new Map() });
  assert.equal((await get('browser://styles/chromeTheme.js')).status, 200);
  assert.equal((await get('browser://styles/tokens.css')).status, 200);
  for (const host of ['settings', 'error', 'downloads', 'bookmarks']) {
    const csp = (await get(`browser://${host}/`)).headers.get('content-security-policy');
    assert.match(csp, /script-src [^;]*browser:\/\/styles/, host);
  }
});

const TabManager = require('../main/tabManager');
const { UI_HEIGHT } = require('../main/constants');

function layoutWith({ fullscreen = false, fp = false, insets = { left: 232, top: -8 } } = {}) {
  let bounds = null;
  const view = { setVisible() {}, setBounds: (b) => { bounds = b; } };
  const tm = Object.assign(Object.create(TabManager.prototype), {
    win: { isDestroyed: () => false, getContentSize: () => [1375, 905] },
    isHtmlFullscreen: fullscreen, incognito: fp, activeId: 1, tabs: [{ id: 1, view }],
    getInsets: () => insets, getSettings: () => ({ incognitoFingerprintProtection: fp }),
    _findVisible: () => false, _getSplitTab: () => null, _getActiveAuth: () => null
  });
  tm.layout();
  return bounds;
}

test('layout: полноэкранное видео занимает всё окно', () => {
  assert.deepEqual(layoutWith({ fullscreen: true }), { x: 0, y: 0, width: 1375, height: 905 });
});
test('layout: отступы сайдбара учитываются', () => {
  assert.deepEqual(layoutWith(), { x: 232, y: UI_HEIGHT - 8, width: 1143, height: 905 - UI_HEIGHT + 8 });
});
test('layout: letterboxing остаётся кратным 100 вместе с отступами', () => {
  const b = layoutWith({ fp: true });
  assert.equal(b.width % 100, 0);
  assert.equal(b.height % 100, 0);
  assert.ok(b.x >= 232);
});

test('seed защиты от fingerprinting передаётся только в Инкогнито и един для сессии', () => {
  const ses = {};
  const prefs = (incognito) => {
    const tm = Object.assign(Object.create(TabManager.prototype), {
      session: ses, incognito, _viewBackground: () => '#000', getSettings: () => ({ incognitoFingerprintProtection: true })
    });
    assert.throws(() => tm._attachView({}), /stop/);
    return lastPrefs;
  };
  const a = prefs(true).additionalArguments;
  assert.match(a[0], /^--pt-fp-seed=[0-9a-f]{32}$/);
  assert.deepEqual(prefs(true).additionalArguments, a);
  assert.equal(prefs(false).additionalArguments, undefined);
});

test('усыпление вкладок следует настройке', () => {
  const run = (sleepMinutes, idle) => {
    const slept = [];
    Object.assign(Object.create(TabManager.prototype), {
      activeId: 1, splitTabId: null, getSettings: () => ({ sleepMinutes }), sleepTab: (id) => slept.push(id),
      tabs: [{ id: 2, url: 'https://a.example', lastActiveAt: Date.now() - idle * 60000 }]
    }).checkSleepingTabs();
    return slept.length;
  };
  assert.equal(run(0, 600), 0);
  assert.equal(run(30, 20), 0);
  assert.equal(run(30, 31), 1);
});

test('загрузки Инкогнито и обычного режима изолированы', async () => {
  const DM = require('../main/downloads');
  const entry = (id, incognito) => ({ id, incognito, name: `f${id}.txt`, url: 'https://a.example/f', state: 'cancelled', total: 0, received: 0 });
  const dm = Object.assign(Object.create(DM.prototype), {
    entries: [entry(1, false), entry(2, true)], _isLive: () => false, _notify() {}
  });
  assert.deepEqual((await dm.getPopupModel()).items.map((i) => i.id), [1]);
  assert.deepEqual((await dm.getPopupModel({ incognito: true })).items.map((i) => i.id), [2]);
  assert.equal(dm.getSummary({ incognito: true }).totalItems, 1);
  dm.clearFinished({ incognito: true });
  assert.deepEqual(dm.entries.map((e) => e.id), [1]);
});

test('каждое окно Инкогнито видит только свои загрузки', async () => {
  const DM = require('../main/downloads');
  const sesA = {};
  const sesB = {};
  const entry = (id, incognito, ses) => ({ id, incognito, ses, name: `f${id}.txt`, url: 'https://a.example/f', state: 'cancelled', total: 0, received: 0 });
  const dm = Object.assign(Object.create(DM.prototype), {
    entries: [entry(1, false, null), entry(2, true, sesA), entry(3, true, sesB)], _isLive: () => false, _notify() {}
  });
  const ids = async (scope) => (await dm.getPopupModel(scope)).items.map((i) => i.id);
  assert.deepEqual(await ids({ incognito: false }), [1]);
  assert.deepEqual(await ids({ incognito: true, ses: sesA }), [2]);
  assert.deepEqual(await ids({ incognito: true, ses: sesB }), [3]);
  assert.deepEqual((await dm.getPageModel({ incognito: true, ses: sesA })).items.map((i) => i.id), [2]);
  assert.equal(dm.getSummary({ incognito: true, ses: sesB }).totalItems, 1);
  assert.equal(dm.canAccess(2, { incognito: true, ses: sesA }), true);
  assert.equal(dm.canAccess(3, { incognito: true, ses: sesA }), false); // чужое окно Инкогнито
  assert.equal(dm.canAccess(2, { incognito: false }), false); // обычное окно не видит Инкогнито
  assert.equal(dm.canAccess(1, { incognito: true, ses: sesA }), false);
  dm.clearHistory({ incognito: true, ses: sesA });
  assert.deepEqual(dm.entries.map((e) => e.id), [1, 3]);
});

test('clearIncognito(ses) не трогает загрузки другого окна Инкогнито', () => {
  const DM = require('../main/downloads');
  const sesA = {};
  const sesB = {};
  const cancelled = [];
  const entry = (id, incognito, ses) => ({ id, incognito, ses, item: { cancel: () => cancelled.push(id) } });
  const dm = Object.assign(Object.create(DM.prototype), {
    entries: [entry(1, false, {}), entry(2, true, sesA), entry(3, true, sesB)], _notify() {}
  });
  dm.clearIncognito(sesA);
  assert.deepEqual(cancelled, [2]);
  assert.deepEqual(dm.entries.map((e) => e.id), [1, 3]);
  dm.clearIncognito(); // без сессии: все Инкогнито-записи, обычные остаются
  assert.deepEqual(dm.entries.map((e) => e.id), [1]);
});

test('подтверждение запуска нужно исполняемым файлам, но не веб-форматам', () => {
  const { needsLaunchConfirm } = require('../main/downloads');
  for (const f of ['a.exe', 'a.BAT', 'a.ps1', 'a.msi', 'a.xll', 'a.msc', 'a.diagcab', 'a.appref-ms']) {
    assert.equal(needsLaunchConfirm(`C:\\d\\${f}`), true, f);
  }
  for (const f of ['a.html', 'a.svg', 'a.mhtml', 'a.txt', 'a.png', 'a.pdf']) {
    assert.equal(needsLaunchConfirm(`C:\\d\\${f}`), false, f);
  }
});

test('adblock: косметика переживает закрытие Инкогнито и полное выключение', async () => {
  const adblock = require('../main/adblock');
  const session = () => ({ webRequest: {} });
  const normal = session();
  const inc = session();
  const handler = () => ipcHandlers.get('@ghostery/adblocker/inject-cosmetic-filters');
  await adblock.setEnabled(normal, true);
  await adblock.setEnabled(inc, true);
  await adblock.setEnabled(inc, false);
  assert.equal(handler()(), 'real');
  await adblock.setEnabled(normal, false);
  assert.deepEqual(handler()(), { styles: [], scripts: [] });
});

test('сброс медиаправ не стирает остальные права сайта', () => {
  const sec = require('../main/security');
  const ses = {};
  sec.setSitePermission(ses, 'https://a.example', 'audio', 'allow');
  sec.setSitePermission(ses, 'https://a.example', 'notifications', 'allow');
  sec.setSitePermission(ses, 'https://b.example', 'notifications', 'allow');
  assert.deepEqual(sec.listMediaPermissions().map((e) => e.origin), ['https://a.example']);
  assert.equal(sec.removeMediaPermission('https://a.example'), true);
  const info = sec.getSitePermissionInfo(ses, 'https://a.example');
  assert.equal(info.items.find((i) => i.kind === 'notifications').value, 'allow');
});

test('cleanUserAgent убирает токен приложения под любым именем', () => {
  const sec = require('../main/security');
  const app = { userAgentFallback: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) DEFFIBrowser/1.0.0 Chrome/140.0.0.0 Electron/45.0.0 Safari/537.36' };
  sec.cleanUserAgent(app);
  assert.equal(app.userAgentFallback, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
});

test('флаг и домены Google Auth совпадают в security.js и tabPreload.js', () => {
  const pick = (f, re) => read(f).match(re)[1];
  for (const re of [/const GOOGLE_FIREFOX_UA = (\w+);/, /const GOOGLE_AUTH_HOST_RE = (.+);/]) {
    assert.equal(pick('preload/tabPreload.js', re), pick('main/security.js', re));
  }
});

test('asarUnpack покрывает все runtime-зависимости воркера adblock', () => {
  const lock = JSON.parse(read('package-lock.json')).packages;
  const globs = JSON.parse(read('package.json')).build.asarUnpack
    .map((g) => new RegExp('^' + g.replace(/\/\*\*$/, '(/.*)?').replace(/(?<!\.)\*/g, '[^/]*') + '$'));
  const seen = new Set();
  const walk = (name) => {
    const key = `node_modules/${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    assert.ok(lock[key], key);
    Object.keys(lock[key].dependencies || {}).forEach(walk);
  };
  walk('@ghostery/adblocker-electron');
  assert.deepEqual([...seen].filter((k) => !globs.some((g) => g.test(k))), []);
});

test.after(() => { setImmediate(() => process.exit()); }); // таймеры модулей не должны держать процесс

test('layout: при открытой карточке интерфейса страницы остаются скрытыми', () => {
  const calls = [];
  const view = { setVisible: (v) => calls.push(v), setBounds() {}, setBorderRadius() {} };
  const tm = Object.create(TabManager.prototype);
  Object.assign(tm, {
    win: { isDestroyed: () => false, getContentSize: () => [1000, 800] },
    tabs: [{ id: 1, view }], activeId: 1, isHtmlFullscreen: false, splitTabId: null,
    getInsets: () => ({ left: 0, top: 0 }), isOverlayOpen: () => true,
    _findVisible: () => false, _getSplitTab: () => null, _getActiveAuth: () => null,
    _isFingerprintProtectionActive: () => false
  });
  tm.layout();
  assert.deepEqual(calls, [false]);
  tm.isOverlayOpen = () => false;
  tm.layout();
  assert.deepEqual(calls, [false, true]);
});

test('sendState склеивает пачку вызовов в один кадр, _sendStateNow шлёт сразу', async () => {
  const WindowManager = require('../main/windowManager');
  const wm = Object.create(WindowManager.prototype);
  let sent = 0;
  wm._sendStateNow = () => { sent++; };
  for (let i = 0; i < 50; i++) wm.sendState();
  assert.equal(sent, 0);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent, 1);
  wm.sendState();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(sent, 2); // после отправки батчинг снова срабатывает
});
