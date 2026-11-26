'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const { matches } = require('../main/webRequestHub');

test('matches учитывает хост и путь', () => {
  const f = { urls: ['https://example.com/*'] };
  assert.ok(matches(f, 'https://example.com/a?b=1'));
  assert.ok(!matches(f, 'https://evil.com/'));
  assert.ok(!matches(f, 'http://example.com/'));
  assert.ok(matches({ urls: ['*://*.example.com/*'] }, 'https://a.example.com/x'));
  assert.ok(matches({ urls: ['<all_urls>'] }, 'https://any.site/'));
});

test('matches: поддомен-подделка и чужой путь не проходят', () => {
  assert.ok(!matches({ urls: ['*://*.example.com/*'] }, 'https://example.com.evil.net/x'));
  assert.ok(!matches({ urls: ['https://example.com/api/*'] }, 'https://example.com/other'));
});
