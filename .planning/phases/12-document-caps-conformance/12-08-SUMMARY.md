---
phase: 12-document-caps-conformance
plan: 08
subsystem: applesauce-concord (control-plane channel fold + deleteChannel)
tags: [wire-conformance, round-trip, denylist, control-plane, channel]
dependency-graph:
  requires: ["12-04"]
  provides: ["WIRE-09-item-3-channel-fold", "WIRE-10-deleteChannel"]
  affects: ["packages/concord/src/types.ts", "packages/concord/src/helpers/control.ts", "packages/concord/src/client/admin.ts"]
tech-stack:
  added: []
  patterns: ["denylist-then-spread (destructure sensitive fields out by name, spread the rest)", "open-object index signature ([k: string]: unknown) for forward-compatible round-trip"]
key-files:
  created: []
  modified:
    - packages/concord/src/types.ts
    - packages/concord/src/helpers/control.ts
    - packages/concord/src/client/admin.ts
    - packages/concord/src/helpers/__tests__/control.test.ts
    - packages/concord/src/client/__tests__/community.test.ts
decisions:
  - "D-22 denylist-then-spread implemented verbatim: `const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = parsed`; spread FIRST, assigned fields LAST in the constructed ChannelMetadata literal."
  - "CommunityMetadata stays closed (D-24) — zero source change to the metadata fold; a new test (Test E) proves its blind `as CommunityMetadata` cast already preserves unknown top-level keys."
  - "deleteChannel converted from a hand-rolled three-field literal to destructure-channel_id-and-spread-the-rest, matching deleteRole's existing preserve-plus-terminal-flag idiom."
  - "custom received no dedicated handling anywhere in this plan (D-15) — both its old conditional spread clause in the fold and any custom-specific branch in deleteChannel are gone; it travels through the rest/spread like any other key."
metrics:
  duration: ~21min
  completed: 2026-07-30
status: complete
---

# Phase 12 Plan 08: Channel-Fold Denylist-Then-Spread + deleteChannel Preservation Summary

Denylist-then-spread closes the channel-edition fold's round-trip gap while keeping `key`/`epoch` from ever becoming live properties — resolving the D-13/D-14 collision per D-22's user ruling — and `deleteChannel` now preserves everything the fold kept, proven on the raw published wire content.

## What Was Built

**Task 1 — `ChannelMetadata` opened, channel fold converted to denylist-then-spread.**
- `packages/concord/src/types.ts`: `ChannelMetadata` gained `[k: string]: unknown`, matching the open-object idiom already used by `CommunityListCommunity`/`CommunityTombstone`/`InviteListInvite`/`InviteListTombstone` in the same file. A doc comment records the reason (CORD-02 §6 + D-13) and the deliberate asymmetry with `CommunityMetadata`, which stays CLOSED (D-24) — its fold is a blind `as` cast that already preserves runtime keys, and opening it would silently disable typo detection on `editMetadata`'s `Partial<CommunityMetadata>` patch.
- `packages/concord/src/helpers/control.ts`: the channel fold's explicit four-field pick was replaced with `const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = parsed as Record<string, unknown>`, keeping the existing `typeof name !== "string" || typeof isPrivate !== "boolean"` validation (unchanged skip-on-failure behavior), then building `{ ...rest, channel_id: eid, name, private: isPrivate }` — spread FIRST, assigned fields LAST, so a raw edition's own `channel_id` cannot overwrite the entity id derived from the coordinate.
- The two conditional clauses for `deleted`/`custom` were deleted — both now arrive through `rest` like any other key (D-15: no `custom`-only branch).
- The CHAN-04 comment above the fold was rewritten to state the denylist rule, why a denylist (not a blind spread) is required — `tsc` stops our code reading an undeclared property, not a hostile edition's JSON from containing one — the future-contributor maintenance obligation to extend the denylist when `ChannelKey`/`JoinMaterial` gain a new sensitive field, and that `material.channels` remains the sole source of channel key material (D-01, unchanged). Confirmed by reading the CHAN-07 sticky-deletion scan (a separate pass over ALL authorized candidates, unaffected by this change) before deleting the `deleted` conditional's `typeof` check — `deleted`'s presence on the folded object is descriptive, not load-bearing.
- The constructed `ChannelMetadata` literal (spread-first, assignments-last) is at `packages/concord/src/helpers/control.ts` lines 317-323 in the final committed state.

