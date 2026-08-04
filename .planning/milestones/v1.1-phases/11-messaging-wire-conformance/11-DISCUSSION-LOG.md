# Phase 11: Messaging Wire Conformance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-29
**Phase:** 11-messaging-wire-conformance
**Areas discussed:** Fixture sourcing, Target-kind API shape, Voice presence delivery, `voice` flag removal + changeset, Ephemeral key retention

---

## Fixture sourcing (TEST-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Vendor fixtures into the repo | Transcribe relevant `examples.md` tag sets into a checked-in fixture file under `packages/concord/src/__tests__/`; tests assert against it, reviewers diff it against the spec | ✓ |
| Transcribe inline per test | Each test hardcodes its expected tag array with a CORD section comment; no new file, but no single auditable place | |
| Fetch during research | `gsd-phase-researcher` pulls `examples.md` from GitHub and quotes it into RESEARCH.md; plans transcribe from there | |

**User's choice:** Vendor fixtures into the repo
**Notes:** Asked because the CORD specs live in the external `concord-protocol/concord` repo with no local copy — without a vendored file, "asserted against the spec" is unverifiable, which defeats the point of TEST-01's anti-self-assertion rule. → CONTEXT D-10.

---

## Target-kind API shape (WIRE-03 / WIRE-04 / WIRE-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Change signatures to take the rumor | Caller passes the `Rumor` it already rendered; breaking, but D-15 makes that cheap. No new failure mode | ✓ |
| Keep `{id, author}`, look up in plane store | Non-breaking; engine resolves by id internally. New failure mode when target not yet synced — throw vs. degrade, and a silent degrade reinstates the bug | |
| Widen to a union | `Rumor \| {id, author}`, good path when given a rumor. Non-breaking and incremental, but leaves the wrong path callable forever | |

**User's choice:** Change signatures to take the rumor
**Notes:** Scouting collapsed this area before it was asked. All three upstream factories already accept a full event/rumor and already emit the correct tags — `setDeleteEvents` calls `ensureKTag` on its `isEvent` branch, `ReactionParent` accepts a `Rumor`, and `setParent`'s `"tags" in parent` branch *is* the verbatim-root-inheritance path. So no upstream change and no `kind` parameter is needed; the only real question was where concord obtains the rumor.

Surfaced during the walkthrough: `setParent`'s else-branch **throws** on a comment-kind pointer with the message *"please pass the full nip-22 comment event"*. `replyToThread` escapes that guard only by hardcoding `kind: kinds.ForumThread` — so depth-2 nesting silently re-roots rather than failing loudly. Recorded as D-03 with an explicit depth-2 test obligation.

Also established as a **boundary, not a decision**: `sendMessage`'s `replyTo?: {id, author}` is correct as-is — `includeChatReply` emits only a NIP-C7 `q` tag, no `k`/`K`, no root inheritance. Written into CONTEXT's out-of-scope list so a planner doesn't "fix" it.

---

## Voice presence delivery (WIRE-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Delete the drop, route to plane store | Remove the `return`; consistent with typing 23311; consumers filter by kind and apply their own freshness window | ✓ |
| Dedicated presence observable | `voicePresence$` holding a time-windowed live set, fed from `route()` before the store; matches the granular `$`-field convention; no durable accumulation, but a new stateful surface with a TTL policy to design | |
| Both — store it and derive the observable | Most complete; durable-accumulation problem still exists underneath | |

**User's choice:** Delete the drop, route to plane store
**Notes:** The precedent was decisive — typing (23311) is not dropped and flows through the same funnel into the same store; 23313 was the only kind singled out for a `return`. The trade-off was stated plainly before the ruling: 23313 is ephemeral presence and a rumor store is durable, so presence accumulates and consumers must window it themselves. Accepted as proportionate to a requirement whose text is "reaches consumers instead of being silently dropped." Two symmetric sites found (`community.ts:682`, `private-channel.ts:316`), plus two now-false comments to correct (D-05).

---

## `voice` flag removal + changeset (WIRE-01)

