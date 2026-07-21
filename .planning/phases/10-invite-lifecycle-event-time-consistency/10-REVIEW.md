---
phase: 10-invite-lifecycle-event-time-consistency
reviewed: 2026-07-21T15:16:08Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/concord/src/helpers/invite-bundle.ts
  - packages/concord/src/helpers/stream.ts
  - packages/concord/src/operations/channel.ts
  - packages/concord/src/operations/guestbook.ts
  - packages/concord/src/factories/guestbook.ts
  - packages/concord/src/client/community.ts
  - packages/concord/src/client/client.ts
  - packages/concord/src/client/invite-manager.ts
  - packages/concord/src/casts/direct-invite.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
resolved:
  - id: CR-01
    fixed_in: 82ebab35
    note: "isAtCoordinate(pubkey===linkSigner && d==='') added to joinByLink pre-collapse filter; non-vacuous injection test via filter-ignoring relay pool stand-in"
status: issues_found
open_findings: "3 warnings + 2 info (CR-01 critical resolved)"
---

# Phase 10: Code Review Report

**Reviewed:** 2026-07-21T15:16:08Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

The phase's headline fixes are implemented correctly for the *honest-relay* case: `newestAtCoordinate` replicates the NIP-01 replaceable-winner rule verbatim, `joinByLink` now collapses the full union before checking `isInviteBundleRevoked` (D-01/D-03), the `#d: [""]` filter scope was added (D-02), `validateInviteBundle`'s `Array.isArray` guard runs before any `.length`/`.slice` (D-10), `decodeFragment` rejects any version `!== FRAGMENT_VERSION` in both directions (D-12), `getInviteBundleVsk` correctly distinguishes absent (→ live) from unparseable/NaN (→ revoked) per the D-04 ruling, `expires_at` is seconds end-to-end with no residual ms boundary (checked every read/write site), and the single-clock-read threading for `created_at`/`ms` (`splitTime` → `includeMs` → `created_at` override, and `buildSnapshotFactories` → `includeSnapshotChunk`) has zero skew including the ≥500ms remainder path, verified by hand-tracing the arithmetic.

However, one finding undercuts the phase's own central claim. `joinByLink`'s new `newestAtCoordinate` collapse is documented as resolving "one addressable coordinate," but the code only filters candidate events by `kind` (`isValidInviteBundle`) — it never checks that a candidate event's `pubkey` matches `parsed.linkSigner` or that its `d` tag is empty. Both constraints are enforced only via the *outgoing* `pool.request` filter, which is advisory and unverified against relay compliance (confirmed: neither `applesauce-relay`'s `Relay`/`RelayPool` nor `mapEventsToTimeline` re-validates filter membership on inbound events). A single non-compliant or malicious relay in the queried set can inject an off-coordinate kind-33301 event that wins the `created_at` race and gets treated as the coordinate's winner — precisely the class of defect this phase's fix is supposed to close. Three further robustness/quality issues were found: a secret invite `token` is logged to `console.warn` on refresh failure, `expires_at` truthiness treats `0` the same as "unset," and `decodeFragment`'s relay-dictionary decoding silently truncates/garbles rather than throwing on a buffer shorter than its own declared lengths.

## Critical Issues

### CR-01: `joinByLink`'s coordinate collapse never verifies event authorship/`d`-tag, only `kind` — ✅ RESOLVED (82ebab35)

> **Resolution (2026-07-21):** Added `isAtCoordinate(event, linkSigner)` (`pubkey === event.pubkey === linkSigner && getReplaceableIdentifier(event) === ""`) to the pre-collapse filter in `joinByLink`, re-enforcing the coordinate on INBOUND events rather than trusting the outgoing `pool.request` filter. New regression test (`client.test.ts`, "one bad relay can't deny a join") injects a wrong-author garbage kind-33301 event via a new `unfilteredServingPool` stand-in that ignores the outgoing filter entirely — the test passes with the fix and fails without it (non-vacuity verified by reverting the filter line). Full concord suite 287/287 green, `tsc` clean.



