# Project Research Summary

**Project:** applesauce v7.0.0 relay-method-layering
**Domain:** TypeScript/RxJS reactive Nostr SDK, 14-package pnpm monorepo, brownfield architectural re-layering
**Researched:** 2026-08-19
**Confidence:** HIGH overall — every researcher verified claims directly against source, live registries, or official spec/tooling docs, not recall. Two areas remain explicitly MEDIUM/LOW (React 19 runtime behavior; NIP-45/negentropy JS prior art) and are called out below.

## Executive Summary

This milestone relocates retry/reconnect/auth/timeout policy from low-level to high-level methods across `applesauce-relay`'s five method families (EVENT, REQ, AUTH, COUNT, NEGENTROPY), and rides three small ecosystem bumps (TypeScript 7, React 19 dual support, `@snort/worker-relay` v2) under one coordinated `applesauce-*@7.0.0` release. The architecture, feature, and pitfalls research all independently confirm the roadmap's own 999.x backlog analysis is directionally correct — but four findings **change the plan** rather than confirm it, and all four are consequential enough that they must reach the roadmapper, not just this document.

The single highest-value finding: **the milestone's own recorded assumption about how the v7.0.0 major gets cut is wrong.** `.planning/ROADMAP.md` states that a major changeset on any package bumps every package — that is `changesets`' `fixed`-group behavior. This repo's `.changeset/config.json` uses `linked`, which only bumps packages that have a changeset of their own (or inherit one via a real dependency cascade). Concretely, `applesauce-concord` (planned as v7's first stable release), `applesauce-react`, and `applesauce-sqlite` have no code changes of their own in the confirmed 999.x scope and no dependency path that would sweep them in — under `linked`, they will silently stay on 6.x while their 11 siblings jump to 7.0.0, unless someone files an explicit changeset for each. This is not a hypothetical; it is the default outcome of the current config against the current scope, verified against both the live `.changeset/config.json` and changesets' own docs by two independent researchers.

