---
quick_id: 260804-gzq
slug: exclude-ephemeral-kinds-from-concordobse
description: Exclude ephemeral kinds (20000-29999, per NIP-01) from ConcordObservedAuthorsModel's fold so voice-presence beacons can no longer resurrect a kicked or departed member
created: 2026-08-04
tasks: 2
source: .planning/todos/pending/11-verify-followups.md
must_haves:
  truths:
    - "A voice-presence beacon (kind 23313) newer than a member's Leave does NOT re-add them to members$."
    - "A voice-presence beacon newer than an authorized Kick does NOT re-add the kicked member to members$."
    - "A durable chat message (kind 9) newer than a Leave STILL re-adds the author to members$ — the fix does not over-narrow."
    - "Exclusion is by NIP-01 RANGE (20000–29999), never by enumerating 23313: kinds 20000/23313/29999 are excluded while 19999/30000 remain observed."
    - "ConcordObservedAuthorsModel's consumer set is pinned to {current-epoch guestbook, channel:*} — widening rewireState's observed selection fails a test."
    - "Every new test is demonstrated non-vacuous by an in-place revert/restore probe (observed RED without the fix, GREEN with it), not merely asserted in a comment."
  artifacts:
    - packages/concord/src/models/observed.ts
    - packages/concord/src/models/__tests__/index.test.ts
    - packages/concord/src/client/__tests__/community.test.ts
  key_links:
    - "packages/concord/src/helpers/guestbook.ts:123-126 (foldMembers' re-entry loop — the resurrection site, unchanged by this task)"
    - "packages/concord/src/models/community.ts:44 (ConcordCommunityStateModel assembles guestbook + caller-supplied observed stores)"
    - "packages/concord/src/client/community.ts:632-640 (rewireState's channel-prefix observed selection — the boundary Task 2 pins)"
    - "packages/concord/src/__tests__/cord-wire-fixtures.ts (VOICE_PRESENCE_JOINED_EXAMPLE — spec-derived beacon kind, independent of our own constant)"
---

# Quick Task 260804-gzq: exclude ephemeral kinds from the observed-authors fold

Phase 11 UAT test 2, backlogged rather than widened into Phase 11's scope. Verified live
before planning: `ConcordObservedAuthorsModel` (`models/observed.ts:9`) reads
`store.timeline([{}])` — **all kinds, unfiltered**. `rewireState` (`client/community.ts:640`)
feeds every `channel:*` store in as the community fold's observed-activity input, and
`foldMembers`' re-entry loop (`helpers/guestbook.ts:123-126`) re-adds any author whose latest
observed activity is newer than their departure. Since WIRE-02 removed the kind-23313
early-return from the receive funnel, voice-presence beacons land in `channel:*` stores and
reach that loop.

`ban()` still works — the banlist loop at `guestbook.ts:132` runs *after* the re-entry loop.
`kick()` alone does not, and `kick()` does not rotate the channel key, so a kicked client keeps
beaconing until an admin manually rotates. Exposure is not self-bounding.

## The rule: range, not enumeration

Exclude by **NIP-01 range 20000–29999**, never by special-casing 23313. This project has a
hard-won lesson on exactly this class (`prefer-structural-over-enumerated-fixes`; the 12-10
`CHANNEL_KEY_FOLD_DISPOSITION` precedent; the CR-01/WR-01 history). Any future presence-like
kind must be covered by construction.

Do **not** hand-roll the range. `applesauce-core/helpers/event` re-exports nostr-tools'
`isEphemeralKind` (verified: `20000 <= kind && kind < 30000`, present in
`packages/core/dist/helpers/event.js`), and `observed.ts` already imports from that exact
module specifier. Using it means the range definition comes from the NIP-01 implementation,
not from us — which is also what makes the boundary test in Task 1 an independent check
rather than the implementation asserting against itself.

## Where the filter goes

In **`ConcordObservedAuthorsModel`** (`models/observed.ts`), not in `observedAuthors`
(`models/utils.ts`). `observedAuthors` is a generic latest-ms-per-author reducer over any
rumor iterable; "observation means *durable* authorship" is a Concord fold policy, and the
model is the single entry point — `models/community.ts:45` is its only consumer, and
`observedAuthors` has no other caller (verified by grep). Do not change `models/utils.ts`.

## Standing constraints

- **No changeset.** `packages/concord` is unreleased; this is a standing project rule.
- **No new exports.** `packages/concord/src/__tests__/exports.test.ts` snapshots the public
  surface — keep the change internal to `observed.ts` so there is zero snapshot churn.
