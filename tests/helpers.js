'use strict';
// Заглушки для electron и tldts: тесты проверяют чистую логику и работают без установки зависимостей
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { getPath: () => require('os').tmpdir(), isPackaged: false }, dialog: {}, shell: {}, BrowserWindow: class {}, safeStorage: {}, session: {}, net: {} };
  }
  if (request === 'tldts') {
    return { getDomain: (h) => (h ? h.split('.').slice(-2).join('.') : null) };
  }
  return origLoad.call(this, request, parent, isMain);
};
