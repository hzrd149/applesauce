# Applesauce

## What This Is

Applesauce is a reactive Nostr SDK for TypeScript/JavaScript, built as a pnpm monorepo of publishable packages (`core`, `common`, `actions`, `relay`, `loaders`, `react`, `accounts`, `signers`, `sqlite`, `content`, `wallet`, `concord`, and more) layered over a single in-memory `EventStore` and RxJS observables. It gives Nostr client developers event storage, models, timelines, filters, casts, loaders, signers, and React bindings.

## Core Value

The core `EventStore` and its reactive model/timeline/filter/cast infrastructure are the foundation everything else builds on — they must stay correct and fast for signed `NostrEvent` consumers no matter what else changes.

## Current Milestone: v1.1 first-fixes

**Goal:** Bring `applesauce-concord` into conformance with the CORD-01..07 protocol specs by fixing all 43 findings from the 2026-07-15 audit, and fix the shared `applesauce-core` cache defect that causes three of them.

**Target features:**

- Core cache semantics — identity memos written non-enumerable so spread cannot carry a stale derivation, with the memo-vs-carry-forward invariant documented (must land first; unblocks the rest)
- Key rotation & epoch correctness — Refoundings actually rotate, the memberlist drops removed members, the epoch walk fetches history
- Authority & permissions — root-Refounding outranking, grant coordinate validation, guards that default to deny
- Channel keying — one source of truth for channel secrets, no public-plane fallthrough, no edition-supplied key material, and a first-class access-vs-key-possession distinction
- Invites — revocation that survives a lagging relay, enforced bundle bounds, resilient refresh
- Time encoding — one clock read per event so `created_at * 1000 + ms` is a true decomposition
- Wire conformance & caps — tag shapes, protocol constants, unknown-field round-trip discipline
- Spec-derived regression tests — assert against independently-derived spec values rather than against our own output

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
- ✓ A Refounding rotates every plane address and the epoch walk addresses each held epoch distinctly — Validated in Phase 6 (ROTATE-01/02)
- ✓ A Refounding removes excluded members from the Complete Memberlist — Validated in Phase 6 (ROTATE-04)
- ✓ A root Refounding is honored only from a rotator who strictly outranks every removed target, on both the send and receive paths — Validated in Phase 6 (AUTH-01/02)

### Active

<!-- v1.1 first-fixes. Full detail with file:line, spec citations, and repros: .planning/concord-audit.md -->

- Cache identity memos must not survive an object spread (`applesauce-core`); the memo-vs-carry-forward distinction is documented so a future cleanup cannot collapse them
- A channel Rekey must rotate the channel's message plane
- Private channel access must derive only from held key material — never from `community_root` — and consumers must be able to distinguish visible metadata from key possession
- Channel key material must come from `material.channels`, never from Control-Plane edition JSON
- Revocation must survive a lagging relay: an invite coordinate resolves before its tombstone is evaluated
- Event time must be one clock read: `created_at * 1000 + ms` is a true decomposition of a single instant
- Attacker-crafted invite bundles must fail closed at the validation boundary
- Protocol caps, tag shapes, and unknown-field round-trip discipline must match the specs
- Regression tests must assert against independently-derived spec values, not against implementation output

### Out of Scope

<!-- Explicit boundaries. -->

- Converting all of `applesauce-common` to generic event types in the first pass — only helpers/casts with a concrete rumor use case are migrated, others stay `NostrEvent`
- Overload-heavy compatibility wrappers — prefer generic defaults (`= NostrEvent`) instead
- Changing public runtime behavior for default `EventStore` users — migration is type-level and runtime-light
- CORD-07 §2/§3/§5/§6/§7 voice transport (broker token grants kind 27235, AES-GCM framing, rendezvous, SFU) — HTTPS/WebRTC concerns, not Nostr event handling, and defensibly outside an events SDK (audit L13)
- Public↔private channel conversion and channel rename (CORD-03 §2) — a genuine feature gap, not a conformance defect; deferred to a feature milestone (audit L12)

## Context

