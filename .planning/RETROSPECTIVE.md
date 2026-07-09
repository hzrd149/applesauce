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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 1 | 4 | First GSD-tracked milestone; established the full-workspace-build gate and carry-forward deferral pattern |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | core 601 + common 500 (all green) | existing suites unchanged + new rumor tests | 0 new dependencies (pure internal TS) |

### Top Lessons (Verified Across Milestones)

1. Full-workspace build gate is non-negotiable for cross-package type changes. *(v1.0)*
2. Hard gates between dependency layers de-risk broad migrations. *(v1.0)*
