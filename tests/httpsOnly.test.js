'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../main/httpsOnly');

test('shouldUpgrade: публичный http апгрейдится только при включённой настройке', () => {
  assert.equal(h.shouldUpgrade('http://example.org/a', { enabled: true }), true);
  assert.equal(h.shouldUpgrade('http://example.org/a', { enabled: false }), false);
  assert.equal(h.shouldUpgrade('https://example.org/a', { enabled: true }), false);
});

test('shouldUpgrade: локальные и приватные адреса не апгрейдятся', () => {
  for (const u of ['http://localhost:3000', 'http://192.168.1.1', 'http://10.0.0.5', 'http://router.local', 'http://intranet', 'http://[::1]/']) {
    assert.equal(h.shouldUpgrade(u, { enabled: true }), false, u);
  }
  assert.equal(h.shouldUpgrade('http://8.8.8.8', { enabled: true }), true);
});

test('исключения Обычного режима и Инкогнито раздельны', () => {
  h.addException('http://exc-test.org/', true);
  assert.equal(h.hasException('http://exc-test.org/', true), true);
  assert.equal(h.hasException('http://exc-test.org/', false), false);
  h.clearIncognitoExceptions();
  assert.equal(h.hasException('http://exc-test.org/', true), false);
});

test('toHttps сохраняет путь, запрос и нестандартный порт', () => {
  assert.equal(h.toHttps('http://example.org:8080/a?b=1#c'), 'https://example.org:8080/a?b=1#c');
});

test('isFallbackError: ошибки DNS и отмены не дают небезопасный вариант', () => {
  assert.equal(h.isFallbackError(-105), false);
  assert.equal(h.isFallbackError(-3), false);
  assert.equal(h.isFallbackError(-200), true);
  assert.equal(h.isFallbackError('x'), false);
});
