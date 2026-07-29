---
status: complete
phase: 11-messaging-wire-conformance
source: [11-VERIFICATION.md]
started: 2026-07-29T13:10:00Z
updated: 2026-07-29T13:35:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Stale public docs still show the pre-phase call shapes

expected: Either the docs are corrected to show the Rumor-taking signatures (a caller following them today emits ["k","undefined"] / ["e", undefined] malformed wire events — the exact defect class this phase exists to eliminate), or a deliberate decision is recorded to defer the fix.
result: pass
resolution: |
  Verified against source and fixed in-scope. Confirmed `react` and `replyToThread` take a full
  `Rumor` and `deleteMessage` takes a `Rumor` (community.ts:1096,1103,1117), while `editMessage`
  still takes `targetId: string` (:1110) — so only 3 of the 4 documented calls were stale.
  Mechanism confirmed: `ReactionParent` requires `{id, pubkey, kind}` (operations/reaction.ts:23)
  and the docs passed `{id, author}` — wrong key name AND missing `kind`, so `setReactionParent`
  emits undefined "p"/"k" values. `deleteMessage(channelId, messageId)` with a bare string makes
  `target.id`/`target.kind` undefined.
  Also verified NOT stale: `sendMessage`'s `replyTo` is genuinely `{id, author}` (:1045), so the
  reply example was left unchanged — a blanket replace would have introduced a new defect.
  Swept all of apps/ for the same call shapes: only community.md was affected; no example app
  uses these methods. Fixed apps/docs/concord/community.md:95-100,109. Suite green (495 passed).

Detail: `apps/docs/concord/community.md:95,97,106` still document
`react(channelId, {id, author}, ...)`, `replyToThread(channelId, {id, author}, ...)` and
`deleteMessage(channelId, messageId)`. Plan 11-04 changed all three to take a full `Rumor`.
No plan in this phase claimed this file in `files_modified`, so it is a scope decision rather
than a code-correctness question — the SDK and its tests are correct and green. VitePress has
no twoslash on this page, so nothing typechecks these examples. Following them does not throw:
the event is sealed, wrapped, and published with malformed tags.

### 2. Voice presence can resurrect a kicked or departed member in the roster fold

expected: Either a decision that a kicked/left member being able to resurrect their membership by leaving a voice-presence client running is accepted (matching D-04's stated ephemeral-accumulation trade-off, which named store growth but not roster resurrection), or a follow-up plan is scheduled to exclude presence kinds from the observed-authors fold.
result: pass
resolution: |
  Decision recorded: follow-up scheduled, not accepted as a trade-off. The defect was verified
  empirically (see Verification below) and judged out of Phase 11's scope — no plan in this phase
  claimed the roster fold, and narrowing it is a behavior change to security-relevant membership
  logic. Filed as .planning/todos/pending/11-verify-followups.md (priority: high) with the
  reproduction table, the non-self-bounding kick/rekey finding, and the structural fix
  (exclude ephemeral kinds 20000-29999 from the observed fold, rather than special-casing 23313).

Detail: WIRE-02 removed the kind-23313 early-return from the receive funnel, which is exactly
what the criterion asked for. But `ConcordObservedAuthorsModel`
(`packages/concord/src/models/observed.ts:9`) reads `store.timeline([{}])` — all kinds,
unfiltered — and `foldMembers`'s re-entry branch (`packages/concord/src/helpers/guestbook.ts:123-126`)
re-adds an author when `lastMs > c.ms`. A voice-presence beacon newer than a member's departure
therefore re-adds them to `members$`. This was structurally impossible before, because presence
never reached the store. It is untested in either direction: no test proves the resurrection,
and no test proves it is excluded. D-04 accepted an ephemeral-accumulation trade-off but named
store growth, not roster integrity.

Verification (executed, not inferred): a throwaway `foldMembers` probe confirmed all three cases.
With a `join(1000)` + `leave(2000)` and an observed entry at ms=3000, the departed member is
re-added — `members.has("bob") === true`. With `join(1000)` + an authorized `kick(2000)` and an
observed entry at ms=3000, the kicked member is re-added — `members.has("mallory") === true`.
A banned member is NOT re-added (`false`), because the banlist loop runs after the observed
re-entry loop (guestbook.ts:132). So `ban()` remains an effective remedy; `kick()` alone does not.

Exposure is not self-bounding: `kick()` (community.ts:1195-1204) revokes roles and publishes a
Kick to the guestbook but does NOT rotate the channel key — rekey is a separate explicit
`rotateChannel` call. A kicked member therefore retains the channel key and their client keeps
beaconing. Confirmed the observed set is every `channel:*` store, kind-unfiltered
(community.ts:640), so 23313 counts as "activity".

What actually changed: this resurrection class pre-existed for chat (a removed member who posts
re-enters). WIRE-02 widened it from requiring a deliberate user action to an idle client doing it
automatically. Note community.ts:632-639 already reasons about exactly this hazard — D-02/T-06-03
narrowed control-store observation because "narrowing observation is fail-safe (it can only shrink
the memberlist, never resurrect a removed member)". That reasoning was never applied to presence.

Suggested structural fix (not applied — scope decision): exclude ephemeral kinds (20000-29999,
which covers 23313 and any future presence-like kind) from `ConcordObservedAuthorsModel`'s fold
rather than special-casing 23313. Observation should mean durable authorship.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
