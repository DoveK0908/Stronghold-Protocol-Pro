// Connection-local baselines. Snapshot and diff encoding are shared only for the SAME message/baseline objects,
// never across players' private views. Weak maps release disconnected sockets and superseded snapshots.
//
// Every frame a connection is given — full or delta — carries a fresh number from that connection's own counter, so
// the sequence only moves forward: a re-sent snapshot must not hand out an older number than the frames before it, and
// a full frame is always ahead of what came before it. The receiver keys its baseline on those numbers.
//
// This fork compresses one channel more than upstream does: `m.private` rides the transport too (the Pro line has sent
// both views this way since pro.3, and the browser decodes either). A private view is per player, so its patch is
// cached on its own message object and is never shared with another connection — the sharing below is public-only.
import { diffState, isStateKind, STATE_DELTA_VERSION } from '../shared/stateDelta.js';

/**
 * The channels this build compresses. The public view is the frame every member of a room receives, so a client that
 * cannot apply one loses nothing it cannot get back from the next full frame; the private view is per player and only
 * reaches clients that negotiated the transport, which have opted in already.
 */
export const DELTA_KINDS = new Set(['m.public', 'm.private']);

// Terminal phases stay plain m.public: the cluster ingress drops those by type (only the coordinator's receipt
// delivers a result), which it could not do inside a delta.
const TERMINAL_PHASES = new Set(['RESULT', 'ENDED']);

/** Frames and bytes by encoding, for /metrics. */
export const stateDeltaStats = { full: 0, delta: 0, fullBytes: 0, deltaBytes: 0, plainBytesAvoided: 0 };

const connections = new WeakMap();   // ws -> { seq, kinds: Map<kind, { snapshot, seq }>, roomCode }
const snapshots = new WeakMap();     // msg -> { encoded, bytes, view, patches: WeakMap<previousSnapshot, opsJson | false> }

const fullFrame = (kind, seq, encoded) =>
  `{"t":"m.state","kind":${JSON.stringify(kind)},"seq":${seq},"full":${encoded}}`;

export function negotiateStateDelta(ws, version) {
  if (!ws || typeof ws !== 'object') return;
  const enabled = version === STATE_DELTA_VERSION;
  const old = connections.get(ws);
  // A repeated hello keeps the baseline it already has: dropping it would turn the next frame into a full one for no
  // reason, and the client would have to decode a full frame it did not need.
  if (enabled) { if (!old) connections.set(ws, { seq: 0, kinds: new Map() }); return; }
  connections.delete(ws);
}

/** The already negotiated capability, for an internal identity handover on the same socket. */
export function stateDeltaVersion(ws) { return connections.has(ws) ? STATE_DELTA_VERSION : undefined; }

/** @returns {boolean} */
export const stateDeltaEnabled = (ws) => !!ws && typeof ws === 'object' && connections.has(ws);

/** Forget the baselines (a new negotiation, or a client that asked for a full resync). The counter never rewinds. */
export function resetStateDelta(ws) { connections.get(ws)?.kinds.clear(); }

/** Keep negotiation and sequence, but never carry a previous room's state into a new room. */
export function setStateDeltaRoom(ws, roomCode) {
  const connection = connections.get(ws);
  if (!connection || connection.roomCode === roomCode) return;
  connection.roomCode = roomCode;
  connection.kinds.clear();
}

/** Return an encoded state and commit its baseline ONLY after the caller successfully queues the reliable frame.
 * `usable: false` means the given bytes cannot be a baseline (they are not a JSON object) and the caller should send a
 * full frame it encoded itself; this connection keeps the baseline it already had. */
export function prepareStateFrame(ws, msg, encoded) {
  const connection = connections.get(ws);
  if (!connection || !isStateKind(msg?.t) || !DELTA_KINDS.has(msg.t)) return { data: encoded, commit() {}, usable: true };
  if (msg.t === 'm.public' && TERMINAL_PHASES.has(msg.phase)) return { data: encoded, commit() {}, usable: true };
  let snapshot = snapshots.get(msg);
  // The encoding, not mutable game objects, owns this immutable baseline.
  if (!snapshot || snapshot.encoded !== encoded) {
    let view;
    // Bytes a caller pre-encoded (a lane worker) can be anything: never throw out of the send path because of them.
    try { view = JSON.parse(encoded); } catch { view = null; }
    if (view === null || typeof view !== 'object' || Array.isArray(view)) {
      return { data: encoded, commit() {}, usable: false };
    }
    snapshot = { encoded, bytes: Buffer.byteLength(encoded), view, patches: new WeakMap() };
    snapshots.set(msg, snapshot);
  }
  const previous = connection.kinds.get(msg.t);
  const seq = ++connection.seq;
  let data = fullFrame(msg.t, seq, encoded);
  let deltaBytes = null;
  if (previous && previous.snapshot !== snapshot) {
    // The patch is content-only, so it is shared between connections; the sequence numbers are not.
    let patch = snapshot.patches.get(previous.snapshot);
    if (patch === undefined) {
      const ops = diffState(previous.snapshot.view, snapshot.view);
      patch = ops ? JSON.stringify(ops) : false;
      snapshot.patches.set(previous.snapshot, patch);
    }
    if (patch) {
      const candidate = `{"t":"m.state","kind":${JSON.stringify(msg.t)},"seq":${seq},"base":${previous.seq},"patch":${patch}}`;
      // Compare actual UTF-8 bytes, not JS string length. Large changes fall back to full.
      const bytes = Buffer.byteLength(candidate);
      if (bytes < Buffer.byteLength(data)) { data = candidate; deltaBytes = bytes; }
    }
  }
  return {
    data,
    usable: true,
    commit() {
      connection.kinds.set(msg.t, { snapshot, seq });
      if (deltaBytes != null) { stateDeltaStats.delta++; stateDeltaStats.deltaBytes += deltaBytes; stateDeltaStats.plainBytesAvoided += snapshot.bytes; }
      else { stateDeltaStats.full++; stateDeltaStats.fullBytes += snapshot.bytes; }
    },
  };
}