Three more findings should shape phase sequencing and scope: an undocumented dependency where `Relay.sync()` calls the low-level `event()`/`req()` directly (bypassing `publish()`/`request()`/`subscription()` entirely) means the negentropy re-layering (999.28) must be sequenced *after* the EVENT/REQ re-layering (999.24/999.25), not parallel to it, contrary to what the roadmap's four recorded dependencies imply; `applesauce-loaders`' duck-typed `RELAY_AUTH_ERROR_NAMES` set creates a silent (not compiler-caught) breakage risk if 999.26 adds a new terminal auth error class without updating it in the same change; and React 19 support, already declared in `package.json` peer ranges, has literally zero rendering tests behind it today — SEED-003 is a "write the first tests this package has ever had, then run them twice" phase, not a version bump. The main mitigation across all four: treat each as an explicit checklist item in the phases that touch it (999.23's release-mechanics gate for changesets; 999.28's plan for the sync() dependency; 999.24/999.25/999.26's plans for the loaders mirror; a dedicated multi-step SEED-003 phase for React 19), rather than relying on the roadmap's existing text, which does not currently mention any of the four.

## Key Findings

### Recommended Stack

The relay re-layering itself introduces no new dependencies — it's internal restructuring. The only stack-relevant surface is three ecosystem riders plus release mechanics.

**Core technologies:**
- `typescript@^7.0.2` — GA, same `tsc` CLI as 5.x/6.x, empirically verified zero tsconfig incompatibilities in this repo (no TS7-removed flags anywhere); safe to land first/early since it changes the compiler everything else builds with.
- React 19 peer support (`react: ^18.0.0 || ^19.0.0`) — declaration already shipped in `packages/react/package.json`, but never tested: zero rendering tests exist in the package (only export-snapshot tests). Needs `@testing-library/react@^16.3.2` + `jsdom` added as devDependencies, and the first real rendering tests written before the claim is trustworthy.
- `@snort/worker-relay@2.0.1` — used only in `apps/examples`, which is `changesets`-`ignore`d; confirmed real breaking changes exist (`insertBatchSize` removed, `setEventMetadata` now sync) but this rider touches **no published package** and needs no changeset at all.

### Expected Features

Five capabilities land in this milestone; all are internal-library correctness fixes, not product features, but each has an outside-convention answer worth matching:

**Must have (table stakes):**
- Group operation raises a real aggregate error only when *every* relay fails (matches `AggregateError`/`Promise.allSettled`/HTTP-207/DynamoDB convention universally).
- Aggregate error carries per-relay causes as `Record<url, unknown>`, not a flattened string.
- Idle/silence timeout semantics for streaming operations (RxJS `timeout()`'s `each` mode) — the codebase's *existing* first-progress-only clock is the outlier here, not the target.
- Progressive fan-out results keep every known relay's key in the record even on failure (never omit — every convention surveyed treats omission as an information-loss bug).
- `count()`'s NIP-45 `approximate`/`hll` fields typed and validated, not cast away.
- Negentropy sync must reach the wire for more than one round (currently shipped but inert).

**Should have (differentiators):**
- Composable error conditions (`errorWhen`/`errorOnAny`) symmetric with the existing `completeWhen` vocabulary — a genuine gap in the RxJS ecosystem, not "catch up to convention."
- Timeout expressed in the same composable vocabulary as failure conditions — ahead of every surveyed library (RxJS, undici, axios all treat timeout and aggregate-failure as separate concerns).
- HLL merge helper shipped alongside raw registers, NIP-45-shaped (no existing JS library is NIP-45-shaped; register-wise max-merge is a small amount of genuinely new code, not a wrapper).
- Typed bidirectional `SyncMessage` progress union — no negentropy implementation surveyed (strfry, rust-nostr) exposes this; judged on its own merits, no prior art to benchmark against.

**Defer (fast-follow, doesn't block the capability):**
- HLL cardinality-estimate convenience helper (register-merge itself is core; estimation on top is separable).
- `RelayGroup.sync()`/`negentropy()`'s group-level reporting — 999.28 leaves this explicitly open.
- `sent` emission on negentropy SEND success.

**Convergence flag (not currently called out in ROADMAP):** 999.20's aggregate-error shape (`Record<url, unknown>` of causes) and 999.21's progressive-result failure shape (`T | { error: unknown }` per relay) are the same underlying concept — "per-source outcome keyed by relay URL" — and should converge on one representation. Shipping two independently-designed shapes for the same idea forces consumers to learn both.

### Architecture Approach

The layering rule (999.23) is a relocation-of-ownership refactor: low-level methods (`event()`, `req()`, `negentropy()`, `auth()`) do one interaction and throw on failure; high-level methods (`publish()`, `request()`, `subscription()`, `sync()`, `authenticate()`) own all configurable policy. `count()` is the sole exception — high-level-only, no separate low-level member. The shared RxJS machinery (`authRetry`, `suspendableTimeout`, `AuthPhaseGate`) stays put; what moves is which method invokes it.

**Major components:**
1. `Relay` (`relay.ts`, 1828 lines) — the five method families; today several high-level methods (`sync()` most notably) bypass their own high-level siblings and call low-level methods directly, forfeiting policy.
2. `RelayGroup` (`group.ts`) — fans methods across N relays; `publish()` is the already-correct precedent (isolated, per-relay error wrapping) that `count()` (999.21) and the error-condition work (999.20) should match.
3. `RelayPool` (`pool.ts`) — pure structural delegation; needs **zero** edits this whole milestone (every option type is derived via `Parameters<RelayGroup[...]>`).
4. `applesauce-loaders`' `sync-loader.ts` — a deliberate, dependency-free structural mirror of relay's auth types (D-06); correct today but has no compiler enforcement, and duck-types terminal auth error classes by `.name` string rather than importing them.

**Undocumented dependency (architecture researcher's most consequential finding):** `Relay.sync()`'s SEND path calls `event()` directly at `relay.ts:1677`, and its RECEIVE path calls `req()` directly at `relay.ts:1689` — bypassing `publish()`/`request()`/`subscription()` entirely. None of ROADMAP's four recorded dependencies (999.23 gates all; 999.24 before 999.25; 999.27 before 999.21; 999.20 before 999.25) mention this. Practical consequence: 999.28 (negentropy re-layer) should be sequenced *after* 999.24 and 999.25 land, not run in parallel — otherwise its rewiring of `sync()`'s internals is written against call sites that change out from under it mid-milestone.

**Two additional real (not spurious) findings from source, not restated from ROADMAP:**
- 999.20 and 999.25 share more file surface than "the same clock" — both touch `group.ts`'s `request()`/`subscription()` bodies directly, reinforcing the "999.20 before 999.25" ordering as a genuine file conflict, not just caution.
- The `AUTH` family has zero group/pool surface — `authenticate()` is `Relay`-only, with no recorded backlog entry proposing to add one. Worth flagging to the roadmapper as an open question, not a defect.

### Critical Pitfalls

1. **The `linked`-vs-`fixed` changesets gap (see Executive Summary).** Independently found by both the stack and pitfalls researchers, verified against the live `.changeset/config.json`. Avoid by treating "which packages get an explicit v7 changeset" as a 999.23 checklist item, and running a dry-run `changeset status --verbose --since=master` (or `version --snapshot`) diffing all 14 `package.json` versions before cutting — not trusting the config to guarantee lockstep.
2. **Nested retry/reconnect budgets multiply, not add, when a retry loop is relocated up a layer.** The codebase has already hit and fixed this once (D-07's `RelayClosedError` skip); 999.24/999.26 both explicitly flag needing to re-derive it once two loops share one method's scope. Avoid with an explicit, written "which loop owns which failure class" note per re-layered pair, enforced by a type check, plus a hot-loop test asserting an exact wire-send upper bound against an always-refusing relay.
3. **`suspendableTimeout` silently regresses to a bare `rxjs timeout()`.** Both compile identically at the call site; only a mutation-check test (swap to bare `timeout()`, confirm a named regression test goes red) catches the regression. Highest risk for 999.28's `sync()` clock, which has no existing suspendable implementation to copy from.
4. **Progress-predicate/union totality guards regress under a convenient `as` cast** when a union widens (`RelayCountResponse` gaining fields, `sync()`'s emission widening to a discriminated union). This is the exact defect class Phase 13 took three rounds to close; each newly-widened union needs its own exhaustive, uncast predicate — nothing forces that to happen automatically.
5. **The existing test suite is structurally blind to the exact defect being fixed.** Documented, not hypothetical: `relay.test.ts:2748` deliberately keeps negentropy fixtures under the 32-item frame-size threshold, so multi-round reconciliation (999.28's entire subject) is never exercised by anything today. Same shape for NIP-45 HLL merge correctness — a test asserting `count()` "returns a number" cannot distinguish correct merge from incorrect summing. Both need specific fixture shapes (frame-size-exceeding data; independently hand-computed union cardinality), not general care.

## Implications for Roadmap

The roadmap's own 999.x backlog already defines the phase-level design decisions; research confirms the shape but surfaces sequencing corrections and scope additions the roadmapper should fold in.

### Phase A: Release-mechanics gate (999.23 + changesets correction)
**Rationale:** Comment/doc-only, zero behavior risk, gates every other phase's plan text (the amended D-01 rule). Must also absorb the `linked`-vs-`fixed` correction now, while it's cheap, not discovered after `changeset publish`.
**Delivers:** Amended D-01 across all 14 shipped-source citations; an explicit checklist requirement that every one of the 14 packages gets a changeset this release (even a trivial "republish under v7" one for packages with no other work), and a dry-run version-diff step before cutting.
**Avoids:** Pitfall 1 (silent stay-on-6.x for concord/react/sqlite).

### Phase B (parallel tracks): EVENT (999.24), COUNT (999.27), AUTH (999.26+999.22)
**Rationale:** Confirmed independent by file-touch analysis — no shared files, no cross-dependency. EVENT is deliberately the smaller surface used to "prove the pattern" before the larger REQ re-layer.
**Delivers:** `publish()` becomes sole owner of retry/timeout policy; `count()` gains configurable timeout/retries and widened, validated `{count, approximate?, hll?}` response; `authenticate()` gains its first-ever options type.
**Avoids:** Pitfall 2 (nested budget multiplication) — flag explicitly in each of these three phases' plans, not just 999.24's.

### Phase C: Group error conditions + timeout-as-condition (999.20)
**Rationale:** Must resolve its `ctx`-carrying-gate design fork before the REQ re-layer starts, since that fork shapes `suspendableTimeout`'s signature for every later consumer.
**Delivers:** `errorWhen`/`errorOnAny`/`errorOnAllRelaysFailed`, `GroupAllRelaysFailedError`, idle-mode suspendable clock.
**Addresses:** Table-stakes error/timeout features from FEATURES.md.
**Note for requirements:** settle the aggregate-error-shape vs. progressive-result-shape convergence (see Convergence flag above) here, before 999.21 independently invents a second shape for the same concept.

### Phase D: REQ re-layer (999.25) — largest, highest-risk single phase
**Rationale:** Depends on 999.24 (pattern proven) and 999.20 (shared file surface, clock shape settled). Nothing else should touch `relay.ts`'s req/request/subscription section or `group.ts`'s equivalent while this is in flight.
**Delivers:** `request()`/`subscription()` become owners of reconnect+resubscribe; `subscription()` gains its re-establish loop (a structural rewrite, not a relocation).
**Avoids:** Pitfall 5 (defer/resubscribe double-send or lost-send) and Pitfall 6 (reconnect duplicate/dropped events) — both need dedicated regression tests, not folded into general "eventually succeeds" criteria.

### Phase E (parallel after D): Group count isolation (999.21) and negentropy re-layer (999.28)
**Rationale:** 999.21 depends only on 999.27 (Phase B) and can start as soon as that lands, in parallel with Phase D. 999.28 must wait for **both** 999.24 and 999.25 — the newly-identified `sync()` bypass dependency — so it starts only after Phase D closes, contrary to any reading of ROADMAP's four recorded dependencies alone.
**Delivers:** Progressive per-relay count record with HLL register-merge; non-blocking multi-round `negentropy()` with explicit bounded transfer concurrency and a typed `SyncMessage` union.
**Avoids:** Pitfall 8 (test-blind fixtures) — 999.28 needs a fixture that provably exceeds the negentropy frame-size threshold (verify the actual constant, ~32 items observed); 999.21 needs the HLL merge asserted against an independently hand-computed union cardinality, not implementation self-comparison.

### Phase F: Ecosystem riders (SEED-002/003/004) — sequence relative to the above, not inside it
**Rationale:** TypeScript 7 (SEED-002) should land early/first — it changes the compiler the exhaustiveness guards in Phase C/D/E rely on, and should not be bundled into the same review pass as those phases (a compiler-behavior change must not be misattributed to a logic bug or vice versa). React 19 (SEED-003) and `@snort/worker-relay` (SEED-004) can run fully independently on separate branches/commits.
**Delivers:** TS7 version bump (one small phase, empirically zero incompatibilities); React 19's *first-ever* rendering tests for `packages/react` run twice (once per major) — this is a multi-plan phase, not a version bump, because the tests don't exist yet; `@snort/worker-relay` v2 bump confined to `apps/examples`, needing **no changeset** since that app is `changesets`-ignored.
**Research flag:** SEED-003 needs its own scoped plan for "write rendering tests for `use$`/`useObservableState`/the three providers" before the React-19-support claim can be trusted — this is unbounded-until-attempted work per the stack researcher.

### Phase Ordering Rationale

- `999.23 → {999.24 ∥ 999.27 ∥ 999.26+999.22} → 999.20 → 999.25 → {999.21 (needs only 999.27) ∥ 999.28 (needs 999.24+999.25)}`, confirmed by direct call-graph and file-touch analysis, not restated from ROADMAP.
- Two dependencies not present in ROADMAP's own four: 999.28 must follow 999.24+999.25 (sync()'s direct low-level calls); 999.20 and 999.25 share more file surface than "the same clock" (both touch `group.ts` request/subscription bodies directly).
- SEED-002 (TypeScript 7) should land before or isolated from the exhaustiveness-guard-heavy phases (999.20/21/27/28) so compiler-behavior changes and logic-bug fixes aren't conflated during review.

### Research Flags

Phases likely needing deeper research during planning:
- **999.25 (REQ re-layer / subscription reconnect):** three genuinely unresolved design questions (watermark on reconnect, subscription-id reuse, dedupe-boundary scope) with no single right answer in prior art — flagged as the milestone's own stated highest-risk area.
- **999.28 (negentropy):** highest-complexity item; no JS prior art for a typed bidirectional sync progress union; needs a fixture design that provably exceeds the frame-size threshold.
- **SEED-003 (React 19):** genuinely open until the first rendering tests are written and run against both majors — cannot be resolved by research alone, only by building the test harness.
- **999.20 (error conditions + timeout-as-condition):** the `ctx`-carrying-gate design fork is called "effectively decided" by feature research (Option 1, context-aware factory) but should be explicitly confirmed against 999.25's downstream needs before that phase starts.

Phases with standard patterns (skip research-phase):
- **999.23 (D-01 amendment):** comment/doc-only, well-scoped.
- **999.24 (EVENT re-layer):** smaller surface, deliberately used to prove the pattern; existing D-07 precedent to follow.
- **999.27 (COUNT):** self-contained, zero cross-family call-graph coupling, NIP-45 spec text is unambiguous.
- **SEED-002 (TypeScript 7):** empirically verified zero incompatibilities; a version-bump-and-green-check phase.
- **SEED-004 (`@snort/worker-relay`):** confined to `apps/examples`, breaking changes fully enumerated by `.d.ts` diff, no changeset/release coordination needed at all.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH for TS7 and changesets `linked` mechanics (live registry checks + official docs + direct compile test); MEDIUM for React 19 runtime behavior (peer-range declaration verified, but no rendering tests exist yet to verify actual behavior under React 19's Strict Mode) |
| Features | MEDIUM-HIGH — library/spec conventions (RxJS, AggregateError, HTTP multi-status, NIP-45, NIP-77) verified against primary sources; LOW specifically for JS-nostr-specific HLL prior art (none found; the merge/estimate split is inferred from general-purpose HLL libraries, not a NIP-45-shaped precedent) |
| Architecture | HIGH — every claim checked against actual source with file:line citations; one line-number discrepancy against ROADMAP's own citation found and corrected (`relay.ts:1175` vs. actual `:1177`, claim itself confirmed correct) |
| Pitfalls | HIGH for changesets/release-tooling and RxJS/defer/retry findings (verified against actual repo source and upstream docs); MEDIUM for general RxJS operator-composition folklore not specific to this codebase |

**Overall confidence:** HIGH — the research pass functioned as intended (verifying and extending the roadmap's own analysis against outside convention), and every load-bearing claim above traces to a live source check, not recall. The two explicitly-flagged soft spots (React 19 runtime behavior, HLL JS prior art) are both areas where no amount of research resolves the gap further — they require building the test harness (React 19) or writing the NIP-45-specific implementation (HLL merge) to close.

### Gaps to Address

- **`.changeset/*.md` files for this milestone don't exist yet** — the `linked`-group mechanics above are doc-verified in general but not demonstrated against this milestone's actual pending changesets. Run `changeset status --verbose --since=master` for real once changesets start landing, not just at cut time.
- **Whether `pnpm@11.10.0` resolves `typescript@7.0.2`'s platform-optional dependencies cleanly in this specific workspace** — only verified under plain `npm` in isolation; low risk given `esbuild`/`playwright`/`turbo` precedent in the same lockfile, but not directly run.
- **`@snort/worker-relay` v2's non-typed runtime behavior changes** (e.g. SQLite schema migrations, worker message protocol) — the breaking-change list is authoritative for the API surface (`.d.ts`/`package.json` diff) but the source repo's changelog was unreachable (403), so runtime-only changes could be missed. Low stakes given this rider is confined to an ignored example app.
- **Whether an `optionalDependencies` edge (e.g. concord's relay/loaders/signers deps) participates in the changesets internal-dependency cascade at all** — flagged by pitfalls research as unconfirmed; must be checked in the same dry-run pass as the `linked` verification above, not assumed either way.
- **The AUTH family's missing group/pool surface** (`authenticate()` has no `RelayGroup`/`RelayPool` equivalent) — not a defect in scope, but an open question the roadmapper should explicitly decide to defer or add, since no current backlog entry addresses it.

## Sources

### Primary (HIGH confidence)
- Direct repo source reads: `packages/relay/src/{relay.ts,group.ts,pool.ts,negentropy.ts,types.ts,operators/auth-retry.ts,operators/complete-when.ts}`, `packages/loaders/src/loaders/sync-loader.ts`, `packages/loaders/package.json`, `packages/concord/package.json` + client files, `packages/wallet/package.json` + wallet source, `packages/react/package.json` + hooks/tests, `.changeset/config.json`, `apps/examples` grep, `apps/docs/loading/relays/relays.md`
- `changesets/changesets` official docs (`linked-packages.md`, `config-file-options.md`, `command-line-options.md`, `snapshot-releases.md`)
- NIP-45 and NIP-77 spec text, `nostr-protocol/nips` raw markdown, fetched directly
- Live registry checks: `npm view typescript/@snort/worker-relay/react/@types/react/@testing-library/react dist-tags/versions/peerDependencies`
- Direct isolated compile test of `typescript@7.0.2` against this repo's tsconfig shape

### Secondary (MEDIUM confidence)
- `.planning/ROADMAP.md` backlog entries 999.13–999.28, `.planning/PROJECT.md` — the design analysis this research weighs outside convention against, per task instructions, not re-derived
- General RxJS `retry`/`repeat`/`timeout` operator community documentation, used only to corroborate hazards already independently verified against this codebase's own source
- strfry README and rust-nostr SDK docs, for negentropy transfer-timing convention comparison

### Tertiary (LOW confidence)
- JS-nostr-specific HyperLogLog/NIP-45 prior art — none found; general-purpose HLL library API shape (`js-hll`, `hyperloglog`) used as the nearest available analog, explicitly flagged as not NIP-45-shaped
- React 19 Strict Mode double-invoke / `useSyncExternalStore` interaction with this repo's specific hook timing logic — background context only, unresolved until real rendering tests exist

## Phase 24 Contract Amendment (2026-09-02)

Negentropy now emits Observable rounds and high-level sync emits discriminated transfer outcomes. Group and Pool preserve sibling progress with explicit `relay-failed` values. Sync owns one global auth budget, fresh reconnect attempts, and fair bounded work; cancellation and duration are caller-owned with no built-in timeout.

---
*Research completed: 2026-08-19*
*Ready for roadmap: yes*
