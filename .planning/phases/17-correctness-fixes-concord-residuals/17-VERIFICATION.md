---
phase: 17-correctness-fixes-concord-residuals
verified: 2026-08-20T13:21:43Z
status: passed
score: 14/14 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 13/14
  gaps_closed:
    - "Required invite-registry publication now fails closed when publishRequired is omitted and never falls back to optimistic publish."
  gaps_remaining: []
  regressions: []
---

# Phase 17: Correctness Fixes & Concord Residuals Verification Report

**Phase Goal:** Five independent, low-risk defects — a relay-controlled prototype-chain lookup, an all-or-nothing SQLite peer dependency, a lossy NIP-29 address round-trip, and two Concord auth/publish-honesty gaps — are fixed without waiting on any re-layering work.
**Verified:** 2026-08-20T13:21:43Z
**Status:** passed
**Re-verification:** Yes — after gap closure plan 17-06

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Hostile/unknown CLOSED prefixes cannot resolve through `Object.prototype` or alter retry classification. | ✓ VERIFIED | Quick regression check: `relay.ts` retains a private `Map.get`; the public REQ matrix retains `constructor`, `__proto__`, and unknown-prefix cases. |
| 2 | Known CLOSED prefixes retain typed errors and retry-skip behavior. | ✓ VERIFIED | Quick regression check: the recognized-prefix public test remains wired to the REQ path. |
| 3 | CLOSED-prefix extension remains internal. | ✓ VERIFIED | The prefix map and parser remain module-private; no registration/export API exists. |
| 4 | A SQLite consumer can install one backend without the other three. | ✓ VERIFIED | The packed-consumer verifier remains substantive and checks an isolated `better-sqlite3`-only install/import. |
| 5 | All four SQLite peers retain their ranges and are optional. | ✓ VERIFIED | Source manifest and verifier retain exact four-key peer/range/optional assertions. |
| 6 | Packed SQLite metadata carries optional-peer declarations. | ✓ VERIFIED | The artifact verifier confirms the manifest-to-packed-consumer link remains wired. |
| 7 | Accepted group pointers losslessly round-trip normalized relay URLs. | ✓ VERIFIED | Encoder/decoder and the ws/wss, port, localhost, IPv6, path, and query matrix remain substantive and wired. |
| 8 | First apostrophe separates arbitrary-length ID; empty ID becomes `_`. | ✓ VERIFIED | Decoder retains first-boundary parsing and corresponding tests. |
| 9 | Fragments are rejected and compatibility format is not called NIP-29 wire format. | ✓ VERIFIED | Fragment rejection and compatibility-policy documentation remain present. |
| 10 | Per-relay AUTH rejection/throw never mutates public fatal error state. | ✓ VERIFIED | Community/private-channel wiring still omits AUTH-to-UI error callbacks; fatal lifecycle catch paths and tests remain intact. |
| 11 | Prevention supersedes RESID-01 clear-on-recovery wording with provenance. | ✓ VERIFIED | ROADMAP criterion, CONTEXT, plans, source/test comments, and changeset consistently preserve the accepted prevention boundary. |
| 12 | Required invite revocation publication cannot report success without one `ok:true`, including exported-admin construction without `publishRequired`. | ✓ VERIFIED | `admin.ts:151-156` has exclusive required/ordinary branches: missing `publishRequired` throws before publication; configured required publication calls only `publishRequired`. The named regression passed. |
| 13 | Local bundle/Invite List tombstones appear only after required network stages succeed. | ✓ VERIFIED | Quick regression check: acknowledgement gates still precede local `EventStore`/Invite List mutation; Concord suite exits 0. |
| 14 | Member revocation publishes bundle, unregisters second, and only then resolves revoked; membership-free skips unregister. | ✓ VERIFIED | Existing stage-ordering implementation/tests remain wired; full Concord package test exits 0. |

