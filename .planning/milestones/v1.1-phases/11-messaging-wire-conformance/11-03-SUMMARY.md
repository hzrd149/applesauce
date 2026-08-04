---
phase: 11-messaging-wire-conformance
plan: 03
subsystem: messaging
tags: [nostr, nip-59, gift-wrap, concord, key-material]

# Dependency graph
requires:
  - phase: 11-messaging-wire-conformance
    provides: plans 01/02 landed in the same wave on the same working tree (cord-wire-fixtures.ts, voice-flag hard removal); no direct code dependency
provides:
  - "WrapOptions.ephemeralSk?: Uint8Array — a caller-suppliable decoy secret key for the wrap's p tag"
  - "wrapForTarget/publishToPlane/sendEvent opts widened to forward ephemeralSk unchanged"
  - "Round-trip + non-leakage + determinism + no-key-control test coverage for the option"
affects: [concord-nip09-deletion, concord-wire-conformance]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Explicit key-in, never key-out: a caller-supplied secret is bound to a local, only the derived public key is ever placed in a published field"

key-files:
  created: []
  modified:
    - packages/concord/src/operations/gift-wrap.ts
    - packages/concord/src/helpers/keys.ts
    - packages/concord/src/client/community.ts
    - packages/concord/src/helpers/__tests__/keys.test.ts

key-decisions:
  - "GiftWrapOptions and rewrapSeal deliberately left untouched (D-07) — the option only reaches the app-level entry point sendEvent, not giftWrap's public signature or compaction re-wraps"
  - "ConcordPrivateChannel (private-channel.ts) untouched — it is receive-only, no send/publish surface exists there (RESEARCH.md Pitfall 4)"
  - "getPublicKey from nostr-tools already returns a hex string — test's expected-value computation uses getPublicKey(sk) directly, no bytesToHex wrapping needed"

requirements-completed: [WIRE-11]

coverage:
  - id: D1
    description: "A caller-supplied ephemeralSk determines the wrap's decoy p tag, forwarded through exactly three signatures (WrapOptions, wrapForTarget, publishToPlane/sendEvent) with no widening of GiftWrapOptions or private-channel.ts"
    requirement: "WIRE-11"
    verification:
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#wrapForTarget ephemeralSk round-trips to the p tag and never leaks (WIRE-11)"
        status: pass
      - kind: unit
        ref: "packages/concord/src/helpers/__tests__/keys.test.ts#wrapForTarget ephemeralSk: default path stays fresh per call, supplied key is deterministic"
        status: pass
    human_judgment: false

# Metrics
duration: 4min
completed: 2026-07-29
status: complete
---

# Phase 11 Plan 03: Caller-suppliable ephemeral decoy key Summary

**`WrapOptions.ephemeralSk?: Uint8Array` threads through `wrapForTarget` → `publishToPlane` → `sendEvent` so a caller can retain and later NIP-09-delete its own giftwrap by `p` tag, proven by a round-trip + non-leakage + determinism test suite.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-29T10:27:21Z
- **Completed:** 2026-07-29T10:31:41Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- `buildWrap` now binds a caller-supplied secret to a local and derives the decoy `p` tag pubkey from it via `getPublicKey`, falling back to `generateSecretKey()` when omitted — closing the CORD-01 §Deletions "if the client saved the ephemeral key" path (WIRE-11 / audit L10)
- The option is forwarded through exactly three signatures (`WrapOptions`, `wrapForTarget`'s opts, `publishToPlane`/`sendEvent`'s opts) and nowhere else — `GiftWrapOptions`, `rewrapSeal`, the six specialized send methods, and `private-channel.ts` are all unchanged, matching D-07's scope discretion
- Test suite proves: (A) the supplied key's derived public key equals the emitted `p` tag value, (B) the secret's hex never appears in the wrap's JSON serialization, (C) two default-path (no key) wraps still get distinct decoy keys, (D) the same supplied key produces the same `p` tag across calls
- Non-vacuity probe executed empirically: reverted `buildWrap`'s fix in place, confirmed both new tests went RED, restored the fix, confirmed GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread ephemeralSk through exactly three signatures and stop** - `897c2f89` (feat)
2. **Task 2: Prove the supplied key round-trips to the p tag and never leaks into the wrap** - `49fbbdc7` (test)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update)

## Files Created/Modified

- `packages/concord/src/operations/gift-wrap.ts` - `WrapOptions.ephemeralSk?: Uint8Array` added with doc comment; `buildWrap` binds `opts.ephemeralSk ?? generateSecretKey()` to a local and derives the decoy pubkey from it
- `packages/concord/src/helpers/keys.ts` - `wrapForTarget`'s `opts` parameter widened to carry `ephemeralSk?: Uint8Array`, forwarded into the `wrapSeal` call alongside `ephemeral`
- `packages/concord/src/client/community.ts` - `publishToPlane` and `sendEvent` opts widened to carry `ephemeralSk?: Uint8Array`; both bodies unchanged (already forward `opts` straight through)
- `packages/concord/src/helpers/__tests__/keys.test.ts` - two new `it()` blocks covering round-trip, non-leakage, no-key-supplied freshness control, and determinism; `getPublicKey` added to the existing `applesauce-core/helpers/keys` import

## Decisions Made

- Followed plan as specified. `GiftWrapOptions`/`rewrapSeal` left untouched per D-07; `private-channel.ts` untouched per RESEARCH.md Pitfall 4 (receive-only, no send/publish surface); no logging statement added anywhere in the chain per D-11.
- Test's expected-value computation calls `getPublicKey(sk)` directly (nostr-tools' `getPublicKey` already returns a hex string) rather than `bytesToHex(getPublicKey(sk))` — the plan's read_first noted `bytesToHex` is imported in the test file, but wrapping an already-hex string in `bytesToHex` throws a type error at runtime (`abytes` guard rejects a string). Caught during the first `-t ephemeralSk` run (RED for the wrong reason, not the intended non-vacuity RED), fixed before the intended probe.

## Deviations from Plan

None beyond the one caught-and-fixed test authoring detail documented above (not a Rule 1-4 deviation — it was fixed before any task commit landed, during initial test authoring, not a later-discovered bug in shipped code).

## Issues Encountered

None beyond the `getPublicKey` return-type detail above, resolved immediately.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

WIRE-11 is fully closed by this plan alone (no other plan touches it). Plans 04/05/06 remain for WIRE-02/03/04/05 (still "In Progress" per STATE.md), each touching `client/community.ts` in the same wave — this plan's `sendEvent`/`publishToPlane` edits were confined to the `opts` parameter type only, so they should not conflict with those plans' signature-reshape work.

---
*Phase: 11-messaging-wire-conformance*
*Completed: 2026-07-29*

## Self-Check: PASSED

All created/modified files found on disk; both task commit hashes (897c2f89, 49fbbdc7) found in git log.
