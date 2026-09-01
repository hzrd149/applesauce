# Requirements: Applesauce v7.0.0 relay-method-layering

**Defined:** 2026-08-19
**Core Value:** The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.

**Milestone goal:** Make every relay method family honour one rule — a low-level method is a single
interaction with the relay; a high-level method owns the configurable policy — then ship the result,
plus v1.2's held changesets, as the coordinated `applesauce-*@7.0.0` major.

**Scope provenance.** Assembled from recorded backlog analysis (999.12, 999.14, 999.15, 999.16,
999.18, 999.19, 999.20, 999.21, 999.23–999.28) plus three ecosystem seeds (SEED-002/003/004), not
from fresh discovery. Research verified that analysis against source rather than restating it; four
findings changed the plan and are marked **[research]** below.

## v1 Requirements

### Method Layering

- [x] **LAYER-01**: D-01 states the rule that actually holds — throwing as an internal signal is a smell *except* where the immediate consumer is an aggregator over upstream calls or a retry layer over them — with the low/high layering rule recorded alongside it
- [x] **LAYER-02**: All 14 shipped D-01 citations (`relay.ts` ×10, `operators/auth-retry.ts` ×3, `__tests__/relay.test.ts` ×1) state the amended rule, so no comment asserts a rule the code no longer follows

### EVENT Family

- [x] **EVT-01**: `event()` performs exactly one EVENT write and one reply, and throws `AuthRequiredError` when the relay refuses, instead of flattening it into `{ok:false, message}`
- [x] **EVT-02**: `publish()` owns the auth retry loop — it catches `event()`'s throw, runs the handler, waits for auth, and resubscribes to resend
- [x] **EVT-03**: A publish that times out is retryable by `publish({retries})` — today the synthetic timeout *value* sails past `customRetryOperator`, which only sees errors
- [x] **EVT-04**: The `AUTH_PHASE_GATE` module-private symbol and the `message`-string round-trip between `event()` and `publish()` are both gone, so a relay-supplied string no longer discriminates between "I declined to try" and "I tried and gave up"
- [x] **EVT-05**: RAUTH-07's shipped claim (that `event` exposes `onAuthRequired`/`authTimeout`/`authRetries`) is restated with recorded provenance rather than silently edited
- [x] **EVT-06**: `Relay.sync()`'s SEND path and `RelayGroup.event()` — both of which call `event()` directly and get auth retries for free today — have a deliberate, recorded disposition rather than silently losing them

### REQ Family

- [x] **REQ-01**: `req()` is a single REQ interaction — `reconnect`, `resubscribe`, and the auth retry no longer live there
- [x] **REQ-02**: `request()` and `subscription()` each own reconnect, resubscribe, and the auth retry, joining the per-method policy defaults they already supply
- [x] **REQ-03**: `subscription()` owns the re-establish loop, and a re-established subscription's observable behavior is specified: whether the REQ id is reused or minted fresh, whether the consumer sees a second `OPEN`, and whether duplicate filtering holds across the boundary
- [x] **REQ-04**: The applicable Phase 13 invariants (fresh per-attempt `defer`, call-scoped clean-CLOSED repeat state, and synthetic `OPEN` exclusion) are re-verified RED→GREEN; the former manufactured-Group-ERROR progress oracle is superseded/non-applicable because the accepted `authSuspendableLifetime` whole-operation clock consumes no values (Phase 22 gap closure, 2026-09-01)
- [x] **REQ-05**: `RelayReqOptions` sheds `reconnect`/`resubscribe`/the auth options while `RelayRequestOptions` and `RelaySubscriptionOptions` declare them, so passing `reconnect` to `req()` is a type error

### AUTH Family

