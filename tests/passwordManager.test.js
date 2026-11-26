'use strict';
const Module = require('module');
const os = require('os');
const path = require('path');
const fs = require('fs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'deffi-pw-'));
// «Шифрование» для теста: обратимое, но не открытый текст на диске
const fakeSafeStorage = {
  available: true,
  isEncryptionAvailable() { return this.available; },
  encryptString: (s) => Buffer.from(`enc:${Buffer.from(s, 'utf8').toString('hex')}`),
  decryptString: (b) => {
    const t = b.toString();
    if (!t.startsWith('enc:')) throw new Error('bad data');
    return Buffer.from(t.slice(4), 'hex').toString('utf8');
  }
};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { app: { getPath: () => userData }, safeStorage: fakeSafeStorage };
  return origLoad.call(this, request, parent, isMain);
};

const test = require('node:test');
const assert = require('node:assert');
const pm = require('../main/passwordManager');

const file = path.join(userData, 'passwords.enc.json');

test('upsert: создаёт запись, повтор обновляет ту же (origin + логин)', () => {
  const a = pm.upsert({ origin: 'https://example.com/login', username: ' alice ', password: 'p1' });
  assert.ok(a.ok && a.created);
  const b = pm.upsert({ origin: 'https://example.com/other', username: 'alice', password: 'p2' });
  assert.ok(b.ok);
  assert.strictEqual(b.created, false);
  assert.strictEqual(b.id, a.id);
  assert.strictEqual(pm.list().length, 1);
  assert.strictEqual(pm.reveal(a.id).password, 'p2');
  assert.ok(pm.isSaved('https://example.com', 'alice', 'p2'));
  assert.ok(!pm.isSaved('https://example.com', 'alice', 'p1'));
});

test('на диске нет пароля открытым текстом', () => {
  pm.upsert({ origin: 'https://secret.example', username: 'bob', password: 'Tr0ub4dor&3' });
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('Tr0ub4dor'));
  assert.ok(raw.includes('encryptedPassword'));
});

test('upsert: небезопасные адреса и пустые значения отклоняются', () => {
  assert.strictEqual(pm.upsert({ origin: 'http://example.com', username: 'u', password: 'p' }).ok, false);
  assert.strictEqual(pm.upsert({ origin: 'https://u:p@example.com', username: 'u', password: 'p' }).ok, false);
  assert.strictEqual(pm.upsert({ origin: 'https://example.com', username: 'u', password: '' }).ok, false);
  assert.strictEqual(pm.upsert({ origin: 'http://localhost:3000', username: 'dev', password: 'p' }).ok, true);
});

test('upsert без доступного шифрования ничего не пишет', () => {
  const before = fs.readFileSync(file, 'utf8');
  fakeSafeStorage.available = false;
  const r = pm.upsert({ origin: 'https://nokey.example', username: 'x', password: 'y' });
  fakeSafeStorage.available = true;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

test('importFromCsv: кавычки, запятые и переводы строк внутри полей, BOM, CRLF', () => {
  const csv = '\uFEFFname,url,username,password\r\n' +
    'a,https://csv1.example/login,user1,"pa,ss""word"\r\n' +
    'b,https://csv2.example,"us\ner",simple\r\n';
  const r = pm.importFromCsv(csv);
  assert.deepStrictEqual([r.ok, r.imported, r.updated, r.skipped], [true, 2, 0, 0]);
  const e1 = pm.list().find((x) => x.host === 'csv1.example');
  assert.strictEqual(pm.reveal(e1.id).password, 'pa,ss"word');
  const e2 = pm.list().find((x) => x.host === 'csv2.example');
  assert.strictEqual(e2.username, 'us\ner');
});

test('importFromCsv: повтор пропускается, смена пароля обновляет, мусор пропускается', () => {
  const head = 'name,url,username,password\n';
  const same = pm.importFromCsv(`${head}a,https://csv1.example,user1,"pa,ss""word"\n`);
  assert.deepStrictEqual([same.imported, same.updated, same.skipped], [0, 0, 1]);
  const changed = pm.importFromCsv(`${head}a,https://csv1.example,user1,newpass\n`);
  assert.deepStrictEqual([changed.imported, changed.updated], [0, 1]);
  const junk = pm.importFromCsv(`${head}a,http://insecure.example,u,p\na,not a url,u,p\na,https://ok.example,,p\n`);
  assert.strictEqual(junk.skipped >= 2, true);
  assert.strictEqual(junk.imported, 1); // пустой логин допустим, это «Без логина»
});

test('importFromCsv: чужой формат и пустой файл', () => {
  assert.strictEqual(pm.importFromCsv('a,b,c\n1,2,3\n').ok, false);
  assert.strictEqual(pm.importFromCsv('   ').ok, false);
});

test('remove и clear', () => {
  const id = pm.list()[0].id;
  assert.strictEqual(pm.remove(id).ok, true);
  assert.strictEqual(pm.remove(id).ok, false);
  const r = pm.clear();
  assert.ok(r.ok && r.removed > 0);
  assert.deepStrictEqual(pm.list(), []);
});
