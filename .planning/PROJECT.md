# Applesauce

## What This Is

Applesauce is a reactive Nostr SDK for TypeScript/JavaScript, built as a pnpm monorepo of publishable packages (`core`, `common`, `actions`, `relay`, `loaders`, `react`, `accounts`, `signers`, `sqlite`, `content`, `wallet`, `concord`, and more) layered over a single in-memory `EventStore` and RxJS observables. It gives Nostr client developers event storage, models, timelines, filters, casts, loaders, signers, and React bindings.

## Core Value

The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.

## Requirements

### Validated

<!-- Shipped and confirmed valuable — inferred from existing published packages. -->

- ✓ In-memory `EventStore` with insert/update/remove streams, delete + expiration handling, and model subscriptions
- ✓ Reactive models (event, replaceable, timeline, filters) over RxJS observables
- ✓ Cast infrastructure (`EventCast`, `castEvent`, cast streams) for signed events
- ✓ NIP-specific helpers/models/casts/factories in `applesauce-common`
- ✓ SQLite/async event database adapters
- ✓ Core `EventStore<E>`/`AsyncEventStore<E>` operate over unsigned NIP-59 `Rumor` events via a generic `E extends StoreEvent` parameter — v1.0
- ✓ `RumorStore` convenience class verifies rumors by recomputed event hash (`verifyRumor`, non-overridable default) — v1.0
- ✓ Constructor honors explicit `verifyEvent: undefined` to disable verification — v1.0
- ✓ Core helpers, store interfaces, managers, models, and cast infrastructure generic over `E extends StoreEvent` (`NostrEvent` defaults) — v1.0
- ✓ `applesauce-common` structural helpers genericized to support rumors (Part B; casts audited, kept `NostrEvent` per conservative scope) — v1.0

### Active

<!-- Next milestone — none defined yet. Run /gsd-new-milestone to plan the next version. -->

_(none — v1.0 shipped; next milestone not yet defined)_

### Out of Scope

<!-- Explicit boundaries. -->

- Converting all of `applesauce-common` to generic event types in the first pass — only helpers/casts with a concrete rumor use case are migrated, others stay `NostrEvent`
- Overload-heavy compatibility wrappers — prefer generic defaults (`= NostrEvent`) instead
- Changing public runtime behavior for default `EventStore` users — migration is type-level and runtime-light

## Context

- Codebase fully mapped under `.planning/codebase/` (ARCHITECTURE, STRUCTURE, STACK, CONVENTIONS, EVENT_KIND_PATTERNS, TESTING, INTEGRATIONS, CONCERNS) on 2026-07-08.
- Detailed migration plan exists at `.planning/rumor-store-migration.md` — the authoritative spec for this milestone.
- NIP-59 `Rumor` = `UnsignedEvent & { id: string }`; verified locally only by checking `getEventHash(rumor) === rumor.id`. Authorization/validity is assumed handled by the protocol layer that produced the rumor.
- This is the first GSD-tracked milestone; the packages themselves are already published and in use.
- **Shipped v1.0 (2026-07-09):** 4 phases, 11 plans, 23 tasks; 99 files changed (+7519/-427). A runtime-light type migration — `applesauce-core` fully generic over `StoreEvent`/`Rumor` with `RumorStore` + sig-gated `castEvent`; `applesauce-common` structural helpers genericized. Gates green: `applesauce-core` 601 tests, `applesauce-common` 500 tests, full workspace `pnpm run build` (18/18). All 16 v1 requirements satisfied, milestone audit passed, 0 open threats.
- **Known follow-ups (deferred):** COMMON-F1/F2 (genericize remaining common casts/helpers one-by-one as concrete rumor needs arise); a pre-existing `getHashtagTag` unsafe-`undefined` cast; a migration release-note for the `verifyEvent: undefined` verification-disable semantics.

## Constraints

- **Tech stack**: TypeScript 5.8–5.9, pnpm 11 workspace, Node >=20.19, RxJS, `nostr-tools`. Browser ES2022 targets must keep working.
- **Compatibility**: Default `EventStore` (no type param) must remain a signed `NostrEvent` store with unchanged behavior; downstream packages must keep compiling with minimal migration.
- **Sequencing**: `applesauce-common` migration (Part B) only begins after the core migration (Part A) is proven — rumor store + `EventCast<Rumor>` tests green and `applesauce-core` builds clean.
- **Verification**: `pnpm --filter applesauce-core test` + `build` minimum; broader `pnpm run build` when exports/downstream types are affected.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Genericize core `EventStore<E>` rather than fork a separate store | Reuse model/timeline/filter/claim/cast infrastructure; avoid duplication | ✓ Good — one generic store, zero duplication, all downstream packages still build |
| Add `RumorStore extends EventStore<Rumor>` convenience class | Ergonomic default for rumor consumers with `verifyRumor` wired in | ✓ Good — thin subclass, `verifyRumor` locked via `Omit<…, "verifyEvent">` |
| Keep `verifyRumor` = hash-only check | Rumors come from a protocol layer that already verified auth/validity | ✓ Good — documented integrity-not-authorization boundary |
| Defaults stay `= NostrEvent` everywhere | Minimize downstream migration churn | ✓ Good — zero behavior change; existing tests + export snapshots unchanged |
| Migrate `applesauce-common` only after core proves out (Part A gate) | De-risk the broad type change one layer at a time | ✓ Good — gate held; common work was minimal (4 helpers) once core was proven |
| Sig-gate `castEvent` input (`CastEventInput<T>`) + internal `performCast` | Restore the compile-time guard the Phase-2 generic widening dropped without over-tightening real rumor casts | ✓ Good — signed casts reject rumors at compile time; concord's rumor cast still compiles |
| Keep common casts `NostrEvent` (COMMON-02 empty targeted set) | No common cast has a concrete rumor use case; their `KnownEvent<K>` types are out-of-scope to genericize | ⚠️ Revisit — COMMON-F1/F2 will genericize one-by-one as needs arise |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-09 after shipping milestone v1.0 event-store-supports-rumors*
