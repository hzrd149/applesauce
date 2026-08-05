---
phase: 12-document-caps-conformance
plan: 11
subsystem: concord-client
tags: [concord, CR-01, WIRE-09, WIRE-10, TEST-01, wire-conformance, non-vacuity]
dependency graph:
  requires: ["12-10"]
  provides: []
  affects: ["packages/concord/src/client/__tests__/community.test.ts"]
tech-stack:
  added: []
  patterns: ["revert-and-observe non-vacuity probe (12.1-01/12.3-06/12.3-10/05-05 precedent)"]
key-files:
  created: []
  modified:
    - packages/concord/src/client/__tests__/community.test.ts
decisions:
  - "The three loose-truthiness `!c.deleted` gates in client/community.ts (publicChannelKeys, reconcileLive's publicIds, reconcilePrivateChannels) are deliberately NOT tightened to strict `=== true` equality — the fold-level invariant landed by 12-10 already makes deleted boolean-or-absent, so duplicating that guarantee into three call sites would only reintroduce the enumerated-patch drift CR-01/WR-01 already exposed."
metrics:
  duration: "~45 minutes"
  completed: "2026-08-01"
status: complete
---

# Phase 12 Plan 11: CR-01 downstream non-vacuity — public and private channel-fold reachability Summary

Proves the downstream half of CR-01's closure: a public or private channel folded from an edition carrying a truthy non-boolean `deleted` remains reachable through `client/community.ts`'s three loose-truthiness gates (`publicChannelKeys()`, `reconcileLive`'s `publicIds`, `reconcilePrivateChannels`), not merely well-shaped at the fold level — while a genuine `deleted: true` is still fully excluded.

## Task 1: The public path — a hostile `deleted` channel is genuinely registered for sync

Added `CR-01: a public channel whose edition carries a non-boolean deleted is still registered as a live stream key, not silently dropped from sync` inside the existing `wire conformance` describe in `packages/concord/src/client/__tests__/community.test.ts`, immediately after the `WIRE-10/D-14 deleteChannel` test.

From `setupWireConformance()`, three public channels (HOSTILE, DEAD, LIVE) are created through the real `community.createChannel(...)` API so each mints real key material. HOSTILE and DEAD each get a chained v2 edition via `computeEditionHash` / `EditionFactory.create` / `publishToPlane` — the exact pattern the `WIRE-10/D-14` test uses — carrying `deleted: "false"` (HOSTILE, the exact 12-REVIEW.md reproduction) or `deleted: true` (DEAD, the discriminating control). LIVE is left untouched at v1.

Assertions, in order:
1. Fold-level shape: HOSTILE present in `state$.value.channels` with no own `deleted` property (v2 adoption confirmed); DEAD absent entirely; LIVE present.
2. Render parity: `channels$` (no `deleted` filter) shows HOSTILE and LIVE, not DEAD.
3. The gate CR-01 names: `publicChannelKeys()`, reached via the file's `as unknown as` private-member convention, includes the expected pubkeys for HOSTILE and LIVE — each read off the derived channel-key map (`this.keys.channels`), a different code path than `publicChannelKeys()` itself.
4. `currentAuthors()` — exactly what `openLive()` dials and registers with `relayAuth` for NIP-42 — contains the HOSTILE pubkey.
5. Genuine-deletion control: the derived channel-key map has no entry for DEAD (it's excluded before `deriveConcordKeys` ever sees it), and DEAD's independently-computed would-be pubkey (via `channelGroupKey` over the public derivation — `community_root`/`root_epoch`, never read off any map) is absent from `currentAuthors()`.

**Verification:** `pnpm --filter applesauce-concord test -- community` — 553 tests passed (this test added alone, before Task 2), test title present verbatim in `--reporter=verbose` output. `pnpm exec tsc --noEmit -p packages/concord/tsconfig.json` exit 0.

**Commit:** `58ebb95e` — `test(12-11): prove hostile deleted channel stays registered for public sync`

## Task 2: The private path — a hostile `deleted` channel keeps its sub-engine, a genuine deletion still disposes it

Added `CR-01: a private channel whose edition carries a non-boolean deleted keeps its sub-engine, while a genuine deletion disposes it` immediately after Task 1's test, inside the same `wire conformance` describe.

From `setupWireConformance()`, two private channels (HOSTILE, DEAD) are created through `community.createChannel(..., { private: true })`. As a setup precondition, both are asserted to already have a live `ConcordPrivateChannel` sub-engine (reached through the file's `as unknown as` convention against the private `privateChannels` map) before either v2 edition is published — a missing engine here would make the rest of the test prove nothing.

HOSTILE gets a chained v2 edition (same `computeEditionHash`/`EditionFactory.create`/`publishToPlane` pattern as Task 1) carrying `deleted: "false"`; adoption is confirmed via the same `hasOwnProperty` check as Task 1, then the engine map is asserted to STILL contain HOSTILE's id — the assertion `reconcilePrivateChannels` (`client/community.ts:830`) makes meaningful, since a truthy string `deleted` would have made it `continue` past the channel and dispose the engine. DEAD then gets a v2 with `deleted: true`; the engine map is asserted to no longer contain DEAD's id, and DEAD is asserted absent from `state$.value.channels` — the discriminating control proving engine retention was not achieved by disabling deletion handling.

**Verification:** `pnpm --filter applesauce-concord test -- community` — 554 tests passed (both this plan's tests present), test title present verbatim in `--reporter=verbose` output. `pnpm exec tsc --noEmit -p packages/concord/tsconfig.json` exit 0. `git status --short` clean after the commit.

**Commit:** `bfd3e8a9` — `test(12-11): prove hostile deleted private channel keeps its sub-engine`

## CR-01 Downstream Non-Vacuity — Revert, RED, Restore, GREEN

Before recording this section, `pnpm --filter applesauce-concord test` was confirmed GREEN at 554 tests with both new tests present and passing (Tasks 1 and 2 above).

**Revert applied** (`packages/concord/src/helpers/control.ts`, replacing the channel loop's fold construction — the block that calls `foldChannelEdition` — with the pre-12-10 destructure-and-rest-spread form, byte-for-byte from commit `48debd59` (the immediate 12-10 predecessor, itself identical to `a8e13299`'s form per 12-10-SUMMARY.md's own P5 probe), leaving this plan's two new tests, the exported rule tables, and every other line of the file untouched):

```ts
// PROBE (12-11 Task 2 non-vacuity): restored the pre-12-10 destructure+spread
// fold body verbatim (from commit 48debd59, the 12-10 predecessor), bypassing
// foldChannelEdition/the rule tables entirely, to prove this plan's two CR-01
// tests are non-vacuous against the pre-fix behavior. TEMPORARY — reverted
// before this task's commit.
for (const cand of authorized) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cand.content);
  } catch {
    continue;
  }
  if (parsed === null || typeof parsed !== "object") continue;
  const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = parsed as Record<string, unknown>;
  if (typeof name !== "string" || typeof isPrivate !== "boolean") continue;
  const meta: ChannelMetadata = { ...rest, channel_id: eid, name, private: isPrivate };
  heads.set(eid, cand.source);
  channels.push(meta);
  break;
}
```

**Command:** `pnpm --filter applesauce-concord exec vitest run --reporter=verbose -- community`

**Verbatim failure summary (trimmed to this plan's two tests):**

```
 Test Files  2 failed | 52 passed (54)
      Tests  8 failed | 546 passed (554)

 FAIL  src/client/__tests__/community.test.ts > wire conformance > CR-01: a public channel whose edition carries a non-boolean deleted is still registered as a live stream key, not silently dropped from sync
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/client/__tests__/community.test.ts:1783:77
    1781|     const foldedHostile = community.state$.value.channels.find((c) => …
    1782|     expect(foldedHostile).toBeDefined();
    1783|     expect(Object.prototype.hasOwnProperty.call(foldedHostile!, "delet…
       |                                                                             ^
    1784|     expect(community.state$.value.channels.some((c) => c.channel_id ==…

 FAIL  src/client/__tests__/community.test.ts > wire conformance > CR-01: a private channel whose edition carries a non-boolean deleted keeps its sub-engine, while a genuine deletion disposes it
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/client/__tests__/community.test.ts:1864:77
    1862|     const foldedHostile = community.state$.value.channels.find((c) => …
    1863|     expect(foldedHostile).toBeDefined();
    1864|     expect(Object.prototype.hasOwnProperty.call(foldedHostile!, "delet…
       |                                                                             ^
    1865|
    1866|     // The gate CR-01's third path names: with a truthy string `delete…
```

**Result:** Both of this plan's tests went RED, confirming non-vacuity. Six other tests (`control.test.ts` Tests B, G, H, I, J, K) also went RED as an expected consequence of the same reversion — these are 12-10's own regression coverage over the same fold body and are recorded here only as corroborating context, not as this plan's claim.

**Recorded divergence from the plan's predicted failure point (not a defect).** The plan's Task 2 action text predicts "Task 1's on the `publicChannelKeys()` assertion, Task 2's on the surviving-engine assertion". What actually failed for BOTH tests is an earlier assertion — step 1's `Object.prototype.hasOwnProperty.call(foldedHostile!, "deleted")).toBe(false)` (public test line 1783, private test line 1864). The mechanism is the same regression, observed one step earlier than predicted: the pre-12-10 fold's denylist-then-spread form only strips `key`/`epoch`, so a hostile `deleted: "false"` survives as an own property on the folded `ChannelMetadata` via `...rest` — under the FIXED fold, the same field fails `isBooleanValue`'s guard and (being `optional`) is silently omitted instead. Because each test's step-1 fold-shape assertion checks for that omission before reaching `publicChannelKeys()`/the engine map, `expect().toBe()` throws there first and the test never reaches the later assertion the plan named. This does not weaken the non-vacuity proof — both a fold-shape divergence and a gate-reachability divergence are real, correlated consequences of the same pre-fix behavior, and vitest's fail-fast semantics simply surface the earlier one. Had the fold-shape assertions been removed, the tests would still go RED at the `publicChannelKeys()`/engine-map assertions exactly as the plan predicted, since the pre-fix HOSTILE channel's `deleted: "false"` is truthy and every one of the three loose-truthiness gates (`!c.deleted`) would exclude it identically to the fixed build's boolean `true` case.

**Restore:** `git checkout -- packages/concord/src/helpers/control.ts`. Confirmed `git status --short packages/concord/src/helpers/control.ts` printed nothing (byte-identical to HEAD, no diff to restore).

**Re-run, GREEN:**

```
$ pnpm --filter applesauce-concord exec vitest run -- community
 Test Files  54 passed (54)
      Tests  554 passed (554)
```

## Final Gate

```
$ pnpm --filter applesauce-concord test
 Test Files  54 passed (54)
      Tests  554 passed (554)

$ pnpm exec tsc --noEmit -p packages/concord/tsconfig.json
(no output — exit 0)

$ pnpm --filter applesauce-concord build
$ rimraf dist
$ tsc
(exit 0)

$ pnpm -r test
Scope: 18 of 19 workspace projects
... every package with a `test` script passes (packages/core 671, common, accounts,
    actions, content, loaders, relay, sqlite, wallet-connect, wallet, react, concord
    554, etc.) — `applesauce-examples` has no `test` script and is out of this
    scope, consistent with 12-10-SUMMARY.md's finding.
EXIT: 0
```

`git status --short` after the plan's commits: clean except this SUMMARY (added) and the two test commits already landed.

## Deliberate Design Decision — the three `client/community.ts` gates are NOT tightened to `=== true`

Per the plan's explicit design note and prohibition, none of `publicChannelKeys()` (`:757`), `reconcileLive`'s `publicIds` (`:807`), or `reconcilePrivateChannels` (`:830`) were rewritten from their existing loose-truthiness `!c.deleted` predicate to strict `c.deleted !== true`. This was a deliberate choice, not an oversight:

- After 12-10, the fold guarantees `deleted` on a folded `ChannelMetadata` is always boolean-or-absent (`CHANNEL_METADATA_FOLD_RULES`'s `isBooleanValue` guard, optional disposition). Given that invariant, `!c.deleted` and `c.deleted !== true` are equivalent for every value the fold can ever produce — tightening the gates would add no new correctness, only duplicate the guarantee.
- Moving the guarantee into three (or four, counting `channels$`'s absence of any filter) separate call sites is exactly the enumerated-patch shape this phase has already been bitten by twice (CR-01 itself, and WR-01's `held` omission from the old denylist) — one place governing every present and future consumer is structurally safer than three places that can independently drift.
- This plan's two tests exist specifically to prove the fold-level invariant actually reaches these gates, rather than to change the gates themselves. `git diff` for both of this plan's commits touches only `packages/concord/src/client/__tests__/community.test.ts` — no implementation file.

## Deviations from Plan

### Auto-fixed Issues

None — this plan adds only test code; no source file was modified to make either test pass.

### Recorded divergences from plan prose (not defects)

1. **The non-vacuity revert probe's predicted failure point differs from the observed one**, documented in full under "CR-01 Downstream Non-Vacuity" above: both tests failed one assertion earlier (the fold-shape `hasOwnProperty` check) than the plan's prose anticipated (the `publicChannelKeys()`/engine-map assertion), for the reason given there. Both failure points are genuine consequences of the same pre-fix regression; the mechanism proven is unchanged.

No other divergence from the plan's task actions, acceptance criteria, or prohibitions was found.

## Self-Check

- `packages/concord/src/client/__tests__/community.test.ts` — FOUND, contains both new `it()` blocks (confirmed via `grep -n "CR-01:" packages/concord/src/client/__tests__/community.test.ts`).
- Commit `58ebb95e` (Task 1) — `git log --oneline --all | grep -q 58ebb95e` → FOUND.
- Commit `bfd3e8a9` (Task 2) — `git log --oneline --all | grep -q bfd3e8a9` → FOUND.
- This plan's own commit range (`git diff --name-only 58ebb95e~1..bfd3e8a9`) touches exactly one file: `packages/concord/src/client/__tests__/community.test.ts`. Neither `packages/concord/src/client/community.ts` nor `packages/concord/src/helpers/control.ts` appears — no implementation file was modified by this plan.
- `packages/concord/src/helpers/control.ts` — restored byte-identical to HEAD after the non-vacuity probe (`git status --short` prints nothing for it).
- No `.changeset/` file added by this plan (`git diff --name-only 58ebb95e~1..bfd3e8a9 -- .changeset/` prints nothing).
- Final gate — `pnpm --filter applesauce-concord test` (554/554), `tsc --noEmit` (exit 0), `pnpm --filter applesauce-concord build` (exit 0), `pnpm -r test` (exit 0) — all CONFIRMED, transcripts above.

## Self-Check: PASSED
