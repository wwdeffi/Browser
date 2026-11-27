'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n'); // на Windows git отдаёт CRLF

// Достаём ptFirefoxMainWorld из preload и выполняем в «странице» с минимальными заглушками DOM
function runFirefoxMask() {
  const src = read('preload/tabPreload.js');
  const start = src.indexOf('function ptFirefoxMainWorld(ua)');
  const end = src.indexOf('(function initGoogleAuthFirefoxMask()');
  assert.ok(start > 0 && end > start, 'ptFirefoxMainWorld не найден в tabPreload.js');
  const body = src.slice(start, end);
  const ctx = vm.createContext({ DOMException: class extends Error {} });
  vm.runInContext(`
    class Navigator { get userAgent() { return 'Chrome'; } get vendor() { return 'Google Inc.'; } }
    globalThis.Navigator = Navigator;
    globalThis.navigator = new Navigator();
    globalThis.window = globalThis;
    globalThis.chrome = {};
    globalThis.CredentialsContainer = class { get() { return 'orig'; } };
    globalThis.PublicKeyCredential = { isUserVerifyingPlatformAuthenticatorAvailable() { return 1; } };
  `, ctx);
  vm.runInContext(`${body}\nptFirefoxMainWorld('Mozilla/5.0 Firefox/135.0');`, ctx);
  return ctx;
}

test('ptFirefoxMainWorld: геттеры и заглушки выглядят как нативный код', () => {
  const ctx = runFirefoxMask();
  const out = vm.runInContext(`({
    ua: navigator.userAgent,
    getter: Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent').get.toString(),
    vendor: Object.getOwnPropertyDescriptor(Navigator.prototype, 'vendor').get.toString(),
    toStr: Function.prototype.toString.toString(),
    cred: CredentialsContainer.prototype.get.toString(),
    pk: PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable.toString(),
    chrome: typeof window.chrome
  })`, ctx);
  assert.equal(out.ua, 'Mozilla/5.0 Firefox/135.0');
  assert.equal(out.getter, 'function get userAgent() { [native code] }');
  assert.equal(out.vendor, 'function get vendor() { [native code] }');
  assert.equal(out.toStr, 'function toString() { [native code] }');
  assert.equal(out.cred, 'function get() { [native code] }');
  assert.equal(out.pk, 'function isUserVerifyingPlatformAuthenticatorAvailable() { [native code] }');
  assert.equal(out.chrome, 'undefined');
});

test('OAuth-попапы всегда получают tabPreload, а will-redirect не отменяет редирект ради смены UA', () => {
  const tm = read('main/tabManager.js');
  const popup = tm.slice(tm.indexOf('const options = {\n          autoHideMenuBar'), tm.indexOf("return { action: 'allow', overrideBrowserWindowOptions"));
  assert.ok(/preload:\s*TAB_PRELOAD_PATH/.test(popup), 'в попап не передан preload');
  assert.ok(!/if \(this\._isFingerprintProtectionActive\(\)\) \{\s*options\.webPreferences\.preload/.test(popup), 'preload снова зависит от защиты отпечатка');
  const redirect = tm.slice(tm.indexOf("wc.on('will-redirect'"), tm.indexOf("wc.on('dom-ready'"));
  assert.ok(!redirect.includes('this._switchGoogleAuthUa('), 'will-redirect снова прерывает редирект');
  const navigate = tm.slice(tm.indexOf("wc.on('will-navigate'"), tm.indexOf("wc.on('will-redirect'"));
  assert.ok(navigate.includes('this._switchGoogleAuthUa('), 'will-navigate потерял смену UA');
});

test('addGoogleChromeBrand: добавляет бренд «Google Chrome» после Chromium и не дублирует', () => {
  require('./helpers');
  const { addGoogleChromeBrand } = require('../main/security');
  assert.equal(
    addGoogleChromeBrand('"Not.A/Brand";v="8", "Chromium";v="142"'),
    '"Not.A/Brand";v="8", "Chromium";v="142", "Google Chrome";v="142"'
  );
  assert.equal(
    addGoogleChromeBrand('"Chromium";v="142.0.7444.59", "Not.A/Brand";v="8.0.0.0"'),
    '"Chromium";v="142.0.7444.59", "Google Chrome";v="142.0.7444.59", "Not.A/Brand";v="8.0.0.0"'
  );
  const already = '"Chromium";v="142", "Google Chrome";v="142"';
  assert.equal(addGoogleChromeBrand(already), already);
});
