---
phase: 20
slug: auth-family-re-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-31
---

# Phase 20 — Validation Strategy

## Test Infrastructure

| Property | Value |
|---|---|
| Framework | Vitest 4, mock WebSocket server, fake timers, deferred signers, and TypeScript 7 |
| Quick run | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts -t "authenticate|challenge|AUTH"` |
| Type boundary | `pnpm --filter applesauce-relay exec tsc -p tsconfig.type-tests.json --noEmit` |
| Full phase gate | Plan 20-04 Task 2 command |

## Sampling Rate

- After each task: run its focused command; run the relay build whenever public declarations change.
- After each wave: run the affected package's complete test suite.
- Before verification: run the compiler fixture, Relay/Loaders/Concord/Extra tests and builds, docs build, changeset audit, and fixed-routing static checks.
- Keep iterative targeted commands under 60 seconds; the full cross-package gate is reserved for phase close.

## Per-Task Verification Map

| Task | Wave | Requirements | Evidence | Automated command | Status |
|---|---:|---|---|---|---|
| 20-01-01 | 1 | AUTHF-04 | Real-wire fixed EVENT/AUTH routing, listener order, verdict/translation, state identity | focused relay test + build | pending |
| 20-01-02 | 1 | AUTHF-04 | Compile-time rejection of `event(event, "AUTH")` | explicit type-test tsconfig | pending |
| 20-02-01 | 2 | AUTHF-01, AUTHF-03 | Fresh-connect wait, 30s-default whole deadline, signer/transport/reply rejection | focused relay test + build | pending |
| 20-02-02 | 2 | AUTHF-02, AUTHF-03 | Freshness matrix, abort/late suppression, multi-await/call independence, newest state, redacted logs | relay + lifecycle suites | pending |
| 20-03-01 | 3 | AUTHF-05 | Actual exported errors classify in Group and loaders; non-auth control does not | Group + loader tests/build | pending |
| 20-03-02 | 3 | AUTHF-03 | Concord verdict/rejection and Vertex raw auth compatibility | package tests/builds | pending |
| 20-04-01 | 4 | AUTHF-01..04 | Docs build and authoritative provenance audit | docs build + positive searches | pending |
| 20-04-02 | 4 | AUTHF-01..05 | Exact changeset, static contract, and complete package gates | Plan 20-04 exact command | pending |

## Wave 0 Requirements

- [ ] Create the explicit compile-included selector fixture and prove it is RED before public narrowing.
- [ ] Add raw frame parity cases before extracting the private helper.
- [ ] Add fresh-connect, no-challenge, deferred-signer, freshness, abort, multi-await, and concurrency cases before changing authenticate().
- [ ] Add actual-error-instance classifier cases before adding the new names.

Each owning task writes its failing evidence before production changes, so no missing automated placeholder remains.

## Non-Vacuity Gates

- Temporarily restore the second public event argument; the `@ts-expect-error` fixture must fail as unused.
- Temporarily route auth-required AUTH replies through EVENT translation; the AUTH verdict test must fail.
- Temporarily omit the post-sign challenge comparison; the stale-candidate frame test must observe an invalid AUTH write.
- Temporarily reset the freshness counter per attempt; exact exhaustion/frame-count coverage must fail.
- Temporarily remove either new classifier name; the actual-instance Group/loader parity case must fail.

## Failure Policy

Any stale AUTH write, synchronous no-challenge throw, outer clock reset, late post-abort write/state update, AUTH recursion into publish, old response overwriting new same-pubkey state, terminal error falling into loader fallback, or full sensitive value in logs is stop-and-investigate.

## Validation Sign-Off

- [x] Every task has an automated verification command.
- [x] Every locked D-01 through D-22 maps to a plan and executable evidence.
- [x] Compile-time and runtime API proofs are independent.
- [x] No package install or human-only verification is required.
- [ ] Wave 0 failing fixtures created and restored green during execution.
- [ ] Set `nyquist_compliant: true` only after executed evidence is reconciled.

**Approval:** pending
