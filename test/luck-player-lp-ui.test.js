// Pure Node source/VM checks: never import the browser overlay or start external runtimes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const luck = new URL('../mods/luck/', import.meta.url);
const source = fs.readFileSync(new URL('runtime/public/overlay.js', luck), 'utf8');
const patch = JSON.parse(fs.readFileSync(new URL('patches/L9-player-lp-ui.patch.json', luck), 'utf8'));
const valid = [1, 20, 99999];
const invalid = [undefined, null, '', '20', true, false, 0, -1, 1.5, 99999.5, 100000,
  NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 1n, {}, []];

function between(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `source boundaries: ${start} -> ${end}`);
  return source.slice(a, b);
}

function fn(name) {
  const match = source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, 'm'));
  assert.ok(match, `extract actual ${name}`);
  return match[0];
}

function defaults() {
  const text = between('const testDefaults =', 'let testMatchScope =');
  return vm.runInNewContext(`${text}\ntestDefaults()`);
}

test('testLp feature defaults on, respects saved preference and both live gates', () => {
  const featureText = between('const FEATURES = [', 'if (!Object.hasOwn(C2S, SHOPLEVEL))');
  const init = between('local.enable = Object.fromEntries', 'function saveEnable()');
  for (const saved of [null, {}, { testLp: false }, { testLp: true }, { testLp: 'false' }]) {
    const local = {};
    let echoed = {};
    const context = vm.createContext({ local, ENABLE_KEY: 'spmod.enable',
      localStorage: { getItem: () => JSON.stringify(saved) },
      store: { get: () => ({ match: { private: { modEnable: echoed } } }) } });
    vm.runInContext(`${featureText}\n${init}\n${fn('enableOn')}`, context);
    assert.equal(vm.runInContext("FEATURES.filter(([k]) => k === 'testLp').length", context), 1);
    assert.equal(local.enable.testLp, saved?.testLp !== false);
    assert.equal(context.enableOn('testLp'), saved?.testLp !== false);
    echoed = { testLp: false };
    assert.equal(context.enableOn('testLp'), false, 'server off vetoes local on');
    local.enable.testLp = false;
    echoed = { testLp: true };
    assert.equal(context.enableOn('testLp'), false, 'local off vetoes server on');
  }
});

test('actual LP number control never converts a blank or invalid input into 1 HP', () => {
  const nodes = [];
  const context = vm.createContext({
    el(tag, props, ...children) { const node = { tag, ...props, children }; nodes.push(node); return node; },
    testRow: (...args) => args, local: { test: {} }, saveTestPrefs() {},
  });
  vm.runInContext(fn('testNumber'), context);
  const sent = [];
  context.testNumber({ key: 'lp', value: '', min: 1, max: 99999, label: 'LP', send: n => sent.push(n) });
  const input = nodes.find(n => n.tag === 'input');
  const button = nodes.find(n => n.tag === 'button');
  for (const value of ['', ' ', 'no', '0', '-1', '1.5', '100000', 'Infinity']) {
    input.value = value; button.onClick();
  }
  assert.deepEqual(sent, []);
  for (const value of ['1', '20', '99999']) { input.value = value; button.onClick(); }
  assert.deepEqual(sent, [1, 20, 99999]);
});

test('TESTLP protocol validates strict integers and preserves an existing registration', () => {
  const constant = source.match(/^const TESTLP = .*;$/m)?.[0];
  const registration = source.match(/^if \(!Object.hasOwn\(C2S, TESTLP\)\).*$/m)?.[0];
  assert.ok(constant && registration, 'LP constant and protocol registration exist');
  const context = vm.createContext({ C2S: {} });
  vm.runInContext(`${constant}\n${registration}`, context);
  assert.equal(vm.runInContext('TESTLP', context), 'g.modTestLp');
  const validator = context.C2S['g.modTestLp'].lp;
  for (const n of valid) assert.equal(validator(n), true);
  for (const n of invalid) assert.equal(validator(n), false);
  const existing = { lp: () => false };
  context.C2S['g.modTestLp'] = existing;
  vm.runInContext(registration, context);
  assert.equal(context.C2S['g.modTestLp'], existing);
});

test('actual sendTestLp sends only bounded integers while its own feature is enabled', async () => {
  const calls = [];
  const warnings = [];
  const local = { enable: {} };
  let echo = {};
  let reject = false;
  const context = vm.createContext({ local, TESTLP: 'g.modTestLp',
    store: { get: () => ({ match: { private: { modEnable: echo } } }) },
    console: { info() {}, warn: (...args) => warnings.push(args) }, errText: e => e.message,
    net: { request: (type, payload) => {
      calls.push([type, { ...payload }]);
      return reject ? Promise.reject(new Error('denied')) : Promise.resolve({ ok: true });
    } } });
  vm.runInContext(`${fn('enableOn')}\n${fn('sendTestLp')}`, context);
  for (const n of valid) context.sendTestLp(n);
  assert.deepEqual(calls, valid.map(lp => ['g.modTestLp', { lp }]));
  calls.length = 0;
  for (const n of invalid) context.sendTestLp(n);
  assert.equal(calls.length, 0);
  local.enable.testLp = false;
  context.sendTestLp(20);
  local.enable.testLp = true;
  echo = { testLp: false };
  context.sendTestLp(20);
  assert.equal(calls.length, 0);
  echo = { testFunds: false };
  reject = true;
  context.sendTestLp(20);
  await Promise.resolve();
  assert.equal(calls.length, 1, 'LP gate is independent of funds');
  assert.deepEqual(warnings, [['[luck] life refused', 'denied']]);
  assert.equal(local.test, undefined, 'request does not manufacture an authoritative LP echo');
});

