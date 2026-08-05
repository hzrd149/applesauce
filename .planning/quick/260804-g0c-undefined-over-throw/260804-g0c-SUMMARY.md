---
quick_id: 260804-g0c
slug: undefined-over-throw
description: Return undefined instead of throwing in getHiddenTags and getWalletNotification
date: 2026-08-04
status: complete
tasks_completed: 2
commits:
  - a587410b fix(core) getHiddenTags
  - 06904f4a fix(wallet-connect) getWalletNotification
requirements-completed: []
files_modified:
  - packages/core/src/helpers/hidden-tags.ts
  - packages/core/src/helpers/__tests__/hidden-tags.test.ts
  - packages/wallet-connect/src/helpers/notification.ts
  - packages/wallet-connect/src/helpers/__tests__/notification.test.ts
  - .changeset/hidden-tags-undefined-not-throw.md
  - .changeset/wallet-notification-safe-parse.md
---

# Quick Task 260804-g0c — undefined over throw

Findings #1 and #2 from the throw/undefined review, both the same defect class closed
in `gift-wrap.ts` at 422ce62b: a getter whose return type already includes `| undefined`
throwing on malformed or hostile input instead of returning it.

## What changed

**Task 1 — `getHiddenTags` (`packages/core`)**
- `JSON.parse` → `safeParse`; the `throw new Error("Content is not an array of tags")`
  became `return undefined`.
- Rejection is not cached. Caching it would leave the list permanently unreadable after
  correct content is later decrypted in, and would break `isHiddenTagsUnlocked`, which
  tests `HiddenTagsSymbol` for presence rather than value.
- Removed the now-dead `try {} catch {}` in `isHiddenTagsUnlocked`. Its param is typed so
  `in` cannot throw, and neither `isHiddenContentUnlocked` nor `getHiddenTags` raises.
- JSDoc `@throws` dropped, undefined contract documented.

**Task 2 — `getWalletNotification` (`packages/wallet-connect`)**
- `JSON.parse` → `safeParse`, returning before the memo write.
- `isWalletNotificationUnlocked` KEPT its try/catch — unlike the hidden-tags one it takes
  `notification: any`, so `X in notification` still throws a TypeError on a primitive.
  Comment narrowed to say that is all it now guards.
- `unlockWalletNotification` untouched — imperative unlock, non-optional return.

## Verification

Full monorepo suite: **2444 passed, 2 skipped, 0 failed** (up from 2438 — 6 new tests).

Both fixes proven non-vacuous by revert → RED → restore → GREEN:

| Probe | Result |
|---|---|
| `getHiddenTags` back to `JSON.parse` + throw | 4/4 new core tests fail; other 5 in file still pass |
| `getWalletNotification` back to `JSON.parse` | 2/2 new wallet-connect tests fail |

Each fix has a "not sticky" test proving the rejection is not memoized — feed the same
event valid content afterwards and it resolves normally.

## Notable

`getHiddenTags` was the widest-blast-radius item in the review: all six hidden-* getters
in `applesauce-common` plus `getTokenContent` and `getHistoryContent` delegate to it.

The review's underlying finding was that four guards carried
`// Wrap in try catch to avoid throwing validation errors` — the codebase had patched the
guards rather than the sources. One of those four (`isHiddenTagsUnlocked`) is now deleted
as dead code. `isWalletNotificationUnlocked` survives for an unrelated reason (`any` param).
The remaining two belong to the wallet follow-up below.

## Deviation from workflow

Executed inline rather than spawning `gsd-planner`/`gsd-executor`. The full analysis —
including the `verifiedSymbol`-spread trap and two vacuous-test dead ends found during the
gift-wrap work — was already in context, and handing it to a fresh subagent would have lost
it. All GSD artifacts produced identically.

## Follow-up (out of scope, from the same review)

- **#3** `getNutzapP2PKPubkey` (`wallet/helpers/nutzap.ts:112`) — two throws on hostile
  input; nutzaps come from strangers. Already returns undefined for empty proofs, so it is
  internally inconsistent.
- **#4** `getTokenContent` (`wallet/helpers/tokens.ts:77`) — `JSON.parse` + 2 throws.
- **#5** `getHistoryContent` (`wallet/helpers/history.ts:70`) — 3 throws.

Fixing #4/#5 lets `isTokenContentUnlocked` and `isHistoryContentUnlocked` drop their
defensive catches, making that fix visibly structural.

Also noted during the review: STATE.md's Deferred Items row for `getHiddenGroups`
(memoizing `undefined`) is **stale** — that site was fixed and now carries a D-02/D-03
comment. Drop the row at milestone archive.