**Score:** 14/14 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact group | Expected | Status | Details |
|---|---|---|---|
| Plan 17-01 relay artifacts | parser, public regressions, changeset | ✓ VERIFIED | 3/3 exist and are substantive; key link verified. |
| Plan 17-02 SQLite artifacts | manifest, packed verifier, changeset | ✓ VERIFIED | 3/3 exist and are substantive; packed metadata link verified. |
| Plan 17-03 group-pointer artifacts | helpers, matrix, changeset | ✓ VERIFIED | 3/3 exist and are substantive; encode/decode link verified. |
| Plan 17-04 AUTH artifacts | two engines, two suites, changeset | ✓ VERIFIED | 5/5 exist and are substantive; diagnostic/UI-boundary link verified. |
| Plan 17-05 revocation artifacts | community, manager, client suite, changeset | ✓ VERIFIED | 4/4 exist and are substantive; ordered revocation link verified. |
| `packages/concord/src/client/admin.ts` | fail-closed required-edition boundary | ✓ VERIFIED | Explicit required branch validates the strict callback, throws if absent, and cannot reach `publish`. |
| `packages/concord/src/client/__tests__/client.test.ts` | omitted/configured publisher regression | ✓ VERIFIED | Direct exported-admin fixture asserts rejection and both callback call counts. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Relay parser | Relay tests | public REQ/CLOSED behavior | ✓ WIRED | Automated plan query verified the declared pattern. |
| SQLite manifest | peer smoke | packed manifest/install assertions | ✓ WIRED | Automated plan query verified the declared pattern. |
| Group helpers | group tests | normalized encode/decode equality | ✓ WIRED | Automated plan query verified the declared pattern. |
| AUTH signers | community/private channel | diagnostics without UI-error callback | ✓ WIRED | Automated plan query verified the declared pattern. |
| Community revocation | invite manager | bundle, unregister, then private tombstone | ✓ WIRED | Automated plan query verified the declared pattern. |
| `admin.ts` | `client.test.ts` | required branch rejects before optimistic publish | ✓ WIRED | Named regression executes the exported class through `unregisterInviteLink`. |

### Data-Flow Trace (Level 4)

No UI-rendering artifacts were introduced. For RESID-02, the response flow is relay results → required publisher acknowledgement validation → registry edition completion → later local revocation mutation. Plan 17-06 closes the only alternate flow: omitted strict configuration now throws before either publication callback.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Exported-admin fail-closed and exclusive routing | `pnpm --filter applesauce-concord exec vitest run src/client/__tests__/client.test.ts -t 'required publication\|publishRequired\|unregister invite'` | 1 passed, 66 skipped | ✓ PASS |
| Concord regression suite | `pnpm --filter applesauce-concord test -- --reporter=dot` | exit 0 | ✓ PASS |
| Concord declarations/build | `pnpm --filter applesauce-concord build` | exit 0 | ✓ PASS |

Previously passed FIX-01/02/03 and RESID-01 items received the required re-verification quick regression checks (existence, substance, and basic wiring). They were not redundantly re-run through every package suite.

### Probe Execution

No phase probe scripts were declared or discovered. The SQLite packed-consumer verifier remains the phase's artifact-level publication check and passed during initial verification; its code and wiring passed regression inspection.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| FIX-01 | 17-01 | Prototype-safe CLOSED-prefix classification | ✓ SATISFIED | Private `Map` plus hostile/known public-path regressions. |
| FIX-02 | 17-02 | Optional SQLite backend peers | ✓ SATISFIED | Exact four optional peers and packed one-backend verifier. |
| FIX-03 | 17-03 | Lossless group-pointer protocol/port round trip | ✓ SATISFIED | Full normalized endpoint codec and matrix. |
| RESID-01 | 17-04 | AUTH rejection cannot latch fatal community/channel UI state | ✓ SATISFIED | Accepted prevention restatement is implemented and tested in both engines. |
| RESID-02 | 17-05, 17-06 | Revocation surfaces failed required publication | ✓ SATISFIED | Any-ack checks, ordered mutations, and fail-closed exported-admin boundary. |

All five ROADMAP requirements are claimed by plans and supported by code/tests; none is orphaned. `REQUIREMENTS.md` still labels FIX-01/02/03 and RESID-01 as `Gaps Found` because phase transition has not run; that tracking metadata is not implementation evidence and is intentionally left unchanged by this verifier.

### Anti-Patterns Found

No unreferenced `TBD`, `FIXME`, or `XXX` marker, substantive stub, or required-to-optimistic fallback was found in the phase artifacts. Plan-level artifact verification passed 20/20 declared artifacts and 6/6 key links.

### Human Verification Required

None. The phase behaviors are non-visual, local, and exercised by deterministic tests or artifact checks.

### Gaps Summary

The sole prior blocker is closed. A valid exported `ConcordCommunityAdmin` may still omit `publishRequired` for ordinary operations, but `unregisterInviteLink` reaches `publishEdition(..., required=true)`, which now throws before either publisher if strict publication is unconfigured. With a strict publisher configured, the same regression proves only `publishRequired` runs. No remaining or deferred gap affects the Phase 17 goal.

### Disconfirmation Pass

- Partial requirement sought: the exported-admin omission path was the prior partial RESID-02 implementation; it is now directly covered and passes.
- Misleading-test risk sought: internal `ConcordCommunity` tests alone would not prove the exported constructor; the new test directly instantiates `ConcordCommunityAdmin` without `publishRequired`.
- Uncovered error path sought: already-absent invite links intentionally return before publication; this does not falsely report a new remote revocation because no registry change is required.

---

_Verified: 2026-08-20T13:21:43Z_
_Verifier: the agent (gsd-verifier)_
