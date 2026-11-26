const { app, session } = require('electron');
const { cleanUserAgent, configureSession, applyChromiumPrivacySwitches } = require('./security');
const { registerSchemePrivileges, registerProtocolHandler } = require('./protocol');
const WindowRegistry = require('./windowRegistry');
const adblock = require('./adblock');
const { registerIpcHandlers } = require('./ipcHandlers');
const { createEnergySaver } = require('./energySaver');
const storage = require('./storage');
const { applyDoh } = require('./doh');
const extensions = require('./extensions');

// Объявляем до подписки на неперехваченные ошибки: обработчик обращается к менеджеру окон (иначе TDZ до его создания)
let registry = null;

// Обход известного бага nodejs/undici#5360 в Node 24 / Electron 45 (undici 7.x),
// чтобы случайный обрыв сокета в фоне не ронял весь браузер
process.on('uncaughtException', (err) => {
  if (
    err &&
    err.code === 'ERR_ASSERTION' &&
    typeof err.stack === 'string' &&
    err.stack.includes('undici') &&
    err.stack.includes('Parser.finish')
  ) {
    console.warn('[runtime] Проигнорирован известный баг undici (assert !this.paused)');
    return;
  }
  // Любое другое неперехваченное исключение — состояние процесса неизвестно: сохраняем сессию и выходим
  console.error('[main] Uncaught Exception:', err);
  try {
    registry?.flushSessionSync();
  } catch (flushErr) {
    console.error('[main] Не удалось сохранить сессию перед выходом:', flushErr);
  }
  app.exit(1);
});

// Страница могла закрыться/уйти на другой адрес, пока main отвечал на её запрос (например, поиск иконки сайта) — это не ошибка
process.on('unhandledRejection', (reason) => {
  const msg = reason && reason.message ? String(reason.message) : String(reason);
  if (msg.includes('Render frame was disposed') || msg.includes('Object has been destroyed')) return;
  console.warn('[main] Unhandled rejection:', reason);
});

// Важно: эти вызовы выполняются до app.whenReady()
cleanUserAgent(app);
registerSchemePrivileges();
applyChromiumPrivacySwitches(app); // разделение хранилища по сайтам, если включено в настройках

// WebRTC не раскрывает реальный IP мимо прокси/VPN (дублируется на уровне webContents в attachWebContentsSecurity)
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

// Жёсткие лимиты кэша Chromium (байты): без них дисковый и медиа-кэш (YouTube) растут без ограничений
app.commandLine.appendSwitch('disk-cache-size', String(150 * 1024 * 1024));
app.commandLine.appendSwitch('media-cache-size', String(100 * 1024 * 1024));

// Максимальное время ожидания AdBlock перед открытием первых вкладок (холодный запуск: списки качаются впервые)
const ADBLOCK_STARTUP_WAIT_MS = 2500;

// Не запускаем дублирующий экземпляр браузера при повторном клике по ярлыку
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const wm = registry?.getFallback();
    if (!wm?.win || wm.win.isDestroyed()) return;
    if (argv && argv.includes('--new-window')) { registry.openNormalWindow(wm); return; }
    if (wm.win.isMinimized()) wm.win.restore();
    wm.win.focus();
  });

  app.whenReady().then(async () => {
	// DNS-over-HTTPS по настройкам пользователя (режим и провайдер); по умолчанию automatic: при сбое DoH откат на системный DNS
    try {
      applyDoh(storage.loadSettings());
    } catch (err) {
      console.warn('[net] Не удалось настроить DNS-over-HTTPS:', err.message);
    }

    configureSession(session.defaultSession);
    registerProtocolHandler(session.defaultSession);

    registry = new WindowRegistry();
    const energySaver = createEnergySaver(registry.legacyHost);
    const { broadcastTheme } = registerIpcHandlers(registry, energySaver);
    registry.onThemeChanged = broadcastTheme;

    // Первые вкладки не должны грузиться без блокировщика: ждём AdBlock, но не дольше таймаута
    const adblockReady = adblock.setEnabled(session.defaultSession, storage.loadSettings().adblock);
    await adblock.settleWithin(adblockReady, ADBLOCK_STARTUP_WAIT_MS);

    // Автозагрузка сохранённых распакованных расширений до открытия первых вкладок
    try {
      await extensions.loadSaved(session.defaultSession);
    } catch (err) {
      console.warn('[ext] Не удалось загрузить расширения:', err.message);
    }

    registry.createWindow(); // первое окно: основное, восстанавливает сессию
  });

  app.on('before-quit', () => {
    if (registry) { registry.quitting = true; registry.flushSessionSync(); }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
