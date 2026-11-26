'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const { matches, compilePattern } = require('../main/webRequestHub');

test('matches: пустой фильтр и <all_urls> пропускают всё', () => {
  assert.ok(matches(null, 'https://a.com/'));
  assert.ok(matches({ urls: [] }, 'https://a.com/'));
  assert.ok(matches({ urls: ['<all_urls>'] }, 'wss://a.com/x'));
});

test('matches: учитывает хост и путь', () => {
  const f = { urls: ['*://*.google.com/*'] };
  assert.ok(matches(f, 'https://mail.google.com/a'));
  assert.ok(matches(f, 'https://google.com/'));
  assert.ok(!matches(f, 'https://evilgoogle.com/a'));
  assert.ok(!matches({ urls: ['https://a.com/api/*'] }, 'https://a.com/other'));
  assert.ok(matches({ urls: ['https://a.com/api/*'] }, 'https://a.com:8080/api/x'));
});

test('matches: некорректный шаблон ничего не совпадает; компиляция кэшируется', () => {
  assert.ok(!matches({ urls: ['bad'] }, 'https://a.com/'));
  assert.strictEqual(compilePattern('https://a.com/*'), compilePattern('https://a.com/*'));
});
