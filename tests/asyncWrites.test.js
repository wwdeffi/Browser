'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const storage = require('../main/storage');

const read = (name) => JSON.parse(fs.readFileSync(path.join(require('os').tmpdir(), 'browser-data', name), 'utf8'));

test('асинхронная запись доходит до диска, последняя версия побеждает', async () => {
  const a = storage.saveDownloadsAsync({ version: 1, items: [1] });
  const b = storage.saveDownloadsAsync({ version: 1, items: [1, 2] });
  await Promise.all([a, b]);
  assert.deepEqual(read('downloads.json').items, [1, 2]);
});

test('синхронная запись не затирается более старой асинхронной', async () => {
  const p = storage.saveDownloadsAsync({ version: 1, items: ['old'] });
  storage.saveDownloads({ version: 1, items: ['new'] });
  await p;
  assert.deepEqual(read('downloads.json').items, ['new']);
});

test('flushPendingWritesSync дописывает то, что не успело уйти на диск', async () => {
  storage.saveDownloads({ version: 1, items: ['base'] });
  const p = storage.saveDownloadsAsync({ version: 1, items: ['pending'] });
  storage.flushPendingWritesSync(); // «выход из приложения» до завершения асинхронной записи
  assert.deepEqual(read('downloads.json').items, ['pending']);
  await p;
  assert.deepEqual(read('downloads.json').items, ['pending']);
});
