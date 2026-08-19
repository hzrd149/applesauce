---
phase: 16-method-layering-foundation-typescript-7
verified: 2026-08-19T18:50:13Z
status: gaps_found
score: 9/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "The workspace builds and tests under TypeScript 7 with no package needing a TS7-specific production-source change."
    status: failed
    reason: "The build and tests pass, but commit ba8a3da6 was required specifically to clear TypeScript 7 declaration and NodeNext diagnostics and changes five production source files. This directly contradicts Roadmap Success Criterion 3 and the matching Plan 16-07 must-have; no accepted override exists."
    artifacts:
      - path: "packages/signers/src/signers/nostr-connect-provider.ts"
        issue: "Added a Debugger import and explicit logger field annotation for TS7 declaration portability."
      - path: "packages/signers/src/signers/nostr-connect-signer.ts"
        issue: "Added a Debugger import and explicit logger field annotation for TS7 declaration portability."
      - path: "packages/signers/src/signers/serial-port-signer.ts"
        issue: "Added a Debugger import and explicit logger field annotation for TS7 declaration portability."
      - path: "packages/wallet-connect/src/wallet-service.ts"
        issue: "Added a Debugger import and explicit logger field annotation for TS7 declaration portability."
      - path: "packages/wallet/src/wallet/nut-wallet.ts"
        issue: "Changed a production side-effect import to include the .js extension because TS7 rejected the previous NodeNext import."
    missing:
      - "Either restore a TS7-clean build without production-source changes, revise the roadmap contract, or add an explicit developer-accepted verification override documenting that these runtime-neutral compatibility edits are acceptable."
---

# Phase 16: Method Layering Foundation & TypeScript 7 Verification Report

**Phase Goal:** The relay package's low/high layering rule is stated correctly everywhere D-01 is cited, and the whole workspace builds and tests clean under TypeScript 7 before any behavior change lands on top of it.
**Verified:** 2026-08-19T18:50:13Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | D-01 permits a throw at an immediate retry/aggregation consumer and rejects expected-state throws across multi-hop chains. | ✓ VERIFIED | Archived Phase 13 context lines 29–40 state both halves explicitly. |
| 2 | D-01 records low-level one-interaction ownership and high-level policy ownership. | ✓ VERIFIED | The same source-of-record block assigns authentication, retry, reconnect, resubscription, clocks, and concurrency to high-level methods. |
| 3 | All 14 shipped D-01 citations are consistent and retain the exact 10/3/1 distribution. | ✓ VERIFIED | Independent `rg` inventory found `relay.ts` 10, `auth-retry.ts` 3, and `relay.test.ts` 1; semantic inspection found each scoped to its local one-hop or multi-hop path. |
| 4 | All 18 live direct TypeScript compiler pins are `^7.0.2`. | ✓ VERIFIED | JSON enumeration covered root, three apps, and fourteen packages; every value was exactly `^7.0.2`. |
| 5 | Manifest edits contain no unrelated dependency-range changes. | ✓ VERIFIED | Commit/diff review shows the 18 TypeScript pin changes plus the planned `@typescript/typescript6` addition only. |
| 6 | All 14 package configs omit `downlevelIteration` while retaining `target: ES2022` and `declaration: true`. | ✓ VERIFIED | Direct JSON inspection passed for all fourteen configs; repository grep found no remaining removed option. |
| 7 | A frozen install resolves the TypeScript 7 CLI, and `pnpm exec tsc --version` reports 7.0.2. | ✓ VERIFIED | `pnpm install --frozen-lockfile` exited 0; compiler output was `Version 7.0.2`; lockfile importers resolve 7.0.2. |
| 8 | `apps/llms` retains the TS7 CLI while using the official TS6 compatibility package only for compiler API calls. | ✓ VERIFIED | Manifest contains both intended pins; `build-exports.mjs` imports `@typescript/typescript6`; workspace build exercised the llms generator successfully. |
| 9 | The full workspace builds/tests under TS7 with no TS7-specific production source changes. | ✗ FAILED | Independent build and test commands pass, but `ba8a3da6` changes five production files specifically to satisfy TS7 diagnostics. |
| 10 | Every one of the 14 packages emits declarations. | ✓ VERIFIED | After the independent build, every package had at least four `dist/**/*.d.ts` files (range 4–200). |

