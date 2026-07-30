---
phase: 12-document-caps-conformance
plan: 07
subsystem: applesauce-concord
tags: [wire-format, community-list, invite-list, round-trip, D-12]
dependency-graph:
  requires: ["12-03", "12-05"]
  provides: ["ParsedCommunityList (open document)", "ParsedInviteList (open document)"]
  affects: ["12-09"]
tech-stack:
  added: []
  patterns:
    - "Open-document root via `[k: string]: unknown` index signature (mirrors the existing per-entry convention in types.ts), instead of a closed two-field struct"
    - "Parse-spread-and-default instead of parse-destructure-and-reconstruct: `{ ...doc, entries: doc.entries ?? [], tombstones: doc.tombstones ?? [] }`"
key-files:
  created: []
  modified:
    - packages/concord/src/helpers/community-list.ts
    - packages/concord/src/helpers/invite-list.ts
    - packages/concord/src/operations/community-list.ts
    - packages/concord/src/operations/invite-list.ts
    - packages/concord/src/casts/community-list.ts
    - packages/concord/src/casts/invite-list.ts
    - packages/concord/src/casts/__tests__/community-list.test.ts
    - packages/concord/src/casts/__tests__/invite-list.test.ts
    - packages/concord/src/client/client.ts
    - packages/concord/src/client/__tests__/extra-relays.test.ts
    - packages/concord/src/helpers/__tests__/community-list.test.ts
    - packages/concord/src/helpers/__tests__/invite-list.test.ts
decisions:
  - "Task 2 also re-pointed two additional test files not in the plan's declared files_modified list — casts/__tests__/community-list.test.ts and casts/__tests__/invite-list.test.ts — because their `.unlock(signer)` assertions compare against the renamed field shape and the compiler could not flag them (Rule 3: blocking issue, required for a green suite)."
  - "Applied D-01/D-12's open-root fix identically to both documents: index signature declared exactly as types.ts already declares it on the four per-entry types (CommunityListCommunity, CommunityTombstone, InviteListInvite, InviteListTombstone), so the package expresses 'open object' one way, not two."
metrics:
  duration: ~15min
  completed: 2026-07-30
status: complete
---

# Phase 12 Plan 07: Open the Community List / Invite List document roots (WIRE-09) Summary

Made `ParsedCommunityList` and `ParsedInviteList` carry the wire document's own open shape — keyed
`entries` with an index signature admitting unrecognized top-level keys — so `parseCommunityList`/
`parseInviteList` spread the whole document instead of reconstructing a closed two-field struct, and
`modifyCommunityList`/`modifyInviteList` re-serialize that spread document rather than a bare
`{entries, tombstones}` literal built from the applied arrays.

## What Changed

**Task 1 — Open both document roots** (`packages/concord/src/helpers/community-list.ts`,
`invite-list.ts`): `ParsedCommunityList`/`ParsedInviteList` renamed their array field to `entries`
(matching the wire key, dropping the old in-memory alias) and gained `[k: string]: unknown`, the
same idiom `types.ts` already uses on `CommunityListCommunity`, `CommunityTombstone`,
`InviteListInvite`, and `InviteListTombstone`. `parseCommunityList`/`parseInviteList` now do
`{ ...doc, entries: doc.entries ?? [], tombstones: doc.tombstones ?? [] }` instead of casting to a
local anonymous type and renaming. `getLiveCommunities`/`getLiveInvites` and both `unlockXList`
fallback literals were re-pointed to `entries`. Both doc comments were rewritten to state the new
contract and explain why the root is open rather than carrying a named "the rest" field (a carrier
keeps the reconstruction and depends on every future write site remembering to spread it — exactly
what D-12 rejected).

**Task 2 — Delete the reconstruction literals, re-point every consumer**
(`operations/community-list.ts`, `operations/invite-list.ts`, `casts/community-list.ts`,
`casts/invite-list.ts`, `client/client.ts`): `modifyCommunityList`/`modifyInviteList` now hold the
parsed open document in a local, apply the operation to `parsed.entries`/`parsed.tombstones`, and
serialize `{ ...parsed, entries: next.communities, tombstones: next.tombstones }` (and the invite
mirror) — so any top-level key this client version does not recognize survives the mutate step
unmodified. The armada-compatibility comment explaining the old rename was deleted and replaced
with a note on what the spread is for, citing CORD-02 §6/§8 (community list) and CORD-05 §4 (invite
list) plus D-01/D-12. Both casts' `communities`/`invites` getters (and their `$` observable
variants) kept their public names while reading `.entries` internally, with a one-line comment on
each explaining the getter-name-vs-wire-key asymmetry. `client.ts`'s `parseMirror` return type
widened to `ParsedCommunityList`; its legacy (bare-array) branch now also keys the array as
`entries` so both branches agree, and `loadMirror` reads `mirror.entries`. No `documentExtras`
field was added and `saveCommunityList`/`saveMirror` were left untouched (plan 12-09's scope, per
D-23). `CommunityListOperation`/`InviteListOperation` and both factories were confirmed unchanged
and absent from this plan's diff.

