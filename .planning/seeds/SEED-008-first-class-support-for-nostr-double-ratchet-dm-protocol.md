---
id: SEED-008
status: dormant
planted: 2026-07-25
planted_during: v1.1-first-fixes / Phase 12.3
trigger_when: when relevant
scope: unknown
---

# SEED-008: Evaluate first-class nostr-double-ratchet support

## Captured Idea (verbatim)

> Investigate and evaluate the possability of building first-class support for
> nostr-double-ratchet DM protocol https://github.com/irislib/nostr-double-ratchet

## Why This Matters

_To be filled in. Run `/gsd-capture --seed --enrich SEED-008` to add context._

This is explicitly framed as an **evaluation**, so the deliverable at promotion is a
decision with rationale, not an implementation. The two capture-time findings that most
shape that decision:

**1. It is NIP-44-based, and may not ride the gift-wrap path at all.** The project's
own documentation describes payload encryption as "NIP-44 + Double Ratchet" and does
not mention NIP-17 or gift wrap. If that holds, this protocol sits *beside*
[[SEED-006]] and [[SEED-007]] rather than on top of them — the gift-wrap ingestion
service would not cover it, and a third DM transport joins legacy and wrapped.
**Verify this from source before relying on it** — absence from a README is not proof
of absence from the wire format, and it materially changes how this fits.

**2. The upstream API is explicitly pre-stable.** The project states _"Breaking changes
are still possible while APIs settle."_ Applesauce packages are published and
changeset-versioned, so taking a hard dependency on a pre-stable protocol library
transfers its churn into applesauce's public surface and release cadence. This is the
main argument for wrapping behind an applesauce-owned interface rather than
re-exporting, or for waiting.

## When to Surface

**Trigger:** when relevant

This seed will surface during `/gsd-new-milestone` when the milestone scope matches.

## Scope Estimate

**Unknown** — run `/gsd-capture --seed --enrich SEED-008` to estimate effort.

Note this is evaluation-shaped: the output is a recommendation. Only the chosen option
carries implementation cost, and those costs differ by roughly an order of magnitude
(see Central Question below).

## Upstream Facts (from the project's own docs, captured 2026-07-25)

| | |
|---|---|
| npm package | `nostr-double-ratchet` |
| License | MIT |
| Version | not stated in fetched content |
| Runtime deps | not stated in fetched content |
| Encryption | "NIP-44 + Double Ratchet" |
| Assigned NIP | none stated |
| Stability | _"Breaking changes are still possible while APIs settle."_ |

**Public API surface:** `NdrRuntime` (`setupUser`, `sendEvent`, `sendMessage`,
`sendReceipt`, `sendTyping`, `sendChatSettings`, `setChatSettingsForPeer`,
`waitForSessionManager`, `onSessionEvent`, `getGroupManager`, `createGroup`,
`sendGroupMessage`, AppKeys management). Lower-level: `SessionManager`, `Session`,
`GroupManager`, `Invite`.

**Feature claims:** 1:1 messaging, multi-device identity via **AppKeys**, group
messaging via **sender keys**, session bootstrap through invites and links.

Everything above is a restatement of upstream documentation, not verified against the
source. Treat as a starting point for the investigation, not as findings.

## In-Repo Context

**No existing work.** A repo-wide search for `double.ratchet` / `DoubleRatchet` /
`NIP-EE` / `MLS` across `*.ts`, `*.md` and `*.json` returns **nothing**. This is
greenfield.

**But there is a strong in-house crypto precedent — concord.** `packages/concord`
already implements epoch-based group rekeying with a full HKDF key-schedule, built
directly on `@noble/curves` ^2.2.0, `@noble/hashes` ^2.2.0 and `@scure/base` ^2.2.0
with **no external crypto framework**:

- `helpers/crypto.ts` — `concordHkdf`, `GroupKey`, `groupKey`, `channelGroupKey`,
  `controlGroupKey`, `guestbookGroupKey`, `channelRekeyGroupKey`, `baseRekeyGroupKey`,
  `voiceGroupKey`/`voiceMediaKey`/`voiceSenderKey`, `epochKeyCommitment`, plus locator
  derivations
- `helpers/rekey.ts` — `REKEY_KIND` (3303), `RekeyScope`, `encodeWrappedKey` /
  `decodeWrappedKey`, chunked rekey blobs (`REKEY_BLOBS_PER_EVENT` = 120)

Note concord's voice path already derives **sender keys** (`voiceSenderKey`) — the same
primitive nostr-double-ratchet uses for groups. So the house has relevant expertise and
a demonstrated appetite for owning this layer.

## Central Question for the Evaluation

Three options, materially different in cost and risk:

1. **Wrap the upstream package** behind an applesauce-owned interface — fastest, but
   inherits pre-stable churn and an external dependency in a published package.
2. **Implement the protocol natively** in applesauce style on `@noble/*`, as concord
   does — highest cost, no external churn, consistent with existing house patterns, and
   the only option that keeps the crypto reviewable in-repo.
3. **Defer** until upstream stabilises or a NIP is assigned — cheapest, and defensible
   given the stated instability.

## Open Questions (for enrichment, not decided here)

1. **What is the actual wire envelope?** Confirm from source whether events are
   gift-wrapped (kind 1059) or a distinct kind. This determines whether [[SEED-007]]'s
   ingestion service applies, and whether this is a third DM transport alongside
   [[SEED-005]] (legacy) and [[SEED-006]] (wrapped).
2. **Where does ratchet session state live?** Double Ratchet requires durable
   per-session state, which is *not* event storage — the `AsyncEventStore` /
   `packages/sqlite` backends noted in [[SEED-007]] solve a different problem. A
   session-state persistence contract is its own design question.
3. **Is there a spec independent of the implementation?** No NIP number is stated. A
   protocol with one implementation and no spec is a different adoption proposition
   than a specified one — relevant to whether "first-class support" is even meaningful
   yet.
4. **How does multi-device AppKeys interact with applesauce's signer model?** The
   `ISigner` / `AccountManager` abstractions assume a single signing identity per
   account; AppKeys implies several.

## Notes

_Captured via one-shot seed capture. Upstream facts fetched from the project's public
README at capture time and not independently verified. Enrich with trigger, why, and
scope at your convenience._
