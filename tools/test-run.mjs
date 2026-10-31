#!/usr/bin/env node
// tools/test-run.mjs — what `npm test` runs: the whole suite, or one shard of it when CI sets SHARD.
//
//   npm test                         every test file, in one runner (TEST_FILES, as package.json always passed them)
//   SHARD=2 npm test                 only shard 2's files (ci.yml runs 0..3 on each OS and Node version)
//   node tools/test-run.mjs --list   the files a run here would execute, and run nothing
//
// One shard is a subset of the full run, never a different set: the files come from tools/ci-shards.mjs, whose table
// test/ci-shards.test.js proves is a partition of exactly what `npm test` runs. The full run passes TEST_FILES on to
// node --test (which expands the globs itself, as before); a shard passes the concrete paths, because a shard is a list
// of files and not a glob. SHARD unset (or empty) means the full run: that is what `npm run ci` and a local `npm test` do.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, TEST_FILES } from './ci.mjs';
import { SHARD_COUNT, shardsOf, testFileList } from './ci-shards.mjs';

/**
 * The two runner flags this project always needs, local or CI (AGENTS.md §"禁止从仓库根裸跑 node --test"):
 *
 *   --test-force-exit  suites that leave a timer, socket or worker pool behind keep their child process alive after
 *                      every test settled, and the runner then waits on it forever (2026-10-18: a whole CI job hung
 *                      for 20+ minutes after the last test had passed).
 *   --test-timeout     a few tests wait on a peer that never answers, so they never settle on their own; without a
 *                      per-test ceiling the run never reaches its summary either.
 * @type {string[]}
 */
export const GUARD_FLAGS = ['--test-force-exit', '--test-timeout=45000'];

/**
 * The arguments `node` is started with: `--test` and the files of the run.
 *
 * `JUNIT=<path>` adds a JUnit report beside the normal output (the reporter that carries `file` and `time` per case, see
 * tools/test-timings.mjs). CI does not ask for one: its matrix is node 22, whose reporter writes no `file` attribute, so
 * the report would weigh nothing. It is how the shard table is re-weighed from a node 24 run (`JUNIT=out.xml npm test`).
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [root]
 * @returns {string[]}
 */
export function runArgs(env = process.env, root = ROOT) {
  const shard = env.SHARD;
  // the reporters must come before the file list: node ignores a --test-reporter after a positional test file
  const reporters = env.JUNIT
    ? ['--test-reporter=spec', '--test-reporter-destination=stdout',
      '--test-reporter=junit', `--test-reporter-destination=${env.JUNIT}`]
    : [];
  if (shard === undefined || shard === '') return ['--test', ...GUARD_FLAGS, ...reporters, ...TEST_FILES];
  if (!/^\d+$/.test(shard) || Number(shard) >= SHARD_COUNT) {
    throw new Error(`SHARD=${shard}: expected 0..${SHARD_COUNT - 1} (or unset for the whole suite)`);
  }
  return ['--test', ...GUARD_FLAGS, ...reporters, ...shardsOf(root).files[Number(shard)]];
}

/**
 * The GitHub check annotations a spec-reporter log implies.
 *
 * A red shard job reports only "Process completed with exit code 1", and the job log needs admin rights on the repo (a
 * fork's `/actions/jobs/<id>/logs` answers 403 without a token), while `/check-runs/<id>/annotations` is public. GitHub
 * turns a `::error file=…,line=…::message` stdout line into one annotation, so the failing test names travel the one
 * channel that stays readable. The spec reporter pairs `test at <file>:<line>:<col>` with the `✖ <name> (12ms)` line.
 * @param {string} out captured spec-reporter output
 * @returns {string[]} the workflow-command lines
 */
export function annotationsFor(out) {
  /** @type {string[]} */
  const lines = [];
  const rows = out.split('\n');
  for (let i = 0; i < rows.length; i++) {
    const at = /^test at (.+?):(\d+):\d+$/.exec(rows[i]);
    if (!at) continue;
    for (let j = i + 1; j < Math.min(i + 4, rows.length); j++) {
      const hit = /^✖ (.+?) \(\d+(?:\.\d+)?ms\)$/.exec(rows[j]);
      if (!hit) continue;
      const file = at[1].trim().replace(/%/g, '%25').replace(/,/g, '%2C');
      const msg = hit[1].replace(/%/g, '%25').replace(/\r?\n/g, ' ');
      lines.push(`::error file=${file},line=${at[2]}::${msg}`);
      break;
    }
  }
  return lines;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const shard = process.env.SHARD;
  const isShard = shard !== undefined && shard !== '';
  if (isShard && (!/^\d+$/.test(shard) || Number(shard) >= SHARD_COUNT)) {
    console.error(`SHARD=${shard}: expected 0..${SHARD_COUNT - 1} (or unset for the whole suite)`);
    process.exit(2);
  }
  if (process.argv.includes('--list')) {
    const files = isShard ? shardsOf(ROOT).files[Number(shard)] : testFileList(ROOT);
    process.stdout.write(files.map((f) => `${f}\n`).join(''));
    process.exit(0);
  }
  // A report that weighs nothing is worse than no report: on node 22 the JUnit reporter writes no file attribute.
  if (process.env.JUNIT && Number(process.versions.node.split('.')[0]) < 24) {
    console.error(`JUNIT=${process.env.JUNIT}: node ${process.versions.node}'s JUnit reporter writes no file attribute, so tools/test-timings.mjs cannot weigh this report (node 24 does)`);
  }
  // CI keeps the child's stdout so a red shard can be annotated (see annotationsFor); everywhere else the runner owns
  // the terminal, as it always has.
  //
  // A pipe is not enough to keep it: --test-force-exit calls process.exit with the reporter's writes still queued on
  // the pipe, and the tail (the failing test block and the summary) is lost — 2026-10-31, shard 0 logged 637 lines that
  // stopped mid-test and no annotation was possible. A regular file's writes are synchronous on POSIX, so the child
  // writes the whole log to a temp file, and this process reads it back after exit to print and annotate.
  const ci = Boolean(process.env.CI);
  const outPath = ci ? path.join(os.tmpdir(), `test-run-${process.pid}.log`) : null;
  const outFd = outPath ? fs.openSync(outPath, 'w') : null;
  const r = spawnSync(process.execPath, runArgs(), ci
    ? { cwd: ROOT, stdio: ['inherit', outFd, 'inherit'] }
    : { cwd: ROOT, stdio: 'inherit' });
  if (outPath) {
    fs.closeSync(outFd);
    const out = fs.readFileSync(outPath, 'utf8');
    fs.unlinkSync(outPath);
    process.stdout.write(out);
    for (const line of annotationsFor(out)) process.stdout.write(`${line}\n`);
    // A child that dies without a summary leaves a red job with nothing to read: name the signal (SIGKILL is the
    // runner's out-of-memory kill) as an annotation, so the next red shard explains itself.
    if (r.status === null || r.signal) {
      process.stdout.write(`::error::node --test ended without a status (signal ${r.signal ?? 'none'}, ${out.length} bytes captured)\n`);
    }
  }
  process.exit(r.status ?? 1);
}
