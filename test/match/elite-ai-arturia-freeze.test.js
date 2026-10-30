// Read-only freeze, import-closure and routing checks; no server, browser, installer or golden writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, relative } from 'node:path';
import * as arturia from '../../server/match/arturia/index.js';
import { makeMatch } from './harness.js';
const root = fileURLToPath(new URL('../../server/match/arturia/', import.meta.url));
const json = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = json('upstream.json'), release = json('addon.json'), evidence = json('upgrade-verification.json');
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
  ? walk(resolve(dir, e.name)) : [relative(root, resolve(dir, e.name)).replaceAll('\\', '/')]);

test('Arturia v0.3.0 freezes every release file, preserves all old policies and keeps shared 1.1.0 read-only', () => {
  assert.equal(metadata.tag, 'arturia-v0.3.0');
  assert.equal(metadata.ref, 'b63ec427cddb378fa5bde049eb0358bd35a41a17');
  assert.equal(metadata.policy, 'sha256:010f073287162dcb031907648c330f2f4e4b5f33e7fcad8d6a9b8ef941b88ad1');
  assert.equal(metadata.policyHash, release.policy);
  assert.deepEqual(metadata.files, evidence.files);
  assert.equal(Object.keys(release.files).length, 654);
  assert.equal(Object.keys(metadata.files).length, 657);
  for (const [path, expected] of Object.entries(metadata.files)) {
    assert.equal(hash(readFileSync(resolve(root, path))), expected, path);
    if (release.files[path]) assert.equal(expected, release.files[path], path);
    assert.match(evidence.gitBlobs[path], /^[a-f0-9]{40}$/);
  }
  const policies = walk(resolve(root, 'policy')).sort();
  assert.deepEqual(policies, Object.keys(metadata.files).filter(p => p.startsWith('policy/')).sort());
  assert.equal(policies.length, 652);
  assert.equal(policies.filter(p => /\/release-(two|four)\//.test(p)).length, 272);
  for (const [path, expected] of Object.entries(evidence.previousFiles).filter(([p]) => p.startsWith('policy/'))) {
    assert.equal(metadata.files[path], expected, `Retained v0.2.6 policy: ${path}`);
  }
  assert.equal(Object.keys(evidence.previousFiles).filter(p => p.startsWith('policy/')).length, 380);
  assert.equal(hash(readFileSync(resolve(root, 'index.js'))), evidence.wrapper.sha256);
  assert.equal(metadata.sharedRuntime.version, '1.1.0');
  assert.deepEqual(metadata.sharedRuntime, release.sharedRuntime);
  assert.equal(Object.keys(metadata.sharedRuntime.files).length, 9);
  for (const [path, expected] of Object.entries(metadata.sharedRuntime.files)) {
    assert.equal(hash(readFileSync(resolve(root, '../aiCompute', path))), expected, path);
    assert.equal(evidence.sharedRuntime[path].changed, false);
  }
  for (const path of ['extended-host.mjs', 'build.mjs', 'install.mjs', 'patches.mjs']) {
    assert.equal(existsSync(resolve(root, path)), false, `Not a host installer: ${path}`);
  }
});

test('all five frozen driver branches have a complete local import closure', t => {
  const seen = new Set(), external = new Set(), optional = [];
  let edges = 0;
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const code = readFileSync(resolve(root, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of code.matchAll(/\b(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (!spec.startsWith('.')) continue;
      const target = resolve(dirname(resolve(root, path)), spec);
      // The frozen compatibility shim intentionally supports either host settlement module.
      if (path === 'compat/settlement.js' && spec === '../../../sim/damage.js' && !existsSync(target)) {
        assert.ok(existsSync(resolve(root, '../../sim/attack.js')));
        optional.push(`${path} -> ${spec}`);
        continue;
      }
      assert.ok(existsSync(target), `${path} -> ${spec}`);
      edges++;
      const local = relative(root, target).replaceAll('\\', '/');
      if (!local.startsWith('../')) visit(local);
      else external.add(local);
    }
  }
  visit('runtime.js');
  const reachablePolicy = [...seen].filter(p => p.startsWith('policy/'));
  assert.equal(reachablePolicy.length, 652);
  assert.deepEqual(reachablePolicy.sort(), Object.keys(metadata.files).filter(p => p.startsWith('policy/')).sort());
  assert.equal([...external].some(p => /install|extended-host|source\//.test(p)), false);
  t.diagnostic(JSON.stringify({ frozenModules: seen.size, policyModules: reachablePolicy.length, importEdges: edges,
    externalHostImports: [...external].sort(), optionalAbsentFallbacks: optional }));
});

// Replace only driver imports with sentinels to observe the original frozen runtime's private dispatch.
// The runtime logic and shared computation API remain unmodified; real driver behavior is exercised below.
async function routingRuntime() {
  const source = readFileSync(resolve(root, 'runtime.js'), 'utf8');
  const instrumented = source.replace(/(['"])(\.[^'"]+)\1/g, (text, quote, spec) => {
    if (!spec.startsWith('./policy/')) return `${quote}${new URL(spec, new URL('../../server/match/arturia/runtime.js', import.meta.url)).href}${quote}`;
    const branch = /\/arturia\/([^/]+)\//.exec(spec)[1];
    const code = `export const botPickCard = () => '${branch}';
      export function* botPrepBeginSteps() { yield '${branch}'; }
      export function* botPrepEndSteps() { yield '${branch}'; }
      export const captureOwnSurvivalOpening = (m, ps) => { ps.opening = '${branch}'; };`;
    return `${quote}data:text/javascript;base64,${Buffer.from(code).toString('base64')}${quote}`;
  });
  return import(`data:text/javascript,${encodeURIComponent(instrumented)}`);
}

test('current routes only ABYSS coop 2/4; all other modes retain v0.2.6 pick/prep/opening drivers', async () => {
  const runtime = await routingRuntime();
  for (const difficulty of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
    for (const mode of ['solo', 'coop']) for (const count of [0, 1, 2, 3, 4, 5, 8, 20]) {
      const m = { mode, isSolo: mode === 'solo', difficulty, opts: { seats: Array.from({ length: count }, () => ({})) },
        round: 1, wave: true, gd: { bossRound: 14 } };
      const current = mode === 'coop' && difficulty === 'ABYSS' && [2, 4].includes(count);
      const expected = mode === 'solo' ? 'solo-policy' : current ? `release-${count === 2 ? 'two' : 'four'}` : `${count >= 4 ? 'four' : 'two'}-policy`;
      const ps = {};
      assert.equal(runtime.pickCard(m, ps, [], () => true), expected);
      assert.deepEqual([...runtime.prepBegin(m, ps)], [expected]);
      assert.deepEqual([...runtime.prepEnd(m, ps)], [expected]);
      assert.equal(ps.opening, mode === 'coop' ? expected : undefined);
      assert.equal(runtime.policyView(m).opts.botLateranoExperiment, current ? 'coop-prep-fin-helm-separate' : 'team28-vision-difficulty');
      assert.deepEqual(m.opts, { seats: m.opts.seats }, 'runtime must not mutate host options');
    }
  }
  const fallback = { mode: 'coop', difficulty: 'ABYSS', opts: {}, order: [{}, {}] };
  assert.equal(runtime.pickCard(fallback, {}, [], () => true), 'release-two');
  const solo = { mode: 'coop', isSolo: true, difficulty: 'ABYSS', opts: { seats: [{}, {}] } };
  assert.equal(runtime.pickCard(solo, {}, [], () => true), 'solo-policy');
});

for (const count of [2, 4]) test(`ABYSS ${count}-seat Arturia drafts and deploys through the actual frozen current driver`, () => {
  const seats = Array.from({ length: count }, (_, i) => ({ seat: i, playerId: i === 1 ? 'ai_0' : `p_${i}`,
    name: `P${i}`, isBot: i === 1, connected: true, ...(i === 1 ? { botPersona: 'arturia' } : {}) }));
  const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', seats, seed: 11, fake: true }).start();
  try {
    h.autoHumans();
    assert.ok(h.drive(() => h.m.phase === 'PREP' || h.ended));
    const ps = h.ps('ai_0');
    assert.equal(ps.bandId, 'band_paganini');
    assert.equal(arturia.policyView(h.m, ps).opts.botLateranoExperiment, 'coop-prep-fin-helm-separate');
    assert.ok(h.run(() => ps.deployCount > 0 || h.ended, { maxSteps: 2e6 }));
    assert.ok(ps.deployCount > 0);
    assert.deepEqual(h.logs.error, []);
    h.invariants();
  } finally { h.m.dispose(); }
});

test('Arturia wrapper preserves own-pool route and options in expanded rooms', () => {
  for (const count of [6, 7, 8, 20]) {
    const seats = Array.from({ length: count }, (_, i) => ({ seat: i, playerId: `p${i}`, name: `P${i}`,
      isBot: i === 5, connected: true, ...(i === 5 ? { botPersona: 'arturia' } : {}) }));
    const h = makeMatch({ seats, difficulty: 'ABYSS', fake: true,
      experimental: { playerCapacity: 20, disableSharedPool: false, revivalEnabled: false } });
    try {
      const ps = h.ps('p5'), view = arturia.policyView(h.m, ps), ownCount = Math.min(count - 4, 4);
      assert.equal(view.pool, ps.pool);
      assert.equal(view.opts.seats.length, ownCount);
      assert.equal(view.opts.botLateranoExperiment, [2, 4].includes(ownCount) ? 'coop-prep-fin-helm-separate' : 'team28-vision-difficulty');
      assert.equal(view.players.size, ownCount);
      assert.equal(h.m.opts.seats.length, count);
      assert.notEqual(view.pool, h.ps('p0').pool);
    } finally { h.m.dispose(); }
  }
});
