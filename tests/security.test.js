'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const sec = require('../main/security');
const pm = require('../main/passwordManager');

test('isGoogleAuthUrl: только https и домены авторизации', () => {
  assert.equal(sec.isGoogleAuthUrl('https://accounts.google.com/signin'), true);
  assert.equal(sec.isGoogleAuthUrl('https://accounts.google.de/x'), true);
  assert.equal(sec.isGoogleAuthUrl('http://accounts.google.com/'), false);
  assert.equal(sec.isGoogleAuthUrl('https://accounts.google.com.evil.io/'), false);
  assert.equal(sec.isGoogleAuthUrl('мусор'), false);
});

test('isLocalDevHostname', () => {
  assert.equal(sec.isLocalDevHostname('localhost'), true);
  assert.equal(sec.isLocalDevHostname('app.localhost'), true);
  assert.equal(sec.isLocalDevHostname('localhost.'), true);
  assert.equal(sec.isLocalDevHostname('example.com'), false);
  assert.equal(sec.isLocalDevHostname(''), false);
});

test('stripTrackingParams убирает utm_*, не трогая остальное', () => {
  assert.equal(sec.stripTrackingParams('https://example.org/p?id=5&utm_source=x'), 'https://example.org/p?id=5');
  assert.equal(sec.stripTrackingParams('https://example.org/p?id=5'), 'https://example.org/p?id=5');
  assert.equal(sec.stripTrackingParams('не url'), 'не url');
  assert.equal(sec.stripTrackingParams('javascript:alert(1)'), 'javascript:alert(1)');
});

test('cleanUserAgent убирает Electron и имя приложения', () => {
  const app = { userAgentFallback: 'Mozilla/5.0 Chrome/140 deffi-browser/1.0.0 Electron/45.0.0 Safari/537.36' };
  sec.cleanUserAgent(app);
  assert.ok(!/Electron|deffi-browser/.test(app.userAgentFallback));
});

test('passwordManager.normalizeOrigin: только https и локальный http', () => {
  assert.deepEqual(pm.normalizeOrigin('https://example.org/login'), { origin: 'https://example.org', host: 'example.org' });
  assert.ok(pm.normalizeOrigin('http://localhost:3000/x'));
  assert.equal(pm.normalizeOrigin('http://example.org'), null);
  assert.equal(pm.normalizeOrigin('https://user:pw@example.org'), null);
  assert.equal(pm.normalizeOrigin('ftp://example.org'), null);
  assert.equal(pm.normalizeOrigin(''), null);
});
