const { contextBridge, ipcRenderer } = require('electron');

// Строго ограниченный мост для попапа главного меню: только своя страница mainmenu.html по file:
if (window.location.protocol === 'file:') contextBridge.exposeInMainWorld('mainMenu', {
  activate: (key) => ipcRenderer.send('mainmenu:activate', String(key)),
  close: () => ipcRenderer.send('mainmenu:close'),
  resize: (height) => ipcRenderer.send('mainmenu:resize', Number(height)),
  onOpen: (cb) => ipcRenderer.on('mainmenu:open', (_e, payload) => cb(payload)),
  onModel: (cb) => ipcRenderer.on('mainmenu:model', (_e, payload) => cb(payload)),
  onReset: (cb) => ipcRenderer.on('mainmenu:reset', () => cb()),
  onMaxHeight: (cb) => ipcRenderer.on('mainmenu:max-height', (_e, h) => cb(Number(h)))
});