**Score:** 9/10 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| Phase 13 `13-CONTEXT.md` | Amended D-01 source of record | ✓ VERIFIED | Substantive amended rule at lines 29–40. |
| `packages/relay/src/relay.ts` | Ten contextual D-01 citations | ✓ VERIFIED | Exists, substantive, runtime-wired, exact count 10. |
| `packages/relay/src/operators/auth-retry.ts` | Three multi-hop citations | ✓ VERIFIED | Exists, substantive, imported by relay implementation, exact count 3. |
| `packages/relay/src/__tests__/relay.test.ts` | Subscriber-boundary citation/test | ✓ VERIFIED | One citation; full test suite passes. |
| 18 workspace manifests | TS7 compiler pins | ✓ VERIFIED | All direct pins equal `^7.0.2`. |
| 14 package tsconfigs | TS7-compatible declaration configs | ✓ VERIFIED | Removed option absent; ES2022/declaration settings retained. |
| `apps/llms/src/build-exports.mjs` | TS6 compiler API bridge | ✓ VERIFIED | Default import is wired into the existing AST scanner; llms build passes. |
| `pnpm-lock.yaml` | Reproducible TS7/TS6 graph | ✓ VERIFIED | Frozen install passes; TS7 and compatibility snapshots/importers are present. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `relay.ts` and auth operator | Archived D-01 | D-01 citations | ✓ WIRED | Citations reflect the amended source rule rather than the former blanket ban. |
| 18 manifests | `pnpm-lock.yaml` | pnpm resolution | ✓ WIRED | Manual lockfile inspection confirms 7.0.2 importer resolutions. The generic verifier's escaped regex produced false negatives, so this was checked directly. |
| `build-exports.mjs` | `apps/llms/package.json` | `@typescript/typescript6` import/dependency | ✓ WIRED | Import and declared dependency match; build executes the scanner. |
| Package tsconfigs | package `dist` trees | declaration emit | ✓ WIRED | All fourteen package outputs contain declarations after build. |

### Data-Flow Trace (Level 4)

Not applicable: the phase changes architectural comments and build configuration, not a dynamic rendered-data surface.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Frozen dependency graph installs | `pnpm install --frozen-lockfile` | Exit 0, already up to date | ✓ PASS |
| TS7 CLI selected | `pnpm exec tsc --version` | `Version 7.0.2` | ✓ PASS |
| Workspace builds | `pnpm run build` | 18/18 tasks successful | ✓ PASS |
| Full test suite passes | `pnpm run test` | 277 files passed, 1 skipped; 2,684 tests passed, 2 skipped | ✓ PASS |
| Declaration output exists | enumerate `packages/*/dist/**/*.d.ts` | All 14 packages non-empty | ✓ PASS |

### Probe Execution

No phase probe was declared or discovered; the phase's executable evidence is the build, test, install, version, and declaration gates above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| LAYER-01 | 16-01 | Amend D-01 with the actual throw boundary and low/high ownership. | ✓ SATISFIED | Source-of-record language verified directly. |
| LAYER-02 | 16-01 | Align all 14 shipped citations. | ✓ SATISFIED | Exact distribution and semantic sweep verified. |
| ECO-01 | 16-02 through 16-07 | Build, test, and emit declarations under TypeScript 7. | ✓ SATISFIED | Compiler, frozen install, build, tests, and declarations pass. |

The requirements file contains no additional Phase 16 requirement IDs not claimed by a plan. The separate roadmap constraint prohibiting TS7-specific production-source changes fails even though ECO-01 itself is satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| Five production files in `ba8a3da6` | commit diff | TS7-specific compatibility edits outside the intended no-source-change boundary | 🛑 Blocker | Contradicts a non-negotiable roadmap success criterion. |

No unreferenced `TBD`, `FIXME`, or `XXX` markers were found in phase-modified implementation files. No TODO/HACK/placeholder evidence formed a user-visible stub.

### Human Verification Required

None. The failing condition is observable from the committed diff and does not require human testing. Developer judgment is required only to choose remediation versus an explicit override.

### Gaps Summary

The layering contract, citations, dependency graph, compiler selection, build, tests, and declaration emission are all proven. The phase nevertheless cannot pass its roadmap contract as written: five production-source files were changed specifically because TypeScript 7 rejected the prior code. Later roadmap phases do not specifically address or supersede this constraint, so the gap is not deferred.

This appears to be an intentional, runtime-neutral compatibility deviation. To accept it, add an override naming the failed must-have, explaining why the four type-only annotations and one NodeNext extension are acceptable, and recording `accepted_by` plus `accepted_at`; otherwise revise the implementation or roadmap criterion.

---

_Verified: 2026-08-19T18:50:13Z_
_Verifier: the agent (gsd-verifier)_
