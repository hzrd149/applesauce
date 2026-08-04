# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — event-store-supports-rumors

**Shipped:** 2026-07-09
**Phases:** 4 | **Plans:** 11 | **Tasks:** 23 | **Sessions:** 1 (autonomous)

### What Was Built
- `applesauce-core` fully generic over `E extends StoreEvent = NostrEvent`: `EventStore`/`AsyncEventStore`, 18 store interfaces, 4 managers, 11 structural helpers, the reactive model framework, and the cast infrastructure — all with `NostrEvent` defaults and zero behavior change for signed consumers.
- `RumorStore extends EventStore<Rumor>` with `verifyRumor` (hash-recompute) locked as its non-overridable default verifier; kind-5 delete + timeline/replaceable/filters all work over unsigned rumors.
- Sig-gated `castEvent` (`CastEventInput<T>`) + internal `performCast` split — a signed-only cast rejects a rumor at compile time; a custom `EventCast<Rumor>` casts a rumor against a real `RumorStore`.
- `applesauce-common`: 4 structural helpers genericized; the targeted-cast set audited as empty (conservative scope, COMMON-F1/F2 deferred).

### What Worked
- **Dependency-ordered phasing with a hard "Part A" gate** (prove core over rumors before touching common) kept the broad type migration de-risked — Phase 4 turned out to be tiny (4 helpers) once core was proven.
- **Empirical research agents** — the Phase 3 researcher applied the `castEvent` fix, built/tested it, and reverted, catching that the code reviewer's exact-`T` suggestion would break concord's real rumor cast. Phase 4 research decisively scoped the work (4 helpers, 0 casts) by direct audit.
- **The recurring full-workspace `pnpm -r build` gate** caught genuine cross-package inference regressions (bare `new EventMemory()` inferring the `StoreEvent` constraint) that per-package builds missed — this became the standing lesson every subsequent phase applied proactively.
- **`= NostrEvent` defaults + localized bridge casts** (the `signedView` pattern) delivered zero behavior change: existing tests and export snapshots stayed byte-identical across all phases.

### What Was Inefficient
- The **Phase 1 `EventMemory` genericization silently broke `applesauce-loaders` + `applesauce-relay`** because the per-wave gate only built `applesauce-core`; the break surfaced only at the Phase-1 post-merge full build. Fixed inline, but a full-workspace build earlier would have caught it sooner.
- A code-review fix (Phase 2 `castEvent` WR-01) was **attempted then reverted** when it didn't cleanly compile and over-tightened the API — correctly deferred to Phase 3 where rumor casting was actually exercised, but that's one round-trip that richer Phase-2 research could have pre-empted.

### Patterns Established
- **Carry-forward via `deferred-items.md`:** code-review warnings that belong to a later phase (Phase 1 WR-01 → Phase 3 verifier; Phase 2 WR-01 → Phase 3 castEvent typing) are documented and explicitly assigned to their owning phase rather than force-fixed in the wrong layer.
- **Genericize with `E extends StoreEvent = NostrEvent` + a narrow `{tags}`/`StoreEvent` bound chosen by what a function actually reads;** never broaden a signature to hide a mismatch — use a localized `as unknown as NostrEvent` bridge confined to structural-field reads.
- **Sig-gating on `T extends { sig: string }`** to distinguish signed-only from rumor-capable casts, rather than exact-type inference.

### Key Lessons
1. **Run the full workspace build at every wave boundary, not just the changed package** — TypeScript inference at contextually-typed call sites (bare generic instantiation) infers the *constraint*, not the *default*, and only a downstream build reveals it.
2. **Prove a broad type migration end-to-end in one package behind a hard gate before propagating it** — the Part A gate made the final phase trivial and low-risk.
3. **A conservative documented scope (COMMON-F1/F2) is a feature, not a gap** — auditing "no common cast needs rumors yet" and deferring is correct when the enabling infrastructure already supports it.

