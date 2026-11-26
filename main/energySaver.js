const { app, powerMonitor, webContents } = require('electron');
const { APP_SCHEME } = require('./constants');

// Режим экономии энергии: эффективный флаг energySaverActive = on | (auto && работа от батареи).
// Рассылается в окно интерфейса (IPC 'energy-saver:state') и во вкладки внутренних страниц browser://
// (атрибут data-energy-saver на <html>, событие 'energy-saver-change' и CSS без backdrop-filter).

const PAGE_CSS = '*,*::before,*::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}';

function createEnergySaver(windowManager) {
  let active = false;
  const cssKeys = new WeakMap(); // webContents -> ключ вставленного CSS
  const chains = new WeakMap(); // webContents -> очередь синхронизации (insertCSS/removeInsertedCSS асинхронны)

  function isOnBattery() {
    try {
      return powerMonitor.isOnBatteryPower();
    } catch {
      return false;
    }
  }

  function compute() {
    const settings = windowManager.getSettings() || {};
    if (settings.energySaver === 'on') return true;
    if (settings.energySaver === 'off') return false;
    return isOnBattery();
  }

  function isInternalPage(wc) {
    try {
      return !wc.isDestroyed() && wc.getURL().startsWith(`${APP_SCHEME}:`);
    } catch {
      return false;
    }
  }

  async function doSync(wc) {
    if (wc.isDestroyed() || !isInternalPage(wc)) return;
    const want = active;
    const prev = cssKeys.get(wc);
    if (want && !prev) {
      const key = await wc.insertCSS(PAGE_CSS);
      if (wc.isDestroyed()) return;
      cssKeys.set(wc, key);
    } else if (!want && prev) {
      cssKeys.delete(wc);
      await wc.removeInsertedCSS(prev);
    }
    if (wc.isDestroyed()) return;
    await wc.executeJavaScript(
      `(() => {
        const root = document.documentElement;
        if (!root) return;
        if (${want}) root.dataset.energySaver = 'true'; else delete root.dataset.energySaver;
        window.dispatchEvent(new CustomEvent('energy-saver-change', { detail: { active: ${want} } }));
      })()`
    );
    if (wc.isDestroyed()) return;
    wc.send('internal:energy-saver:changed', want); // для onEnergySaverChanged в preload/tabPreload.js (browser://newtab)
  }

  function syncPage(wc) {
    const prev = chains.get(wc) || Promise.resolve();
    chains.set(wc, prev.then(() => doSync(wc)).catch(() => { /* страница закрылась или навигация — не критично */ }));
  }

  function sendToUi() {
    const send = (wm) => {
      const win = wm && wm.win;
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('energy-saver:state', active);
      }
    };
    if (typeof windowManager.forEachWindow === 'function') windowManager.forEachWindow(send);
    else send(windowManager);
  }

  function broadcast() {
    sendToUi();
    for (const wc of webContents.getAllWebContents()) syncPage(wc);
  }

  // Пересчитать флаг; рассылает только при изменении (force — принудительно)
  function refresh(force = false) {
    const next = compute();
    if (next === active && !force) return active;
    active = next;
    broadcast();
    return active;
  }

  active = compute();

  powerMonitor.on('on-battery', () => refresh());
  powerMonitor.on('on-ac', () => refresh());
  powerMonitor.on('resume', () => refresh());

  // Новые страницы browser://: после загрузки документа CSS и атрибут нужно выставить заново
  app.on('web-contents-created', (_event, wc) => {
    wc.on('did-start-navigation', (details) => {
      if (details && details.isMainFrame && !details.isSameDocument) cssKeys.delete(wc);
    });
    wc.on('dom-ready', () => {
      if (active || cssKeys.has(wc)) syncPage(wc);
    });
  });

  return {
    isActive: () => active,
    refresh
  };
}

module.exports = { createEnergySaver };
