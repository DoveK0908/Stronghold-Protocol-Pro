#!/usr/bin/env node
// mods/<overlay>/apply.mjs — 把一份外挂式 overlay 叠加到基线工作树上 / 从工作树里撤回。
//
// 本文件是**通用**的：同一份代码在 mods/sakiko/ 与 mods/sandbox/ 下各有一份副本，行为只由
// 自己所在目录里的 patches/ / files/ / replaces/ 决定，名字与说明从目录名推出来。
//
// 设计目标：**对上游更新零影响**。
//   · 本 overlay 自己的文件（mods/<overlay>/**）是唯一被提交的东西；
//   · 它对外部文件的改动以「锚点式补丁」的形式存放（patches/*.patch.json），不是整文件覆盖 ——
//     所以上游改了同一个文件时，只要锚点还在，补丁照样能打；锚点没了就**响亮地报冲突**，绝不静默改错。
//   · 生成物（压成一行的 JSON 之类）锚点表达不了，走 replaces/ 整份快照替换；
//   · 应用后的状态只留在工作树里（未提交），`--revert` 一条命令回到干净基线。
//
// 用法（把 <overlay> 换成 sakiko / sandbox）：
//   node mods/<overlay>/apply.mjs              # 应用（幂等：已应用的补丁跳过）
//   node mods/<overlay>/apply.mjs --check      # 只检查能不能应用，不写任何文件
//   node mods/<overlay>/apply.mjs --revert     # 撤回：git checkout 被改的文件 + 删掉新增的文件
//   node mods/<overlay>/apply.mjs --json       # 机器可读输出
//
// 多个 overlay 可以同时应用，互不干扰（各自只管自己列出的文件）。
//
// 退出码：0 = 全部成功 / 1 = 有冲突或错误

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// 目标根：默认是**本仓库根**（StrongholdPro/）。但 overlay 要打的不一定在本仓库里 —— `mods/luck/` 打的是
// `source/luck/`（一个上游克隆，另一个 git 仓库）。所以允许在 overlay 目录里放一份 `target.json`：
//     { "root": "../source/luck" }        ← 相对 overlay 目录解析
// 补丁里的 `file` 一律**相对于目标根**。没有这个文件就是默认行为（对老 overlay 完全无影响）。
const TARGET_CFG = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(HERE, 'target.json'), 'utf8')); } catch { return null; }
})();
const ROOT_OVERRIDE = TARGET_CFG && typeof TARGET_CFG.root === 'string' ? TARGET_CFG.root.trim() : '';
const ROOT = ROOT_OVERRIDE ? path.resolve(HERE, ROOT_OVERRIDE) : path.resolve(HERE, '..', '..');

// `files/` 里装的是「overlay 自己新增的文件」（纯净基线里没有）。判这句话要用 git 本身，见 inBaseRef。
// 基线分支名可以从 `target.json` 的 `baseRef` 给；没给就试 master / main；两个都没有就当作认不出。
const BASE_REF = (() => {
  const want = TARGET_CFG && typeof TARGET_CFG.baseRef === 'string' ? TARGET_CFG.baseRef.trim() : '';
  for (const ref of (want ? [want] : ['master', 'main'])) {
    try {
      execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { stdio: 'ignore' });
      return ref;
    } catch { /* 换下一个 */ }
  }
  return null;
})();
const PATCH_DIR = path.join(HERE, 'patches');
const FILES_DIR = path.join(HERE, 'files');
const REPLACES_DIR = path.join(HERE, 'replaces');

// overlay 自己的名字：目录名 + 一句人话标题（新增 overlay 时在这里补一行即可）
const OVERLAY = path.basename(HERE);
const OVERLAY_LABELS = Object.freeze({
  sakiko: '丰川祥子自选干员',
  sandbox: '干员技能试验台',
  luck: 'Stronghold-Luck 控制台',
});
const OVERLAY_LABEL = OVERLAY_LABELS[OVERLAY] ?? OVERLAY;

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
const REVERT = argv.includes('--revert');
const JSON_OUT = argv.includes('--json');
/**
 * `--force-files`：允许 `files/**` 覆盖**被 git 跟踪**的目标。
 *
 * 为什么需要它：本项目的约定是 overlay 与应用态**一起提交**。应用态一进提交，
 * `files/**` 的目标就成了「被跟踪的文件」，默认判据会拒绝覆盖 ——
 * 于是「改了 `files/` 却同步不到工作树」变成静默失败（`--check` 报 conflict，很容易被当成噪音忽略）。
 * 开发本 overlay 时用它同步；**验证「纯净基线 + 一键 apply」时不要用它**（那条路上目标本来就不存在）。
 */
