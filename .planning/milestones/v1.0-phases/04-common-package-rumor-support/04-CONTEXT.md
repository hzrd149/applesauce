# Phase 4: Common package rumor support - Context

**Gathered:** 2026-07-09
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure genericization; scope guided by the migration doc — no user grey-areas, but the exact "targeted casts" set is a research/discretion decision within documented bounds)

<domain>
## Phase Boundary

Carry the genericization proven in `applesauce-core` (Phases 1–3) into `applesauce-common`: make helpers that use only structural fields generic over `E extends StoreEvent`, and make a **targeted** subset of casts (and their models/factories where needed) operate over rumors — all while keeping default signed-`NostrEvent` behavior byte-for-byte unchanged. This is the milestone's final phase; it begins only after the Phase 3 Part A gate (already confirmed: `applesauce-core` builds clean and rumor/cast tests pass).

Out of scope: converting ALL of `applesauce-common` to generic event types (explicitly forbidden by the migration doc — "Avoid converting all of applesauce-common to generic event types in the first pass").
</domain>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/rumor-store-migration.md` — authoritative design. For Common, it is deliberately CONSERVATIVE: "keep `applesauce-common` models and casts signed-event-oriented unless individually audited later" (line 14); "Keep `applesauce-common` casts as `NostrEvent` by default. They can be made generic one-by-one later if there is a concrete rumor use case" (line 178); "Watch for `CastRefEventStore` references in common casts; defaults should keep these compiling against `NostrEvent`" (line 217).
- `./CLAUDE.md` — the "Adding Support For A New NIP" checklist (helpers → casts → operations → factories → tests → snapshots) and the STRICT one-sentence changeset rule; helper snapshot tests (`helpers/__tests__/exports.test.ts`-style) and export snapshots must be kept in sync (regenerate via `vitest -u`, never hand-edit).
- Phase 1–3 `deferred-items.md` — the established genericization patterns (`E extends StoreEvent = NostrEvent` defaults, localized bridge casts, the full-workspace-build downstream-inference lesson, sig-gated cast typing).
</canonical_refs>

<decisions>
## Implementation Decisions

### Scope of genericization (guided by migration doc; exact sets resolved in research)
- **Helpers (COMMON-01):** Genericize `applesauce-common` helper functions that read ONLY structural `StoreEvent` fields (id/kind/pubkey/created_at/content/tags) over `E extends StoreEvent = NostrEvent`, defaulting to `NostrEvent`. Do NOT broaden helpers that semantically require a signature or signed-only fields. Research identifies the precise structural-only set.
- **Casts / models / factories (COMMON-02):** Be CONSERVATIVE. Genericize only a **targeted** subset with a concrete rumor use case — do NOT convert all common casts. Keep `NostrEvent` defaults so existing signed-cast call sites compile unchanged (watch `CastRefEventStore` references per migration doc). Research determines the targeted set from actual rumor consumers (e.g. what `applesauce-concord`'s rumor casts need); if no cast has a concrete rumor need beyond what Phase 3 already demonstrated, the targeted cast set may be small or empty and the phase focuses on structural helpers.

### Zero behavior change (LOCKED, consistent with Phases 1–3)
- Every generic parameter defaults to `NostrEvent`. Existing `applesauce-common` tests and export/helper snapshots MUST pass unchanged (or snapshots regenerated only for genuinely new/renamed exports via `vitest -u`, never hand-edited).

### Claude's Discretion
The exact structural-helper set, the targeted-cast set, and whether any models/factories need touching are at Claude's discretion within the conservative migration-doc bounds, informed by research and the "Adding Support For A New NIP" checklist.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phases 1–3)
- `applesauce-core` is fully generic: `EventStore<E>`, `AsyncEventStore<E>`, `RumorStore`, generic managers/helpers/models, and the sig-gated cast infrastructure (`castEvent`/`performCast`/`CastEventInput`, `EventCast<E>`, `CastRefEventStore<E>`).
- `StoreEvent`, `Rumor`, `verifyRumor` exported from `applesauce-core/helpers/event`.
- Phase 2 already fixed one `applesauce-common` file (`observable/filter-timeline-by-mutes.ts`) during the full-build gate — the common package currently builds clean against generic core.
- Existing `applesauce-common` casts already declare their event types via `EventCast<T>` (e.g. `Profile extends EventCast<ProfileEvent>`) — the pattern to extend where a rumor variant is needed.

### Established Patterns
- `E extends StoreEvent = NostrEvent` with `NostrEvent` defaults; localized `as unknown as NostrEvent` / `signedView` bridge casts confined to structural-field reads.
- The "Adding Support For A New NIP" checklist order (helpers → casts → operations → factories → tests/snapshots) and helper snapshot maintenance.

### Integration Points & Gate
- Verification bar: `pnpm --filter applesauce-common test` + helper/export snapshots unchanged, and `pnpm run build` (full workspace) exit 0 — the downstream-inference gate from Phases 1–3.
</code_context>

<specifics>
## Specific Ideas

- Prefer generic defaults over overload-heavy compatibility wrappers (migration doc migration note).
- Per-change single-sentence changesets; `applesauce-common` `minor` for new generic surface, `patch` for internal-only fixes.
- Run the FULL `pnpm run build`, not just `applesauce-common`, before declaring done (the recurring downstream-inference lesson).
</specifics>

<deferred>
## Deferred Ideas

Broad conversion of all `applesauce-common` casts/models to generic event types is explicitly deferred (migration doc). Any common cast without a concrete rumor use case stays `NostrEvent`-oriented and is a candidate for a future one-by-one audit, not this phase.
</deferred>
