'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// Эти селекторы Google живут в двух местах: main/searchSelectors.js и preload/tabPreload.js
// (preload в песочнице не может подключить модуль). При правке одного из файлов тест напомнит о втором.
test('селекторы searchSelectors.js совпадают с tabPreload.js', () => {
  const selectors = read('main/searchSelectors.js');
  const preload = read('preload/tabPreload.js');
  for (const s of ['.EsfOKc', '[data-xid^="aim-aside"]']) {
    assert.ok(selectors.includes(s), `нет в searchSelectors.js: ${s}`);
    assert.ok(preload.includes(s), `нет в tabPreload.js: ${s}`);
  }
});

test('GOOGLE_AUTH_HOST_RE в tabPreload.js совпадает с security.js', () => {
  const re = /GOOGLE_AUTH_HOST_RE = (\/.+\/);/;
  const a = re.exec(read('main/security.js'));
  const b = re.exec(read('preload/tabPreload.js'));
  assert.ok(a && b, 'не найдено определение GOOGLE_AUTH_HOST_RE');
  assert.strictEqual(a[1], b[1]);
});
