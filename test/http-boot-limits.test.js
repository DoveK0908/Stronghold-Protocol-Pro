// test/http-boot-limits.test.js — the caps in effect are printed once when the session stack is built.
//
// The line states the configuration the server is running with. Every admission cap defaults to 0 = unlimited
// (docs/CONCURRENCY-ADMISSION.md: a positive cap is compared before rejecting a count), so the out-of-the-box line reads
// "rooms 0 (unlimited/network) … sockets 0 (unlimited/network)". The global caps are printed as the raw number (0), never
// as the word "unlimited"; a per-network cap is printed as its number, and 0 there reads "unlimited".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionStack } from '../server/http/websocket.js';
import { NET_DEFAULTS } from '../server/net.js';
import { LOBBY_DEFAULTS } from '../server/lobby.js';

/** Build the stack with `opts` and no SP_MAX_* in the environment; return what `log.info` was given. */
function logLines(opts = {}) {
  const saved = new Map();
  for (const k of ['SP_MAX_ROOMS', 'SP_MAX_ROOMS_PER_ADDR', 'SP_MAX_MATCHES_PER_ADDR', 'SP_MAX_CONNECTIONS', 'SP_MAX_CONNECTIONS_PER_ADDR']) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  const lines = [];
  const log = { info: (m) => lines.push(m), warn() {}, debug() {}, error() {} };
  try {
    createSessionStack(opts, { data: {}, log });
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return lines;
}

test('the defaults are printed as they are: every cap 0 = unlimited', () => {
  assert.equal(LOBBY_DEFAULTS.maxRooms, 0);
  assert.equal(LOBBY_DEFAULTS.maxRoomsPerAddr, 0);
  assert.equal(LOBBY_DEFAULTS.maxMatchesPerAddr, 0);
  assert.equal(NET_DEFAULTS.maxConnections, 0);
  assert.equal(NET_DEFAULTS.maxConnectionsPerAddr, 0);
  const lines = logLines();
  assert.equal(lines.length, 1, 'exactly one line on boot');
  assert.equal(lines[0], '[http] limits: rooms 0 (unlimited/network), matches unlimited/network, sockets 0 (unlimited/network)');
});

test('an explicit cap is printed, and a per-network 0 reads as unlimited', () => {
  const lines = logLines({ maxRooms: 5, maxRoomsPerAddr: 16, maxConnections: 100, maxConnectionsPerAddr: 0, maxMatchesPerAddr: 0 });
  assert.equal(lines[0], '[http] limits: rooms 5 (16/network), matches unlimited/network, sockets 100 (unlimited/network)');
});

test('a global 0 is printed as 0, the number as configured, never as the word "unlimited"', () => {
  const lines = logLines({ maxRooms: 0, maxConnections: 0 });
  assert.match(lines[0], /^\[http\] limits: rooms 0 \(unlimited\/network\), matches unlimited\/network, sockets 0 \(unlimited\/network\)$/);
});
