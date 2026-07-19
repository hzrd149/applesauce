---
phase: 08-rotation-robustness-consensus
reviewed: 2026-07-19T15:10:54Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - packages/concord/src/client/channel-sync.ts
  - packages/concord/src/client/community.ts
  - packages/concord/src/client/private-channel.ts
  - packages/concord/src/client/sync.ts
  - packages/concord/src/helpers/keys.ts
  - packages/concord/src/helpers/permissions.ts
  - packages/concord/src/helpers/rekey.ts
  - packages/concord/src/operations/rekey.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
  critical_resolved: 1
status: issues_found
resolution_note: "CR-01 (critical) fixed in commit 920676ee with a spec-derived regression test; 3 warnings + 2 info remain open for triage."
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-19T15:10:54Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed the rotation-robustness / consensus surface: the scope-generic rekey fold
(`readRekeyScoped`), the racing-rotation convergence + D-06 opaque handling, the
chunk-set consistency guards (`groupRotations`), the refounding majority gate, the
`vac` citation verifier, the down-only re-read cascades (root + channel), and the
fail-closed build/chain hardening.

Most of the consensus machinery is careful and matches its documented invariants:
the `groupRotations` `consistent`/`complete` checks correctly detect a resumed
rotation minting a different `n` (ROTATE-10/11); `buildChain`/`rollForward` attribute
each epoch's refounder from its own `held_roots` entry (no tip-refounder leak); the
`vacVerifier` structurally matches the citation produced by `admin.vacFor`; the
majority threshold `Math.ceil((n+1)/2)` is a correct strict majority; and the
compaction abort-on-unfoldable-head is genuinely fail-closed.

However, the D-06 "never remove on transient decrypt failure" invariant is violated
when a decrypt-throw coexists with a competing no-blob set — a false, irreversible
removal (CR-01). Two convergence/liveness gaps (multi-chunk majority scatter, and the
live path being unable to down-heal an already-adopted epoch) are also called out.

## Critical Issues

### CR-01: Transient decrypt failure causes false removal when a competing no-blob rotation exists

> **RESOLVED** in commit `920676ee` — added a separate `decryptThrew` flag in `readRekeyScoped`; when set with no decryptable winner, the fold returns `{ kind: "none" }` before the removal loop, so a transient decrypt-throw defers even beside an outranking no-blob removal set. Spec-derived regression test added (fails without the fix, passes with it); full concord suite 233/233 green.


**File:** `packages/concord/src/helpers/keys.ts:560-603` (`readRekeyScoped`)
**Issue:**
The fold's stated invariant (D-06, restated in the function docstring) is that a
blob found at our own locator whose *decrypt threw* is "positive evidence we ARE in
that set, outcome undetermined — never absence, never removal on its own." The code
records that case only by setting the shared `opaqueCompetitor` boolean:

```ts
try {
  const plain = await signer.nip44!.decrypt(set.rotator, blob.wrapped);
  ...
  decryptable.push({ key: newKey, rotator: set.rotator });
} catch {
  opaqueCompetitor = true;   // decrypt-threw: our blob WAS present
}
```

`opaqueCompetitor` is consulted only on the **adopt** path (to defer, D-10). The
**removal** path never consults it:

```ts
// decryptable.length === 0 here
for (const rotator of noBlobRotators) {
  if (held.canRemoveSelf?.(rotator) === true) return { kind: "removed", epoch: targetEpoch };
}
return { kind: "none" };
```

So when a keep-set (blob present, decrypt threw transiently — e.g. a NIP-46 bunker
briefly offline) coexists with a competing no-blob set from another authorized
rotator that outranks us, `decryptable` is empty, the loop reaches the no-blob
rotator, and we return `removed`. This is a **false, irreversible removal**
(`handleRemoved` disposes the engine and fires `onRemoved`, tombstoning the
membership) despite positive evidence we were kept. The docstring's own claim — "a
decrypt-threw set alone never reaches this branch" — only covers the *alone* case;
decrypt-throw + no-blob was not handled. This directly contradicts the phase's
transient-decrypt-retry goal, and `canRemoveSelf` is wired at the real call sites
(`sync.ts`, `community.ts` root; `community.ts` channel), so the branch is reachable
in production.

**Fix:** Track decrypt-throws separately from no-blob sets and defer removal when a
throw occurred (positive keep-evidence outranks an unproven removal):

```ts
let decryptThrew = false;
...
} catch {
  opaqueCompetitor = true;
  decryptThrew = true;
}
...
// No decryptable candidate. A transient decrypt failure is positive evidence we
// were a recipient somewhere — never honor a competing removal on top of it.
if (decryptThrew) return { kind: "none" };
for (const rotator of noBlobRotators) {
  if (held.canRemoveSelf?.(rotator) === true) return { kind: "removed", epoch: targetEpoch };
}
return { kind: "none" };
```

## Warnings

### WR-01: Multi-chunk rekey can pass the majority gate yet leave no relay holding a complete rotation

