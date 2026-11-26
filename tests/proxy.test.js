'use strict';
require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const { readProxySettings, sanitizeProxyPatch, buildProxyConfig, applyProxy, PROXY_DEFAULTS } = require('../main/proxy');

const manual = { proxyMode: 'manual', proxyProtocol: 'socks5', proxyHost: 'Proxy.Example.com', proxyPort: 1080 };

test('readProxySettings: мусор откатывается к значениям по умолчанию', () => {
  assert.deepStrictEqual(readProxySettings(null), PROXY_DEFAULTS);
  const r = readProxySettings({ proxyMode: 'evil', proxyProtocol: 'ftp', proxyHost: 'bad host!', proxyPort: 70000 });
  assert.strictEqual(r.proxyMode, 'system');
  assert.strictEqual(r.proxyProtocol, 'http');
  assert.strictEqual(r.proxyHost, '');
  assert.strictEqual(r.proxyPort, 0);
});

test('sanitizeProxyPatch: проверка хоста, порта и ручного режима', () => {
  assert.strictEqual(sanitizeProxyPatch({ proxyMode: 'bogus' }, {}).ok, false);
  assert.strictEqual(sanitizeProxyPatch({ proxyPort: 0 }, {}).ok, true);
  assert.strictEqual(sanitizeProxyPatch({ proxyPort: '99999' }, {}).ok, false);
  assert.strictEqual(sanitizeProxyPatch({ proxyHost: 'a b' }, {}).ok, false);
  assert.strictEqual(sanitizeProxyPatch({ proxyMode: 'manual' }, {}).ok, false, 'без хоста и порта ручной режим недопустим');
  const ok = sanitizeProxyPatch({ proxyMode: 'manual', proxyHost: 'Proxy.Example.com', proxyPort: '8080' }, {});
  assert.ok(ok.ok);
  assert.strictEqual(ok.clean.proxyHost, 'proxy.example.com');
  assert.strictEqual(ok.clean.proxyPort, 8080);
  assert.strictEqual(sanitizeProxyPatch({ proxyIncognitoOnly: 'yes' }, {}).ok, false);
  assert.strictEqual(sanitizeProxyPatch({ proxyBypassRules: 'a;b c' }, {}).clean.proxyBypassRules, 'a,b,c');
  assert.deepStrictEqual(sanitizeProxyPatch({ unknownKey: 1 }, {}).clean, {}, 'чужие ключи игнорируются');
});

test('buildProxyConfig: режимы и «только Инкогнито»', () => {
  assert.deepStrictEqual(buildProxyConfig({ proxyMode: 'direct' }), { mode: 'direct' });
  assert.deepStrictEqual(buildProxyConfig({}), { mode: 'system' });
  const cfg = buildProxyConfig(manual);
  assert.strictEqual(cfg.mode, 'fixed_servers');
  assert.strictEqual(cfg.proxyRules, 'socks5://proxy.example.com:1080');
  const only = { ...manual, proxyIncognitoOnly: true };
  assert.strictEqual(buildProxyConfig(only, { incognito: false }).mode, 'system');
  assert.strictEqual(buildProxyConfig(only, { incognito: true }).mode, 'fixed_servers');
  assert.strictEqual(buildProxyConfig({ proxyMode: 'manual', proxyHost: '', proxyPort: 0 }).mode, 'system');
});

function fakeSession({ failOn } = {}) {
  const calls = [];
  return {
    calls,
    setProxy: async (c) => { calls.push(c); if (failOn && failOn(c)) throw new Error('boom'); },
    closeAllConnections: async () => { calls.push('closeAll'); }
  };
}

test('applyProxy: повторное применение той же конфигурации пропускается, смена закрывает соединения', async () => {
  const ses = fakeSession();
  assert.strictEqual(await applyProxy(ses, { proxyMode: 'direct' }), true);
  assert.strictEqual(await applyProxy(ses, { proxyMode: 'direct' }), true);
  assert.strictEqual(ses.calls.length, 1);
  await applyProxy(ses, manual);
  assert.deepStrictEqual(ses.calls.slice(1).map((c) => (c === 'closeAll' ? c : c.mode)), ['fixed_servers', 'closeAll']);
});

test('applyProxy: при сбое ручного прокси включается fail-closed, а не прямой трафик', async () => {
  const ses = fakeSession({ failOn: (c) => c.proxyRules === 'socks5://proxy.example.com:1080' });
  assert.strictEqual(await applyProxy(ses, manual), false);
  const last = ses.calls.filter((c) => c !== 'closeAll').pop();
  assert.strictEqual(last.mode, 'fixed_servers');
  assert.strictEqual(last.proxyRules, 'http://127.0.0.1:9');
  assert.strictEqual(await applyProxy(null, manual), false);
});
