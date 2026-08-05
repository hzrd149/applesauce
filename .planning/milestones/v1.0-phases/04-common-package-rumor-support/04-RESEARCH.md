# Phase 4: Common package rumor support - Research

**Researched:** 2026-07-09
**Domain:** TypeScript generics migration — `applesauce-common` helpers/casts over `StoreEvent`/`Rumor`
**Confidence:** HIGH

## Summary

This phase's deliverable is a SCOPE decision, and the codebase evidence resolves it clearly: **no `applesauce-common` cast needs to be genericized (COMMON-02 targeted set is empty)**, and **the COMMON-01 structural-helper set should be small and curated, not a blanket sweep of all 48 helper files**. Every concrete rumor consumer that exists today (`applesauce-concord`'s `ConcordDirectInvite`, `applesauce-actions`' wrapped-message actions) either already works directly against a hardcoded `Rumor` type (predating this migration — `gift-wrap.ts`, `messages.ts`, `wrapped-messages.ts`, `encrypted-content-cache.ts`, the gift-wrap factories/operations/models) or built entirely custom types/casts in its own package (`concord`'s `DirectInviteRumor`, `EditRumor`) rather than extending any `applesauce-common` cast. No downstream consumer calls a `applesauce-common` cast, model, or kind-specific getter with a rumor today.

The deeper architectural finding: almost every kind-specific `applesauce-common` helper (`badge.ts`, `article.ts`, `zap.ts`, `calendar-event.ts`, etc.) is built on `isValidXxx(event): event is XxxEvent` guards where `XxxEvent = KnownEvent<K>`, and `KnownEvent<K>` (defined in `applesauce-core/helpers/event.ts`) is **hardcoded to `NostrEvent`, not generic over `E extends StoreEvent`**. Phases 1-3 deliberately left `KnownEvent` out of core's genericization list. Genericizing these ~40 kind-specific helper files would therefore require either (a) reopening core's already-closed scope to genericize `KnownEvent`, or (b) diverging each guard's return type from its exported `XxxEvent` type alias — both violate the "zero behavior change" / "no high-churn without concrete use case" bounds set by CONTEXT.md and the migration doc. These files should be explicitly deferred to COMMON-F1/COMMON-F2, not touched in this phase.

**Primary recommendation:** Genericize only the small set of `applesauce-common` helpers that (1) take a full event parameter, (2) read only structural fields, and (3) do NOT type-guard to a `KnownEvent`-based branded alias — i.e., general-purpose cross-kind utility helpers (NIP-10 threading, emoji/tag parsing, hashtag/content readers). Leave every `isValidXxx`/`XxxEvent`-guarded kind-specific helper, every cast, and every model untouched. Add zero new casts. This keeps the phase small, zero-risk, and honestly scoped, and it satisfies COMMON-01/02/03 as written without inventing speculative rumor use cases.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Structural helper genericization (id/kind/pubkey/created_at/content/tags reads) | Library (applesauce-common) | — | Pure type-signature change; no store/network/UI involvement |
| Kind-specific typed getters (`isValidXxx`/`XxxEvent`) | Library (applesauce-common) | Library (applesauce-core, `KnownEvent`) | Blocked by core's `KnownEvent` being NostrEvent-hardcoded; out of scope this phase |
| Cast infrastructure compilation against `CastRefEventStore<E>` | Library (applesauce-core, already generic) | Library (applesauce-common casts, consumers) | Core already generic; common casts compile unchanged via `NostrEvent` defaults — no action needed |
| Rumor-specific NIP-59 flows (gift-wrap/seal/rumor unwrap, wrapped messages) | Library (applesauce-common) | Downstream (concord, actions) | Already implemented pre-migration with hardcoded `Rumor` type; not part of this phase's scope |
| Custom per-app rumor casts (e.g. Direct Invite) | Downstream (applesauce-concord) | — | Consumers build their own `EventCast<CustomRumorType>` rather than extending common casts — confirms no "targeted cast" need exists in common |

## Package Legitimacy Audit

