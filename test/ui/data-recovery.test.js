import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDataStore, CORE_DATA_TIMEOUT_MS, ART_MANIFEST_TIMEOUT_MS } from '../../public/js/data.js';
import { BrowserClock, flushPromises } from '../helpers/browserClock.js';

const json = (value) => ({ ok: true, status: 200, json: async () => value });
const silent = (t) => t.mock.method(console, 'warn', () => {});
const options = (clock, fetch, extra = {}) => ({ fetch, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, retryDelays: [], ...extra });

for (const body of [false, true]) {
  test(`core timeout aborts a hung ${body ? 'response body' : 'request'} and leaves no live deadline`, async (t) => {
    silent(t);
    const clock = new BrowserClock(); let signal, bodyRead = false;
    const store = createDataStore(options(clock, async (_, opts) => {
      signal = opts.signal;
      if (!body) return new Promise(() => {});
      return { ok: true, status: 200, json: () => { bodyRead = true; return new Promise(() => {}); } };
    }));
    const loading = store.load('chess');
    await flushPromises();
    assert.equal(bodyRead, body);
    assert.equal(signal.aborted, false);
    clock.advance(CORE_DATA_TIMEOUT_MS - 1);
    assert.equal(store.status('chess'), 'loading');
    clock.advance(1);
    assert.equal(await loading, null);
    assert.equal(signal.aborted, true);
    assert.equal(store.status('chess'), 'missing');
    assert.equal(clock.jobs.size, 0);
  });
}

test('timed-out body cannot overwrite a newer retry and late rejection is consumed', async (t) => {
  silent(t);
  const clock = new BrowserClock(); let rejectOld, calls = 0;
  const store = createDataStore(options(clock, async () => {
    if (++calls > 1) return json({ version: 2 });
    return { ok: true, status: 200, json: () => new Promise((_, reject) => { rejectOld = reject; }) };
  }));
  const first = store.load('config'); await flushPromises();
  clock.advance(CORE_DATA_TIMEOUT_MS); await first;
  assert.deepEqual(await store.invalidate('config'), { version: 2 });
  rejectOld(new TypeError('late stream reset')); await flushPromises();
  assert.deepEqual(store.get('config'), { version: 2 });
  assert.equal(store.status('config'), 'ready');
  assert.equal(clock.jobs.size, 0);
});

test('manual retry aborts in-flight old entry, consumes its late success and retains only the new value', async (t) => {
  silent(t);
  const clock = new BrowserClock(); let oldSignal, resolveOld, calls = 0;
  const store = createDataStore(options(clock, (_, opts) => {
    if (++calls > 1) return Promise.resolve(json({ version: 2 }));
    oldSignal = opts.signal;
    return new Promise((resolve) => { resolveOld = resolve; });
  }));
  const first = store.load('config');
  assert.deepEqual(await store.invalidate('config'), { version: 2 });
  assert.equal(oldSignal.aborted, true);
  assert.equal(await first, null);
  resolveOld(json({ version: 1 })); await flushPromises();
  assert.deepEqual(store.get('config'), { version: 2 });
  assert.equal(clock.jobs.size, 0);
});

test('invalidate cancels the old retry backoff and never refetches an already ready file', async () => {
  const clock = new BrowserClock(); let calls = 0;
  const store = createDataStore(options(clock, async () => {
    if (++calls === 1) throw new TypeError('offline');
    return json({ ok: true });
  }, { retryDelays: [600, 2000] }));
  const first = store.load('items'); await flushPromises();
  assert.equal([...clock.jobs.values()][0].at, 600);
  await store.invalidate('items'); await first;
  assert.equal(clock.jobs.size, 0);
  clock.advance(3000); await flushPromises();
  await store.load('items');
  assert.equal(calls, 2);
  assert.equal(store.status('items'), 'ready');
});

test('body transport errors retry, but malformed JSON and definite 4xx do not', async (t) => {
  silent(t);
  for (const [kind, expected] of [['transport', 2], ['syntax', 1], ['404', 1], ['403', 1], ['429', 2], ['503', 2]]) {
    let calls = 0;
    const store = createDataStore({ wait: async () => {}, retryDelays: [0], fetch: async () => {
      if (++calls > 1) return json({ good: true });
      if (/^\d+$/.test(kind)) return { ok: false, status: Number(kind) };
      return { ok: true, status: 200, json: async () => { throw kind === 'syntax' ? new SyntaxError('bad JSON') : new TypeError('body disconnected'); } };
    } });
    await store.load('bands');
    assert.equal(calls, expected, kind);
    assert.equal(store.status('bands'), expected === 2 ? 'ready' : 'missing', kind);
  }
});

test('art keeps its shorter deadline and glyph status across background recovery', async () => {
  const clock = new BrowserClock(); let calls = 0, firstSignal;
  const seen = [];
  const store = createDataStore(options(clock, (_, opts) => {
    if (++calls > 1) return Promise.resolve(json({ groups: {} }));
    firstSignal = opts.signal;
    return new Promise(() => {});
  }, { retryDelays: [600] }));
  store.subscribe(() => seen.push(store.status('assets')));
  const loading = store.load('assets');
  clock.advance(ART_MANIFEST_TIMEOUT_MS); await flushPromises();
  assert.equal(store.status('assets'), 'missing');
  assert.equal(firstSignal.aborted, true);
  clock.advance(600); await loading;
  assert.deepEqual(seen, ['missing', 'ready']);
  assert.equal(clock.jobs.size, 0);
});

test('synchronous invalidation from the art fallback notification never arms an obsolete retry', async () => {
  const clock = new BrowserClock(); let calls = 0, waits = 0, second;
  const store = createDataStore(options(clock, async () => {
    if (++calls === 1) throw new TypeError('offline');
    return json({ fresh: true });
  }, { retryDelays: [600], wait: () => { waits++; return new Promise(() => {}); } }));
  store.subscribe(() => { if (store.status('assets') === 'missing') second = store.invalidate('assets'); });
  const first = store.load('assets');
  await flushPromises();
  assert.deepEqual(await second, { fresh: true });
  assert.equal(await first, null);
  assert.equal(waits, 0);
  assert.equal(clock.jobs.size, 0);
});

test('language-overlay retries use the injected clock alongside core data recovery', async () => {
  const clock = new BrowserClock(); let calls = 0;
  const store = createDataStore(options(clock, async () => {
    if (++calls === 1) return { ok: false, status: 503 };
    return json({ files: {} });
  }, { retryDelays: [600] }));
  const switching = store.setLocale('en');
  await flushPromises();
  assert.equal(store.locale(), 'zh');
  assert.equal([...clock.jobs.values()][0].at, 600);
  clock.advance(600);
  assert.equal(await switching, 'en');
  assert.equal(calls, 2);
  assert.equal(clock.jobs.size, 0);
});
