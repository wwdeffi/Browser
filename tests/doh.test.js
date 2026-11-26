'use strict';
const Module = require('module');
const origLoad = Module._load;
const calls = { configure: [], flushed: [] };
const mkSession = (name, fail = false) => ({
  name,
  clearHostResolverCache: () => (fail ? Promise.reject(new Error('x')) : (calls.flushed.push(name), Promise.resolve()))
});
const defaultSession = mkSession('default');
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { app: { configureHostResolver: (c) => calls.configure.push(c) }, session: { defaultSession } };
  }
  return origLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert');
const doh = require('../main/doh');

test('normalizeDohUrl: только https, без логина и фрагмента, шаблон {?dns} допустим', () => {
  assert.strictEqual(doh.normalizeDohUrl('https://dns.example/dns-query'), 'https://dns.example/dns-query');
  assert.strictEqual(doh.normalizeDohUrl('https://dns.example/dns-query{?dns}'), 'https://dns.example/dns-query{?dns}');
  for (const bad of ['http://dns.example/q', 'https://u:p@dns.example/q', 'https://dns.example/q#x', 'https://dns.example/q?a=1{?dns}',
    'https://dns .example/q', '', '   ', null, 42, `https://dns.example/${'a'.repeat(2100)}`]) {
    assert.strictEqual(doh.normalizeDohUrl(bad), null, String(bad).slice(0, 40));
  }
});

test('resolveDohConfig: режимы, провайдеры, откат к значениям по умолчанию', () => {
  assert.deepStrictEqual(doh.resolveDohConfig({ dohMode: 'off' }), { secureDnsMode: 'off' });
  assert.deepStrictEqual(doh.resolveDohConfig({}), { secureDnsMode: 'automatic', secureDnsServers: ['https://cloudflare-dns.com/dns-query'] });
  assert.strictEqual(doh.resolveDohConfig({ dohMode: 'secure', dohProvider: 'quad9' }).secureDnsServers[0], 'https://dns.quad9.net/dns-query');
  assert.strictEqual(doh.resolveDohConfig({ dohMode: 'bogus' }).secureDnsMode, 'automatic');
  const custom = doh.resolveDohConfig({ dohProvider: 'custom', dohCustomUrl: 'https://my.dns/q' });
  assert.deepStrictEqual(custom.secureDnsServers, ['https://my.dns/q']);
  const badCustom = doh.resolveDohConfig({ dohProvider: 'custom', dohCustomUrl: 'http://bad' });
  assert.strictEqual(badCustom.secureDnsServers[0], doh.DOH_PROVIDERS.cloudflare.url, 'невалидный адрес не должен отключать DoH');
});

test('applyDoh: повтор той же конфигурации ничего не делает; смена сбрасывает DNS-кэш во всех сессиях', async () => {
  assert.strictEqual(doh.applyDoh({ dohMode: 'automatic' }), true);
  assert.strictEqual(calls.configure.length, 1);
  assert.deepStrictEqual(calls.flushed, [], 'первое применение кэш не сбрасывает');
  assert.strictEqual(doh.applyDoh({ dohMode: 'automatic' }), true);
  assert.strictEqual(calls.configure.length, 1);

  const registry = { incognitoSessions: () => [mkSession('inc1'), mkSession('inc2', true)] };
  const incs = registry.incognitoSessions();
  registry.incognitoSessions = () => incs;
  assert.strictEqual(doh.applyDoh({ dohMode: 'secure', dohProvider: 'adguard' }, registry), true);
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(calls.configure.length, 2);
  assert.ok(calls.flushed.includes('default'));
  assert.ok(calls.flushed.includes('inc1'));
});

test('flushDnsEverywhere: сбой одной сессии или битый реестр не мешают остальным', async () => {
  calls.flushed.length = 0;
  await doh.flushDnsEverywhere({ incognitoSessions: () => { throw new Error('нет реестра'); } });
  assert.deepStrictEqual(calls.flushed, ['default']);
  calls.flushed.length = 0;
  await doh.flushDnsEverywhere({ incognitoSessions: () => [mkSession('bad', true), mkSession('good')] });
  assert.deepStrictEqual(calls.flushed.sort(), ['default', 'good']);
  await doh.flushDnsEverywhere(undefined);
});
