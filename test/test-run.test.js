// test/test-run.test.js — tools/test-run.mjs, which is `npm test`: the whole suite when SHARD is unset (a local run,
// `npm run ci`), one shard of it when CI's matrix sets SHARD. Nothing here runs a test file: the arguments are.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { ROOT, TEST_FILES } from '../tools/ci.mjs';
import { SHARD_COUNT, shardsOf } from '../tools/ci-shards.mjs';
import { GUARD_FLAGS, runArgs } from '../tools/test-run.mjs';

test('SHARD unset: node --test over TEST_FILES, the globs the runner expands itself', () => {
  assert.deepEqual(runArgs({}), ['--test', ...GUARD_FLAGS, ...TEST_FILES]);
  assert.deepEqual(runArgs({ SHARD: '' }), ['--test', ...GUARD_FLAGS, ...TEST_FILES], 'an empty SHARD is no shard');
});

test('every run carries --test-force-exit and --test-timeout: both are needed to reach a summary here', () => {
  // AGENTS.md: a bare `node --test` lets a suite that keeps a timer/socket/server alive hang the whole run, and a few
  // cases wait on a peer that never answers. The flags are in tools/test-run.mjs so `npm test` and CI both get them.
  assert.deepEqual(GUARD_FLAGS, ['--test-force-exit', '--test-timeout=45000']);
  for (const env of [{}, { SHARD: '0' }, { SHARD: '3' }, { JUNIT: 'junit-a.xml' }]) {
    assert.ok(runArgs(env).includes('--test-force-exit'), `${JSON.stringify(env)}: --test-force-exit`);
    assert.ok(runArgs(env).includes('--test-timeout=45000'), `${JSON.stringify(env)}: --test-timeout`);
  }
});

test("SHARD=n: exactly that shard's files, and the shards together are the whole suite", () => {
  const split = shardsOf();
  const seen = [];
  for (let n = 0; n < SHARD_COUNT; n++) {
    const args = runArgs({ SHARD: String(n) });
    assert.deepEqual(args, ['--test', ...GUARD_FLAGS, ...split.files[n]]);
    seen.push(...args.slice(1 + GUARD_FLAGS.length));
  }
  assert.deepEqual(seen.sort(), split.files.flat().sort(), 'no file runs twice and none is left out');
});

test('a shard outside the matrix is refused, not silently run as the whole suite', () => {
  for (const bad of ['4', '9', '-1', '1.5', 'two']) assert.throws(() => runArgs({ SHARD: bad }), /SHARD=/);
});

test('JUNIT: a report beside the normal output, and nothing extra without it', () => {
  const args = runArgs({ SHARD: '1', JUNIT: 'junit-a.xml' });
  const split = shardsOf();
  assert.deepEqual(args.slice(0, 7), [
    '--test',
    '--test-force-exit', '--test-timeout=45000',
    '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=junit', '--test-reporter-destination=junit-a.xml',
  ], 'the reporters come before the files: node ignores a --test-reporter after a positional test file');
  assert.deepEqual(args.slice(7), split.files[1], 'and the files are still exactly that shard');
  assert.deepEqual(runArgs({}), ['--test', ...GUARD_FLAGS, ...TEST_FILES], 'no JUNIT, no reporter arguments');
});

test('the command line: --list prints the files of the run, and a bad SHARD exits 2', () => {
  const run = (shard) => {
    const env = { ...process.env };
    delete env.SHARD;
    if (shard !== undefined) env.SHARD = shard;
    return spawnSync(process.execPath, ['tools/test-run.mjs', '--list'], { cwd: ROOT, env, encoding: 'utf8' });
  };
  const split = shardsOf();
  const full = run();
  assert.equal(full.status, 0, full.stderr);
  assert.deepEqual(full.stdout.trim().split('\n'), split.files.flat().sort(), 'no SHARD lists the whole suite');
  const two = run('2');
  assert.equal(two.status, 0, two.stderr);
  assert.deepEqual(two.stdout.trim().split('\n'), split.files[2]);
  const bad = run('9');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /SHARD=9/);
});
