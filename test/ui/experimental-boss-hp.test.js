// Execute field handlers and mount the actual Preact input in memory: no browser or subprocess.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExperimentalOptions } from '../../public/js/ui/experimental.js';
import { validateC2S } from '../../shared/protocol.js';
import { h, render } from '../../public/vendor/preact.module.js';

// Only the DOM surface used by a mounted Preact input. No browser, service or dependency.
class InputNode {
  constructor(name) {
    this.localName = name;
    this.nodeType = 1;
    this.namespaceURI = 'http://www.w3.org/1999/xhtml';
    this.childNodes = [];
    this.parentNode = null;
    this.value = '';
    this.disabled = false;
    this.oninput = this.onblur = this.onkeydown = null;
    this.listeners = new Map();
  }
  insertBefore(node, before) {
    node.parentNode?.removeChild(node);
    const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
  }
  removeChild(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
  appendChild(node) { this.insertBefore(node, null); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  setAttribute(name, value) { this[name] = String(value); }
  removeAttribute(name) { delete this[name]; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  removeEventListener(name) { this.listeners.delete(name); }
  fire(type) { this.listeners.get(type)?.call(this, { type, currentTarget: this, target: this }); }
}
function mountedField(t, onChange, extra = {}) {
  const before = globalThis.document;
  globalThis.document = { createElementNS: (_ns, name) => new InputNode(name) };
  const root = new InputNode('div');
  t.after(() => { render(null, root); globalThis.document = before; });
  const update = (patch = {}) => {
    extra = { ...extra, ...patch };
    const vnode = nodes(ExperimentalOptions({ open: true, value: base, editable: true, onChange, ...extra }))
      .find(n => n.props?.id === 'experimental-boss-hp');
    // Mount the actual field (including its hooks), not just invoke its onBlur handler.
    render(h(vnode.type, vnode.props), root);
  };
  update();
  return { input: root.firstChild, update };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const base = { revivalEnabled: false, disableSharedPool: false };
function field(onChange, extra = {}) {
  return nodes(ExperimentalOptions({ open: true, value: base, editable: true, onChange, ...extra }))
    .find(n => n.props?.id === 'experimental-boss-hp').props;
}
test('boss HP commits finite stepped values and survives JSON/protocol normalization', () => {
  for (const [typed, expected] of [['150', 150], ['1000', 1000], ['22', 25], ['153', 155], ['1e30', 9007199254740990]]) {
    let sent;
    const input = { value: typed };
    field(value => { sent = value; }).onBlur({ currentTarget: input });
    assert.equal(input.value, String(expected));
    assert.equal(sent.bossHpPercent, expected);
    const msg = JSON.parse(JSON.stringify({ t: 'room.setExperimental', experimental: sent }));
    assert.equal(validateC2S(msg), null);
    assert.equal(msg.experimental.bossHpPercent, expected);
    assert.equal(field(() => {}, { value: sent }).value, expected);
  }
});
test('empty/invalid input does not submit a bad request; busy/non-host cannot edit', () => {
  for (const typed of ['', 'NaN', 'Infinity', '1e999', '100']) {
    const input = { value: typed };
    field(() => assert.fail('unexpected request')).onBlur({ currentTarget: input });
    assert.equal(input.value, '100');
  }
  for (const extra of [{ editable: false }, { busy: true }]) {
    field(() => assert.fail('unauthorized edit'), extra).onBlur({ currentTarget: { value: '150' } });
  }
});
test('room clock/ping re-renders do not overwrite a half-typed HP before blur', async t => {
  let sent;
  const { input, update } = mountedField(t, value => { sent = value; });
  for (const typed of ['1', '15', '150']) {
    input.value = typed;
    input.fire('input');
    await flush();
    update(); // RoomScreen's one-second tick still carries the old room.experimental.
    assert.equal(input.value, typed, 'a parent render must preserve the local editing draft');
    assert.equal(sent, undefined, 'typing must not send a partial percentage');
  }
  input.fire('blur');
  assert.equal(sent.bossHpPercent, 150);
});

test('pending old room echoes preserve the submitted draft; accepted echo and reopen stay at 155', async t => {
  const requests = [];
  const { input, update } = mountedField(t, value => requests.push(value));
  input.value = '153';
  input.fire('input');
  await flush();
  input.fire('blur');
  await flush();
  assert.equal(input.value, '155', 'blur normalizes the local draft');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].bossHpPercent, 155);
  update({ busy: true });
  assert.equal(input.value, '155', 'old 100% props while waiting must not roll back');
  update({ value: { ...base, bossHpPercent: 155 } });
  update({ busy: false });
  await flush();
  assert.equal(input.value, '155');
  update({ open: false });
  update({ open: true });
  assert.equal(input.value, '155');
  assert.equal(requests.length, 1, 'server echo/reopen must not submit again');
});

test('refused request restores authoritative value; closing drops an uncommitted draft', async t => {
  const { input, update } = mountedField(t, () => {});
  input.value = '150';
  input.fire('input');
  await flush();
  input.fire('blur');
  await flush();
  update({ busy: true });
  update({ busy: false }); // request refused: room.state stays at the original 100%
  await flush();
  assert.equal(input.value, '100');
  input.value = '200';
  input.fire('input');
  await flush();
  update({ open: false });
  update({ open: true });
  await flush();
  assert.equal(input.value, '100');
  update({ value: { ...base, bossHpPercent: 75 }, editable: false });
  await flush();
  assert.equal(input.value, '75', 'a read-only viewer follows the authoritative change');
  assert.equal(input.disabled, true);
});

test('mounted field preserves an empty edit across ticks, then blur restores it without sending', async t => {
  const { input, update } = mountedField(t, () => assert.fail('empty input must not send'));
  input.value = '';
  input.fire('input');
  await flush();
  update();
  assert.equal(input.value, '');
  input.fire('blur');
  await flush();
  assert.equal(input.value, '100');
});

test('Enter blurs the field so the same commit handler is used', () => {
  let blurred = false;
  field(() => {}).onKeyDown({ key: 'Enter', currentTarget: { blur() { blurred = true; } } });
  assert.equal(blurred, true);
});
