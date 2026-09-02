---
phase: 25
slug: ecosystem-riders-react-19-snort-worker-relay-v2
status: draft
shadcn_initialized: false
preset: none
created: 2026-09-02
---

# Phase 25 — UI Design Contract

> Visual and interaction contract for the React 19 and worker-relay v2 compatibility phase. This is a visual-regression contract: preserve the existing examples UI while changing runtime dependencies and behavior beneath it.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | DaisyUI 5 with Tailwind CSS 4 (existing project system; no initialization or redesign) |
| Preset | `applesauce-light` default and `applesauce-dark` preferred-dark themes |
| Component library | DaisyUI existing classes only; do not introduce shadcn or a third-party registry |
| Icon library | Existing inline SVGs/components only; no new icons are required |
| Font | Inherit the existing Tailwind/DaisyUI system sans stack; monospaced text remains limited to identifiers and technical data |

The absence of root `components.json` is intentional for this phase. The shadcn initialization gate is not applicable because Phase 25 introduces no new visual component or screen; initializing a second component system would expand scope and violate the existing examples design system. Preserve the repository rule that examples use simple borders, no drop shadows, and no new card treatment. Do not add DaisyUI `.form-control`, which does not exist in DaisyUI 5.

---

## Spacing Scale

Declared values (existing Tailwind utilities; all multiples of 4):

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Inline badge and compact control gaps |
| sm | 8px | Control groups and compact row spacing |
| md | 16px | Default content and form spacing |
| lg | 24px | Existing example page padding |
| xl | 32px | Large content separation |
| 2xl | 48px | Empty-state and major section spacing |
| 3xl | 64px | Reserved page-level separation |

Exceptions: preserve existing DaisyUI control sizing and the current examples' responsive layout; no new spacing token or exception is authorized.

---

## Typography

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Supporting label | 14px | 400 | 1.5 |
| Body / control | 16px | 400 | 1.5 |
| Section heading | 20px | 700 | 1.2 |
| Page heading | 30px | 700 | 1.2 |

Exactly two weights are permitted in changed UI markup: regular 400 and bold 700. Phase 25 should not change existing typography classes or text hierarchy.

---

## Color

| Role | Value | Usage |
|------|-------|-------|
| Dominant (60%) | `base-100` — light `oklch(98% 0.002 247.839)`, dark `oklch(24.353% 0 0)` | Page background and dominant surface |
| Secondary (30%) | `base-200` / `base-300` — existing theme tokens | Bordered sections, navigation, tables, and secondary surfaces; do not add drop shadows |
| Accent (10%) | `primary` `#f14158`; status accent `#30a46c` | Existing primary action buttons and the existing worker-relay/status indicator only |
| Destructive | `error` — light `oklch(59% 0.249 0.584)`, dark `oklch(51.61% 0.146 29.674)` | Existing destructive database action and errors only |

Accent reserved for: existing primary action buttons (`Start Live`/`Stop Live`, `Load More`, import/search controls, row action visibly labeled `Open` with accessible name `Open Event`) and the existing worker-relay status badge. Do not recolor neutral content, add decorative accents, or introduce a React-version badge.

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA | Preserve each existing action label; the cache example's stateful CTA remains `Start Live` / `Stop Live` and its pagination CTA remains `Load More` |
| Empty state heading | Preserve `No notes found` and `No events found for “{searchQuery}”` in their current contexts |
| Empty state body | Preserve `No events in database, import some`; it names the next action without adding migration-specific copy |
| Error state | Worker initialization: `Worker Relay couldn't start. Reload the example to try again.` with `Reload Example`. Cache query: `Notes couldn't be loaded. Check the relay connection and try again.` with `Try Again`. Database search/query: `Search failed. Check the filters and try again.` with `Retry Search`. Import: `Import failed. Choose a valid .jsonl file and try again.` with `Try Import Again`. Clear: `Database couldn't be cleared. Try again.` with `Retry Clear`. Preserve `Please select a .jsonl file` and `No events to export` for validation errors; these require correcting the input or populating results, not retry controls. |
| Destructive confirmation | Preserve the existing database-clear action and confirmation flow unchanged; no new destructive action is introduced |

