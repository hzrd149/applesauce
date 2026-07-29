---
title: Phase 11 UAT follow-up — exclude ephemeral kinds from the observed-authors fold
status: pending
created: 2026-07-29
source: 11-UAT.md (test 2)
priority: high
---

Deferred from Phase 11 UAT. The stale-docs item (test 1) was fixed in-phase; this one was
verified as a real defect and backlogged per user decision rather than widened into Phase 11's
scope — no plan in the phase claimed the roster fold.

## Voice presence resurrects a kicked or departed member

WIRE-02 removed the kind-23313 early-return from the receive funnel, which is exactly what the
phase criterion asked for. The side effect is that voice-presence beacons now land in
`channel:*` stores, and those stores are the community fold's *observed activity* input.

`ConcordObservedAuthorsModel` (`packages/concord/src/models/observed.ts:9`) reads
`store.timeline([{}])` — all kinds, unfiltered. `rewireState` passes every `channel:*` store as
the observed set (`packages/concord/src/client/community.ts:640`). `foldMembers`' re-entry branch
(`packages/concord/src/helpers/guestbook.ts:123-126`) re-adds an author whenever
`lastMs > c.ms`. So a presence beacon newer than a member's departure re-adds them to `members$`.

**Verified empirically** with a throwaway `foldMembers` probe (three cases, since removed):

| Scenario | Observed beacon newer than removal | Result |
|---|---|---|
| `join(1000)` + `leave(2000)` | ms=3000 | **re-added** |
| `join(1000)` + authorized `kick(2000)` | ms=3000 | **re-added** |
| same, but on the banlist | ms=3000 | not re-added |

`ban()` remains an effective remedy because the banlist loop runs *after* the observed re-entry
loop (`guestbook.ts:132`). `kick()` alone does not.

**Exposure is not self-bounding.** `kick()` (`community.ts:1195-1204`) revokes roles and publishes
a Kick to the guestbook but does NOT rotate the channel key — rekey is a separate explicit
`rotateChannel` call. A kicked member keeps the channel key, so their client keeps beaconing until
an admin manually rotates.

**What actually changed.** This resurrection class pre-existed for chat: a removed member who
posts re-enters. WIRE-02 widened it from *requiring a deliberate user action* to *an idle client
doing it automatically*. That is a change in kind, and it is not covered by D-04's accepted
trade-off, which named ephemeral store growth rather than roster integrity.

Note that `community.ts:632-639` already reasons about this exact hazard — D-02/T-06-03 narrowed
control-store observation because "narrowing observation is fail-safe (it can only shrink the
memberlist, never resurrect a removed member)". That reasoning was never applied to presence.

## Fix

Exclude ephemeral kinds (20000–29999, per NIP-01) from `ConcordObservedAuthorsModel`'s fold rather
than special-casing 23313 — observation should mean *durable authorship*, so any future
presence-like kind is covered by construction instead of needing another patch.

Add regression tests in both directions: presence must not resurrect a departed or kicked member,
and a durable chat message must still count as observed activity (so the fix doesn't over-narrow).
