# Requirements: Applesauce — v1.2 operation-scoped-relay-auth

**Defined:** 2026-08-05
**Core Value:** The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.

**Milestone goal:** Move NIP-42 authentication out of ambient, relay-wide cached state and into the operation that actually receives `auth-required:`, then migrate Concord's stream auth onto that hook instead of its own client-wide registry driver.

**Origin:** three backlog items promoted 2026-08-05 via `/gsd-review-backlog` — 999.5 (drafted plan on disk at `phases/999.5-operation-scoped-nip-42-auth-hooks/`), 999.4, and 999.11 — plus SEED-001's `packages/loaders/` sweep.

## v1.2 Requirements

### RAUTH — Operation-scoped relay auth

`applesauce-relay`, `applesauce-loaders`. Promoted from backlog 999.5.

- [x] **RAUTH-01**: A consumer can pass `onAuthRequired` to a request-like operation and have it invoked with operation-local context — relay, url, challenge, operation, requirement, `missingPubkeys`, reason — when that operation receives `auth-required:`
- [x] **RAUTH-02**: An operation that has not itself received `auth-required:` is never pre-blocked by an earlier unrelated operation's auth failure
- [x] **RAUTH-03**: After the handler resolves, the operation waits for `waitForAuth` to be satisfied and retries, bounded by `authRetries` (default `1`)
- [x] **RAUTH-04**: A consumer can bound the wait with `authTimeout` (default `30_000` ms); `authTimeout: false` waits indefinitely for external auth state to satisfy the operation
- [x] **RAUTH-05**: A handler rejection or timeout rejects only its own operation — concurrent operations each call their own handler, with no relay-internal dedupe
- [x] **RAUTH-06**: `waitForAuth: false` still rejects immediately with `AuthRequiredError` without invoking the handler, and `event(…, "AUTH")` never invokes it
- [x] **RAUTH-07**: The behavior is available on `req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, and negentropy, and passes through `RelayPool` and `RelayGroup`
- [x] **RAUTH-08**: `SyncLoader` threads `onAuthRequired`, `authTimeout`, and `authRetries` into both the negentropy sync path and the paginated request path
- [x] **RAUTH-09**: `authRequiredForRead$` / `authRequiredForPublish$` keep updating for UI and status consumers, as informational state only

### ALOG — Auth lifecycle observability

`applesauce-relay`, `applesauce-loaders`. Promoted from backlog 999.4 + SEED-001.

- [x] **ALOG-01**: An operator can tell from debug output where a NIP-42 auth attempt sits in its lifecycle — challenge received, AUTH sent, result — and why it succeeded or failed
- [x] **ALOG-02**: Auth retry, timeout, and rejection outcomes are attributable to the specific operation that triggered them
- [x] **ALOG-03**: Every `Debugger` in `packages/loaders/` is derived once per module load, per class construction, per context construction, or per function/operator invocation — never on a path a reactive pipeline can re-enter, such as inside a `switchMap`/`mergeMap` projector or a per-item loop body (a correlation logger derived once per call with a generated suffix, e.g. `.extend(nanoid(n))`, remains compliant) (SEED-001)

  Restated from the original wording, which tested for an extend-then-immediately-invoke pattern (`x.extend(...)(...)`) at a log call site — that pattern does not exist anywhere in this monorepo, so the original criterion passed without the `packages/loaders/` sweep ever being performed (D-17). The tightened derive-once-per-lifetime rule above is what Phase 14's sweep actually satisfies (D-18).

### CAUTH — Concord stream-auth cleanup

`applesauce-concord`. Promoted from backlog 999.11. **Hard-blocked on RAUTH landing first**, including both the paginated REQ and negentropy sync paths.

- [x] **CAUTH-01**: Each community and private-channel engine authenticates only the `waitForAuth` pubkeys its own operation is missing, using the keys held by that scope
- [x] **CAUTH-02**: A relay is asked to authenticate only the stream keys the operations actually using that relay require — not every key in the client-wide registry — and a reconnect re-authenticates only that same scoped set
- [ ] **CAUTH-03**: The client-wide driver machinery is removed or narrowed once callers migrate — `authenticateStreamKeys`, `version$`, relay driver reference counting, `ensureAuth()`, and relay-status-driven stream authentication
- [x] **CAUTH-04**: Per-operation auth retries are preserved through the migration

## Future Requirements

Deferred; tracked but not in this roadmap.

### Backlog phases not promoted

- **999.7**: Phase 8 rotation-robustness residuals (WR-01/02/03, IN-01, IN-02) — 12.3's majority-ack gate may have overtaken WR-01; check before scoping
- **999.9**: Invite-bundle rule-table hardening — `RuleFor<V>` binding rule kind to field type, subsuming `RULE_TABLE_SUBJECT_PROOF`
- **999.2**: Concord media epoch-key decryption audit — premise looks wrong; `helpers/imeta.ts` carries per-file keys in the message's own tag rather than resolving from epoch state

### Deferred feature gaps

- **FUT-01**: Public↔private channel conversion and channel rename (CORD-03 §2)
- **FUT-02**: CORD-07 voice transport, if the SDK boundary is ever redrawn

### Verification debt

- Three Nyquist validation gaps (`/gsd-validate-phase` on Phases 10, 12.1, 12.2); five accepted overrides; the `low` 05.1 follow-ups todo

## Out of Scope

| Feature | Reason |
|---------|--------|
| Relay-internal auth dedupe, single-flight guards, or signer-prompt suppression | Apps and libraries own prompt dedupe, signer queuing, retry suppression, and user-intent policy. Putting it in `applesauce-relay` would make concurrent operations share fate — the exact coupling this milestone removes |
| Removing `authRequiredForRead$` / `authRequiredForPublish$` | They stay as informational status for UI consumers (RAUTH-09). Only their use as a *pre-block gate* on operations is removed |
| Reconstructing `.planning/debug/concord-multi-user-auth-churn.md` | Cited by 999.11 as root-cause evidence but never committed (`git log --all -S` finds the name only in `8c97f50b`, the commit that added the backlog entry). Both churn mechanisms are legible from `relay-auth.ts:144/174` and `:65`; CAUTH-02's oracle is derived from the new design, not from a recording of the old behavior |
| A lint rule enforcing the SEED-001 logger convention | Explicitly scoped out at milestone start — ALOG-03 is the `packages/loaders/` sweep only. The rule remains available as a follow-up |
| Concord changesets | `applesauce-concord` is unreleased. `applesauce-relay` and `applesauce-loaders` are published and DO need changesets, one single-sentence body each |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RAUTH-01 | Phase 13 | Complete |
| RAUTH-02 | Phase 13 | Complete |
| RAUTH-03 | Phase 13 | Complete |
| RAUTH-04 | Phase 13 | Complete |
| RAUTH-05 | Phase 13 | Complete |
| RAUTH-06 | Phase 13 | Complete |
| RAUTH-07 | Phase 13 | Complete |
| RAUTH-08 | Phase 13 | Complete |
| RAUTH-09 | Phase 13 | Complete |
| ALOG-01 | Phase 14 | Complete |
| ALOG-02 | Phase 14 | Complete |
| ALOG-03 | Phase 14 | Complete |
| CAUTH-01 | Phase 15 | Complete |
| CAUTH-02 | Phase 15 | Complete |
| CAUTH-03 | Phase 15 | Pending |
| CAUTH-04 | Phase 15 | Complete |

## Verification Standard

Carried forward from v1.1's TEST-01, which remains the project's standing test criterion:

- Assert against a value derived **independently** from the spec or from the new design — never against implementation output. All 189 concord tests passed while 9 HIGH bugs were live because every test compared the implementation to itself.
- Record a RED→GREEN non-vacuity probe so a passing test is known to fail for the right reason.
- Applies with particular force to **CAUTH-02**, whose "before" state has no committed recording.

Minimum gates: `pnpm --filter applesauce-relay test`, `pnpm --filter applesauce-loaders test`, and — once Phase 15 lands — `pnpm --filter applesauce-concord test`. Use `pnpm vitest run <path>` from the repo root for per-file runs; the `--filter … -- <path>` form silently ignores the path.
