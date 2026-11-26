const { contextBridge, ipcRenderer } = require('electron');

// В попап подсказок отдаём только то, что ему нужно: выбор строки и подписки на данные от main
contextBridge.exposeInMainWorld('omnibox', {
  pick: (index) => ipcRenderer.send('omnibox:pick', index),
  hover: (index) => ipcRenderer.send('omnibox:hover', index),
  onItems: (cb) => ipcRenderer.on('omnibox:items', (_e, p) => cb(p)),
  onSelect: (cb) => ipcRenderer.on('omnibox:select', (_e, i) => cb(i)),
  onTheme: (cb) => ipcRenderer.on('omnibox:theme', (_e, t) => cb(t))
});
