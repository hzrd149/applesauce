---
quick_id: 260804-g7f
slug: wallet-undefined-over-throw
description: Return undefined instead of throwing in wallet token, history and nutzap helpers
date: 2026-08-04
status: complete
tasks_completed: 3
commits:
  - fa828090 fix(wallet) getTokenContent
  - 535c47f3 fix(wallet) getHistoryContent
  - b1e89b55 fix(wallet) getNutzapP2PKPubkey
requirements-completed: []
files_modified:
  - packages/wallet/src/helpers/tokens.ts
  - packages/wallet/src/helpers/history.ts
  - packages/wallet/src/helpers/nutzap.ts
  - packages/wallet/src/helpers/__tests__/tokens.test.ts
  - packages/wallet/src/helpers/__tests__/history.test.ts
  - packages/wallet/src/helpers/__tests__/nutzap.test.ts
  - .changeset/token-content-undefined-not-throw.md
  - .changeset/history-content-undefined-not-throw.md
  - .changeset/nutzap-p2pk-undefined-not-throw.md
---

# Quick Task 260804-g7f — wallet undefined over throw

Findings #3, #4, #5 of the throw/undefined review. Closes the class opened by
`gift-wrap.ts` (422ce62b) and continued in 260804-g0c (#1 `getHiddenTags`,
#2 `getWalletNotification`).

## What changed

**#4 `getTokenContent`** — `JSON.parse` → `safeParse`; `throw` on missing `mint`/`proofs`
→ `return undefined`. Added a shape guard before any property read, which is load-bearing:
`safeParse("null")` yields `null` and `null.mint` throws a TypeError, so without it the fix
would have swapped one throw for another. Deleted `isTokenContentUnlocked`'s try/catch.

**#5 `getHistoryContent`** — three throws (missing direction, missing amount, unparseable
amount) → `return undefined`. Deleted `isHistoryContentUnlocked`'s try/catch, which was
doubly dead: its other call, `getHiddenTags`, stopped throwing in a587410b.

**#3 `getNutzapP2PKPubkey`** — two throws → `return undefined`. The mixed-lock case returns
undefined rather than the first pubkey seen, which would hide the mismatch. Also corrected
`findMatchingPrivateKeyForNutzap`'s JSDoc, which documented a throw that can no longer happen.

All three `unlock*` counterparts still throw and already guarded `if (!x) throw`, so they
kept working unchanged.

## Why this was safe for existing callers

`getTokenContent` had the most exposure — 13 call sites. Every direct dereference of
`.proofs`/`.mint` in `actions/tokens.ts` is gated by `isTokenContentUnlocked`, and that guard
*already* converted the throw into `false` via its own catch. So the filtered sets are
identical before and after; only the mechanism changed. `actions/tokens.ts:680/689` and
`dumbTokenSelection` already checked for undefined explicitly, and both casts were already
written for the undefined contract (`this.meta?.proofs`, and `defined()` after the `map`).

`getNutzapP2PKPubkey` has zero callers in the repo — public API only.

## Verification

Full monorepo suite: **2457 passed, 2 skipped, 0 failed** (up from 2444 — 13 new tests).

Non-vacuity by revert → RED → restore → GREEN, all three at once:

| Probe | Result |
|---|---|
| `getTokenContent` back to `JSON.parse` + throws | 5/5 new tests fail |
| `getHistoryContent` back to 3 throws | 4/4 new tests fail |
| `getNutzapP2PKPubkey` back to 2 throws | 2/2 new tests fail |

Each helper has a "not sticky" test proving the rejection is not memoized, and
`getTokenContent` has an explicit `null` test pinning the shape guard.

## The class is now closed

All five findings are fixed, and the meta-finding behind them is resolved: four guards carried
`// Wrap in try catch to avoid throwing validation errors`, patching the guards rather than the
sources. Three are now deleted as dead code (`isHiddenTagsUnlocked`, `isTokenContentUnlocked`,
`isHistoryContentUnlocked`). The fourth, `isWalletNotificationUnlocked`, survives for an
unrelated reason — its parameter is `any`, so `X in notification` still throws a TypeError on a
primitive; its comment now says that is all it guards.

The repo-wide convention is now consistent: **getters return `undefined`, `unlock*` throws.**

## Deviation from workflow

Executed inline rather than spawning `gsd-planner`/`gsd-executor`, same as 260804-g0c — the
review analysis and call-site audit were already in context. All GSD artifacts produced
identically.

## Carried forward

STATE.md's Deferred Items row for `getHiddenGroups` (memoizing `undefined`) is **stale** — that
site was fixed and carries a D-02/D-03 comment. Drop it at milestone archive. Also worth
dropping: `05.1-review-followups.md`'s WR-03 item, closed by the sentinel fix in 422ce62b.