- [x] **AUTHF-01**: `authenticate()` acquires a challenge rather than reading `this.challenge` synchronously — a bounded wait, so "no challenge yet" on a fresh connection is transient rather than fatal, and a relay that never sends one fails on a clock rather than hanging
- [x] **AUTHF-02**: A challenge that moves while a slow signer (NIP-46 bunker, extension dialog) is signing produces a re-sign and resend within an explicit small bound, instead of writing an AUTH signed against a superseded challenge and reporting the relay's rejection as a refusal
- [x] **AUTHF-03**: Every failure `authenticate()` can produce reaches the caller through the promise rejection, so `.catch()` and `try`/`await` agree (subsumes 999.22)
- [x] **AUTHF-04**: `auth()` remains a single AUTH frame and its one reply, using the same private one-frame/one-reply primitive as `event()` with fixed AUTH routing and never calling `publish()`, so it cannot recurse into the auth loop EVT-02 installs
- [x] **AUTHF-05**: **[research]** `applesauce-loaders`' `RELAY_AUTH_ERROR_NAMES` recognizes every terminal auth error class the relay can raise, with the duck-typed-by-`.name` gap closed so a new class is a visible failure rather than a silent non-match

### COUNT Family

- [x] **COUNT-01**: `count()` is the high-level member of its family — `RelayCountOptions` gains `reconnect`, `retries`, and a configurable `timeout` (today the only operation clock in the package a caller cannot change), and failure surfaces as an error
- [x] **COUNT-02**: `RelayCountResponse` is `{count, approximate?, hll?}`, validated rather than reached by an unchecked `m[2] as RelayCountResponse`, so a malformed payload is an error rather than a typed lie
- [x] **COUNT-03**: A register-wise max merge over NIP-45's 256-register `hll` payload ships, so a correct cross-relay total is constructible at all
- [ ] **COUNT-04**: One failing or offline relay costs the caller that relay's number, not every relay's — `RelayGroup.count()` isolates per relay instead of propagating the first error through `combineLatest`
- [ ] **COUNT-05**: `RelayGroup.count()` emits progressively as each relay answers, rather than withholding every count until the slowest relay returns

### Negentropy and Sync

- [ ] **SYNC-01**: Multi-round reconciliation reaches the wire — `negentropySync` sends its computed follow-up message — proven by a test whose data deliberately exceeds the frame-size threshold to force a second round
- [ ] **SYNC-02**: `negentropy()` emits what it learns per round without blocking on the caller's transfers, so negotiation runs at protocol speed as NIP-77 describes
- [ ] **SYNC-03**: `sync()` owns the policy: one auth budget for the operation rather than three independent ones, an operation clock where none exists today, reconnect handling, and explicit bounded transfer concurrency
- [ ] **SYNC-04**: `sync()` reports both directions — a SEND's outcome is observable rather than silently swallowed, so "Upload complete" cannot print when every upload was rejected

### Group Error Surface

- [x] **GROUP-01**: `RelayGroup.request()` and `subscription()` error when every relay has failed — **on by default** — so total failure is no longer reported as an empty completion or an indefinite silent hang
- [x] **GROUP-02**: The raised aggregate carries every relay's own cause, keyed by relay URL, rather than collapsing them into one bare message
- [x] **GROUP-03**: **[research]** The aggregate error's per-relay causes and the progressive count record's failed-relay entries use **one** representation of "per-source outcome keyed by relay URL", not two independently-designed shapes for the same idea
- [x] **GROUP-04**: One public `timeout` bounds finite request — 30 seconds by default — and activity, retries, and reconnections never disarm or reset it; persistent subscriptions have no built-in duration or inactivity clock (Phase 22 D-23/D-24 amendment)
- [x] **GROUP-05**: The request whole-operation clock pauses with its remaining budget while the call-scoped shared auth gate is active, resuming only after overlapping auth phases finish; subscription lifetimes are caller-composed (Phase 22 D-23/D-24 amendment)

### Correctness Fixes

- [x] **FIX-01**: `parseClosedError`'s prefix lookup cannot reach the prototype chain at all (a `null`-prototype map or `Object.hasOwn` guard), rather than filtering `constructor`/`__proto__` by name and leaving the next inherited key open
- [x] **FIX-02**: `applesauce-sqlite` declares its four SQLite drivers optional via `peerDependenciesMeta`, so a consumer installs only the backend it uses
- [x] **FIX-03**: NIP-29 group identifiers round-trip their port and protocol — `ws://localhost:4869` survives encode→decode instead of becoming `wss://localhost`