### Read-path fold behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Drop it — delete the line | `voice` becomes an unknown key like any other, discarded by the existing narrow fold. No special-casing | ✓ |
| Preserve into `custom` | Keeps the value reachable mid-migration, but `custom` is the spec's user-extension field and nothing reads the value | |
| Drop it, plus a defensive read guard | Delete the field and add an assertion that no path reads a `voice` key | |

**User's choice:** Drop it — delete the line
**Notes:** Grounded first: `control.ts:305-313` already folds into a narrow shape and discards every other top-level key, so removing the line adds no lossiness — it only stops `voice` being privileged. The third option was noted as redundant: removing the field from the type already gives the structural guard via `tsc`.

### Changeset conflict

| Option | Description | Selected |
|--------|-------------|----------|
| D-15 wins — no changeset | concord is unreleased; a changeset for a package with no consumers is noise. Override recorded so verify-phase scores criterion 1 on the field removal alone | ✓ |
| Write the changeset anyway | Honor the ROADMAP criterion literally; CHANGELOG carries the migration note for whenever concord ships | |
| No changeset, but a migration note in code/README | Skip `.changeset/` per D-15 but record the breaking surface in UPSTREAM-NOTES.md or the README | |

**User's choice:** D-15 wins — no changeset
**Notes:** Flagged proactively during the phase walkthrough: ROADMAP criterion 1 demands "changeset + migration note", which directly contradicts Phase 12.3's D-15. Resolved without hesitation. The override was extended to cover D-01's signature break, which the ROADMAP did not anticipate when it named only `voice` as the phase's breaking change.

---

## Ephemeral key retention (WIRE-11)

### Retention mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Caller supplies it via `WrapOptions` | Add `ephemeralSk?: Uint8Array`; caller generated it so caller has it. No hidden state, no secret on a published object | ✓ |
| Non-enumerable symbol on the wrap | Follows the Phase 5.1 convention, zero signature change, key travels with its object — but puts a secret on an event that gets published | |
| Retain pubkey only, via an engine-side set | Lowest risk; only correct if CORD-01 doesn't require the delete to be signed by that key | |

**User's choice:** Caller supplies it via `WrapOptions`
**Notes:** Two caveats were raised before the ruling. First, the decoy *pubkey* is already public (it's the `p` tag), so if retention is only for "is this wrap mine?", no secret is needed at all — the audit says *secret*, implying a signing requirement, but CORD-01 §Deletions is in the external repo and that should be researcher-confirmed rather than assumed. Second, attaching a secret key via symbol is the exact shape Phase 5.1's review flagged in `lockAppData`.

An open plumbing question was **not** resolved and is recorded as Claude's discretion: `WrapOptions` is consumed internally via `helpers/keys.ts:41` and `publishToPlane`, so how `ephemeralSk` reaches an app-level caller is left to research and planning.

### Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Retention only | Make the key obtainable and test that it round-trips to the `p` tag; the NIP-09 flow is a consumer concern in no WIRE requirement | ✓ |
| Retention + a delete helper | Also ship a helper building the NIP-09 delete, so the capability is reachable end-to-end | |

**User's choice:** Retention only

---

## Claude's Discretion

- How `ephemeralSk` reaches an app-level caller (open for research — see above)
- Whether `Rumor` or a narrower structural type is right for D-01's three signatures
- Fixture file name, location within `__tests__/`, internal structure
- Test file organization — extending existing suites vs. a new wire-conformance suite

## Deferred Ideas

- Time-windowed `voicePresence$` observable — standalone follow-up if durable accumulation of ephemeral presence bites a consumer (same latent issue applies to typing 23311)
- The NIP-09 giftwrap-delete flow built on D-07's retained key
- `deleteChannel` preserving `custom` (L02/WIRE-10) — Phase 12
- `CORD-06 §94` non-existent-section comment citations (L11/WIRE-12) — Phase 12
- `05.1-review-followups.md` todo — reviewed, not folded (0.6 match on the keyword "phase" alone; unrelated to wire shapes)
