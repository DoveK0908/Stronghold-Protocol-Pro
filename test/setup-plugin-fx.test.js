import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fxFixture } from './helpers/fxFixtures.js';
import { installedFxReferences, officialFxReferences } from '../server/plugins/fxReferences.js';
import { checkPluginFx, pluginFxExtractionAllowed } from '../tools/setup.mjs';

const IDS = ['char_4217_makoto', 'char_9001_test', 'char_9002_test', 'char_9003_test', 'char_9004_test'];
const SYNC = { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } };

// fx.py is stdlib-only, but its interpreter is an environment dependency: python3 on CI/Ubuntu, python on a Windows
// box, neither on a plain one. Probe both (module import included, so a broken checkout still runs for real) and let
// the python-side test skip only when no interpreter can run it.
function pythonWithFx() {
  const probe = `import sys\nsys.path.insert(0, ${JSON.stringify(path.resolve('tools/local-extract'))})\nimport fx`;
  for (const cmd of ['python3', 'python']) {
    const r = spawnSync(cmd, ['-c', probe], SYNC);
    if (r.status === 0) return cmd;
  }
  return null;
}
const PYTHON = pythonWithFx();

function referencesFixture(t) {
  const f = fxFixture(t);
  f.put('plugins/demo/plugin.json', { operators: ['ops.json'], assets: 'assets.json', entry: { sim: 'evil.js' } });
  f.put('plugins/demo/ops.json', [{ fx: { unit: 'char_4217_makoto' } }, { origin: { charId: 'char_9001_test' }, art: { assets: { spine: 'char_9002_test' } } }, { charId: 'char_9003_test' }]);
  f.put('plugins/demo/assets.json', { chars: { char_x_demo_one: { ref: 'char_9004_test' } } });
  fs.writeFileSync(path.join(f.root, 'plugins/demo/evil.js'), 'throw new Error("must never execute");');
  return f;
}

test('setup notices installed official references absent from data/index, without reading scripts or links', t => {
  const f = referencesFixture(t);
  assert.deepEqual(installedFxReferences(f.root), IDS); assert.deepEqual(checkPluginFx(f.root), IDS);
  f.put('public/assets/local/fx/index.json', { units: { char_4217_makoto: {} } });
  assert.deepEqual(checkPluginFx(f.root), IDS.slice(1));
  f.put('plugins/linked/plugin.json', { operators: ['linked.json'] });
  fs.symlinkSync(path.join(f.root, 'plugins/demo/ops.json'), path.join(f.root, 'plugins/linked/linked.json'));
  assert.deepEqual(installedFxReferences(f.root), IDS);
  const r = spawnSync(process.execPath, ['tools/local-extract/plugin-fx.mjs', f.root], { encoding: 'utf8' });
  assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout), IDS, 'extractor uses exactly the setup reference reader');
});

test('fx.py game_data() reads the same references (real interpreter, skipped without one)', { skip: PYTHON ? false : 'no python3/python that can import tools/local-extract/fx.py' }, t => {
  const f = referencesFixture(t);
  f.put('.cache/gamedata/excel/character_table.json', { char_4217_makoto: { skills: [{ skillId: 'skcom_synthetic' }] } });
  const source = `import sys, json\nsys.path.insert(0, ${JSON.stringify(path.resolve('tools/local-extract'))})\nimport fx\nprint(json.dumps(fx.game_data(${JSON.stringify(f.root)})))`;
  const py = spawnSync(PYTHON, ['-c', source], SYNC);
  assert.equal(py.status, 0, py.stderr);
  const discovered = JSON.parse(py.stdout);
  assert.deepEqual(discovered.chars, IDS); assert.deepEqual(discovered.skills.char_4217_makoto, ['skcom_synthetic']);
});

test('effect gap requires typed yes; check/no-local always win and unchanged refs do not prompt extraction', () => {
  for (const answer of [false, null, undefined]) assert.equal(pluginFxExtractionAllowed({}, ['char_1_x'], answer), false);
  assert.equal(pluginFxExtractionAllowed({}, ['char_1_x'], true), true);
  assert.equal(pluginFxExtractionAllowed({}, [], true), false);
  assert.equal(pluginFxExtractionAllowed({ local: 'force' }, []), true);
  assert.equal(pluginFxExtractionAllowed({ check: true, local: 'force' }, ['char_1_x'], true), false);
  assert.equal(pluginFxExtractionAllowed({ local: 'no', yes: true }, ['char_1_x'], true), false);
  assert.deepEqual(officialFxReferences({ fx: { unit: '../char_1_x' }, charId: 'char_x_demo_one' }), []);
});