### Review Residuals

- [x] **RESID-01**: A single relay's AUTH rejection no longer latches a permanent `error$` on an otherwise-working community — there is a clear-on-recovery path, not merely a reset of `started`
- [x] **RESID-02**: `revoke()`/`revokeBundle()` report a publish failure rather than absorbing it and returning `revoked: true`, so the UI cannot call a link dead while it still resolves
- [ ] **RESID-03**: The two Phase 13 residuals with reachable behavioral consequence are closed — the negentropy non-auth fallback force-closes open auth phases, and `Relay.sync()`'s RECEIVE branch does not reject with `EmptyError` on a zero-event EOSE
- [x] **RESID-04**: No comment, doc, or changeset in the shipped packages asserts behavior the code does not have — covering WR-06's publish `error` discriminator, WR-03's false progress-predicate comment, and WR-09's stale `timeout` doc

### Release

- [ ] **REL-01**: **[research]** Every package intended to reach 7.0.0 actually reaches it. The config uses changesets' `linked`, not `fixed`, so a package bumps only via its own changeset or a real dependency cascade — the release carries an explicit per-package checklist verified by a dry run, not an assumption that one major changeset sweeps all fourteen
- [ ] **REL-02**: `applesauce-concord` publishes as `7.0.0` to `latest` — its first official stable release, with a changelog that starts from zero rather than explaining removals from `next`-tagged snapshots
- [ ] **REL-03**: v1.2's held `applesauce-relay` and `applesauce-loaders` changesets ship in this release
- [ ] **REL-04**: Each changeset file describes exactly one change in a single sentence, per the repo's changeset convention

### Ecosystem

- [x] **ECO-01**: The workspace builds, tests, and emits declarations under TypeScript 7
- [ ] **ECO-02**: **[research]** `applesauce-react`'s already-declared React 19 support is backed by evidence — the package's first rendering tests exist and pass against both React 18 and 19, covering `use$`/`useObservableState` and the providers
- [ ] **ECO-03**: `apps/examples` runs on `@snort/worker-relay` v2, with the removed `insertBatchSize` option and the now-synchronous `setEventMetadata` handled at both call sites

## Future Requirements

Tracked, not in this roadmap.

### Observability

- **DEBUG-01**: Replace the `debug` dependency (999.17) — the one rider that genuinely needs a major, deliberately deferred as the largest. 109 `.extend()` sites, 52 `Debugger` type references, ~125 printf sites, and both test capture harnesses need a replacement mechanism

### COUNT

- **COUNT-F1**: HyperLogLog cardinality estimation on top of the merged registers — separable from the merge itself, and the part with the most room to be subtly wrong

### Group

- **GROUP-F1**: `RelayGroup.sync()` and `RelayGroup.negentropy()` group-level reporting — both drop per-relay failure today (to `EMPTY` and a literal `true` respectively); 999.28 leaves the shape explicitly open, and no surveyed implementation offers a convention to borrow

### Concord

- **CONC-F1**: Invite-bundle rule-table hardening (999.9) — guardrail only, zero live defects across all 26 rules
- **CONC-F2**: Phase 8 rotation-robustness residuals (999.7) — check first whether 12.3's majority-ack gate already overtook WR-01
- **CONC-F3**: Media epoch-key decryption audit (999.2) — verify the premise before scoping; `helpers/imeta.ts` appears to carry per-file keys in the message's own tag rather than resolving from epoch state
- **FUT-01**: Public↔private channel conversion and channel rename (CORD-03 §2)

## Out of Scope

