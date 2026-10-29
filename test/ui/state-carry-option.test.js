// Pure Node contracts only: no browser, server, worker or subprocess is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXPERIMENTAL_DEFAULTS, EXPERIMENTAL_OPTIONAL, EXPERIMENTAL_OPTIONAL_DEFAULTS,
  isExperimental, experimentalOptions, experimentalKey, optionalValue, sameExperimental,
} from '../../shared/experimental.js';
import { validateC2S } from '../../shared/protocol.js';
import {
  ExperimentalOptions, experimentalOptions as uiOptions, experimentalChanged, experimentalCopy, experimentalSummary,
} from '../../public/js/ui/experimental.js';
import { ROOM_DEFAULT_KEYS, roomDefaultsExperimental, sanitizeRoomDefaults } from '../../public/js/ui/roomDefaults.js';
import { roomDefaultCopy } from '../../public/js/ui/roomDefaultsSection.js';

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const on = { ...EXPERIMENTAL_DEFAULTS, stateCarry: true };
const off = { ...EXPERIMENTAL_DEFAULTS, stateCarry: false };
const label = '联防状态继承';
const note = '敌人保留生命值与阶段，退场干员保留剩余再部署时间；等待时暂停计时，仅本回合联防生效';
const nodes = value => Array.isArray(value) ? value.flatMap(nodes)
  : value && typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [];
const text = value => Array.isArray(value) ? value.map(text).join('')
  : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
const input = tree => nodes(tree).find(n => n.props?.id === 'experimental-state-carry');

test('stateCarry defaults off, preserves legacy wire shape, and contributes only :carry when on', () => {
  assert.ok(EXPERIMENTAL_OPTIONAL.includes('stateCarry'));
  assert.equal(EXPERIMENTAL_OPTIONAL_DEFAULTS.stateCarry, false);
  assert.equal(optionalValue({}, 'stateCarry'), false);
  assert.deepEqual(experimentalOptions(off), EXPERIMENTAL_DEFAULTS);
  assert.deepEqual(uiOptions(off), EXPERIMENTAL_DEFAULTS);
  assert.deepEqual(experimentalOptions(on), on);
  assert.deepEqual(uiOptions(on), on);
  assert.equal(experimentalKey(on), '00:carry');
  assert.equal(experimentalKey(off), experimentalKey(EXPERIMENTAL_DEFAULTS));
  assert.equal(sameExperimental(on, EXPERIMENTAL_DEFAULTS), false);
  assert.equal(sameExperimental(off, EXPERIMENTAL_DEFAULTS), true);
  assert.equal(sameExperimental(on, { ...on }), true);
  assert.equal(experimentalChanged(on), true);
  assert.equal(experimentalChanged(off), false);
  assert.ok(experimentalSummary(on).includes(label));
  assert.ok(!experimentalSummary(off).includes(label));
});

test('shared schema and room protocol accept only plain boolean stateCarry', () => {
  for (const value of [on, off, EXPERIMENTAL_DEFAULTS]) {
    assert.equal(isExperimental(value), true);
    assert.equal(validateC2S({ t: 'room.setExperimental', experimental: value }), null);
    assert.equal(validateC2S({ t: 'room.create', mode: 'coop', difficulty: 'HARD', experimental: value }), null);
  }
  for (const stateCarry of [undefined, null, 1, 'true', {}, []]) {
    const bad = { ...EXPERIMENTAL_DEFAULTS, stateCarry };
    assert.equal(isExperimental(bad), false);
    assert.equal(validateC2S({ t: 'room.setExperimental', experimental: bad }), 'bad field experimental');
    assert.throws(() => experimentalOptions(bad), /invalid experimental options/);
  }
  let reads = 0;
  const accessor = Object.defineProperty({ ...EXPERIMENTAL_DEFAULTS }, 'stateCarry', {
    enumerable: true, get() { reads++; return true; },
  });
  assert.equal(isExperimental(accessor), false);
  assert.equal(optionalValue(accessor, 'stateCarry'), false);
  assert.equal(reads, 0, 'validation never executes untrusted accessors');
});

test('room dialog exposes the scoped linked rule, toggles safely and keeps matchmaking unchanged', () => {
  let changed;
  const tree = ExperimentalOptions({ open: true, value: EXPERIMENTAL_DEFAULTS, editable: true,
    onChange: value => { changed = value; } });
  const checkbox = input(tree);
  assert.ok(checkbox);
  assert.equal(checkbox.props.checked, false);
  assert.equal(checkbox.props.disabled, false);
  assert.equal(checkbox.props.role, 'switch');
  assert.equal(checkbox.props['aria-describedby'], 'experimental-state-carry-help');
  assert.ok(text(tree).includes(label));
  assert.ok(text(tree).includes(note));
  checkbox.props.onChange({ currentTarget: { checked: true } });
  assert.deepEqual(changed, on);
  assert.equal(input(ExperimentalOptions({ value: on, editable: true })).props.checked, true);
  for (const props of [{ editable: false }, { editable: true, busy: true }]) {
    changed = null;
    const locked = input(ExperimentalOptions({ value: on, ...props, onChange: v => { changed = v; } }));
    assert.equal(locked.props.disabled, true);
    locked.props.onChange({ currentTarget: { checked: false } });
    assert.equal(changed, null);
  }
  assert.equal(input(ExperimentalOptions({ value: on, source: 'matchmaking' })), undefined);
});

test('personal room defaults reuse the exact scoped copy and normalize the switch', () => {
  assert.ok(ROOM_DEFAULT_KEYS.includes('stateCarry'));
  assert.deepEqual(experimentalCopy('stateCarry'), [label, note]);
  assert.deepEqual(roomDefaultCopy('stateCarry'), [label, note]);
  assert.equal(sanitizeRoomDefaults({}).stateCarry, false);
  assert.equal(roomDefaultsExperimental(sanitizeRoomDefaults({})), undefined);
  assert.deepEqual(roomDefaultsExperimental(sanitizeRoomDefaults({ stateCarry: true })), on);
  const settings = read('public/js/ui/roomDefaultsSection.js');
  assert.match(settings, /ROOM_DEFAULT_KEYS\.filter/);
  assert.match(settings, /roomDefaultCopy\(key\)/);
  assert.match(settings, /room-default-\$\{key\}/);
  const en = JSON.parse(read('public/i18n/en.json'));
  assert.equal(en[label], 'Unite state carry');
  assert.ok(en[note].includes('HP and phase'));
  assert.ok(en[note].includes('remaining redeployment time'));
  assert.ok(en[note].includes('Timers pause while waiting'));
  assert.ok(en[note].includes("only to this round's Unite battles"));
});