const FORCE_FILES = argv.includes('--force-files');

// ─────────────────────────────────────────────────────────── 工具

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** 读文件；不存在返回 null */
function readOrNull(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/** 原子写（tmp + rename），避免半截文件 */
function writeAtomic(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.modtmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, p);
}

/** 数 needle 在 hay 里出现几次（按字面，不用正则） */
function countOccurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) {
    const j = hay.indexOf(needle, i);
    if (j === -1) return n;
    n++; i = j + needle.length;
  }
}

/**
 * 两个文本是否「内容相同」——忽略 BOM 与行尾差异。
 * 为什么需要它：overlay 里的源文件是 LF，而工作树里的副本可能被工具写成 CRLF
 * （本项目真的踩过：三份 `*.test.js.overlay` 与工作树逐行相同，只差每行一个 CR，
 * 于是 `checkAddition` 判成 `conflict-tracked` 并把整份补丁集标成「需人工重锚」）。
 * 判「已应用」只该看内容，不该看行尾。
 */
function sameText(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const norm = (s) => s.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return norm(a) === norm(b);
}

// ── 行尾：补丁一律按 LF 书写，落盘时还原目标文件原本的行尾 ───────────────────────────────────────────
// 为什么必须这样：`git` 里存的是 LF，工作树里是什么由目标仓库的 `.gitattributes` 与本机 `core.autocrlf`
// 决定。本项目已经为此踩过两次坑（三份 `*.test.js.overlay` 是 CRLF 而 `.gitattributes` 规定 LF；
// 而 `source/luck` 既没有 `.gitattributes` 又开着 `core.autocrlf=true`，整棵树都是 CRLF）。
// 在归一化成 LF 的文本上匹配、替换，写回时再改回文件原来的行尾 ⇒ 同一份补丁在 autocrlf 开/关的
// 机器上都成立，也不会把整棵树的行尾悄悄改掉。
const toLf = (s) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const eolOf = (s) => (s.includes('\r\n') ? '\r\n' : '\n');
const withEol = (s, eol) => (eol === '\r\n' ? s.replace(/\n/g, '\r\n') : s);

/**
 * 这个路径是否被 git 跟踪。
 *
 * 在**文件自己所在的目录**里问 git，而不是在 ROOT 里 —— `mods/luck/` 的目标是另一个仓库
 * （`source/luck`），拿外层仓库的 `ls-files` 问一个 `../source/luck/...` 的路径永远问不出来，
 * 于是 `files/` 的「拒绝覆盖被跟踪文件」那道闸门会被静默绕过（把上游 git 文件当新文件覆盖掉）。
 * `git -C <目录> ls-files --error-unmatch -- <文件名>` 在任意子目录都成立。
 */
