'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseIconLinks, sniffImage } = require('../main/siteIcons');

test('parseIconLinks: apple-touch-icon и крупные иконки идут первыми, пути делаются абсолютными', () => {
  const html = `<head>
    <link rel="icon" href="/favicon-16.png" sizes="16x16">
    <link rel="shortcut icon" href="/favicon.ico">
    <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
    <link rel="icon" href="/big.png" sizes="192x192"></head>`;
  const r = parseIconLinks(html, 'https://example.org/page');
  assert.equal(r[0], 'https://example.org/apple.png');
  assert.ok(r.includes('https://example.org/big.png'));
  assert.ok(r.every((u) => u.startsWith('https://example.org/')));
});

test('parseIconLinks: пропускает data:, javascript: и mask-icon; svg — только последним', () => {
  const html = `<link rel="icon" href="data:image/png;base64,AAAA">
    <link rel="icon" href="javascript:alert(1)">
    <link rel="mask-icon" href="/m.svg">
    <link rel="icon" href="/logo.svg">
    <link rel="icon" href="/a.png" sizes="32x32">`;
  assert.deepEqual(parseIconLinks(html, 'https://example.org/'), ['https://example.org/a.png', 'https://example.org/logo.svg']);
});

test('parseIconLinks: не падает на мусоре', () => {
  assert.deepEqual(parseIconLinks(null, 'https://example.org/'), []);
  assert.deepEqual(parseIconLinks('<link rel="icon">', 'https://example.org/'), []);
});

test('sniffImage определяет тип по сигнатуре, а не по заголовку', () => {
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])), 'image/png');
  assert.equal(sniffImage(Buffer.from([0, 0, 1, 0, 1, 0, 16, 16])), 'image/x-icon');
  assert.equal(sniffImage(Buffer.from('<html><body>hello</body></html>')), null);
  assert.equal(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
});