**Task 3 — Round-trip tests** (`helpers/__tests__/community-list.test.ts`,
`helpers/__tests__/invite-list.test.ts`): added a `describe("WIRE-09 round-trip: ...")` block per
document with: a parse-preservation test (a scalar unrecognized key plus a nested `custom` object
both survive `parseCommunityList`/`parseInviteList` alongside the known arrays); an
absent-array-defaulting test (a document with only an unrecognized key still gets `entries: []`,
`tombstones: []`); and an operation-round-trip test that builds a seed event with an unrecognized
top-level key, mutates it through `CommunityListFactory.modify(...).join(...)` /
`InviteListFactory.modify(...).mintInvite(...)`, decrypts the re-signed event's content directly,
and asserts the **raw** `JSON.parse`d key set and values — never by reading the result back through
`parseCommunityList`/`parseInviteList`, which would let a rename hide from the test. Each block
cites `CORD_ROUND_TRIP_SENTENCE` (the vendored CORD-02 §6 text) as its authority. The two
pre-existing `unlockCommunityList`/`unlockInviteList` tests had their field reads re-pointed from
`.communities`/`.invites` to `.entries`.

## Non-Vacuity (four mutations, all observed RED then reverted)

1. Reinstated the deleted reconstruction literal in `modifyCommunityList` (bare
   `JSON.stringify({ entries: next.communities, tombstones: next.tombstones })`, no spread) — the
   operation-round-trip test failed: raw key set was `['entries','tombstones']` instead of
   `['custom','entries','future_protocol_field','tombstones']`. Reverted.
2. Same mutation in `modifyInviteList` — identical failure mode. Reverted.
3. Restored the key rename in `parseCommunityList` (returned `{ communities, tombstones }`,
   dropped the spread) — both the absent-array-defaulting test (`parsed.entries` was `undefined`)
   and the operation-round-trip test (raw key set included `communities` instead of `custom`/
   `future_protocol_field`) failed; 4 of 14 tests in the file went RED. Reverted.
4. Same mutation in `parseInviteList` — the absent-array-defaulting test failed identically, and
   the operation-round-trip test crashed harder than expected (`TypeError: a is not iterable` in
   `mergeInvites`, since `parsed.entries` was `undefined` and `mintInvite`'s operation spreads it
   directly) rather than merely mis-comparing; still genuinely RED. 5 of 10 tests failed. Reverted.

## Verification

- `npx tsc --noEmit -p packages/concord/tsconfig.json` — exits 0.
- `pnpm --filter applesauce-concord test` — 53 files, 533 tests, all green.
- `pnpm exec turbo build --filter='./packages/*'` — 14/14 tasks succeed.
- `git diff --name-only` does not list `factories/community-list.ts`, `factories/invite-list.ts`,
  or `operations/__tests__/community-list.test.ts` — confirms the array-in/array-out operation
  primitives and their consumers were genuinely unaffected.
- `documentExtras` absent from `client.ts`; `saveCommunityList` untouched (0 added/removed lines in
  `git diff` for that function) — plan 12-09's scope respected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Re-pointed two cast test files not in the plan's declared `files_modified`**
- **Found during:** Task 2's full-suite verification run
- **Issue:** `casts/__tests__/community-list.test.ts` and `casts/__tests__/invite-list.test.ts` each
  assert `await expect(list.unlock(signer)).resolves.toEqual({ communities, tombstones: [] })` (and
  the invite mirror) — a runtime shape comparison the compiler's structural typing did not flag as
  an error, so these two files were not in the Task 1 `tsc` error list the plan expected Task 2 to
  work from.
- **Fix:** Re-pointed both `.resolves.toEqual(...)` expectations to `{ entries: ..., tombstones: [] }`.
- **Files modified:** `packages/concord/src/casts/__tests__/community-list.test.ts`,
  `packages/concord/src/casts/__tests__/invite-list.test.ts`
- **Commit:** 6a4199a5

No other deviations — the rest of the plan executed as written.

## Self-Check: PASSED

- FOUND: packages/concord/src/helpers/community-list.ts
- FOUND: packages/concord/src/helpers/invite-list.ts
- FOUND: packages/concord/src/operations/community-list.ts
- FOUND: packages/concord/src/operations/invite-list.ts
- FOUND: packages/concord/src/casts/community-list.ts
- FOUND: packages/concord/src/casts/invite-list.ts
- FOUND: packages/concord/src/client/client.ts
- FOUND: commit 80aa984f (Task 1)
- FOUND: commit 6a4199a5 (Task 2)
- FOUND: commit fb7859da (Task 3)
