---
phase: 17-correctness-fixes-concord-residuals
verified: 2026-08-20T12:41:11Z
status: gaps_found
score: 13/14 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Invite revocation succeeds only when at least one relay reports ok:true; empty/all-failed results reject with per-relay evidence."
    status: failed
    reason: "The exported ConcordCommunityAdmin permits publishRequired to be omitted, and publishEdition(required=true) then falls back to optimistic publish; unregisterInviteLink can therefore resolve without any relay acknowledgement."
    artifacts:
      - path: "packages/concord/src/client/admin.ts"
        issue: "ConcordCommunityAdminOptions.publishRequired is optional and line 151 selects opts.publish when it is absent."
      - path: "packages/concord/src/client/__tests__/client.test.ts"
        issue: "End-to-end tests cover the internal ConcordCommunity construction, which supplies publishRequired, but no regression covers a valid exported admin constructed without it."
    missing:
      - "Make publishRequired mandatory or fail closed when publishEdition is called with required=true and no required publisher is configured."
      - "Add a regression constructing ConcordCommunityAdmin without publishRequired and prove unregisterInviteLink rejects without calling optimistic publish."
---

# Phase 17: Correctness Fixes & Concord Residuals Verification Report

**Phase Goal:** Five independent low-risk relay, SQLite, group-pointer, Concord AUTH, and Concord publication-honesty defects are fixed without re-layering.
**Verified:** 2026-08-20T12:41:11Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Hostile/unknown CLOSED prefixes cannot resolve through `Object.prototype` or alter retry classification. | ✓ VERIFIED | `relay.ts` uses a private `Map.get`; the public REQ matrix covers `constructor`, `__proto__`, and unknown prefixes. |
| 2 | Known CLOSED prefixes retain typed errors and retry-skip behavior. | ✓ VERIFIED | Public REQ regression asserts `restricted` remains `RelayClosedError` and sends one REQ. |
| 3 | CLOSED-prefix extension remains internal. | ✓ VERIFIED | Map and parser are module-private; no registration/export API was added. |
| 4 | A SQLite consumer can install one backend without the other three. | ✓ VERIFIED | Independent packed-consumer smoke installed only `better-sqlite3` and imported the matching export. |
| 5 | All four SQLite peers retain their ranges and are optional. | ✓ VERIFIED | Manifest and smoke script assert the exact four names, ranges, and optional flags. |
| 6 | Packed SQLite metadata carries optional-peer declarations. | ✓ VERIFIED | Verifier ran build plus `verify-optional-peers.mjs`; source/tarball comparison passed. |
| 7 | Accepted group pointers losslessly round-trip normalized relay URLs. | ✓ VERIFIED | Table covers ws/wss, port, localhost, IPv6, path, and query; focused suite passed. |
| 8 | First apostrophe separates arbitrary-length ID; empty ID becomes `_`. | ✓ VERIFIED | Decoder uses `indexOf`; tests cover apostrophes in ID and empty ID. |
| 9 | Fragments are rejected and compatibility format is not called NIP-29 wire format. | ✓ VERIFIED | Decoder rejects URL hashes; doc comments explicitly distinguish compatibility identifiers from NIP-29 naddr references. |
| 10 | Per-relay AUTH rejection/throw never mutates public fatal error state. | ✓ VERIFIED | Community/private-channel prevention and fatal-control tests passed; constructors no longer wire AUTH failures to UI error callbacks. |
| 11 | Prevention supersedes RESID-01 clear-on-recovery wording with provenance. | ✓ VERIFIED | ROADMAP success criterion, CONTEXT, plan, source/test comments, and changeset consistently record the accepted stronger boundary. |
| 12 | Required invite revocation publication cannot report success without one `ok:true`. | ✗ FAILED | Direct paths validate responses, but exported `ConcordCommunityAdmin.publishEdition(..., true)` falls back to `publish` when optional `publishRequired` is absent. |
| 13 | Local bundle/Invite List tombstones appear only after required network stages succeed. | ✓ VERIFIED | Code orders acknowledgement checks before `eventStore.add` and Invite List tombstoning; failure/partial-success tests passed. |
| 14 | Member revocation publishes bundle, unregisters second, and only then resolves revoked; membership-free skips unregister. | ✓ VERIFIED | `community.revokeInvite` and manager branch ordering are explicit and exercised by the passing client suite. |

