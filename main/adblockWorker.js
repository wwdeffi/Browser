// Воркер: тяжёлый разбор текстовых списков фильтров в движок блокировщика вне главного процесса.
// Получает { text } через workerData, возвращает сериализованный движок (ArrayBuffer) или { ok: false, error }.
// Любой сбой (нет пакета, исключение, неподходящий формат) обрабатывается в adblock.js — фолбэком на разбор в main.
const { parentPort, workerData } = require('worker_threads');

function loadEngineClass() {
  // Базовый движок без зависимости от модуля 'electron' (внутри воркера его API недоступен)
  try {
    return require('@ghostery/adblocker').FiltersEngine;
  } catch {
    return require('@ghostery/adblocker-electron').ElectronBlocker;
  }
}

try {
  const Engine = loadEngineClass();
  // Косметические правила (## / #@# / #?# / ##+js) всегда загружаются в движок: включение и выключение
  // делается на лету в adblock.js (setCosmetic), без пересборки. Генерик-правила нужны для скрытия пустых контейнеров.
  const engine = Engine.parse(String(workerData && workerData.text), {
    loadCosmeticFilters: true,
    loadGenericCosmeticsFilters: true,
    loadNetworkFilters: true
  });
  const bytes = engine.serialize();
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  parentPort.postMessage({ ok: true, data: copy.buffer }, [copy.buffer]);
} catch (err) {
  parentPort.postMessage({ ok: false, error: String((err && err.message) || err) });
}