**File:** `packages/concord/src/client/client.ts:89-96, 440-452`
**Issue:** `newestAtCoordinate`'s docstring claims to "Collapse a multi-relay union of events at one addressable coordinate to its single NIP-01 winner," and `joinByLink` feeds it `events.filter(isValidInviteBundle)` — but `isValidInviteBundle` (`helpers/invite-bundle.ts:253-255`) only checks `event.kind === INVITE_BUNDLE_KIND`. Neither the pre-collapse filter nor `newestAtCoordinate` itself checks `event.pubkey === parsed.linkSigner` or that the event's `d` tag is `""`. The only place those constraints are expressed is the *outgoing* `pool.request` filter (`authors: [parsed.linkSigner], "#d": [""]`, line 442) — which is a request to relays, not a guarantee enforced on what they return. Confirmed by reading `applesauce-relay`'s `Relay`/`RelayPool` request path and `mapEventsToTimeline` (`packages/core/src/observable/map-events-to-timeline.ts`): neither re-validates that an emitted event actually matches the filter that was sent. `lastValueFrom(...pool.request(relays, [...]))` unions responses across every relay in `relays` (which, for a link with no bootstrap relays in its fragment, falls back to `this.defaultRelays` — relays the *app*, not necessarily the *inviter*, configured).

A single misbehaving or compromised relay in that set can therefore emit a kind-33301 event with an arbitrary `pubkey` and/or non-empty `d` tag (needs no valid decryption of the real bundle — it just needs to win the `created_at`/`id` race in `newestAtCoordinate`) and it will be accepted as "the" coordinate's winner, with `isInviteBundleRevoked` and `getInviteBundle`/`validateInviteBundle` then evaluated against it instead of the real coordinate's actual newest event. Concretely this lets one bad relay in the fetch set unconditionally deny a join (the injected event is real-kind but decrypts to garbage under `parsed.token`, so `validateInviteBundle`/`decryptBundle` fails) regardless of what the honest relays in the same union are serving — which is exactly the "a lagging/misbehaving relay must not be able to control the join outcome" property INVITE-01 exists to establish. It also means the "collapse to one coordinate" invariant this phase's own doc-comment asserts is not actually implemented; it silently depends on every queried relay honoring the outgoing filter.

No test in `client.test.ts` exercises a wrong-pubkey or wrong-`d`-tag injected event (the only `#d` test, `filteringAsyncServingPool`, tests that the *outgoing* filter carries the tag — it never simulates a relay that ignores it, which is the actual threat `asyncServingPool` was built to model for the union case).

**Fix:**
```ts
function isAtCoordinate(event: NostrEvent, linkSigner: string): boolean {
  const d = event.tags.find((t) => t[0] === "d")?.[1] ?? "";
  return event.pubkey === linkSigner && d === "";
}

// in joinByLink:
const winner = newestAtCoordinate(
  events.filter((e) => isValidInviteBundle(e) && isAtCoordinate(e, parsed.linkSigner)),
);
```

## Warnings

### WR-01: Secret invite unlock token logged to console on refresh failure

