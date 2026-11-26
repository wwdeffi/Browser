const { contextBridge, ipcRenderer } = require('electron');

// Preload попапа «Загрузки». Документ грузится из data: URL, поэтому мост создаётся только для него.
// Наружу — минимальный набор: действие (тип + числовой id), закрытие, высота панели и подписки на состояние.
// Валидацию типов и самих id выполняет main (DownloadsPopup.handleAction).
if (window.location.protocol === 'data:') {
  contextBridge.exposeInMainWorld('dlPopup', {
    action: (type, id) => ipcRenderer.send('dlpopup:action', String(type), id === undefined || id === null ? null : Number(id)),
    close: () => ipcRenderer.send('dlpopup:close'),
    resize: (height) => ipcRenderer.send('dlpopup:resize', Number(height)),
    onState: (cb) => ipcRenderer.on('dlpopup:state', (_e, state) => cb(state)),
    onReset: (cb) => ipcRenderer.on('dlpopup:reset', () => cb())
  });
}
