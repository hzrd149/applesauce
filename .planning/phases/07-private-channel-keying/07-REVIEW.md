---
phase: 07-private-channel-keying
reviewed: 2026-07-17T19:29:48Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - packages/concord/src/types.ts
  - packages/concord/src/helpers/community.ts
  - packages/concord/src/helpers/keys.ts
  - packages/concord/src/helpers/control.ts
  - packages/concord/src/client/community.ts
  - apps/examples/src/examples/concord/admin-management.tsx
  - packages/concord/src/helpers/__tests__/keys.test.ts
  - packages/concord/src/helpers/__tests__/control.test.ts
  - packages/concord/src/client/__tests__/community.test.ts
  - packages/concord/src/__tests__/exports.test.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 07: Code Review Report

**Reviewed:** 2026-07-17T19:29:48Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

The core single-source-of-truth refactor is sound: `channelSecret`/`channelKeyFor`/`voiceKeysFor`/`deriveKeys` (`helpers/community.ts`) and `channelKeyMemo`/`deriveConcordKeys` (`helpers/keys.ts`) are correctly total over the private branch — a keyless private channel derives `null` at every layer, never falls through to the public `community_root` formula, and never produces a `keys.channels`/`channelEpochs`/`planes` entry. `foldControl`'s rewritten channel loop (`helpers/control.ts`) picks `name`/`private`/`deleted`/`voice`/`custom` explicitly with type checks, never reads `key`/`epoch` from edition JSON, and the sticky-delete scan derives both `heads.set` and the push/skip decision from one pass over `authorized` candidates — traced through by hand against the CHAN-07 test's create→delete→resurrect→compact→fresh-fold scenario and it holds up (an unauthorized deletion is correctly ignored; a legitimate one permanently pins `heads`). The `keys.test.ts`/`control.test.ts` additions genuinely compute expected values only from `crypto.ts` primitives (verified by grep: no case uses `channelKeyFor`/`deriveConcordKeys`/`channelKeyMemo` in an *expected*-value position) and the CHAN-01 case asserts absence rather than a public-address collision, as required. `channels$`'s `materialChanged$` plumbing (`client/community.ts`) is wired correctly at all four mutation sites, in the correct order relative to `this.keys` reassignment, so the reactivity-gap fix is real (traced the RxJS synchronous-emission path by hand). Full package suite (211/211) passes.

Two gaps are worth fixing before calling this closed: the new `MissingChannelKeyError` guard only covers `sendMessage`/`sendEvent`, leaving several other channel-plane write paths to surface the generic, non-`instanceof`-catchable backstop error for the exact scenario the guard exists to distinguish; and `deriveConcordKeys`'s channel loop does a second, redundant `material.channels.find(...)` that duplicates work `channelKeyMemo` already did, which is a duplication/maintenance risk rather than a live bug today.

## Warnings

### WR-01: CHAN-02's typed guard doesn't cover every channel-plane write path