**Score:** 13/14 truths verified (0 present, behavior-unverified)

### Required Artifacts

All fifteen declared source/test/changeset artifacts exist and are substantive. Relay, common, SQLite, and Concord artifacts are wired through their public call paths. The only defective wiring is the required-publish fallback in `packages/concord/src/client/admin.ts`.

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| Relay parser | Relay tests | public REQ/CLOSED behavior | ✓ WIRED | Hostile and recognized prefixes exercise the real websocket path. |
| SQLite manifest | peer smoke | packed manifest/install assertions | ✓ WIRED | Script reads source and tarball then imports from an isolated consumer. |
| Group helpers | group tests | encode/decode normalized equality | ✓ WIRED | Full endpoint matrix exercises both exports. |
| AUTH signers | community/private channel | diagnostics without UI-error callback | ✓ WIRED | AUTH stays caller/log-visible; lifecycle catch owns fatal state. |
| Community revocation | invite manager | bundle, unregister, then private tombstone | ⚠ PARTIAL | Internal construction supplies the required publisher, but the exported admin contract permits bypass. |

### Data-Flow Trace (Level 4)

No UI-rendering artifacts were introduced. Publication response arrays flow from relay-pool calls into `requireInviteRevocationAck`; the admin fallback is the identified point where this evidence can be bypassed.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| CLOSED classification/retry | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts` | 175 passed | ✓ PASS |
| Group pointer round trip | `pnpm --filter applesauce-common exec vitest run src/helpers/__tests__/groups.test.ts` | 13 passed | ✓ PASS |
| Concord AUTH and revocation | `pnpm --filter applesauce-concord exec vitest run` on the three declared test files | 146 passed | ✓ PASS |
| Packed SQLite consumer | `pnpm --filter applesauce-sqlite build && node packages/sqlite/scripts/verify-optional-peers.mjs` | build and one-backend import passed | ✓ PASS |

### Probe Execution

No phase probe scripts were declared or discovered; the SQLite packed-consumer verifier was executed as the phase's runnable publication check.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| FIX-01 | 17-01 | ✓ SATISFIED | Private Map lookup plus public hostile/typed regressions. |
| FIX-02 | 17-02 | ✓ SATISFIED | Exact optional peers survive packing and one-backend install. |
| FIX-03 | 17-03 | ✓ SATISFIED | Complete normalized endpoints round-trip. |
| RESID-01 | 17-04 | ✓ SATISFIED | Transient AUTH is excluded from fatal UI state in both engines. |
| RESID-02 | 17-05 | ✗ BLOCKED | Public admin construction can bypass required acknowledgement validation. |

No Phase 17 requirement is orphaned.

### Anti-Patterns Found

No unreferenced TBD/FIXME/XXX markers or substantive stubs were found in phase files. The `return null` matches are intentional parser/failure outcomes; test empty arrays are fixtures. All five changesets are patch-scoped and contain one Markdown sentence.

### Human Verification Required

None. The blocker is directly observable in the exported type and branch logic.

### Gaps Summary

Phase 17 is blocked by one publication-honesty hole. The normal `ConcordCommunity` wiring passes `publishRequired`, so current end-to-end tests pass, but `ConcordCommunityAdmin` is exported and accepts options without that callback. Calling `unregisterInviteLink()` on such a valid instance uses optimistic `publish` and resolves without inspecting acknowledgements, contradicting RESID-02 and the required-publication contract. No later roadmap phase specifically owns this defect, so it is not deferred.

---

_Verified: 2026-08-20T12:41:11Z_
_Verifier: the agent (gsd-verifier)_