- Codebase fully mapped under `.planning/codebase/` (ARCHITECTURE, STRUCTURE, STACK, CONVENTIONS, EVENT_KIND_PATTERNS, TESTING, INTEGRATIONS, CONCERNS) on 2026-07-08.
- Detailed migration plan exists at `.planning/rumor-store-migration.md` — the authoritative spec for this milestone.
- NIP-59 `Rumor` = `UnsignedEvent & { id: string }`; verified locally only by checking `getEventHash(rumor) === rumor.id`. Authorization/validity is assumed handled by the protocol layer that produced the rumor.
- This is the first GSD-tracked milestone; the packages themselves are already published and in use.
- **Shipped v1.0 (2026-07-09):** 4 phases, 11 plans, 23 tasks; 99 files changed (+7519/-427). A runtime-light type migration — `applesauce-core` fully generic over `StoreEvent`/`Rumor` with `RumorStore` + sig-gated `castEvent`; `applesauce-common` structural helpers genericized. Gates green: `applesauce-core` 601 tests, `applesauce-common` 500 tests, full workspace `pnpm run build` (18/18). All 16 v1 requirements satisfied, milestone audit passed, 0 open threats.
- **Known follow-ups (deferred):** COMMON-F1/F2 (genericize remaining common casts/helpers one-by-one as concrete rumor needs arise); a pre-existing `getHashtagTag` unsafe-`undefined` cast; a migration release-note for the `verifyEvent: undefined` verification-disable semantics.
- **v1.1 authoritative spec:** `.planning/concord-audit.md` — the 2026-07-15 conformance audit of `packages/concord/src/` against CORD-01..07, produced by seven parallel agents (one per spec doc) and orchestrator-verified. 43 findings: 9 HIGH, 17 MEDIUM, 4 suspected, 13 LOW. Carries file:line, the violated spec sentence, symptom, and fix per finding, plus a "verified correct" register marking ground that does not need re-auditing.
- **Why v1.1 exists:** a downstream app reported an incomplete member list after a Refounding. Root cause was `buildInviteBundle` dropping an optional `refounder` field from a hand-rolled literal — invisible to TypeScript, silent at runtime, green on all 189 tests. The audit was commissioned on the premise that a defect that quiet was unlikely to be alone; it was not. Nearly every finding is one of four variants of the same mistake: a guard that defaults to permit, a hand-rolled literal that drops an optional field, a correct helper that exists but is never called (`splitTime`, `store.replaceable`, `canRemoveSelf`, `grantLocator`), or a `catch`/`continue` that degrades where the spec says MUST.
- **Test-methodology finding (drives a v1.1 requirement):** all 189 concord tests passed while 9 HIGH bugs were live, because every test compares the implementation against itself. A four-line probe deriving the expected address from the spec formula caught the worst bug instantly. Spec-derived assertions are the gap.
- **Phase 6 complete (2026-07-16):** Refounding rotation & authority correctness — 3 plans, 6 tasks. Guestbook/base-rekey addresses gained spec-derived tests (ROTATE-01/02); the guestbook store is now epoch-keyed and the live `observed` set scoped to the current epoch so a Refounding drops excluded members (ROTATE-04); the root Refounding path gained a send-side outrank loop and a fail-closed `readRekey` receive guard mirroring the channel path (AUTH-01/02). `foldMembers` left untouched; `applesauce-concord` 202/202 green, all packages build. Verification passed 5/5 must-haves.
- **CONCORD-H07 has a blocked downstream consumer** (Accordian): private channel metadata without held key material derives the *public* address, so the composer can publish private content to a plane every community member can derive. Field-confirmed and reproduced 2026-07-15; their acceptance criteria and five required tests are adopted verbatim in the audit register.

## Constraints

- **Tech stack**: TypeScript 5.8–5.9, pnpm 11 workspace, Node >=20.19, RxJS, `nostr-tools`. Browser ES2022 targets must keep working.
- **Compatibility**: Default `EventStore` (no type param) must remain a signed `NostrEvent` store with unchanged behavior; downstream packages must keep compiling with minimal migration.
- **Sequencing**: `applesauce-common` migration (Part B) only begins after the core migration (Part A) is proven — rumor store + `EventCast<Rumor>` tests green and `applesauce-core` builds clean.
- **Verification**: `pnpm --filter applesauce-core test` + `build` minimum; broader `pnpm run build` when exports/downstream types are affected.
- **v1.1 sequencing**: the `applesauce-core` cache fix lands before any concord rotation work — H01 currently *masks* H02, so fixing H01 alone activates a latent memberlist bug. H08 has two independent root causes (metadata threading **and** the channel-plane memo); fixing either alone leaves a rekeyed channel on its old plane.
- **v1.1 test standard**: every fix carries a regression test asserting against an **independently-derived spec value**, not against implementation output. Comparing the implementation to itself is precisely what let all 43 findings pass CI.
- **v1.1 breaking changes** (accepted): remove `ChannelMetadata.voice` (CORD-03 §2 and CORD-07 §1 both state no per-channel voice flag exists); remove `ChannelMetadata.key`/`.epoch` (client-tracked keying must not ride folded edition metadata). Both need changesets and migration notes.

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
| Fix the cache-memo defect centrally in `applesauce-core`, not locally in concord (v1.1) | The local fix patches 3 call sites and leaves the trap armed for the next caller. Central fix's only behavior change is that spread/`Object.assign` stop copying the cache — `JSON.stringify`/`Object.keys`/`Reflect.get` are unaffected either way, and ~all 101 call sites cache onto immutable signed `NostrEvent`s that are never spread. Proven not to disturb the deliberate `EncryptedContentSymbol` carry-forward (those 3 sites hand-roll their own writes); full monorepo green at 1989 tests. | ⏳ Pending — Phase 5 |
| Scope v1.1 to all 43 findings rather than HIGH-only | HIGH-only still drags in a breaking change (H08 needs `ChannelMetadata.key` deleted), so the compatibility cost is paid either way; and the MEDIUM/LOW set is mostly the same four defect shapes, cheaper to fix in one pass than to re-derive context for later | ⏳ Pending |

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
*Last updated: 2026-07-21 — Phase 10 complete (Invite lifecycle & event-time consistency; revoked invites survive relay lag, malformed bundles fail closed, created_at/ms is one clock read)*
