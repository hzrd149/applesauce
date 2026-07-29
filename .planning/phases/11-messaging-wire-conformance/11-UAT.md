---
status: testing
phase: 11-messaging-wire-conformance
source: [11-VERIFICATION.md]
started: 2026-07-29T13:10:00Z
updated: 2026-07-29T13:10:00Z
---

## Current Test

number: 1
name: Decide whether apps/docs/concord/community.md's stale react()/replyToThread()/deleteMessage() call examples are in-scope doc debt to fix now, or an accepted follow-up.
expected: |
  Either the docs are corrected to show the Rumor-taking signatures (a caller following them
  today emits ["k","undefined"] / ["e", undefined] malformed wire events — the exact defect
  class this phase exists to eliminate), or a deliberate decision is recorded to defer the fix.
awaiting: user response

## Tests

### 1. Stale public docs still show the pre-phase call shapes

expected: Either the docs are corrected to show the Rumor-taking signatures (a caller following them today emits ["k","undefined"] / ["e", undefined] malformed wire events — the exact defect class this phase exists to eliminate), or a deliberate decision is recorded to defer the fix.
result: [pending]

Detail: `apps/docs/concord/community.md:95,97,106` still document
`react(channelId, {id, author}, ...)`, `replyToThread(channelId, {id, author}, ...)` and
`deleteMessage(channelId, messageId)`. Plan 11-04 changed all three to take a full `Rumor`.
No plan in this phase claimed this file in `files_modified`, so it is a scope decision rather
than a code-correctness question — the SDK and its tests are correct and green. VitePress has
no twoslash on this page, so nothing typechecks these examples. Following them does not throw:
the event is sealed, wrapped, and published with malformed tags.

### 2. Voice presence can resurrect a kicked or departed member in the roster fold

expected: Either a decision that a kicked/left member being able to resurrect their membership by leaving a voice-presence client running is accepted (matching D-04's stated ephemeral-accumulation trade-off, which named store growth but not roster resurrection), or a follow-up plan is scheduled to exclude presence kinds from the observed-authors fold.
result: [pending]

Detail: WIRE-02 removed the kind-23313 early-return from the receive funnel, which is exactly
what the criterion asked for. But `ConcordObservedAuthorsModel`
(`packages/concord/src/models/observed.ts:9`) reads `store.timeline([{}])` — all kinds,
unfiltered — and `foldMembers`'s re-entry branch (`packages/concord/src/helpers/guestbook.ts:123-126`)
re-adds an author when `lastMs > c.ms`. A voice-presence beacon newer than a member's departure
therefore re-adds them to `members$`. This was structurally impossible before, because presence
never reached the store. It is untested in either direction: no test proves the resurrection,
and no test proves it is excluded. D-04 accepted an ephemeral-accumulation trade-off but named
store growth, not roster integrity.

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