**File:** `packages/concord/src/client/community.ts:1276-1286` (`refound` / `requireMajority`)
**Issue:**
`requireMajority` gates each wrap **independently** against a strict majority of the
configured relay set. A rotation with more than `REKEY_BLOBS_PER_EVENT` (120)
recipients is split into multiple chunk wraps (`buildRekeyRumors`), and a reader only
converges on a rotation that is **COMPLETE** — i.e. all `n` chunks present on the same
relay (`groupRotations` requires `chunks.size >= chunkCount`). Because each chunk can
clear its own strict majority on a *different* subset of relays, the intersection of
all `n` chunk-ack sets can be empty for `n >= 3` (e.g. 3 relays, 3 chunks acked by
`{A,B}`, `{B,C}`, `{A,C}`): every chunk passes the gate, yet no single relay holds the
complete rotation, so the new epoch is undiscoverable — exactly the failure the gate
exists to prevent. The rotator then proceeds to `adoptRefounding`, rolling itself
onto an epoch nobody else can follow.

**Fix:** Gate the rotation as a unit rather than per-wrap — e.g. require a strict
majority of relays that each acked **every** chunk of the rotation (intersect the
per-chunk ok-sets and count the intersection), or publish/confirm all chunks of a
rotation as one batch before evaluating the threshold.

### WR-02: Live path cannot down-heal an already-adopted epoch — racing rotations can diverge permanently until re-sync

**File:** `packages/concord/src/client/community.ts:792-800` (`checkRekey`) and `packages/concord/src/client/private-channel.ts:287-300`
**Issue:**
The down-only latch comment promises a "settled epoch can heal DOWN but never
re-fork UP," and `checkRekey` implements the down-heal via `isStrictlyLowerKey`.
However, the candidate comes from `readRekey`, which only ever considers rotations
where `set.newEpoch === heldEpoch + 1n` (`readRekeyScoped`, keys.ts:544). Once we
adopt epoch N, `this.keys.material.root_epoch === N`, so every subsequent
`checkRekey` targets epoch N+1 and the strictly-lower sibling of epoch N is filtered
out — the `rekeyHandled.get(N)` entry becomes dead and the heal-down branch is
unreachable on the live path. If node A completes and adopts the higher root `R_N`
before the lower `R_N'` wrap arrives, and node B adopts `R_N'`, the two nodes are
permanently split (different `community_root` ⇒ mutually unreadable planes) until a
full `syncEpochs` re-walk (only run once, in `start()`, which is guarded by
`this.started`). The re-read cascade in `sync.ts` heals this, but there is no live
trigger to invoke it after adoption. Same shape in `ConcordPrivateChannel.checkRekey`.

**Fix:** Either (a) evaluate all present candidates for the *current* epoch before
adopting and re-run the fold when a strictly-lower sibling for the just-adopted epoch
arrives (retain the pre-adoption `heldEpoch` view long enough to down-correct), or
(b) trigger a bounded re-walk (`syncEpochs`/`syncChannelEpochs`) when a rekey event
whose `newEpoch <= current root_epoch` and strictly-lower key is observed live.

### WR-03: `refound` publishes and gates rekey wraps before confirming any are complete, leaving partial rotations on relays on abort

**File:** `packages/concord/src/client/community.ts:1285-1286`
**Issue:**
`requireMajority` throws mid-loop the moment one wrap misses majority, but earlier
wraps (and the failing wrap's partial acks) have already been published. For a
multi-chunk rotation this scatters an *incomplete* rotation across relays and aborts
without cleanup. Readers won't adopt an incomplete rotation, so this is not a
correctness break today, but combined with WR-01 it widens the window where relays
hold partial-but-not-complete rotation state that can never be garbage-collected or
resolved, and no compensating tombstone/retry is emitted. Consider building+confirming
the full rotation set atomically (see WR-01 fix) so an abort leaves either nothing or
a complete, discoverable rotation.

## Info

### IN-01: Best-effort compaction/snapshot publishes swallow all errors silently

**File:** `packages/concord/src/client/community.ts:1289-1290`
**Issue:** `this.pool.publish(relays, wrap).catch(() => {})` discards every error for
compaction and snapshot wraps. These are documented as non-gating, but a total
compaction failure means members re-sync from genesis with no diagnostic. Consider
`.catch((err) => console.warn("compaction publish failed", err))` to match the
logging convention used elsewhere in this file (e.g. line 1056, 1099).

### IN-02: `groupRotations` captures `vac` from the first-arriving chunk only

**File:** `packages/concord/src/helpers/rekey.ts:216-218, 249`
**Issue:** The set's `vac` is captured from whichever chunk created the bucket, and
the docstring notes cross-chunk `vac` agreement is out of scope. This is safe today
because all chunks are correlated by the rotator's real seal-signer pubkey and
`vacVerifier` re-checks the current roster (so a forged/omitted `vac` on a later chunk
cannot elevate authority). Worth a targeted test pinning that a chunk with a
divergent `vac` cannot change the set's honored authority, so the "out of scope"
assumption stays true if the correlation key ever changes.

---

_Reviewed: 2026-07-19T15:10:54Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