No new user-facing copy is required for React 19, the CI matrix, worker-relay v2, or the three folded internal fixes. Dependency versions are implementation facts, not interface labels.

---

## Interaction Contract

- Both worker-relay examples retain their current routes, controls, keyboard behavior, labels, responsive layouts, and result rendering.
- The cache screen's primary visual anchor is its page heading plus `Worker Relay` operational-status badge. Preserve this hierarchy: status and live-relay controls first, cache statistics next, note results and `Load More` last.
- The database screen's primary visual anchor is its page heading plus `Worker Relay` operational-status badge. Preserve this task hierarchy: status first, search/filter controls and results as the primary workflow, and import/export/clear as visually secondary database-maintenance actions.
- The cache example initializes `cache-relay.db`, shows cached counts, starts/stops live relay ingestion, loads more notes, and renders new results without a visible reset caused solely by the v2 migration.
- The database example initializes `relay.db`, imports, exports, clears, searches, opens event details, and renders the same completion, empty, and error feedback as before.
- Every visible event-row action may retain the compact text `Open`, but it must expose `aria-label="Open Event"` so its accessible name contains the object being opened.
- Worker/WASM initialization remains asynchronous. Controls that already expose in-flight state remain disabled while their own operation is active; do not add a page-blocking migration screen.
- Existing OPFS data must not be deleted as a migration shortcut. On successful v2 initialization, persisted content remains queryable; on failure, the existing error surface must settle visibly and never display a perpetual loading indicator.
- React 18 and React 19 must produce the same observable screen state. Synchronous sources render their first value immediately; asynchronous sources initially render the existing empty/placeholder state and update after emission. Replacement, stale errors, Strict Mode remounts, and teardown must not cause stale flashes, duplicate rows, or post-unmount updates.
- Provider replacement and nesting change the consumed instance without changing layout. Missing required providers fail through the documented React error path; optional account access remains non-rendering `undefined`.

---

## UI Considerations

> The phase does not add a new UI element. These considerations guard the two existing worker-relay example surfaces whose runtime behavior changes.

Applicable state considerations resolved: 8 covered, 0 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Notes list; database results | ✅ covered | Zero notes retains `No notes found`; zero database rows retains the documented empty-state copy from the Copywriting Contract |
| loading | Import/search controls; route/worker initialization | ✅ covered | Existing spinners and disabled controls remain operation-scoped; initialization either resolves to the populated/empty view or the existing route error boundary |
| error | Worker initialization, import, search, and query flows | ✅ covered | Failures settle into the existing alert or route error surface and do not masquerade as empty success or perpetual loading |
| populated | Cache notes, stats, and database result table | ✅ covered | Successful v2 queries render the same stats, note rows, event rows, and detail interactions as the current implementation |
| partial | Cached stats and imported/search results | ✅ covered | Partial available data remains renderable using existing zero/fallback values; one failed operation does not erase already-rendered content |
| overflow | Event table, identifiers, and note content | ✅ covered | Preserve existing table overflow, identifier truncation, and note wrapping; the dependency migration may not change containment |
| zero-one-many | Notes and event results | ✅ covered | Zero uses existing empty copy; one and many use the same row/list structure with stable keys and no duplicate rendering |
| long-text | Relay URLs, event IDs, content, and error messages | ✅ covered | Preserve existing truncation helpers/table containment and allow error text to wrap without widening the page |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | none | not applicable — shadcn is not initialized and no new visual components are in scope |
| third-party | none | no registry code authorized |

Runtime package legitimacy is handled by the technical plan's dependency-install checkpoints; it is separate from UI component registry safety.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
