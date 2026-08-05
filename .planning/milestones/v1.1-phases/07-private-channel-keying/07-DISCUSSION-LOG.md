# Phase 7: Private Channel Keying - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-17
**Phase:** 7-private-channel-keying
**Areas discussed:** Refactor scope, CHAN-06 access API, CHAN-02 reject shape, CHAN-07 deletion ruling

---

## Refactor scope (channel-key source of truth)

| Option | Description | Selected |
|--------|-------------|----------|
| Full removal | Delete `ChannelMetadata.key`/`.epoch`; drop the edition merge; derive from `material.channels`. Breaking; kills the H06/H07/H08 root class outright. | ✓ |
| Keep fields internal | Leave key/epoch on the type but stop trusting the edition. Less breaking, keeps the footgun field alive. | |
| You decide | Take the audit recommendation and let research confirm signatures. | |

**User's choice:** Full removal
**Notes:** Aligns with the audit's "these fields should not exist" and forecloses the `custom.key` footgun. concord is unreleased, so no changeset/migration cost. Keyless private channels consequently derive nothing (the `deriveConcordKeys` loop skips them), which is CHAN-01.

---

## CHAN-06 access API (visible-vs-key-held)

| Option | Description | Selected |
|--------|-------------|----------|
| Enriched channel view | `channels$` emits `ChannelView[]` with `accessible: boolean`; `ChannelMetadata` stays pure edition data. | ✓ |
| Method on client | `hasChannelKey(id)` / `isChannelAccessible(id)` — imperative, not reactive. | |
| Derived observable | `accessibleChannels$` (Set) as a separate granular stream. | |

**User's choice:** Enriched channel view
**Notes:** `accessible` is client-local state (not edition data), so it rides the emitted view rather than the `ChannelMetadata` type. Public channels always `true`; private `true` iff key held. Consumers get the flag inline on the object they already iterate and can drive composer/invite enable-disable reactively.

---

## CHAN-02 reject shape (keyless-private send)

| Option | Description | Selected |
|--------|-------------|----------|
| Named error class | Exported `MissingChannelKeyError` thrown from `sendMessage`; consumers `instanceof`-catch. | ✓ |
| Distinct message only | Plain `Error` with a distinct message; consumers must string-match. | |
| You decide | Fit concord's existing error conventions. | |

**User's choice:** Named error class
**Notes:** `MissingChannelKeyError(channelId)` with message `missing private channel key`. Thrown from `sendMessage` (which has the channel state + `accessible` flag); `planeKeyFor`'s generic `unknown channel` throw stays a backstop for truly-unknown ids. Research to place the class consistently with any existing concord error conventions.

---

## CHAN-07 deletion ruling (terminality)

| Option | Description | Selected |
|--------|-------------|----------|
| Sticky-deleted in fold | Any authorized `deleted:true` edition drops the id permanently; scan candidates, never re-create. Fold-time only, no persisted state. | ✓ |
| Persisted tombstone set | Durable `deletedChannelIds` on community state; survives compaction dropping the deleting edition. | |
| You decide | Sticky-vs-persisted based on compaction behavior. | |

**User's choice:** Sticky-deleted in fold
**Notes:** Upstream CORD-03 §2 read verbatim this session: *"Deletion is terminal: the id is never reused, clients drop the Channel from display and may discard its keys."* The id-reuse clause removes ambiguity — a deleted id is permanently dead. This rules out "no change needed": the current fold resurrects on a later `deleted:false` head. Research must confirm compaction cannot drop the deleting edition (the head is retained per `control.ts:232`); if it can, escalate to the persisted tombstone.

---

## Claude's Discretion

- The exact `NONE`/skip signalling shape between `channelSecret`/`channelKeyFor`/`channelKeyMemo` and the `deriveConcordKeys` loop (memo cache-key currently `channel.key`-based).
- `accessible` naming unless research finds a prevailing concord term.
- Error-message wording beyond the distinct string; whether `MissingChannelKeyError` extends a concord base error class.
- Plan/commit sequencing within the "behavioral fix lands with its spec-derived test" constraint.

## Deferred Ideas

- Public↔private channel conversion and rename (FUT-01).
- Persisted `deletedChannelIds` tombstone set (only if compaction can drop the deleting edition).
- Voice channel keying beyond fixing the keyless wrong-room derivation (CORD-07 transport is FUT-02).
- Rotation robustness — racing rotations, transient-signer retry, `vac` citation (ROTATE-05..13, Phase 8).