| Feature | Reason |
|---------|--------|
| A low-level COUNT method | Resolved 2026-08-19: the count family has only a high-level member. The raw form has exactly one consumer in the repo, and the group can wrap the high-level method as `group.publish()` already does. Extract one later only if real demand appears |
| Replacing `debug` (999.17) | Needs a major and this is one — but it is the largest rider by far, and bundling it with a large internal refactor multiplies the surface under test. Deferred deliberately, not by omission |
| CORD-07 voice transport (FUT-02) | HTTPS/WebRTC concerns, not Nostr event handling — defensibly outside an events SDK |
| A lint rule enforcing no-throw-as-internal-signal | LAYER-01's amendment makes a naive rule flag correct code; it would have to understand the aggregator/retry boundary or not exist |
| Value-signalling the remaining `CLOSED` prefixes | Partly unnecessary under the amended D-01 — where the consumer is a retry layer, a throw is being handled deliberately rather than filtered through an uninterested intermediary |
| Re-auditing the three Nyquist validation gaps | Phases 10, 12.1, 12.2 carry `/gsd-validate-phase` gaps from v1.1; acknowledged and carried, not resolved here |
| Bundling every ecosystem bump | SEED-002/003/004 ride along because they are small and the packages republish anyway. 999.17 does not, on the same reasoning applied honestly |

## Traceability

Populated during roadmap creation 2026-08-19. All 46 v1 requirements map to exactly one of the 11 phases (16–26) in ROADMAP.md.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LAYER-01 | Phase 16 | Complete |
| LAYER-02 | Phase 16 | Complete |
| EVT-01 | Phase 18 | Gaps Found |
| EVT-02 | Phase 18 | Gaps Found |
| EVT-03 | Phase 18 | Gaps Found |
| EVT-04 | Phase 18 | Gaps Found |
| EVT-05 | Phase 18 | Gaps Found |
| EVT-06 | Phase 18 | Gaps Found |
| REQ-01 | Phase 22 | Complete |
| REQ-02 | Phase 22 | Complete |
| REQ-03 | Phase 22 | Complete |
| REQ-04 | Phase 22 | Complete |
| REQ-05 | Phase 22 | Complete |
| AUTHF-01 | Phase 20 | Complete |
| AUTHF-02 | Phase 20 | Complete |
| AUTHF-03 | Phase 20 | Complete |
| AUTHF-04 | Phase 20 | Complete |
| AUTHF-05 | Phase 20 | Complete |
| COUNT-01 | Phase 19 | Complete |
| COUNT-02 | Phase 19 | Complete |
| COUNT-03 | Phase 19 | Complete |
| COUNT-04 | Phase 23 | Pending |
| COUNT-05 | Phase 23 | Pending |
| SYNC-01 | Phase 24 | Pending |
| SYNC-02 | Phase 24 | Pending |
| SYNC-03 | Phase 24 | Pending |
| SYNC-04 | Phase 24 | Pending |
| GROUP-01 | Phase 21 | Complete |
| GROUP-02 | Phase 21 | Complete |
| GROUP-03 | Phase 21 | Complete |
| GROUP-04 | Phase 21 | Complete |
| GROUP-05 | Phase 21 | Complete |
| FIX-01 | Phase 17 | Gaps Found |
| FIX-02 | Phase 17 | Gaps Found |
| FIX-03 | Phase 17 | Gaps Found |
| RESID-01 | Phase 17 | Gaps Found |
| RESID-02 | Phase 17 | Complete |
| RESID-03 | Phase 24 | Pending |
| RESID-04 | Phase 18 | Gaps Found |
| REL-01 | Phase 26 | Pending |
| REL-02 | Phase 26 | Pending |
| REL-03 | Phase 26 | Pending |
| REL-04 | Phase 26 | Pending |
| ECO-01 | Phase 16 | Complete |
| ECO-02 | Phase 25 | Pending |
| ECO-03 | Phase 25 | Pending |

**Coverage:**

- v1 requirements: 46 total
- Mapped to phases: 46
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-19*
*Last updated: 2026-08-19 after initial definition*
*Traceability populated: 2026-08-19 during roadmap creation — 46/46 v1 requirements mapped across 11 phases (16–26), 0 orphans.*
