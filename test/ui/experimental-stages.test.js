// 地图禁用 (玩法#03): the experimental dialog lists the mode's battlefields and bans the unchecked ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../../public/js/ui/experimental.js', import.meta.url), 'utf8');
const room = readFileSync(new URL('../../public/js/screens/room.js', import.meta.url), 'utf8');
const en = JSON.parse(readFileSync(new URL('../../public/i18n/en.json', import.meta.url), 'utf8'));

test('ExperimentalOptions renders a battlefield list and lets the host check stages to ban them', () => {
  assert.match(ui, /export function ExperimentalOptions\(\{[^}]*stages = \[\][^}]*\}\)/);
  assert.match(ui, /const choices = \(Array\.isArray\(stages\) \? stages : \[\]\)/);
  assert.match(ui, /const toggleStage = \(id, disable\) => \{/);
  assert.match(ui, /if \(choices\.length > 1 && choices\.every\(s => next\.has\(s\.id\)\)\) next\.delete\(id\);/);
  assert.match(ui, /onChange\?\.\(list\.length \? \{ \.\.\.rest, bannedStages: list \} : rest\);/);
  assert.match(ui, /class=\$\{`experimental-stage\$\{banned\.has\(s\.id\) \? ' is-banned' : ''\}`\}/);
  assert.match(ui, /checked=\$\{banned\.has\(s\.id\)\}/);
  assert.match(ui, /const toggleStage = \(id, disable\)/);
  assert.match(ui, /disabled=\$\{!editable \|\| busy\}/);
});

test('the battlefield list only shows for a host-editable private room with a real choice', () => {
  assert.match(ui, /\$\{source !== 'matchmaking' && choices\.length > 1 \? html`<div class="experimental-stages">/);
});

test('the stage descriptor shows under the battlefield number', () => {
  const lobby = readFileSync(new URL('../../public/js/screens/lobby.js', import.meta.url), 'utf8');
  assert.match(lobby, /export function stageSuffix\(id\)/);
  assert.match(lobby, /return rec\.name\.replace\(\/\^\(\.\*\?#\\d\+/);
  assert.match(ui, /\$\{s\.note \? html`<small>\$\{s\.note\}<\/small>` : ''\}/);
  assert.equal(en['活性源石'], 'Active Originium');
  assert.equal(en['涨潮控制'], 'Tide Control');
});

test('the room screen hands the difficulty\'s stages to the dialog', () => {
  assert.match(room, /const m = DIFFICULTIES\.includes\(room\.difficulty\) \? getMode\(modeIdFor\(room\.mode, room\.difficulty\)\) : null;/);
  assert.match(room, /const suffix = stageSuffix\(id\);/);
  assert.match(room, /return \{ id, label: stageLabel\(id\) \|\| id, note: suffix \? t\(suffix\) : '' \};/);
  assert.ok(room.includes('<${ExperimentalOptions}'));
  assert.match(room, /stages=\$\{stageChoices\}/);
});

test('the new strings are translated in English', () => {
  assert.equal(en['禁用战场'], 'Banned battlefields');
  assert.equal(en['勾选的战场本局不会出现，至少保留一张。'], 'Checked stages never appear this match; at least one stays.');
  assert.equal(en['禁用战场 {n} 张'], '{n} battlefields banned');
});

test('the stylesheet gives the list its own block', () => {
  const css = readFileSync(new URL('../../public/css/components.css', import.meta.url), 'utf8');
  assert.match(css, /\.experimental-stages \{/);
  assert.match(css, /\.experimental-stage\.is-banned \{/);
  assert.match(css, /\.experimental-stage input:checked \{/);
});