### Cost Observations
- Model mix: orchestration on Opus 4.8 (1M); executors/researchers/checkers/reviewers on Sonnet; planners on Opus.
- Sessions: 1 (single autonomous `/gsd-autonomous` run, discuss→plan→execute→review→verify→nyquist→security per phase).
- Notable: infrastructure/genericization phases were auto-detected and given minimal CONTEXT.md (no grey-area discussion), concentrating effort on the one genuine open design question per phase (the `castEvent` typing).

---

## Milestone: v1.1 — first-fixes

**Shipped:** 2026-08-04
**Phases:** 12 | **Plans:** 87 | **Tasks:** 203 | **Commits:** 592 | **Timeline:** 21 days (2026-07-15 → 2026-08-04)

### What Was Built

- **`applesauce-core` symbol propagation redesigned** (Phases 5 + 5.1) — every symbol write non-enumerable via `setCachedValue`; `PRESERVE_EVENT_SYMBOLS` carried explicitly through `pipeFromAsyncArray`/`EventFactory.chain`; both per-step strip loops deleted. Root cause of three HIGH concord findings.
- **Rotation and refounding correctness** (6 + 8) — Refoundings rotate their plane addresses in-session, drop excluded members, and abort atomically without a relay-majority ack; racing rotations converge via a per-epoch down-only latch and a multiset-consistency gate.
- **Private channel keying** (7) — `ChannelMetadata.key`/`.epoch` removed; `material.channels` is the sole key source; `channels$` carries a client-local `accessible` flag. Unblocked the Accordian consumer.
- **Authority fold correctness** (9) — Grant/Kick/Ban/Role folds bind coordinates, handle malformed input totally, and enforce strict outranking against the current roster.
- **Wire and document conformance** (10 + 11 + 12) — real factories for reactions/replies/deletes, both document roots opened for unknown-field round-trip, spec-constant caps, rule-table invite-bundle validation.
- **Transport-only extra relays** (12.3) — app-local `extraRelays` used purely as transport, never written into community or protocol state.

### What Worked

- **Sequencing the root-cause fix first, with the unmasking made explicit.** The roadmap stated up front that H01 *masked* H02, so fixing the cache defect alone would activate a latent memberlist bug — and scheduled ROTATE-04 immediately after. The consequence landed in the same milestone as its cause instead of surfacing later as a mystery regression.
- **TEST-01 as a standing criterion across eight phases rather than one phase's deliverable.** This is the single highest-leverage decision of the milestone. Phase 7's spec-derived probe of the CORD-03 §1 derivations is what exposed H07 — the bug that had a downstream consumer blocked.
- **Closing defect classes structurally.** `validateInviteBundle`'s mapped-type rule tables, `copySymbolsToDuplicateEvent`'s tuple arity, `CHANNEL_KEY_STRIPPED_FIELDS` derived from its fold disposition. Each converts "a reviewer must notice the next instance" into "the compiler rejects it."
- **Recorded RED→GREEN non-vacuity probes.** Deliberately reverting the exact line a test covers, observing the failure, then restoring. Cheap, and it is the only thing that distinguishes a test that passes from a test that would catch the bug.
- **Inserting Phase 5.1 rather than shipping Phase 5's taxonomy.** Phase 5 documented a two-category convention and annotated 35 call sites; review found 14 of those annotations were false. Recognizing that the *convention* was the problem — not the annotations — and redesigning was better than a third correction pass.

### What Was Inefficient