- **Watch CORD citations.** `packages/concord/src/__tests__/cord-citations.test.ts` walks every
  `.ts` under `packages/concord/src` and fails on any `CORD-NN §X` string naming a section that
  does not exist. Prefer citing NIP-01 in new comments; if you write a CORD citation, run that
  guard before committing.
- `tsconfig.json` excludes `src/**/__tests__/**` from the build, so `build` type-checks the
  source fix only — run `test` too.

## Task 1 — exclude ephemeral kinds + the four regression tests

**files:** `packages/concord/src/models/observed.ts`,
`packages/concord/src/models/__tests__/index.test.ts`

**action:**

Source fix (`models/observed.ts`, one file, no other source touched):

- Change the type-only import to a mixed one: pull `isEphemeralKind` as a value alongside
  `type Rumor` from `applesauce-core/helpers/event`.
- Filter the timeline before reducing: reject rumors whose `kind` satisfies `isEphemeralKind`,
  then pass the survivors to `observedAuthors`.
- Update the doc comment to state the contract: observation means *durable* authorship;
  ephemeral kinds (NIP-01 range 20000–29999) never count as presence in the roster fold, so a
  voice beacon cannot resurrect a removed member. Say it is a range check by design and that
  enumerating a single kind is the anti-pattern being avoided. Do not name the constant
  `VOICE_PRESENCE_KIND` as the target — that would re-frame a range rule as a kind rule.
- `noUnusedLocals` is on for source: leave no unused import behind.

Tests (`models/__tests__/index.test.ts`) — extend the existing `describe("Concord models")`
block, reusing its `rumorFromTemplate` / `add` helpers and `OWNER`/`ALICE`/`BOB` constants and
matching the surrounding fixture style (`createCommunity` genesis into a `control` RumorStore,
`JoinLeaveFactory` rumors into a `guestbook` RumorStore, activity into a `channel` RumorStore,
subscribe to `ConcordCommunityStateModel(material, { guestbook, observed: [channel] }, 10_000)`
and read `s.members`).

Source the beacon kind from the **vendored spec fixture**, not from our own constant: import
`VOICE_PRESENCE_JOINED_EXAMPLE` from `../../__tests__/cord-wire-fixtures.js` and use its
`.kind`. That file is dependency-free and already imported by client tests. Do **not** import
`VOICE_PRESENCE_KIND`, and do **not** import `isEphemeralKind` into the test — a test that
reuses the implementation's own predicate proves nothing.

Add exactly four tests:

1. **Beacon does not resurrect a departed member.** ALICE joins at ms 1000, leaves at 2000; a
   beacon (fixture kind) authored by ALICE lands in the channel store at 3000. Assert
   `members.has(ALICE) === false`.
2. **Durable message still re-adds a departed member (the mirror).** Identical fixture to test
   1 — same times, same author, same stores — differing in exactly one variable: the channel
   rumor is `kinds.ChatMessage` instead of the beacon kind. Assert
   `members.has(ALICE) === true`. Keeping the pair one-variable-apart is what makes the
   over-narrowing probe in the verification step meaningful.
3. **Beacon does not resurrect a kicked member.** ALICE joins at 1000; OWNER authors
   `KickFactory.create(ALICE)` into the guestbook at 2000 (owner is position 0 with every
   permission, ALICE is roleless, and `vacVerifier` exempts the owner — so the kick is honored
   with no `vac` tag); ALICE beacons into the channel at 3000. Assert
   `members.has(ALICE) === false`.
4. **Range boundary table.** One fixture, five *fresh distinct* pubkeys with no guestbook
   history at all (so `foldMembers` reaches them only through the observed loop's `!c` branch),
   each authoring one channel rumor at ms 4000 of kind `19999`, `20000`, `23313`, `29999`,
   `30000` — written as literals derived from NIP-01's ranges, never computed from
   `isEphemeralKind`. Assert membership is `true, false, false, false, true` respectively.
   `RumorStore` applies no kind gating (verified) and a `d`-less addressable event resolves to
   identifier `""` rather than throwing, so kind 30000 stores cleanly.

**non-vacuity probes (mandatory, in place, observe the output — do not assert them in a
comment):**

- **P1 — under-narrow.** Temporarily restore `observed.ts` to the unfiltered
  `map(observedAuthors)` form. Run the file. Tests 1 and 3 and the three ephemeral rows of
  test 4 must go **RED**. Restore the fix, confirm **GREEN**.
- **P2 — over-narrow.** Temporarily invert the predicate so only ephemeral kinds survive. Run
  the file. Test 2 and both durable rows of test 4 must go **RED**. Restore the fix, confirm
  **GREEN**.

Record both probes' observed results in the SUMMARY. P2 is not optional decoration: without
it, a filter that dropped *everything* would pass tests 1 and 3.

**verify:** `pnpm --filter applesauce-concord test` green (full suite, not just the one file)
and `pnpm --filter applesauce-concord build` exit 0. P1 and P2 both observed RED then restored
to GREEN.

**done:** `models/observed.ts` excludes kinds 20000–29999 by range via `isEphemeralKind`; four
new tests pass; no new package export; no changeset. Commit as
`fix(concord): exclude ephemeral kinds from the observed-authors fold`.

## Task 2 — pin ConcordObservedAuthorsModel's consumer set

**files:** `packages/concord/src/client/__tests__/community.test.ts`

The boundary is currently held only by prose. `client/community.ts:632-639` reasons about this
exact hazard — "narrowing observation is fail-safe (it can only shrink the memberlist, never
resurrect a removed member)" — but nothing enforces it, so a contributor widening
`rewireState`'s observed selection would not be caught. Flagged independently in
`.planning/v1.1-MILESTONE-AUDIT.md` under "New coverage gap".

