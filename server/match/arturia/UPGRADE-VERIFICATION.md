# Arturia v0.2.6 → v0.3.0 local freeze acceptance

## Source and byte identity

- Read-only source Git object: `arturia-v0.3.0` = `b63ec427cddb378fa5bde049eb0358bd35a41a17`; previous freeze `28552feb35915cdd1537c34dc33d9553c9744b9c`.
- Imported raw `git show commit:path` buffers, without newline normalization or invoking the upstream installer. Every imported file was independently read back and SHA-256 matched. All 654 entries declared in upstream release metadata match their hashes.
- Release policy identity: `sha256:010f073287162dcb031907648c330f2f4e4b5f33e7fcad8d6a9b8ef941b88ad1`. The true tag commit is distinct from the release's base-game provenance.
- [upstream.json](upstream.json): actual tag/ref, policyHash, route metadata and complete 657-file SHA-256 map.
- [upgrade-verification.json](upgrade-verification.json): every selected file's SHA-256 and Git blob ID, previous 382-file manifest hashes, added/changed/unchanged lists, nine shared hashes and excluded upstream paths.

| Inventory | Previous | Current | Change |
| --- | ---: | ---: | --- |
| Frozen policy files | 380 | 652 | +272; all old 380 byte-identical |
| Policy + runtime code files | 381 | 653 | +272 |
| Policy + runtime + compatibility | 382 | 654 | +272 |
| Imported release selection including metadata/license/changelog | 384 | 657 | +273, changed 2, unchanged 382, removed 0 |

The two changed selected files are [runtime.js](runtime.js) and [CHANGELOG.md](CHANGELOG.md); the 273 added files are 272 release-two/release-four policy files plus [addon.json](addon.json). [LICENSE](LICENSE) and [compat/settlement.js](compat/settlement.js) are unchanged. The old solo/two/four policy trees are retained in full. The local [README.md](README.md) was updated surgically, not replaced by the upstream README. Build/installer/patch/extended-host materials were not imported or executed.

## Local boundaries and routes

- The original local [index.js](index.js) is unchanged: SHA-256 `bbd33925534b7004047cde66c02aeab957e53d280bbb7ab1d3eff7ac2d06a3c0`. Frozen runtime remains separate from this own-pool wrapper.
- New current policy is selected only for ABYSS cooperative views of exactly two or four seats. Solo, other difficulties, other modes and other seat counts preserve the old branches. The unchanged Pro wrapper scopes expanded rooms to the persona's own pool before runtime dispatch; an eligible two/four-seat subgroup intentionally receives the current policy.
- Shared aiCompute 1.1.0: all nine existing files matched the old manifest, new release manifest and target Git bytes; no shared files were written. No other AI/host/frontend files were modified by this task.
- Host rules, E2 cards, legal actions, persona reservation order and host adapters remain authoritative. No upstream installer, services, browser, golden updates, full-suite scan, deployment, fetch, commit, push or product version edits were performed.

## Import closure

The added [freeze test](../../../test/match/elite-ai-arturia-freeze.test.js) walks runtime imports across all five drivers: **654 frozen modules, 652 policy modules, 2,666 relative import edges**. Every required local/host import resolves. The only missing optional branch is `compat/settlement.js -> ../../../sim/damage.js`: the unchanged shim uses the existing host `sim/attack.js`, and enters the damage fallback only if that attack module itself is absent. JSDoc type imports are not executable imports.

Resolved host boundaries: shared constants/loadoutRecord/summonPlacement; sim attack/body/constants/content devices/enemies/archetypes/garrisons-meta/dir/grid/professions/rng/targeting; match aiCompute cache/forecast/identity/ordered/sampleCache/scopes; board/bondsMeta/finalAssault/gamedata/waves. No dependency on a source checkout, installer or extended-host patch is required at runtime.

## Directed acceptance

Read the match harness, virtual scheduler, fake battle helper and simulation client before running tests. Tests use virtual/fake match computation and disposal; they do not start an HTTP service or browser.

```sh
node --test --test-force-exit test/match/elite-ai-arturia-freeze.test.js test/match/elite-ai.test.js
```

Final result: **14 tests, 14 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo; 1947.0127 ms**, exit 0.

Coverage:
- All 657 imported bytes, release map agreement, all old policies retained, exact 652-file policy inventory, unchanged wrapper/shared runtime, excluded installers.
- Full frozen import closure including the deliberate optional host settlement fallback.
- All 64 combinations of four difficulties × solo/coop × eight seat counts: runtime pick/prep-begin/prep-end/opening routes and policy options; order-count and isSolo fallbacks. Driver sentinels observe unchanged runtime dispatch; actual drivers are tested separately.
- Actual ABYSS two-seat and four-seat Arturia drafting and first deployment with invariants/error checks.
- Expanded 6/7/8/20-seat own-pool view isolation and unchanged host options.
- Existing eight elite regressions, including all three persona reservations, host preparation and 20-seat band/pool boundaries.

Two intermediate runs each reported 13 pass/1 fail while constructing the import-closure assertion: first it treated the intentional optional damage fallback as required; next it treated a JSDoc Match type import as executable. The test was narrowed accordingly, with no frozen source modifications. Final run is green. These tests establish freeze/integration correctness, not complete-match balance, browser behavior, production performance or wins against human players. Upstream benchmark figures in release metadata are not local measured results.

## Handoff

Local authorized scope is complete. Parent/lead owns product display version, announcement/CHANGELOG outside this freeze, broader handoff, and any later independently authorized release actions. The temporary one-shot import script was removed after acceptance; the permanent manifests, evidence and directed regression remain.