**Task 2 — `deleteChannel` destructures the coordinate and spreads the rest.**
- `packages/concord/src/client/admin.ts`: `deleteChannel` now does `const { channel_id: _channel_id, ...rest } = ch; await this.publishEdition(VSK.CHANNEL, channelId, JSON.stringify({ ...rest, deleted: true }))`, replacing the hand-rolled `{ name, private, deleted: true }` literal. This matches `deleteRole`'s existing `{ ...current, deleted: true }` idiom in the same file.
- A doc comment above `deleteChannel` records: what is preserved and why nothing is enumerated (with Task 1's fold change, `ch` carries unknown keys, so the spread preserves them too — CORD-02 §6, D-13/D-14); why the spread is safe (`ChannelMetadata` carries no key material at the type level, and the fold's own denylist prevents key material from ever being a live property at the value level — D-22); and the ROADMAP criterion 4 correction (D-14) so verify-phase scores the preserved fields and absence of key material rather than the presence of a spread operator.
- Plan 12-04's three `assertByteCap(` call sites in `createChannel`/`editMetadata` are untouched; `createRole`, `editRole`, `deleteRole`, `publishEdition` are untouched.

**Task 3 — Six regression tests across two files, TDD-style with mandatory mutation observations.**
- `packages/concord/src/helpers/__tests__/control.test.ts` gained a new describe block (`"control fold — unknown-key round-trip (WIRE-09/WIRE-10/D-22/D-24)"`) with:
  - **Test A**: an edition carrying `custom` plus a top-level `future_flag` folds with both present and deep-equal, plus correct `name`/`private`/`channel_id`.
  - **Test B**: an edition additionally carrying `key`/`epoch` folds to an object where `Object.prototype.hasOwnProperty.call` returns `false` for both, while the same object's `future_flag` (from the same fixture shape as Test A) is still present — proving the denylist is selective.
  - **Test C**: a hostile edition's own `channel_id` cannot shadow the entity id — the folded `channel_id` equals the entity id supplied to `foldControl`, proving spread-first ordering.
  - **Test D**: a non-string `name` and a non-boolean `private` are each skipped (not folded, `foldControl` does not throw) — the fold's validation is unchanged.
  - **Test E (D-24)**: an authorized metadata edition (chained via `computeEditionHash`/`prevHash` onto genesis's own v1, matching the CHAN-07 test's linking pattern, so the fold's contiguous-chain walk adopts it as head) carrying unrecognized top-level keys folds with them present — with **zero source change** to the metadata fold.
- `packages/concord/src/client/__tests__/community.test.ts` gained **Test F** inside the `"wire conformance"` describe (using its `setupWireConformance()` fixture): creates a public channel, publishes a v2 edition directly (chained via `computeEditionHash`) carrying `custom` + an unrecognized key, confirms the fold adopted it, calls `deleteChannel`, then decodes the newly published control-plane wrap via `decodeWrap(wrap, controlGroupKey(...).convKey)` and inspects the **raw** `Object.keys` of the parsed edition content — never reading it back through the fold, so the denylist cannot mask a wire leak. Asserts `deleted: true`, `custom`, `future_flag`, `name`, `private` present, and `channel_id`/`key`/`epoch` absent.
- All three mandated non-vacuity mutations were performed and observed:
  1. Blind spread (dropped the `key`/`epoch` destructure) → Test B (and the pre-existing CHAN-04 test) went RED while Test A stayed green. Reverted.
  2. Reordered the constructed literal (`{ channel_id, name, private, ...rest }`) → Test C went RED (`folded` undefined, since the hostile edition's `channel_id` overwrote the entity id and the by-id lookup failed). Reverted.
  3. Restored `deleteChannel`'s hand-rolled three-field literal → Test F went RED (`raw.custom` undefined). Reverted.
  - Each mutation was verified clean-reverted via `git diff --stat` returning empty before moving on.

## Deviations from Plan

None — plan executed as written. The metadata-fold chaining detail in Test E (using `computeEditionHash`/`prevHash` to make the v2 edition the fold's adopted head) was not spelled out in the plan's action text but follows directly from the pre-existing CHAN-07 test's established pattern in the same file, and is documented here for future readers rather than filed as a deviation.

## Self-Check: PASSED

- `packages/concord/src/types.ts` — FOUND, contains `ChannelMetadata` with `[k: string]: unknown` and `CommunityMetadata` unchanged (no index signature).
- `packages/concord/src/helpers/control.ts` — FOUND, channel fold uses denylist-then-spread; metadata fold untouched.
- `packages/concord/src/client/admin.ts` — FOUND, `deleteChannel` destructures `channel_id` and spreads the rest.
- `packages/concord/src/helpers/__tests__/control.test.ts` — FOUND, contains Tests A-E.
- `packages/concord/src/client/__tests__/community.test.ts` — FOUND, contains Test F.
- Commit `a8e13299` (Task 1) — FOUND in `git log --oneline`.
- Commit `29dd3a1c` (Task 2) — FOUND in `git log --oneline`.
- Commit `dc421713` (Task 3) — FOUND in `git log --oneline`.
- `npx tsc --noEmit -p packages/concord/tsconfig.json` — exits 0.
- `pnpm --filter applesauce-concord test` — 539/539 green (53 files).