function isTracked(relPath) {
  const abs = path.resolve(ROOT, relPath);
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  if (!fs.existsSync(abs)) return false;
  try {
    execFileSync('git', ['-C', dir, 'ls-files', '--error-unmatch', '--', base], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/**
 * 这个路径在**纯净基线分支**里存在吗。
 *
 * 为什么需要它：`files/` 装的是「overlay 自己新增的文件」—— 基线里没有它们。可这类文件一旦跟着
 * mod 分支提交过一次，`git` 就认为它「被跟踪」了；之后再改 overlay 源、再 apply，会被
 * `conflict-tracked` 拦住 —— 明明是自己的文件，却要记得手加 `--force-files`，很容易忘，
 * 而忘掉的后果是「以为应用成功了，其实没写」。
 *
 * 判据交给 git：基线里没有、当前却跟踪着的，只可能是本 overlay 加进去的 ⇒ 允许覆盖。
 * 基线里本来就有的（上游的文件）仍然拒绝 —— 那必须走 `replaces/`，这道闸门是有意留的。
 */
function inBaseRef(relPath) {
  if (!BASE_REF) return true; // 认不出基线分支：保守当成上游文件，继续拒绝
  const abs = path.resolve(ROOT, relPath);
  try {
    const top = execFileSync('git', ['-C', path.dirname(abs), 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const rel = path.relative(top, abs).split(path.sep).join('/');
    execFileSync('git', ['-C', top, 'cat-file', '-e', `${BASE_REF}:${rel}`], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

/** 递归列出目录下所有文件（相对该目录） */
function walk(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

// ─────────────────────────────────────────────────────────── 载入 overlay

function loadPatches() {
  const names = fs.existsSync(PATCH_DIR)
    ? fs.readdirSync(PATCH_DIR).filter((f) => f.endsWith('.patch.json')).sort()
    : [];
  // 跨补丁的重复锚点同样不安全 —— 两个补丁都往同一个 `find` 前插入时，第二个的插入位置有歧义，
  // 而且两个 `already` 判据会互相破坏，反复运行就反复插入。
  // 真实事故：C10b 与 C11a 都锚在 `export function pickUnitSfx(banks, opts = {}) {`，
  // 于是 `PROJECTILE_SFX_BANKS` 被插了四份，`node --check` 报 `already declared`。
  const seenGlobal = new Map();
  return names.map((name) => {
    const spec = JSON.parse(fs.readFileSync(path.join(PATCH_DIR, name), 'utf8'));
    validatePatch(name, spec);
    for (const h of spec.hunks || []) {
      const owner = `${name}#${h.id || '(unnamed)'}`;
      const prev = seenGlobal.get(h.find);
      if (prev) {
        throw new Error(
          `跨补丁的重复 find 锚点：${owner} 与 ${prev} 用了**完全相同**的锚点。\n` +
          '两个补丁都往同一个锚点前插入时，第二个的插入位置有歧义，`already` 判据也会失效，' +
          '反复运行就会反复插入。请把它们合并成一个补丁（一个 hunk）。',
        );
      }
      seenGlobal.set(h.find, owner);
    }
    return { name, ...spec };
  });
}

// 一个补丁里两个 hunk 共用同一个 `find` 锚点是**不安全**的：
// 第一个 hunk 应用后会把新文本插在锚点之前，于是第二个 hunk 的 `replace` 不再与锚点相邻，
// 下一次运行时第一个 hunk 又会判成 will-apply 并**重复插入**（真实事故：C9 让 `skillSfxUrl`
// 声明了两次，报 `SyntaxError: Identifier 'skillSfxUrl' has already been declared`）。
// 正确写法是把它们合并成一个 hunk，或让后一个的 find 锚在前一个的 replace 尾巴上。
function validatePatch(name, spec) {
  const seen = new Map();
  for (const h of spec.hunks || []) {
    const id = h.id || '(unnamed)';
    if (typeof h.find !== 'string' || typeof h.replace !== 'string') {
      throw new Error(`${name}: hunk ${id} 的 find / replace 必须是字符串`);
    }
    if (seen.has(h.find)) {
      throw new Error(
        `${name}: hunk ${seen.get(h.find)} 与 ${id} 使用了**完全相同**的 find 锚点 —— ` +
        '这会让第二次运行重复插入。请把它们合并成一个 hunk，或让后一个锚在前一个 replace 的尾部。',
      );
    }
    seen.set(h.find, id);
  }
}

// Stored verbatim files live under files/ and mirror the repo layout. A stored name ending in `.overlay`
// is copied WITHOUT that suffix. Reason: the overlay keeps its ported test sources under test/**, and
// `node --test` discovers every `*.test.js` AND every `.js` under a `test/` directory anywhere in the
// tree — without the suffix the stored copies would be picked up a second time, from mods/, where their
// relative imports do not resolve and they would fail. (`npm run ci` would then be red for no good reason.)
const STORED_SUFFIX = '.overlay';

function loadAdditions() {
  return walk(FILES_DIR).map((r) => {
    const to = r.endsWith(STORED_SUFFIX) ? r.slice(0, -STORED_SUFFIX.length) : r;
    // A stored file whose name is only the suffix would map to an empty/odd target and, before this guard,
    // silently renamed a whole directory over itself. Refuse loudly.
    if (!to || to.endsWith('/')) {
      throw new Error(`files/${r}: 存储名去掉 "${STORED_SUFFIX}" 后不是有效路径 —— 请检查文件名。`);
    }
    return { from: path.join(FILES_DIR, r), to };
  });
}

// `replaces/` holds files that MAY overwrite a git-tracked target — the generated data snapshots
// (`data/assets.json`, `data/backups.json`). They cannot be expressed as anchor patches: both are written
// minified, so a one-byte change makes the whole megabyte a single hunk. `files/` still refuses tracked
// targets on purpose (a typo there would silently clobber upstream source); this second directory makes the
// few deliberate snapshot overwrites explicit, and `--revert` restores them with `git checkout --`.
function loadReplaces() {
  return walk(REPLACES_DIR).map((r) => {
    if (!r || r.endsWith('/')) throw new Error(`replaces/${r}: 不是有效路径 —— 请检查文件名。`);
    return { from: path.join(REPLACES_DIR, r), to: r };
  });
}

// ─────────────────────────────────────────────────────────── check / apply

// `baseText` lets several patches that share one file compose: main() threads the previous patch's
// output back in, so `tools/assets/audio.mjs` (patched by more than one file) is not silently
// clobbered — reading each patch's base fresh from disk meant "last writer wins" and the earlier
// patch's hunks vanished while `--check` still reported them as applied.
function checkPatch(spec, baseText) {
  const abs = path.join(ROOT, spec.file);
  const before = baseText === undefined ? readOrNull(abs) : baseText;
  const result = { file: spec.file, about: spec.about || '', status: 'ok', hunks: [], notes: [] };

  if (before === null) {
    result.status = 'missing-file';
    result.notes.push(`文件不存在：${spec.file}`);
    return result;
  }

  // 匹配与替换都在归一化成 LF 的文本上做；`_after` 落盘前再还原成文件原本的行尾。
  const eol = eolOf(before);
  const base = toLf(before);
  let text = base;
  for (const h of spec.hunks) {
    const entry = { id: h.id || '(unnamed)', state: 'ok' };
    const find = toLf(h.find);
    const repl = h.replace === undefined ? h.replace : toLf(h.replace);
    const already = repl !== undefined && text.includes(repl);
    if (already) {
      entry.state = 'already';
    } else {
      const n = countOccurrences(text, find);
      if (n === 1) {
        entry.state = 'will-apply';
        text = text.replace(find, repl);
      } else if (n === 0) {
        entry.state = 'conflict-anchor-missing';
        result.status = 'conflict';
      } else {
        entry.state = `conflict-anchor-ambiguous(${n})`;
        result.status = 'conflict';
      }
    }
    result.hunks.push(entry);
  }
  result.changed = text !== base;
  result._after = withEol(text, eol);
  return result;
}

function checkAddition(add, allowTracked = false) {
  const abs = path.join(ROOT, add.to);
  const want = fs.readFileSync(add.from, 'utf8');
  const have = readOrNull(abs);
  if (sameText(have, want)) return { file: add.to, status: 'already' };
  if (have === null) return { file: add.to, status: 'will-add' };
  if (isTracked(add.to)) {
    // 基线里没有它 ⇒ 这正是本 overlay 自己加的文件，只是跟着 mod 分支提交过了
    if (!inBaseRef(add.to)) return { file: add.to, status: 'will-replace-own', note: '本 overlay 自己新增的文件（基线里没有），随分支提交后仍可更新' };
    if (!allowTracked) return { file: add.to, status: 'conflict-tracked', note: '目标是被 git 跟踪的上游文件，拒绝覆盖（要覆盖就放进 replaces/）' };
    return { file: add.to, status: 'will-replace-tracked' };
  }
  return { file: add.to, status: 'will-overwrite-untracked' };
}

// ─────────────────────────────────────────────────────────── revert

function revert(patches, additions, replaces) {
  const report = { restored: [], removed: [], skipped: [] };
  for (const spec of patches) {
    const abs = path.join(ROOT, spec.file);
    if (!fs.existsSync(abs)) continue;
    if (!isTracked(spec.file)) { report.skipped.push(`${spec.file}（未被 git 跟踪，跳过还原）`); continue; }
    execFileSync('git', ['-C', ROOT, 'checkout', '--', spec.file]);
    report.restored.push(spec.file);
  }
  // Snapshot overwrites: a tracked target goes back to HEAD; an ignored/untracked one is removed, but only
  // when it still holds exactly what the overlay put there (a file the user edited in between is kept).
  for (const rep of replaces) {
    const abs = path.join(ROOT, rep.to);
    if (!fs.existsSync(abs)) continue;
    if (isTracked(rep.to)) {
      execFileSync('git', ['-C', ROOT, 'checkout', '--', rep.to]);
      report.restored.push(rep.to);
      continue;
    }
    if (!sameText(fs.readFileSync(abs, 'utf8'), fs.readFileSync(rep.from, 'utf8'))) {
      report.skipped.push(`${rep.to}（内容与 overlay 不符，已改动过，不删）`);
      continue;
    }
    fs.rmSync(abs);
    report.removed.push(rep.to);
  }
  for (const add of additions) {
    const abs = path.join(ROOT, add.to);
    if (!fs.existsSync(abs)) continue;
    const want = fs.readFileSync(add.from, 'utf8');
    const have = fs.readFileSync(abs, 'utf8');
    if (!sameText(have, want)) { report.skipped.push(`${add.to}（内容与 overlay 不符，已改动过，不删）`); continue; }
    if (isTracked(add.to)) { report.skipped.push(`${add.to}（被 git 跟踪，不删）`); continue; }
    fs.rmSync(abs);
    report.removed.push(add.to);
  }
  return report;
}

// ─────────────────────────────────────────────────────────── main

function main() {
  const patches = loadPatches();
  const additions = loadAdditions();
  const replaces = loadReplaces();

  if (REVERT) {
    const r = revert(patches, additions, replaces);
    if (JSON_OUT) { console.log(JSON.stringify({ action: 'revert', ...r }, null, 2)); return 0; }
    console.log(`撤回 ${OVERLAY_LABEL} overlay：`);
    console.log(`  还原 ${r.restored.length} 个被改文件：`);
    for (const f of r.restored) console.log(`    - ${f}`);
    console.log(`  删除 ${r.removed.length} 个新增文件：`);
    for (const f of r.removed) console.log(`    - ${f}`);
    if (r.skipped.length) { console.log(`  跳过 ${r.skipped.length} 项：`); for (const f of r.skipped) console.log(`    ! ${f}`); }
    return 0;
  }

  // Patches that share one file must COMPOSE: thread each patch's output into the next one's input,
  // then write each file once. Reading every base fresh from disk made it "last writer wins" — C12's
  // ten hunks for `public/js/audio.js` were silently dropped behind C9's, while `--check` still
  // reported C9 `already` and looked healthy.
  const pResults = [];
  const threaded = new Map();
  for (const spec of patches) {
    const r = checkPatch(spec, threaded.get(spec.file));
    if (r._after !== undefined) threaded.set(spec.file, r._after);
    pResults.push(r);
  }
  const aResults = additions.map((a) => checkAddition(a, FORCE_FILES));
  const rResults = replaces.map((a) => checkAddition(a, true));
  const conflicts = [
    ...pResults.filter((r) => r.status === 'conflict' || r.status === 'missing-file'),
    ...aResults.filter((r) => r.status.startsWith('conflict')),
    ...rResults.filter((r) => r.status.startsWith('conflict')),
  ];

  if (!CHECK) {
    const finalText = new Map();
    const dirty = new Set();
    for (const r of pResults) {
      if (r._after === undefined) continue;
      finalText.set(r.file, r._after);
      if (r.changed) dirty.add(r.file);
    }
    for (const [file, text] of finalText) if (dirty.has(file)) writeAtomic(path.join(ROOT, file), text);
    for (const r of [...aResults, ...rResults]) {
      if (r.status === 'will-add' || r.status === 'will-overwrite-untracked' || r.status === 'will-replace-tracked' || r.status === 'will-replace-own') {
        const add = [...additions, ...replaces].find((a) => a.to === r.file);
        writeAtomic(path.join(ROOT, add.to), fs.readFileSync(add.from, 'utf8'));
      }
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ action: CHECK ? 'check' : 'apply', patches: pResults.map(({ _after, ...r }) => r), additions: aResults, replaces: rResults, conflicts: conflicts.length }, null, 2));
    return conflicts.length ? 1 : 0;
  }

  console.log(`${OVERLAY_LABEL} overlay ${CHECK ? '【检查模式，未写任何文件】' : '【已应用】'}`);
  console.log('');
  console.log(`补丁（${pResults.length} 个文件）：`);
  for (const r of pResults) {
    const marks = r.hunks.map((h) => `${h.id}=${h.state}`).join(' ');
    const flag = r.status === 'ok' ? 'ok  ' : 'CONF';
    console.log(`  [${flag}] ${r.file}`);
    console.log(`         ${marks}`);
  }
  console.log('');
  console.log(`新增文件（${aResults.length} 个）：`);
  const byStatus = {};
  for (const r of aResults) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  for (const [s, n] of Object.entries(byStatus)) console.log(`  ${s}: ${n}`);

  console.log('');
  console.log(`快照替换（${rResults.length} 个，会覆盖被 git 跟踪的生成物）：`);
  for (const r of rResults) console.log(`  [${r.status}] ${r.file}${r.note ? `  (${r.note})` : ''}`);

  if (conflicts.length) {
    console.log('');
    console.log(`!! ${conflicts.length} 处冲突 —— 上游很可能改动了锚点，需要人工重锚：`);
    for (const r of conflicts) {
      console.log(`  ${r.file}${r.note ? `  (${r.note})` : ''}`);
      for (const h of r.hunks || []) if (h.state.startsWith('conflict')) console.log(`      - ${h.id}: ${h.state}`);
    }
    return 1;
  }
  console.log('');
  console.log('全部通过，无冲突。');
  return 0;
}

process.exit(main());