- **Phase 5 spent four review rounds correcting comments about an invariant that Phase 5.1 then deleted.** Comment-only passes across 22 files, then correction passes over those corrections. The signal was available early: when a convention needs 35 hand-audited sites to stay true, it is the wrong abstraction. Roughly two rounds of that work was wasted motion.
- **Finding IDs were not stable across review rounds** — `WR-07` in one round named a different finding than `WR-07` in another, and a summary marked one closed against the other's evidence. Cost real reconciliation time and left a permanent caveat in the record.
- **Bookkeeping drifted from evidence in three places** (CHAN-07's traceability row, AUTH-09's alias, WIRE-10's missing frontmatter). None represented unfinished work, but each needed independent three-source verification at audit time to prove it.
- **The milestone audit went stale within two days.** Real work closed its security BLOCKER and two other items between audit and close, requiring a refresh pass. Auditing closer to the actual close would have avoided it.

### Patterns Established

- **Independent spec oracles:** compute the expected value from the spec formula using primitives only (`crypto.ts`), never by calling the code under test. Anchor the assertion with an `"EXPECTED, independently derived from CORD-NN §…"` comment.
- **Non-vacuity probes as evidence:** a test is not trusted until it has been observed failing against a surgical revert of the line it covers.
- **Structural over enumerated:** when a defect class survives repeated gap-closure rounds, make the bad state unrepresentable rather than patching the next instance.
- **Citation-existence guards:** a package-wide scanner that fails the build on a `CORD-NN §X` citation pointing at a section that does not exist. Its first run found 12 invalid citations.
- **Fixture-anchored wire tests:** vendored spec tag sets in `cord-wire-fixtures.ts` so wire assertions never import an expected value from the implementation.

### Key Lessons

1. **A convention that requires hand-auditing many call sites to stay true is a standing defect source, not a convention.** Prefer one mechanism that makes the wrong write impossible. *(Phases 5 → 5.1)*
2. **Green tests are necessary, not sufficient — and the gap is measurable.** 189 tests passed while 9 HIGH bugs were live because every test compared the implementation to itself. A four-line spec-derived probe caught the worst one instantly.
3. **When a root-cause fix will unmask a latent bug, schedule the consequence in the same milestone and say so in the roadmap.** Otherwise the unmasked bug reads as a regression from the fix.
4. **Stabilize finding IDs per review round, or namespace them.** Cross-round ID collisions silently corrupt closure records.
5. **Run the milestone audit close to the actual close.** Two days of ordinary work was enough to invalidate its main conclusions.

### Cost Observations

- Model mix: orchestration on Opus (1M); executors/researchers/reviewers on Sonnet; planners on Opus.
- Sessions: many, across 21 days — phase-by-phase rather than one autonomous run, with gap waves and re-verification on Phases 5, 11, 12, and 12.3.
- Notable: the two largest phases by plan count (5 at 14 and 12.3 at 14) were both driven by review-and-gap-wave iteration rather than by original scope. Phase 5's iteration was largely avoidable; Phase 12.3's was genuine hardening of a new public API surface.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 1 | 4 | First GSD-tracked milestone; established the full-workspace-build gate and carry-forward deferral pattern |
| v1.1 | many (21 days) | 12 | Shifted from "does it build" to "does the test prove anything" — spec-derived oracles, non-vacuity probes, and structural class-closure became standing practice |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | core 601 + common 500 (all green) | existing suites unchanged + new rumor tests | 0 new dependencies (pure internal TS) |
| v1.1 | 2,466 passed / 2 skipped across 272 files (from a 1,989 baseline) | concord 189 → 554 tests across 54 files; load-bearing derivations now spec-anchored | 0 new dependencies (`nostr-tools` bumped to ^2.24) |

### Top Lessons (Verified Across Milestones)

1. Full-workspace build gate is non-negotiable for cross-package type changes. *(v1.0)*
2. Hard gates between dependency layers de-risk broad migrations. *(v1.0, reconfirmed v1.1 — the cache fix gated all rotation work)*
3. A test that compares the implementation to itself proves nothing; derive the expected value from the spec. *(v1.1)*
4. When a defect class survives repeated gap-closure rounds, stop patching instances and make the state unrepresentable. *(v1.1)*
5. Prefer one enforcing mechanism over a documented convention plus annotations. *(v1.1)*