**File:** `packages/concord/src/client/community.ts:886-920` (`sendThread`, `replyToThread`, `react`, `editMessage`, `deleteMessage`)
**Issue:** `requireChannelKey` (the `MissingChannelKeyError` guard) is only called from `sendMessage` (:849) and `sendEvent` (:835). `sendThread`, `replyToThread`, `react`, `editMessage`, and `deleteMessage` are separate entry points that also `bindToChannel(...)` + `publishToPlane({ plane: "channel", channelId }, ...)` directly, without going through `sendEvent`/the guard. For a known-but-keyless private channel, these five methods will instead surface `planeKeyFor`'s generic `Error("unknown channel")` (`helpers/keys.ts:221`) — not `instanceof MissingChannelKeyError` — which is precisely the "indistinguishable from a truly-unknown id" failure mode CHAN-02/D-06 was written to close. This doesn't leak any key material (the underlying `keys.channels` map still has no entry, so no wrong-plane send occurs — Plan 01's total derivation still fails closed), but it means a consuming app that `instanceof`-catches `MissingChannelKeyError` to disable reactions/edits/deletes/thread-replies on a channel it lost access to will instead see an uncaught generic `Error`.
**Fix:** Route these five methods through the same `requireChannelKey(channelId)` guard (or better, through `sendEvent`, which already does the `bindToChannel` + `publishToPlane` work) so every channel-plane send path throws the same typed, catchable error:
```ts
async react(channelId: string, target: { id: string; author: string }, reaction: string | Emoji): Promise<void> {
  this.requireChannelKey(channelId);
  const epoch = this.channelEpoch(channelId);
  ...
}
```

### WR-02: Redundant, divergence-prone duplicate lookup in `deriveConcordKeys`'s channel loop

**File:** `packages/concord/src/helpers/keys.ts:181-189`
**Issue:** `channelKeyMemo(material, ch)` (called on line 182) already looks up `material.channels.find((c) => c.id === channel.channel_id)` internally to build its cache signature and derive the key. Line 184 repeats the identical lookup (`material.channels.find((c) => c.id === ch.channel_id)`) just to source `channelEpochs`. Both lookups target the same array/id within the same call so they can't disagree today, but the duplication means a future edit to one private-branch condition (e.g. adding a filter, changing `.find` to something else) without updating the other would silently desynchronize the derived key from the recorded epoch — exactly the class of bug CHAN-03 was written to close.
**Fix:** Have `channelKeyMemo` return the resolved `held` entry (or epoch) alongside the `GroupKey`, or factor the lookup into a small shared helper both call:
```ts
function heldChannelKey(material: JoinMaterial, channelId: string) {
  return material.channels.find((c) => c.id === channelId);
}
```

## Info

### IN-01: `custom` field validation in `foldControl` accepts arrays, not just objects

**File:** `packages/concord/src/helpers/control.ts:277`
**Issue:** `raw.custom !== null && typeof raw.custom === "object"` is true for arrays (`typeof [] === "object"`), so an edition with `"custom": [1,2,3]` folds into `ChannelMetadata.custom`, which is typed `Record<string, unknown>`. This is looser than the "explicit type validation" CHAN-04 calls for, though it doesn't crash the fold or leak key material.
**Fix:** `!Array.isArray(raw.custom) && typeof raw.custom === "object" && raw.custom !== null`.

### IN-02: No test exercises the multi-simultaneous-deletion tiebreak path

**File:** `packages/concord/src/helpers/control.ts:249` / `packages/concord/src/helpers/__tests__/control.test.ts`
**Issue:** The sticky-delete scan's tiebreak (`!deletion || cand.rumorId < deletion.rumorId`) — for when two different authorized candidates at different versions are both `deleted:true` — has no dedicated test. 07-01-SUMMARY.md notes this was treated as a self-resolved assumption ("any deterministic tiebreak is correct"), but the branch itself is currently untested (the CHAN-07 test only exercises a single deleting edition).
**Fix:** Add a case with two authorized `deleted:true` editions at different versions/rumorIds and assert the lower-rumorId one is the one `heads` pins to.

### IN-03: `admin-management.tsx`'s `ChannelsTab` doesn't surface the phase's headline `accessible` affordance

**File:** `apps/examples/src/examples/concord/admin-management.tsx:748-773`
**Issue:** `ChannelsTab` reads `community.channels$` (now `ChannelView[]`, carrying `accessible`) but never displays or uses `channel.accessible` — the exact "visible metadata vs key held" distinction CHAN-06 was built to let clients query without hand-rolling a lookup. Not a defect (the admin panel wasn't required to use it, and admin users typically hold every channel key already), but it's a missed opportunity to demonstrate the new API in the one example this phase touched.
**Fix:** Optional — add an "inaccessible" badge for `!channel.accessible` private channels in the list.

---

_Reviewed: 2026-07-17T19:29:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