Not applicable — this phase adds no new external packages. It is a pure internal TypeScript generics change to `applesauce-common` source files. No `npm install` occurs.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMMON-01 | `applesauce-common` helpers using only structural fields accept `E extends StoreEvent` | Section "Structural Helpers to Genericize (concrete list)" below enumerates the exact functions/files; section "Helpers to explicitly NOT genericize" explains the `KnownEvent` blocker for the remaining ~40 kind-specific files |
| COMMON-02 | Targeted `applesauce-common` casts (+ models/factories) operate over rumors while keeping `NostrEvent` defaults | Section "Targeted Casts (concrete finding: none)" documents the concrete-consumer audit that justifies an empty set |
| COMMON-03 | Default signed-`NostrEvent` behavior unchanged; existing tests/snapshots pass | Section "Snapshot/Test Risk" enumerates all 4 export-snapshot files and the exact "should not change" invariant; genericizing via `<E extends StoreEvent = NostrEvent>` signature-only changes preserves default inference at every call site (same pattern proven in Phase 1's `01-01-SUMMARY.md`) |

## Standard Stack

No new libraries. This phase only touches:
- `applesauce-common` (workspace package, v6.2.0) — [VERIFIED: packages/common/package.json]
- `applesauce-core` (workspace package, already generic per Phases 1-3) — consumed as-is, not modified this phase

No `npm install` / registry verification needed — no external packages added.

## Architecture Patterns

### System Architecture Diagram

```
                      applesauce-core (Phases 1-3, CLOSED scope)
                      ├─ StoreEvent, Rumor, verifyRumor  ─────────┐
                      ├─ EventStore<E>/AsyncEventStore<E>/RumorStore
                      ├─ EventCast<E>/CastRefEventStore<E>/castEvent  (generic, default NostrEvent)
                      └─ KnownEvent<K> = Omit<NostrEvent,"kind"> & {kind:K}  <- NOT generic, hardcoded NostrEvent
                                              │
                                              ▼
                      applesauce-common (THIS PHASE — bounded scope)
                      ├─ helpers/threading.ts, emoji.ts, hashtag.ts, content.ts   <- genericize (COMMON-01 target)
                      ├─ helpers/badge.ts, article.ts, zap.ts, ... (~40 files)    <- DEFER (blocked by KnownEvent)
                      ├─ helpers/gift-wrap.ts, messages.ts, wrapped-messages.ts   <- already Rumor-typed, no change
                      ├─ casts/*.ts (30 files, all EventCast<KnownEvent<K>>)      <- no concrete rumor need, no change
                      └─ models/*.ts, factories/*.ts                             <- unaffected (no cast changes ripple)
                                              │
                                              ▼
                      Downstream consumers (evidence gathered, not modified)
                      ├─ applesauce-concord: builds OWN Rumor types (DirectInviteRumor, EditRumor)
                      │  and OWN casts (ConcordDirectInvite extends core's EventCast directly)
                      └─ applesauce-actions: wrapped-messages.ts already imports Rumor from
                         applesauce-common/helpers/gift-wrap (pre-existing, untouched)
```

### Recommended Project Structure

No new files/folders. Modify in place:
```
packages/common/src/helpers/
├── threading.ts     # genericize getNip10References, getEventPointerFromThreadTag, interpretThreadTags
├── emoji.ts          # genericize getEmojiTag, getEmojiFromTags, getReactionEmoji
├── hashtag.ts        # genericize getHashtagTag
├── content.ts        # genericize getContentWarning
└── __tests__/exports.test.ts   # snapshot — verify unchanged after genericization
```

### Pattern: Signature-only genericization (proven in Phase 1)

**What:** Add `<E extends StoreEvent = NostrEvent>` to the function signature only; leave the body and all internal calls untouched. The default preserves `NostrEvent` inference at every existing call site.
**When to use:** Any helper whose parameter is read only for structural fields (`tags`, `content`, `pubkey`, `created_at`, `kind`, `id`) and whose return type does not depend on a `KnownEvent`-based branded alias.
**Example:**
```typescript
// Source: packages/core/src/helpers/pointers.ts (Phase 1 pattern, 01-01-SUMMARY.md)
// Before:
export function eventMatchesPointer(event: NostrEvent, pointer: Pointer): boolean { ... }
// After:
export function eventMatchesPointer<E extends StoreEvent = NostrEvent>(event: E, pointer: Pointer): boolean { ... }
```
Applied to common:
```typescript
// packages/common/src/helpers/threading.ts — current signature
export function getNip10References(event: NostrEvent | EventTemplate): ThreadReferences { ... }
// Target signature (structural-only reads: .tags only)
export function getNip10References<E extends { tags: string[][] } = NostrEvent>(event: E): ThreadReferences { ... }
```
Import `StoreEvent` from `applesauce-core/helpers/event` for the parameter bound where a full structural shape is read (id/kind/pubkey/created_at/content/tags); use a narrower inline shape (e.g. `{ tags: string[][] }`) where only tags are read, to avoid an unnecessary `StoreEvent` import in tag-only utility files — mirrors the existing narrow-shape pattern already used in `blossom.ts` (`event: { tags: string[][] } | string[][]`) and `emoji.ts` (`event: { tags: string[][] } | string[][]`).

### Anti-Patterns to Avoid
- **Genericizing a `isValidXxx(event): event is XxxEvent` guard by changing only the parameter type:** the return type `event is XxxEvent` still narrows to `KnownEvent<K>` (hardcoded `NostrEvent`), so a rumor passed in would incorrectly narrow to a `NostrEvent`-shaped type at the call site — a real type-soundness bug, not just style. Do not attempt this without first genericizing `KnownEvent` in core (out of scope).
- **Adding a new `EventCast<Rumor>` subclass in `applesauce-common` "to establish the pattern"** with no concrete consumer: this is exactly the "high churn, low value" pattern CONTEXT.md's Out-of-Scope table forbids. The pattern is already established in `applesauce-core`'s own test suite (RUMOR-06) and in `applesauce-concord`'s `ConcordDirectInvite` — a third demonstration inside `common` adds no new proof and no real capability.
- **Touching `KnownEvent` in `applesauce-core`:** this reopens Phases 1-3's closed scope (CORE-01..07 are marked complete) and is not listed as a Phase 4 requirement.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rumor-aware cast for a new kind | A new generic `EventCast<Rumor>` subclass inside `applesauce-common` | `applesauce-core`'s already-generic `EventCast<E>` directly in the consuming package (concord's own `ConcordDirectInvite` pattern) | Common casts are kind-specific and NostrEvent-typed by design; per-app rumor casts belong in the app package, not common, until a genuinely shared cross-app rumor kind exists |
| Structural helper for a new kind | A NostrEvent-only helper when a rumor variant is foreseeable | The `E extends StoreEvent = NostrEvent` pattern from Phase 1, applied only to the curated set below | Keeps future extension mechanical without speculative churn now |

**Key insight:** The generic infrastructure (`EventStore<E>`, `EventCast<E>`, `CastRefEventStore<E>`) is already fully built and proven in core (Phases 1-3). `applesauce-common` does not need to preemptively adopt generics everywhere to benefit from it — downstream packages can already build fully rumor-typed casts today by importing core's generics directly (concord proves this). Phase 4's job is narrowly to make the handful of genuinely cross-kind, structural-only common helpers reusable in that scenario, not to convert the whole package.

## Structural Helpers to Genericize (concrete list — COMMON-01)

All functions below take a full event/tags parameter, read ONLY structural fields, and do **not** depend on a `KnownEvent`-based branded return type. `[VERIFIED: packages/common/src/helpers/*.ts]` via direct source read.

| File | Function(s) | Current signature reads | Genericize to |
|------|-------------|--------------------------|----------------|
| `helpers/threading.ts` | `getNip10References` | `event.tags` only | `<E extends { tags: string[][] } = NostrEvent>(event: E)` |
| `helpers/threading.ts` | `getEventPointerFromThreadTag`, `interpretThreadTags` | `tag: string[]` / `tags: string[][]` — already portable, no event param | No change needed (already generic-shaped); confirm and note in PLAN as "verified already portable" |
| `helpers/emoji.ts` | `getEmojiTag`, `getEmojiFromTags` | `event: { tags: string[][] } \| string[][]` — already generic-shaped | No change needed; confirm |
| `helpers/emoji.ts` | `getReactionEmoji` | `event.tags` only, no branded return | `<E extends { tags: string[][] } = NostrEvent>(event: E)` |
| `helpers/hashtag.ts` | `getHashtagTag` | `event.tags`, `event: NostrEvent \| EventTemplate` | `<E extends { tags: string[][] } = NostrEvent>(event: E, hashtag: string)` |
| `helpers/content.ts` | `getContentWarning` | `event.tags` only | `<E extends { tags: string[][] } = NostrEvent>(event: E)` |
| `helpers/comment.ts` | `getCommentEventPointer`, `getCommentAddressPointer`, `getCommentExternalPointer` | `tags: string[][]` — no event param | No change needed; already portable |
| `helpers/groups.ts` | `getGroupPointerFromHTag`, `getGroupPointerFromGroupTag` | `tag: string[]` — no event param | No change needed; already portable |
| `helpers/blossom.ts` | `getBlossomServersFromList` | `event: { tags: string[][] } \| string[][]` | No change needed; already portable |

**Net new signature changes required: ~4 functions across 4 files** (`threading.ts`, `emoji.ts`, `hashtag.ts`, `content.ts`). The remainder of the "structural-only" candidates in this table are already portable (take raw `tags`/`tag` arrays, no `NostrEvent`-specific coupling) and require zero code change — just confirmation/documentation that they satisfy COMMON-01 as-is.

## Helpers to explicitly NOT genericize (deferred — COMMON-F1/F2)

`[VERIFIED: packages/common/src/helpers/*.ts]` — confirmed by grep: every one of these ~40 files defines an `export type XxxEvent = KnownEvent<K>` and an `isValidXxx(event?: NostrEvent): event is XxxEvent` guard (or the article/badge/code-snippet/etc. overload variant of the same pattern): `app-data.ts`, `app-handler.ts`, `article.ts`, `badge-award.ts`, `badge.ts`, `bookmark.ts`, `calendar-event.ts`, `calendar-rsvp.ts`, `calendar.ts`, `channels.ts`, `code-snippet.ts`, `comment.ts` (the `CommentEvent`-typed getters, distinct from the tag-only pointer functions above), `emoji-pack.ts`, `file-metadata.ts`, `forum-thread.ts`, `git-grasp-list.ts`, `git-lists.ts`, `git-repository.ts`, `lists.ts`, `mute.ts`, `nostr-web-token.ts`, `picture-post.ts`, `poll.ts`, `profile-badges.ts`, `reaction.ts`, `relay-discovery.ts`, `relay-list.ts`, `reports.ts`, `share.ts`, `stream-chat.ts`, `stream.ts`, `torrent.ts`, `trusted-assertions.ts`, `user-status.ts`, `zap-goal.ts`, `zap.ts`.

**Why deferred:** `KnownEvent<K>` (`packages/core/src/helpers/event.ts:38`) is `Omit<NostrEvent, "kind"> & { kind: K }` — hardcoded to `NostrEvent`, not generic over `E extends StoreEvent`. Genericizing any of the above `isValidXxx` guards would either (a) require also genericizing `KnownEvent` in `applesauce-core` (reopens Phases 1-3's closed scope — CORE-01..07 already complete, not a Phase 4 requirement), or (b) require the guard's return type to diverge from its exported `XxxEvent` alias (a real behavior/type change, not the zero-behavior-change bar this phase requires). Neither is justified by a concrete rumor consumer today (see next section). Correctly deferred to COMMON-F1 ("Genericize the remaining `applesauce-common` casts/helpers/models that have no current rumor use case, one-by-one as concrete needs arise") per REQUIREMENTS.md.

Also NOT touched (already handle `Rumor` directly, pre-dating this migration, out of scope):
`helpers/gift-wrap.ts`, `helpers/messages.ts`, `helpers/wrapped-messages.ts`, `helpers/encrypted-content-cache.ts`, `factories/gift-wrap.ts`, `factories/wrapped-message.ts`, `operations/gift-wrap.ts`, `operations/wrapped-message.ts`, `operations/reaction.ts` (accepts `NostrEvent | Rumor | {id,pubkey,kind}` union already), `models/gift-wrap.ts`, `models/wrapped-messages.ts`. `[VERIFIED: packages/common/src/helpers/gift-wrap.ts]` — these already import `Rumor` from `applesauce-core/helpers/event` and type their parameters as `Rumor` (or `Rumor | NostrEvent` unions) directly. This is a **pre-existing NIP-59 feature**, unrelated to the `E extends StoreEvent` generic pattern — it needs no change to satisfy COMMON-01/02/03.

## Targeted Casts (concrete finding: none — COMMON-02)

`[VERIFIED: packages/common/src/casts/*.ts, packages/concord/src, packages/actions/src, packages/wallet/src]` — grep audit of every downstream consumer for `Rumor` usage combined with `applesauce-common` cast imports.

**Finding:** Zero `applesauce-common` casts are applied to rumors by any current consumer.

- `applesauce-concord`'s only rumor cast is `ConcordDirectInvite` (`packages/concord/src/casts/direct-invite.ts`), which extends **`applesauce-core`'s `EventCast` directly** (`import { EventCast } from "applesauce-core/casts"`), not any `applesauce-common` cast. Its event type (`DirectInviteRumor`) is defined locally in concord (`packages/concord/src/helpers/direct-invite.ts`), not derived from any common `XxxEvent` alias.
- `applesauce-actions`' `wrapped-messages.ts` action file imports `Rumor` from `applesauce-common/helpers/gift-wrap` and `castUser` from `applesauce-common/casts` — but `castUser`/`PubkeyCast` operates on a **pubkey string**, not an event, so it is unaffected by the `StoreEvent` generic question entirely.
- `applesauce-wallet` has no `Rumor` references anywhere in its source (`[VERIFIED: grep -rn "Rumor" packages/wallet/src]` returned zero matches).
- Concord's `invite-list.ts` and `community-list.ts` casts do `import "applesauce-common/casts"` for side-effect registration only (their own list-cast subclasses), not for a rumor-typed cast.

**Recommendation:** COMMON-02's targeted-cast set is **empty for this phase**. Do not add a new `EventCast<Rumor>` cast to `applesauce-common` speculatively — no concrete consumer needs one, and the pattern is already proven twice over (core's RUMOR-06 test, concord's `ConcordDirectInvite`). Should a genuinely shared cross-app rumor kind emerge later (e.g. a `applesauce-common`-level NIP-17 message cast), it becomes a COMMON-F1 candidate at that time, following the exact `EventCast<E extends StoreEvent = NostrEvent>` pattern already established in core.

**Models/factories:** Since no cast changes, no `applesauce-common` model or factory needs touching for COMMON-02. This also means `CastRefEventStore` references inside common casts require no change — they already compile against `NostrEvent` via core's default, per the migration doc's watch-item (line 217 of `rumor-store-migration.md`), and no genericization work makes them do otherwise this phase.

## Snapshot/Test Risk (COMMON-03)

Four export-snapshot (`toMatchInlineSnapshot`) files exist in `applesauce-common`, all using `Object.keys(exports).sort()` — i.e., they snapshot the **set of exported names**, not their type signatures:

| File | Lines | What it snapshots |
|------|-------|--------------------|
| `packages/common/src/helpers/__tests__/exports.test.ts` | 459 | All named exports from `helpers/index.ts` |
| `packages/common/src/casts/__tests__/exports.test.ts` | 57 | All named exports from `casts/index.ts` |
| `packages/common/src/operations/__tests__/exports.test.ts` | 51 | All named exports from `operations/index.ts` |
| `packages/common/src/__tests__/exports.test.ts` | 17 | All named exports from the package root `index.ts` |

**Expected outcome:** Genericizing `getNip10References`/`getReactionEmoji`/`getHashtagTag`/`getContentWarning` signatures-only (per the curated list above) changes **zero export names** — the functions keep their existing names, just gain a type parameter with a default. All four snapshots must remain **byte-for-byte unchanged**; an unchanged snapshot is itself the acceptance proof for COMMON-03, mirroring Phase 1's `01-01-SUMMARY.md` precedent where `exports.test.ts` needed updating only because a genuinely NEW export (`verifyRumor`) was added — not because existing signatures changed. `vitest -u` should NOT be needed for this phase's curated helper list; if it reports a diff, that is a signal something outside the planned scope changed and should be investigated, not silently accepted.

No `models/__tests__` or `factories/__tests__` export-snapshot files exist `[VERIFIED: find ... -name exports.test.ts]` — consistent with the "no models/factories touched" conclusion above.

## Common Pitfalls

### Pitfall 1: Assuming `KnownEvent<K>` is already generic
**What goes wrong:** A planner assumes all `isValidXxx`/`XxxEvent` helpers can be mechanically genericized the same way core's structural helpers were in Phase 1.
**Why it happens:** The surface pattern (`isValidBadge(event): event is BadgeEvent`) looks identical to core's genericizable helpers, but `BadgeEvent = KnownEvent<K>` is a NostrEvent-hardcoded type alias, not a bare structural shape.
**How to avoid:** Grep for `KnownEvent<` usage before genericizing any `isValidXxx` guard; if the return type references a `KnownEvent`-derived alias, defer it (see the deferred list above).
**Warning signs:** `tsc` errors like "Type 'E' is not assignable to type 'NostrEvent'" when trying to genericize a guard whose branded return type wasn't also changed.

### Pitfall 2: Downstream-inference trap (bare generic instantiation)
**What goes wrong:** A genericized helper with `<E extends { tags: string[][] } = NostrEvent>` gets called somewhere with a bare, unannotated object literal (`{ tags: [] }`), and TypeScript infers `E` as that literal's exact shape instead of falling back to the `NostrEvent` default — silently changing downstream type inference at that call site.
**Why it happens:** TS generic defaults only apply when no argument is passed to infer from; any call site provides an argument, so inference always wins over the default.
**How to avoid:** After genericizing, run the FULL `pnpm run build` (not just `pnpm --filter applesauce-common build`) to catch every downstream package (concord, actions, wallet, react) that calls these helpers — this is the exact lesson already learned in Phases 1-3 per `01-01-SUMMARY.md`'s "Reflect.get inference" deviation and CONTEXT.md's explicit reminder.
**Warning signs:** New `tsc` errors in `packages/concord`, `packages/actions`, `packages/wallet`, or `packages/react` after a common helper's signature changes, even though `applesauce-common`'s own build is green.

### Pitfall 3: `CastRefEventStore` references in common casts silently breaking
**What goes wrong:** Even though this phase adds no new casts, if a future task accidentally imports `EventCast`/`CastRefEventStore` without their default type parameter, existing common cast subclasses (`Note`, `Profile`, etc.) could stop inferring `NostrEvent` and instead widen to `StoreEvent`.
**Why it happens:** `EventCast<E extends StoreEvent = NostrEvent>` and `CastRefEventStore<E extends StoreEvent = NostrEvent>` are already generic (Phase 2); an accidental explicit `<StoreEvent>` instantiation instead of relying on the default would compile but change the type surface.
**How to avoid:** Do not touch `casts/cast.ts`'s re-exports in this phase (verified they are pure re-exports, no local generic instantiation — `[VERIFIED: packages/common/src/casts/cast.ts]`). Leave all 30 cast files untouched, matching the "zero targeted casts" recommendation.
**Warning signs:** Any diff appearing in `casts/*.ts` files during this phase's implementation should be treated as scope creep, not an expected outcome.

## Code Examples

### Genericizing `getNip10References` (representative example for the curated list)
```typescript
// Source: packages/common/src/helpers/threading.ts (current)
export function getNip10References(event: NostrEvent | EventTemplate): ThreadReferences {
  return interpretThreadTags(event.tags);
}

// Target (COMMON-01, signature-only change, body untouched)
export function getNip10References<E extends { tags: string[][] } = NostrEvent>(event: E): ThreadReferences {
  return interpretThreadTags(event.tags);
}
```

### Confirming a cast needs no change (representative — `Note`)
```typescript
// Source: packages/common/src/casts/note.ts (unchanged this phase)
// CastRefEventStore and EventCast already default to NostrEvent via core's generics;
// this class requires zero edits to remain correct and zero edits to support a future
// rumor-typed Note IF a concrete need ever arises (it would become `EventCast<Rumor & {kind:1}>`
// at that time, following concord's ConcordDirectInvite precedent, not before).
export class Note extends EventCast<KnownEvent<1>> { ... }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `EventStore`/`EventCast` hardcoded to `NostrEvent` | Generic over `E extends StoreEvent = NostrEvent` | Phases 1-2 (this milestone) | `applesauce-common` casts already compile against the generic core with zero changes — confirmed by the existing green build noted in CONTEXT.md ("Phase 2 already fixed one applesauce-common file... the common package currently builds clean against generic core") |
| N/A — no prior common-level rumor cast pattern | Concrete rumor casts live in the consuming app package (concord), not in `applesauce-common` | Established during Phase 3 gate + concord's own CORD-05 work (pre-existing) | Sets the precedent this research recommends continuing: rumor casts stay app-local until a shared need exists |

**Deprecated/outdated:** None — this is additive-only generics work with no runtime behavior change.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The curated 4-function genericization list is the complete "high-value, zero-risk" set; no other common helper is both structural-only AND free of `KnownEvent` entanglement | Structural Helpers to Genericize | Low — worst case the planner discovers 1-2 more portable tag-only helpers during implementation and adds them; this doesn't change the overall conservative scope decision |
| A2 | No hidden/undocumented downstream consumer (outside this monorepo) applies an `applesauce-common` cast to a rumor | Targeted Casts | Low-medium — `applesauce-common` is a published npm package; external consumers aren't visible to a repo grep. Mitigated by the fact COMMON-02 explicitly allows an empty set when no concrete need is found, and any external need surfaces as a COMMON-F1 request later |

## Open Questions

1. **Should the "already portable" tag-only helpers (comment.ts pointer functions, groups.ts, emoji.ts's tag-only functions, blossom.ts) get an explicit type annotation added even though no code change is needed?**
   - What we know: They already accept `tags: string[][]` or `{ tags: string[][] } | string[][]` — technically satisfy COMMON-01 as written today.
   - What's unclear: Whether the planner should add a one-line comment/JSDoc noting "already portable — verified structural-only, no `E` param needed" for auditability, or leave them silent.
   - Recommendation: Add a brief note in the relevant PLAN.md verification step confirming these were checked and require no change, so the phase's COMMON-01 completion is auditable without inventing unnecessary generic parameters on functions that don't need them.

## Environment Availability

Skipped — this phase has no external tool/service dependencies. It is a pure TypeScript source change verified by `pnpm --filter applesauce-common test`, `pnpm --filter applesauce-common build`, and `pnpm run build` (all already available in this workspace — `[VERIFIED: package.json scripts, turbo build]`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-standard) `[VERIFIED: packages/common/package.json "test": "vitest run --passWithNoTests"]` |
| Config file | Root/workspace vitest config (no package-local override found) |
| Quick run command | `pnpm --filter applesauce-common test` |
| Full suite command | `pnpm run build && pnpm run test` (root: `turbo build --filter='./packages/*' && vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| COMMON-01 | Genericized helpers preserve default `NostrEvent` behavior for existing callers | unit | `pnpm --filter applesauce-common test threading emoji hashtag content` | ✅ (existing test files: `threading` covered indirectly via `note.ts`/cast tests; `emoji.test.ts`, `hashtags.test.ts`, `content.test.ts` exist) |
| COMMON-01 | No export-name drift | unit (snapshot) | `pnpm --filter applesauce-common test exports` | ✅ `helpers/__tests__/exports.test.ts` |
| COMMON-02 | No cast changes — casts still compile and existing cast tests pass | unit | `pnpm --filter applesauce-common test` (full suite, includes `casts/__tests__/*`) | ✅ |
| COMMON-03 | Full workspace type-checks after common's signature changes | build | `pnpm run build` | ✅ (turbo pipeline) |

### Sampling Rate
- **Per task commit:** `pnpm --filter applesauce-common test <affected-file-stem>`
- **Per wave merge:** `pnpm --filter applesauce-common test` (full package suite) + `pnpm run build` (full workspace — the downstream-inference gate)
- **Phase gate:** Full suite green + full workspace build green before `/gsd-verify-work`

### Wave 0 Gaps
None — existing test infrastructure (`threading` covered via `note.test.ts`/cast tests, `emoji.test.ts`, `hashtags.test.ts`, `content.test.ts`, all four `exports.test.ts` snapshots) fully covers this phase's requirements. No new test files or fixtures are needed.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | No auth surface touched |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A |
| V5 Input Validation | Marginal — type-level only | TypeScript generic bounds (`E extends StoreEvent`) are a compile-time contract, not a runtime validator; runtime shape validation for rumors is already handled by `verifyRumor`/`RumorStore` in core (Phase 1/3), unchanged by this phase |
| V6 Cryptography | No | This phase does not touch signature verification, encryption, or the gift-wrap unlock/seal crypto paths (`gift-wrap.ts`'s `unlockSeal`/`unlockGiftWrap` are explicitly out of scope, unmodified) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Type-widening regression silently accepting a malformed/unsigned event where a signed one was assumed | Tampering | The explicit "do not genericize `isValidXxx`/`KnownEvent`-guarded helpers" boundary in this research prevents exactly this — those guards continue to narrow strictly to `NostrEvent`-shaped types, so no signature/verification assumption is weakened |
| Rumor content accepted as if it were signed (already mitigated upstream) | Spoofing | Out of this phase's scope — `verifyRumor`/`RumorStore` (Phase 1/3, core) already gate rumor validity before any `applesauce-common` helper sees a rumor; this phase adds no new rumor-acceptance path |

## Sources

### Primary (HIGH confidence — direct codebase verification)
- `packages/common/src/helpers/*.ts` (all 48 files) — read/grepped directly to classify structural-vs-KnownEvent-guarded helpers
- `packages/common/src/casts/*.ts` (30 files) — grepped for `Rumor` usage (zero matches) and read `cast.ts`, `note.ts`, `profile.ts` as representative samples
- `packages/core/src/helpers/event.ts` — confirmed `KnownEvent<K> = Omit<NostrEvent, "kind"> & { kind: K }` is NostrEvent-hardcoded
- `packages/concord/src/casts/direct-invite.ts`, `packages/concord/src/types.ts`, `packages/concord/src/helpers/direct-invite.ts` — confirmed concord's rumor cast bypasses `applesauce-common` entirely
- `packages/actions/src/actions/wrapped-messages.ts` — confirmed pre-existing `Rumor`-typed common helper usage needs no change
- `packages/common/src/{helpers,casts,operations}/__tests__/exports.test.ts` and `packages/common/src/__tests__/exports.test.ts` — confirmed the 4 export-snapshot files and their "sorted export names" invariant
- `packages/common/package.json`, root `package.json` — confirmed test/build commands and package version (6.2.0)
- `.planning/rumor-store-migration.md`, `.planning/REQUIREMENTS.md`, `.planning/phases/04-common-package-rumor-support/04-CONTEXT.md`, `.planning/phases/01-generic-store-foundation/01-01-SUMMARY.md` — authoritative project planning docs

### Secondary (MEDIUM confidence)
None used — no external documentation lookup was needed or performed (no new libraries; no web search providers configured for this session — `brave_search`/`firecrawl`/`exa_search` all reported unavailable by `init.phase-op`).

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries, verified via package.json
- Architecture: HIGH — verified via direct source reads of core's `KnownEvent`, common's helper/cast patterns, and concord's rumor cast implementation
- Pitfalls: HIGH — pitfalls 1-2 are directly evidenced in this codebase (Pitfall 2 is literally the deviation already recorded in `01-01-SUMMARY.md`)

**Research date:** 2026-07-09
**Valid until:** Stable — this is internal architecture, not subject to external ecosystem drift. Re-verify only if Phases 1-3's `KnownEvent`/`EventCast` design changes before Phase 4 executes.