test('LP field sits immediately beside funds in drawTestPage and uses private authoritative echo', () => {
  const page = fn('drawTestPage');
  const start = page.indexOf("key: 'funds'");
  const end = page.indexOf("key: 'shopLevel'", start);
  assert.ok(page.includes("'对局数据'"));
  assert.ok(start >= 0 && end > start);
  const fields = page.slice(start, end);
  assert.ok(/send: sendTestFunds,[\s\S]*?testNumber\(\{\s*key: 'lp'/.test(fields));
  assert.ok(/key: 'lp', value: local\.test\.lp, min: 1, max: 99999/.test(fields));
  assert.ok(fields.includes("label: '当前生命值'"));
  assert.ok(fields.includes("placeholder: t && t.lp != null ? String(t.lp) : ''"));
  assert.ok(fields.includes('send: sendTestLp'));
  assert.ok(page.includes('v.priv.modSandbox.test'));
  assert.ok(page.includes("' · 生命 ' + (t && t.lp != null ? t.lp : '?')"));
  assert.ok(page.includes('local.test = testDefaults()'), 'match change resets the draft');
  assert.equal(defaults().lp, '', 'draft starts blank rather than inventing current LP');
});

test('actual render signature changes when only authoritative player LP changes', () => {
  const context = vm.createContext({ local: { filter: { bonds: [] } }, testEchoSig: () => '' });
  vm.runInContext(`${fn('quotaOf')}\n${fn('signature')}`, context);
  const v = { priv: { funds: 100, modSandbox: { test: { lp: 20 } } },
    shop: { level: 1 }, pick: { chess: [], item: [] }, slots: [] };
  const before = context.signature(v);
  v.priv.modSandbox.test.lp = 19;
  assert.notEqual(context.signature(v), before, 'LP alone invalidates render cache');
  delete v.priv.modSandbox;
  assert.equal(typeof context.signature(v), 'string', 'missing echo remains safe');
  assert.equal(context.signature(null), 'none');
});

test('actual LP preference functions save and restore only valid same-match drafts', () => {
  let raw;
  let mid = 'match-a';
  const local = { test: defaults() };
  const context = vm.createContext({ local, TEST_KEY: 'spmod.test', testMatchScope: null,
    store: { get: () => ({ match: { public: { matchId: mid } } }) },
    localStorage: { getItem: () => raw, setItem: (key, value) => {
      assert.equal(key, 'spmod.test'); raw = value;
    } } });
  vm.runInContext(`${fn('saveTestPrefs')}\n${fn('loadTestPrefs')}`, context);
  for (const lp of valid) {
    local.test = defaults(); local.test.lp = lp;
    context.saveTestPrefs();
    assert.equal(JSON.parse(raw).lp, lp);
    assert.equal(JSON.parse(raw).matchId, mid);
    local.test = defaults(); context.loadTestPrefs();
    assert.equal(local.test.lp, lp);
  }
  for (const lp of invalid.filter(n => typeof n !== 'bigint')) {
    raw = JSON.stringify({ matchId: mid, lp });
    local.test = defaults(); context.loadTestPrefs();
    assert.equal(local.test.lp, '');
  }
  raw = JSON.stringify({ matchId: 'match-a', lp: 50 });
  mid = 'match-b'; local.test = defaults(); context.loadTestPrefs();
  assert.equal(local.test.lp, '', 'previous match preference is ignored');
  raw = '{broken'; context.loadTestPrefs();
  assert.equal(local.test.lp, '', 'malformed storage is harmless');
});

test('L9 uniquely reverses/reapplies against runtime without touching files', () => {
  assert.equal(patch.file, 'public/overlay.js');
  let text = source;
  const count = (hay, needle) => hay.split(needle).length - 1;
  for (const h of [...patch.hunks].reverse()) {
    assert.ok(h.find && h.replace && h.find !== h.replace, h.id);
    assert.equal(count(text, h.replace), 1, `${h.id}: unique applied text`);
    text = text.replace(h.replace, h.find);
  }
  assert.ok(!text.includes('const TESTLP ='), 'reverse removes LP registration');
  assert.ok(!text.includes('function sendTestLp('), 'reverse removes LP sender');
  for (const h of patch.hunks) {
    assert.equal(count(text, h.find), 1, `${h.id}: unique original anchor`);
    assert.equal(count(text, h.replace), 0, `${h.id}: not already applied`);
    text = text.replace(h.find, h.replace);
  }
  assert.equal(text === source, true, 'reapply reconstructs runtime byte for byte');
});

test('Luck patch hunk IDs and per-target original anchors are not duplicated', () => {
  const ids = new Set();
  const anchors = new Set();
  const dir = new URL('patches/', luck);
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith('.patch.json'))) {
    const p = JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8'));
    const shipped = fs.readFileSync(new URL(`runtime/${p.file}`, luck), 'utf8').replaceAll('\r\n', '\n');
    for (const h of p.hunks) {
      assert.ok(shipped.includes(h.replace), `cumulative anchor no longer already applied: ${name}/${h.id}`);
      assert.ok(!ids.has(h.id), `duplicate hunk ID: ${h.id}`);
      ids.add(h.id);
      const key = `${p.file}\u0000${h.find}`;
      assert.ok(!anchors.has(key), `duplicate original anchor: ${name}/${h.id}`);
      anchors.add(key);
    }
  }
});
