const { BrowserWindow, session } = require('electron');
const WindowManager = require('./windowManager');
const DownloadManager = require('./downloads');
const storage = require('./storage');

// Реестр независимых окон: windowId (BrowserWindow.id) -> WindowManager (у каждого свой TabManager)
class WindowRegistry {
  constructor() {
    this.windows = new Map();
    this.primaryId = null;         // единственное окно, которое пишет session.json (только обычное, не Инкогнито)
    this.quitting = false;
    this.downloads = null;         // один DownloadManager на всё приложение
    this._incRefs = new WeakMap(); // Инкогнито-сессия -> сколько окон её держит
    this.legacyHost = this._buildLegacyHost();
  }

  get primary() { return this.windows.get(this.primaryId) || null; }
  all() { return [...this.windows.values()]; }

  getFallback() {
    const focused = BrowserWindow.getFocusedWindow();
    return (focused && this.windows.get(focused.id)) || this.primary || this.all()[0] || null;
  }

  register(wm) {
    this.windows.set(wm.id, wm);
    if (this.primaryId === null && !wm.dedicatedIncognito) this.primaryId = wm.id;
  }

  unregister(wm) {
    this.windows.delete(wm.id);
    if (this.primaryId !== wm.id) return;
    this.primaryId = null;
    const next = this.all().find((w) => !w.dedicatedIncognito);
    if (next) {
      this.primaryId = next.id;
      if (!this.quitting) next.scheduleSessionSave(); // сессию дальше ведёт следующее обычное окно
    }
  }

  hasOtherNormalWindows(wm) {
    return this.all().some((w) => w !== wm && !w.dedicatedIncognito);
  }

  // Окно, которому принадлежит webContents-отправитель IPC
  fromSender(sender) {
    if (!sender || sender.isDestroyed()) return null;
    try {
      const bw = BrowserWindow.fromWebContents(sender);
      const wm = bw && this.windows.get(bw.id);
      if (wm) return wm;
    } catch { /* ниже запасной поиск */ }
    // WebContentsView вкладок и попапы могут не резолвиться через fromWebContents
    return this.all().find((w) => w.ownsSender(sender)) || null;
  }

  isUiWebContents(c) {
    return this.all().some((w) => w.win && !w.win.isDestroyed() && w.win.webContents === c);
  }

  // ---- Создание окон ----
  createWindow(opts = {}) {
    const wm = new WindowManager({ registry: this });
    wm.createMainWindow(opts);
    return wm;
  }

  openNormalWindow(fromWm) {
    return this.createWindow({ secondary: true, bounds: this._cascade(fromWm) });
  }

  async openIncognitoWindow(fromWm) {
    const wm = new WindowManager({ registry: this, dedicatedIncognito: true });
    const ses = await wm._openIncognitoSession();
    wm.createMainWindow({ secondary: true, incognitoSession: ses, bounds: this._cascade(fromWm) });
    return wm;
  }

  // Перенос вкладки: живой WebContentsView переезжает в новое окно без перезагрузки
  moveTabToNewWindow(srcWm, tabId, point) {
    const tm = srcWm.tabManager;
    if (!tm || !srcWm.win || srcWm.win.isDestroyed() || !tm.getTab(tabId)) return null;
    const wasLast = tm.tabs.length === 1;
    const ses = srcWm.isIncognito ? srcWm._incognitoSession : null;
    const payload = tm.detachTabForTransfer(tabId);
    if (!payload) return null;

    const src = srcWm.win.getNormalBounds();
    const bounds = point
      ? { x: point.x - 120, y: point.y - 18, width: src.width, height: src.height }
      : this._cascade(srcWm);

    let wm = null;
    let retained = false;
    try {
      wm = new WindowManager({ registry: this, dedicatedIncognito: Boolean(ses) });
      if (ses) { this.retainIncognito(ses); retained = true; } // вкладка Инкогнито остаётся в той же временной сессии
      wm.createMainWindow({ secondary: true, bounds, incognitoSession: ses, adoptPayload: payload });
    } catch (err) {
      console.error('[window] Не удалось перенести вкладку в новое окно:', err && err.message);
      // Вкладка уже переехала в новое окно (adoptTab отработал) — оставляем её там
      if (wm && wm._adopted && wm.win && !wm.win.isDestroyed()) return wm;
      if (retained) this.releaseIncognito(ses);
      if (wm) {
        try { this.unregister(wm); } catch { /* ignore */ }
        try { if (wm.win && !wm.win.isDestroyed()) wm.win.destroy(); } catch { /* ignore */ }
      }
      // Возвращаем вкладку в исходное окно
      try { if (!srcWm.win.isDestroyed()) srcWm.tabManager.adoptTab(payload); } catch { /* ignore */ }
      return null;
    }

    if (wasLast && !srcWm.win.isDestroyed()) {
      // Старое окно опустело. Если это режим Инкогнито внутри обычного окна — выходим из режима, а не закрываем окно
      if (srcWm.isIncognito && !srcWm.dedicatedIncognito) srcWm.toggleIncognito();
      else srcWm.win.close();
    }
    return wm;
  }

  _cascade(fromWm) {
    const w = fromWm && fromWm.win && !fromWm.win.isDestroyed() ? fromWm.win : null;
    if (!w) return null;
    const b = w.getNormalBounds();
    return { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height };
  }

  // ---- Общие ресурсы ----
  ensureDownloads() {
    if (this.downloads) return this.downloads;
    this.downloads = new DownloadManager({
      getWindow: () => { const wm = this.getFallback(); return wm ? wm.win : null; },
      onChange: () => { for (const wm of this.all()) wm._onDownloadsChanged(); }
    });
    this.downloads.attach(session.defaultSession);
    return this.downloads;
  }

  incognitoSessions() {
    return [...new Set(this.all().map((w) => w._incognitoSession).filter(Boolean))];
  }

  retainIncognito(ses) { this._incRefs.set(ses, (this._incRefs.get(ses) || 0) + 1); }
  releaseIncognito(ses) {
    const n = Math.max(0, (this._incRefs.get(ses) || 1) - 1);
    this._incRefs.set(ses, n);
    return n; // 0 — последнее окно закрылось, сессию можно чистить
  }

  // Настройки общие: окно, сохранившее их, раздаёт новый объект остальным
  syncSettings(source) {
    for (const wm of this.all()) {
      if (wm === source) continue;
      wm.settings = source.settings;
      wm._onSharedSettingsChanged();
    }
  }

  // Список/имена/цвета пространств общие: все окна перерисовывают переключатель, сессию пишет основное
  workspacesChanged() {
    for (const wm of this.all()) wm.sendState();
    this.primary?.scheduleSessionSave();
  }

  // Сессию пишет только основное обычное окно
  flushSessionSync() {
    const p = this.primary;
    if (p) p.flushSessionSync();
    else { storage.flushHistorySync(); storage.flushStudioSync(); }
  }

  // Заглушка «одного окна» для модулей, которые ещё принимают windowManager (createEnergySaver)
  _buildLegacyHost() {
    const reg = this;
    return {
      get win() { const w = reg.getFallback(); return w ? w.win : null; },
      get tabManager() { const w = reg.getFallback(); return w ? w.tabManager : null; },
      getSettings: () => { const w = reg.getFallback(); return w ? w.getSettings() : storage.loadSettings(); },
      forEachWindow: (fn) => reg.all().forEach(fn)
    };
  }
}

module.exports = WindowRegistry;