**action:**

Add one test to `community.test.ts`. Build it in the file's established engine style
(`PrivateKeySigner` + `fakePool()` + `createCommunity`, `publishToPlane` the genesis control
and guestbook rumors, `await settle()`), modelled on the existing
`"Open Question 1 (DEFERRED to Phase 7)…"` test at ~line 1208 — reuse this file's
`rumorFromTemplate` helper and `community.dispose()` at the end.

Make it **total over whatever plane stores exist**, not an enumerated list of plane names —
that is what makes it survive a future plane being added:

- Touch `community.channelStore(general.channel_id)` first so a `channel:` key is present.
- Reach the private map: `(community as unknown as { stores: Map<string, { add: (r: Rumor) =>
  unknown }> }).stores` — the `as unknown as` accessor convention this suite already uses (see
  ~line 1080).
- Derive the expected partition **independently from the documented contract**, not by reading
  the implementation's expression: a store is an observed input iff its plane key starts with
  `channel:` or equals `` `guestbook@${community.epoch$.value}` ``. Note in a comment that the
  guestbook clause is current-epoch-scoped on purpose (ROTATE-04 / D-01/D-02) — a stale-epoch
  guestbook store is *not* an observed input.
- Guard the sample space before asserting anything: at least one live key must satisfy the
  predicate and at least one must not. A degenerate map would otherwise pass silently. This
  mirrors the anti-vacuity `it()` blocks in `src/__tests__/cord-citations.test.ts`.
- Mint one fresh distinct pubkey per store key and add one **durable** rumor (kind 9, ms 5000)
  authored by it into that store. Add the rumors for **non-observed** keys first and the
  observed ones last, then `await settle()`, so the final `state$` emission provably postdates
  every add.
- Assert, in one loop over the live keys, `members.has(authorFor(key)) === isObservedPlane(key)`.
  One loop covers both directions: a widening makes the control/dissolved authors appear, a
  narrowing makes the channel or guestbook author disappear.

Use kind 9 (durable) throughout — this test is about *which stores* are consulted, and an
ephemeral rumor would be filtered by Task 1's fix and mask the boundary being pinned.

**non-vacuity probe (mandatory, in place):**

- **P3 — widening.** Temporarily change `rewireState`'s observed selection in
  `client/community.ts` from the `channel:`-prefix filter to every store in the map. Run the
  file: the new test must go **RED**, naming the control (and/or dissolved) author as an
  unexpected member. Restore, confirm **GREEN**. Record the observed output in the SUMMARY.

**verify:** `pnpm --filter applesauce-concord test` green. P3 observed RED then restored to
GREEN.

**done:** one new test in `community.test.ts` pins the observed consumer set to
{current-epoch guestbook, `channel:*`} and fails on widening. Commit as
`test(concord): pin the observed-authors consumer set to guestbook + channel planes`.

## Out of scope

- `foldMembers`' re-entry loop itself (`helpers/guestbook.ts`) — unchanged. The fix is upstream
  of it, at the fold's input.
- `models/utils.ts` (`observedAuthors` / `mergeObserved`) — unchanged.
- Open Question 1's known residual (a removed member's OLD public-channel *durable* message
  still counting as observed post-Refounding). It is a separate, already-pinned deferral at
  `community.test.ts:1208` and must stay green.
- `kick()` not rotating the channel key. Real, noted in the source todo, but a separate change.

## Changesets

**None.** `packages/concord` is unreleased — standing project rule.

## Close-out

Mark `.planning/todos/pending/11-verify-followups.md` done (move to the completed todos
location this repo uses) and record the quick task in STATE.md's Quick Tasks Completed table
with both commit SHAs. Commit the planning artifacts as
`docs(quick-260804-gzq): exclude ephemeral kinds from the observed-authors fold`.