**File:** `packages/concord/src/client/community.ts:1153`
**Issue:** `refreshInviteBundles`'s per-link catch logs `` `invite refresh skipped for link ${link.token}` ``. `link.token` is the invite's hex-encoded unlock secret (per `ConcordInviteLink.token` doc: "Hex-encoded invite unlock token. Also the Invite List merge key" — `invite-manager.ts:34`) — the same material embedded in the shareable link's URL fragment that lets anyone holding it decrypt the bundle. Writing it to `console.warn` risks it being captured by browser devtools history, crash/error-reporting SDKs, or server logs, none of which should ever see a live invite's unlock secret in cleartext.
**Fix:** Log a non-secret identifier instead (e.g. the link's `signerPubkey`, which is already public in the invite naddr):
```ts
console.warn(`invite refresh skipped for link ${link.signerPubkey}`, err);
```

### WR-02: `bundle.expires_at &&` treats an explicit `expires_at: 0` the same as "no expiry"

**File:** `packages/concord/src/client/client.ts:480`
**Issue:** `if (bundle.expires_at && unixNow() > bundle.expires_at) throw new Error("invite expired");` uses `bundle.expires_at` as a truthiness gate. `0` is a valid (if degenerate) unix-seconds timestamp — the Unix epoch, in the past for any real client — but is falsy in JS, so `expires_at: 0` silently skips the expiry check entirely and the invite is treated as never-expiring instead of always-expired. This is unlikely to occur from a legitimate invite-creation path today, but `bundle` here is attacker-crafted input reached via a link (per this file's own `validateInviteBundle` doc), and `validateInviteBundle` does not currently reject an `expires_at` of `0` — a maliciously/incorrectly-modified bundle claiming `expires_at: 0` bypasses expiry entirely rather than always failing it.
**Fix:**
```ts
if (bundle.expires_at != null && unixNow() > bundle.expires_at) throw new Error("invite expired");
```

### WR-03: `decodeFragment`'s relay-dictionary decode silently truncates on a malformed/short buffer instead of failing closed

**File:** `packages/concord/src/helpers/invite-bundle.ts:90-107`
**Issue:** After the version check (D-12, correctly fail-closed), the rest of `decodeFragment` reads attacker-controlled length-prefixed fields (`len = bytes[i++]`, then `bytes.slice(i, i + len)`) with no check that `i + len <= bytes.length`. A truncated or adversarially short fragment doesn't throw — `Array.prototype.slice` silently clamps to whatever bytes exist, `i` advances past the buffer end, subsequent `bytes[i++]` reads return `undefined`, and the final `token = bytes.slice(i, i + 16)` can silently come back shorter than 16 bytes. The function returns a `{ token, relays }` pair built from corrupted/partial data rather than throwing, which is inconsistent with this phase's own "fail closed on malformed input, don't guess" standard applied to the version and `vsk`/array-shape guards in the same file.
**Fix:** Bounds-check before each slice and throw on underflow, e.g.:
```ts
function readBytes(bytes: Uint8Array, i: number, len: number): Uint8Array {
  if (i + len > bytes.length) throw new Error("truncated invite fragment");
  return bytes.slice(i, i + len);
}
```
and route the host/token/custom-relay reads through it.

## Info

### IN-01: `InviteBundle.expires_at` lacks the unit doc-comment its sibling field carries

**File:** `packages/concord/src/types.ts:163`
**Issue:** `InviteListInvite.expires_at` (`types.ts:208`) is documented as `/** Optional unix-seconds expiry (D-05; CORD-05 §4 magnitude reading). */`, but the identically-named, identically-unitted `InviteBundle.expires_at` field two structs up has no doc-comment at all — a reader looking only at `InviteBundle` has to go find the comment on a different interface (or `helpers/invite-bundle.ts`'s `BuildInviteBundleOptions.expires_at`) to learn the unit, which is exactly the kind of ambiguity `UPSTREAM-NOTES.md` records as having caused the original ms/seconds confusion.
**Fix:** Add the same doc-comment to `InviteBundle.expires_at`.

### IN-02: Two separate import statements from the same module in `factories/guestbook.ts`

**File:** `packages/concord/src/factories/guestbook.ts:6-7`
**Issue:** `JOIN_LEAVE_KIND, KICK_KIND, SNAPSHOT_KIND, type JoinLeaveVerb` and `SNAPSHOT_CHUNK` are imported from `../helpers/guestbook.js` in two separate `import` statements rather than one combined import.
**Fix:**
```ts
import { JOIN_LEAVE_KIND, KICK_KIND, SNAPSHOT_CHUNK, SNAPSHOT_KIND, type JoinLeaveVerb } from "../helpers/guestbook.js";
```

---

_Reviewed: 2026-07-21T15:16:08Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
