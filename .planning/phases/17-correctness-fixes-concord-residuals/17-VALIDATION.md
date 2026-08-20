---
phase: 17-correctness-fixes-concord-residuals
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-08-20
---

# Phase 17 Validation Strategy

## Requirement Evidence

| Requirement | Behavioral evidence | Automated command |
|---|---|---|
| FIX-01 | Hostile/unknown CLOSED prefixes exercise public REQ retry behavior; known prefix control preserves D-07 classification | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts` |
| FIX-02 | Exact four-peer metadata assertions plus packed tarball installed in an isolated one-backend consumer | `pnpm --filter applesauce-sqlite build && node packages/sqlite/scripts/verify-optional-peers.mjs` |
| FIX-03 | Independently expected, table-driven normalized pointer matrix including ports, IPv6, paths/queries, apostrophe IDs, defaults, and fragment rejection | `pnpm --filter applesauce-common exec vitest run src/helpers/__tests__/groups.test.ts` |
| RESID-01 | Rejected/thrown AUTH leaves both engines' UI errors null; fatal lifecycle controls still populate them | `pnpm --filter applesauce-concord exec vitest run src/client/__tests__/community.test.ts src/client/__tests__/private-channel.test.ts` |
| RESID-02 | Empty/all-failed/partial-success and unregister failure cover both revocation branches and local-state ordering | `pnpm --filter applesauce-concord exec vitest run src/client/__tests__/client.test.ts -t "revoke|revocation"` |

## Package and Phase Gates

- Per plan: run the focused test before the complete affected-package suite/build.
- SQLite: validate the packed manifest and downstream install because workspace state cannot prove peer behavior.
- Concord: run the full suite after plan 05 because plans 04 and 05 share engine/test surfaces.
- Phase close: `pnpm --filter applesauce-relay test && pnpm --filter applesauce-sqlite test && pnpm --filter applesauce-common test && pnpm --filter applesauce-concord test && pnpm run build`.
- Changesets: require one sentence and one change per file; relay, SQLite, and common each receive one changeset, while Concord receives separate RESID-01 and RESID-02 changesets.

## Non-Vacuity and Mutation Checks

- FIX-01: temporarily restore object property indexing; the `constructor` public-path case must fail at the inherited constructor boundary.
- FIX-02: remove any one `optional: true`; the exact-set/packed-manifest assertion must fail.
- FIX-03: restore `.hostname`; the localhost port and path/query rows must fail.
- RESID-01: restore either `onAuthFailure -> error$.next`; the matching engine test must fail while fatal controls remain green.
- RESID-02: treat every resolved response array as success; empty/all-failed tests and false-local-state assertions must fail.

## Source Coverage Audit

| Source | ID | Item | Plan | Status |
|---|---|---|---|---|
| GOAL | — | Five independent relay/SQLite/group-pointer/Concord defects fixed without re-layering | 01-05 | COVERED |
| REQ | FIX-01 | Prototype-safe CLOSED lookup | 01 | COVERED |
| REQ | FIX-02 | Four optional SQLite peers | 02 | COVERED |
| REQ | FIX-03 | Lossless group-pointer scheme/port round trip | 03 | COVERED |
| REQ | RESID-01 | AUTH cannot latch fatal UI error | 04 | COVERED — prevention supersedes earlier clear-on-recovery wording |
| REQ | RESID-02 | Revocation reports failed publication | 05 | COVERED |
| CONTEXT | Relay/SQLite decisions | Internal Map, no public prefix API, all four optional peers, public/packed tests | 01-02 | COVERED |
| CONTEXT | Group-pointer decisions | First delimiter, full normalized endpoint, arbitrary ID, fragments rejected, NIP-29 distinction | 03 | COVERED |
| CONTEXT | Concord UI decisions | Fatal-only errors, preserve auth diagnostics/caller path, provenance restatement | 04 | COVERED |
| CONTEXT | Revocation decisions | Any-ok success, aggregate evidence, ordered local/network stages, stable return type | 05 | COVERED |
| RESEARCH | Architecture/security/validation constraints | Exact seams, no installs, isolated package gates, threat mitigations | 01-05 | COVERED |

Deferred public CLOSED-prefix registration and replacement/expansion of Concord `error$` are intentionally excluded.

## Failure Policy

Any secret/token in logs or aggregate errors, local tombstone before its network prerequisite, public prefix-registration export, removed SQLite backend peer, or regression of fatal lifecycle error reporting is a stop-and-investigate result rather than authority to broaden scope.
