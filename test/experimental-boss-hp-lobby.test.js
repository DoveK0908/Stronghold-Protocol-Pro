// In-memory request → real lobby setter → encoded room.state; no listening server or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import { validateC2S } from '../shared/protocol.js';
import { EXPERIMENTAL_DEFAULTS, numericValue } from '../shared/experimental.js';

for (const mode of ['solo', 'coop']) {
  test(`${mode}: boss HP persists through real lobby broadcasts and other rule edits`, t => {
    const registry = new SessionRegistry();
    const lobby = new Lobby({ registry, getData: () => ({}), seedFn: () => 7 });
    t.after(() => lobby.shutdown());
    const host = registry.create('Boss HP');
    host.connected = true;
    const frames = [];
    host.ws = { readyState: 1, bufferedAmount: 0, send(data, cb) { frames.push(JSON.parse(data)); cb?.(); } };
    assert.deepEqual(lobby.create(host, { mode, difficulty: 'NORMAL' }), { ok: true });
    const room = lobby.roomOf(host);
    const latest = () => frames.filter(frame => frame.t === 'room.state').at(-1);
    const request = experimental => {
      const msg = JSON.parse(JSON.stringify({ t: 'room.setExperimental', experimental }));
      assert.equal(validateC2S(msg), null);
      assert.deepEqual(lobby.setExperimental(host, msg), { ok: true });
      assert.deepEqual(latest().experimental, room.toState().experimental);
      return latest().experimental;
    };
    for (const percent of [150, 1000, 25]) {
      const echo = request({ ...EXPERIMENTAL_DEFAULTS, bossHpPercent: percent });
      assert.equal(numericValue(echo, 'bossHpPercent'), percent);
      const toggled = request({ ...echo, prepUnlimited: true });
      assert.equal(toggled.bossHpPercent, percent, 'editing another rule preserves the percentage');
      assert.equal(toggled.prepUnlimited, true);
    }
    const reset = request({ ...EXPERIMENTAL_DEFAULTS, bossHpPercent: 100 });
    assert.equal(numericValue(reset, 'bossHpPercent'), 100);
    assert.equal(Object.hasOwn(reset, 'bossHpPercent'), false, 'the default is omitted only intentionally');
  });
}
