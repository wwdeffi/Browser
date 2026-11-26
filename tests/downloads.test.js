'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'deffi-dl-'));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => userData, on() {}, isPackaged: false }, dialog: {}, shell: {}, session: {}, BrowserWindow: class {} };
  }
  if (request === 'tldts') return { getDomain: (h) => h };
  return origLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert');
const DownloadManager = require('../main/downloads');
const { needsLaunchConfirm } = DownloadManager;

test('needsLaunchConfirm: исполняемые типы требуют подтверждения', () => {
  for (const f of ['setup.exe', 'a.BAT', 'x.ps1', 'lib.dll', 'm.docm', 'C:\\dl\\run.msi']) {
    assert.strictEqual(needsLaunchConfirm(f), true, f);
  }
});

test('needsLaunchConfirm: обычные файлы и веб-форматы без подтверждения', () => {
  for (const f of ['photo.png', 'doc.pdf', 'notes.txt', 'page.html', 'pic.svg', 'a.mhtml', '', null, undefined]) {
    assert.strictEqual(needsLaunchConfirm(f), false, String(f));
  }
});

test('needsLaunchConfirm: регистр и двойное расширение', () => {
  assert.strictEqual(needsLaunchConfirm('INVOICE.PDF.EXE'), true);
  assert.strictEqual(needsLaunchConfirm('run.exe.txt'), false); // решает последнее расширение
});

function makeManager() {
  let changes = 0;
  const dm = new DownloadManager({ getWindow: () => null, onChange: () => { changes++; } });
  dm.entries = [];
  dm._schedulePersist = () => {}; // файловая система в этом тесте не нужна
  return { dm, changes: () => changes };
}

test('clearIncognito(ses): закрытие одной Инкогнито-сессии не трогает загрузку другой', () => {
  const { dm } = makeManager();
  const sesA = { name: 'A' };
  const sesB = { name: 'B' };
  let canceledA = 0;
  let canceledB = 0;
  dm.entries = [
    { id: 1, incognito: true, ses: sesA, state: 'progressing', item: { cancel: () => { canceledA++; } } },
    { id: 2, incognito: true, ses: sesB, state: 'progressing', item: { cancel: () => { canceledB++; } } },
    { id: 3, incognito: false, ses: null, state: 'completed', item: null }
  ];
  dm.clearIncognito(sesA);
  assert.strictEqual(canceledA, 1);
  assert.strictEqual(canceledB, 0, 'загрузка второго окна должна остаться жива');
  assert.deepStrictEqual(dm.entries.map((e) => e.id), [2, 3]);
});

test('clearIncognito() без сессии убирает все Инкогнито-записи, обычные остаются', () => {
  const { dm } = makeManager();
  let canceled = 0;
  dm.entries = [
    { id: 1, incognito: true, ses: {}, state: 'progressing', item: { cancel: () => { canceled++; } } },
    { id: 2, incognito: true, ses: {}, state: 'completed', item: null },
    { id: 3, incognito: false, ses: null, state: 'progressing', item: { cancel: () => { canceled++; } } }
  ];
  dm.clearIncognito();
  assert.strictEqual(canceled, 1, 'обычную загрузку отменять нельзя');
  assert.deepStrictEqual(dm.entries.map((e) => e.id), [3]);
});

test('clearIncognito: исключение при cancel() не ломает очистку', () => {
  const { dm, changes } = makeManager();
  dm.entries = [{ id: 1, incognito: true, ses: {}, state: 'progressing', item: { cancel() { throw new Error('уже завершена'); } } }];
  assert.doesNotThrow(() => dm.clearIncognito());
  assert.strictEqual(dm.entries.length, 0);
  assert.ok(changes() >= 1, 'интерфейс должен получить уведомление');
});
