# Phase 11: Messaging Wire Conformance - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Six requirements — WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-05, WIRE-11 — covering the
tag shapes `applesauce-concord` **emits** for reactions, threaded replies, and deletes;
two **receive-side** gaps (kind 23313 voice presence dropped at the funnel; the wrap's
ephemeral `p`-tag key discarded at generation); and the removal of the `voice` channel
flag the spec abolishes.

**In scope:**

- `ChannelMetadata.voice` removal, write site, and read-path fold (WIRE-01 / audit M13)
- Kind 23313 reaching consumers instead of being dropped (WIRE-02 / M14)
- `react()` emitting the target's real kind in `k` (WIRE-03 / M15)
- `replyToThread()` inheriting the parent's root tags verbatim and deriving `K`/`k`
  from the real target kind (WIRE-04 / M16)
- `deleteMessage()` emitting a `k` tag (WIRE-05 / L03)
- The wrap's ephemeral key becoming retainable (WIRE-11 / L10)

**Explicitly out of scope (do not "fix" these here):**

- **`sendMessage`'s `replyTo?: { id; author }`.** It routes to `includeChatReply`
  (`packages/common/src/operations/chat-message.ts:12`), which normalizes to an
  `EventPointer` and emits **only** a NIP-C7 `q` tag — no `k`, no `K`, no root
  inheritance. It is correct as written. WIRE-04 concerns kind-1111 threaded replies,
  not NIP-C7 chat quote-replies.
- WIRE-06 through WIRE-10 and WIRE-12 — all assigned to Phase 12 by
  `REQUIREMENTS.md`'s traceability table. In particular `deleteChannel`'s dropped
  `custom` (L02/WIRE-10) touches the same `client/admin.ts` region this phase edits;
  leave it alone.
- The NIP-09 giftwrap-delete flow itself (see D-07).
- CORD-07 §2/§3/§5/§6/§7 broker/media/rendezvous transport — deferred as FUT-02.

</domain>

<decisions>
## Implementation Decisions

### Target-kind API shape (WIRE-03 / WIRE-04 / WIRE-05)

- **D-01:** `react()`, `replyToThread()`, and `deleteMessage()` **change signature to
  take the full target `Rumor`** instead of `{ id, author }` / a bare id string. The
  caller has already rendered the message it is acting on, so it holds the rumor.

  ```ts
  async react(channelId: string, target: Rumor, reaction: string | Emoji): Promise<void>
  async replyToThread(channelId: string, parent: Rumor, body: string): Promise<void>
  async deleteMessage(channelId: string, target: Rumor): Promise<void>
  ```

  Rejected: an in-engine plane-store lookup by id (adds a "target not yet synced"
  failure mode whose graceful-degrade branch silently reinstates the bug), and a
  `Rumor | { id; author }` union (leaves the wrong path callable forever — the
  enumerated-patch shape this project has repeatedly rejected).

- **D-02:** **No upstream factory changes are required.** All three factories already
  handle a full event/rumor correctly; concord's only defect is passing an identity
  instead. A plan that edits `packages/common` or `packages/core` factories for these
  three requirements has misread the problem. Verified:

  | Factory | Path | Why passing the rumor is sufficient |
  |---|---|---|
  | `DeleteFactory.fromEvents` | `packages/core/src/operations/delete.ts:13` | `isEvent(event)` branch calls `ensureKTag(tags, event.kind)`. The bare-string else-branch is what drops `k`. |
  | `ReactionFactory.create` | `packages/common/src/operations/reaction.ts:23` | `ReactionParent = NostrEvent \| Rumor \| { id; pubkey; kind }`. concord passes the third form with `kind` hardcoded. |
  | `CommentFactory.create` | `packages/common/src/operations/comment.ts:29` | The `"tags" in parent` branch calls `createCommentTagsForEvent(parent)` — this *is* the verbatim-root-inheritance path. |

- **D-03:** The `setParent` else-branch **throws** on a comment-kind pointer:
  `"Comment pointer cannot be a comment kind. please pass the full nip-22 comment
  event"`. `replyToThread` currently escapes that guard only because it hardcodes
  `kind: kinds.ForumThread` — it mislabels the parent. Depth-2 nesting therefore does
  not fail loudly today; it **silently re-roots**. A regression test must cover the
  depth-2 case specifically, not just depth-1.

### Voice presence delivery (WIRE-02)

- **D-04:** **Delete the drop; route 23313 into the plane store like any other rumor.**
  Two symmetric sites, both go:
  - `packages/concord/src/client/community.ts:682`
  - `packages/concord/src/client/private-channel.ts:316`

  Consumers read it via the already-public raw store — `channelStore(channelId)`
  (`client/community.ts:607`) with `.timeline([{ kinds: [23313] }])`. This matches the
  existing precedent: typing (23311) is **not** dropped and flows through the same
  path; 23313 was the only kind singled out for a `return`.

  Accepted trade-off: 23313 is ephemeral presence and a rumor store is durable, so
  presence accumulates and consumers must apply their own freshness window. A
  dedicated time-windowed `voicePresence$` was considered and rejected as
  out-of-proportion for a requirement whose text is "reaches consumers instead of
  being silently dropped."

- **D-05:** Two comments must be corrected alongside the deletion, or they become
  false: the funnel doc-comment at `client/community.ts:679-680` ("…and voice presence
  (not chat)") and the deferral note at `client/__tests__/roundtrip.test.ts:3-4`
  ("§9 voice … deferred with their phases").

### `voice` flag removal (WIRE-01)

- **D-06:** **Hard removal.** Delete `ChannelMetadata.voice` (`types.ts:120-121`),
  `CreateChannelOptions.voice` (`client/admin.ts:55-56`), the write at
  `client/admin.ts:188`, and the fold line at `helpers/control.ts:311`.

  Dropping the fold line introduces **no** new lossiness: `control.ts:305-313` already
  folds into a narrow `ChannelMetadata` (`name`/`private`/`deleted`/`voice`/`custom`)
  and discards every other top-level key. Deleting the line simply stops `voice` being
  privileged over any other unknown key. Do **not** route it into `custom` — that is
  the spec's user-extension field, and nothing reads the value anyway. Unknown
  top-level round-tripping is WIRE-09, scoped to the Community/Invite Lists in Phase 12,
  not to channel editions.

  Removing the field from the type is itself the structural guard — `tsc` fails any
  reintroduced read. No additional assertion needed.

### Ephemeral wrap key retention (WIRE-11)

- **D-07:** **Caller-supplied via `WrapOptions`.** Add `ephemeralSk?: Uint8Array`;
  `buildWrap` uses it when given and generates as today when not.

  ```ts
  export type WrapOptions = { ephemeral?: boolean; created_at?: number; ephemeralSk?: Uint8Array };
  // buildWrap (operations/gift-wrap.ts:67)
  const sk = opts.ephemeralSk ?? generateSecretKey();
  const decoyPubkey = getPublicKey(sk);
  ```

  Rejected: attaching the secret to the wrap via a non-enumerable symbol. It would
  follow the Phase 5.1 convention and need no signature change, but it puts a **secret
  key on the object that gets published** — the same shape 05.1's review flagged in
  `lockAppData`. Explicit beats implicit for key material.

- **D-08:** **Retention only.** Ship the plumbing plus a test proving the supplied key
  round-trips to the emitted `p` tag. The NIP-09 giftwrap-delete flow is a consumer
  concern and appears in no WIRE requirement.

### Milestone conventions carried forward

- **D-09:** **No changeset** — carried forward from Phase 12.3's D-15 and confirmed
  here. concord is unreleased; a changeset for a package with no consumers is noise.

  **This is a deliberate override of ROADMAP.md Phase 11 success criterion 1**, which
  reads "breaking change; changeset + migration note included". `verify-phase` must
  score criterion 1 on the **field removal alone** and must not re-block on the missing
  changeset. The override also covers D-01's signature break, which the ROADMAP did not
  anticipate when it named only `voice` as this phase's breaking change.

- **D-10:** **Fixtures are vendored.** Transcribe the relevant `examples.md` tag sets
  into a checked-in fixture file under `packages/concord/src/__tests__/`. Tests assert
  against that file; a reviewer can diff the file against the spec. This is what makes
  TEST-01's anti-self-assertion rule auditable — the CORD specs live in an external
  repo (`github.com/concord-protocol/concord`, branch `master`) with no local copy, so
  without a vendored file "asserted against the spec" is unverifiable.

  Every fixture entry must carry its CORD section citation. Note L11: existing comments
  cite `CORD-06 §94`, a section that does not exist (CORD-06 has 3 sections; 94 is a
  line number) — do not copy that citation style. Fixing those comments is WIRE-12,
  Phase 12.

- **D-11:** Namespaced `debug` logging convention from Phase 12.2 applies; derive the
  `Debugger` once and never `.extend()` at a call site.

### Claude's Discretion

- **How `ephemeralSk` reaches an app-level caller.** D-07 makes the key *suppliable* at
  `buildWrap`, but concord calls `wrapSeal`/`giftWrap` internally through
  `helpers/keys.ts:41` and `publishToPlane`. Whether the option is threaded all the way
  out to a public method, exposed only at the operation layer, or surfaced some third
  way is **open for research and planning** — it was not decided in discussion.
- Whether `Rumor` or a narrower structural type is the right parameter type for D-01's
  three signatures.
- Fixture file name, location within `__tests__/`, and internal structure.
- Test file organization — extending existing concord suites vs. a new wire-conformance
  suite.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & audit

- `.planning/REQUIREMENTS.md` — WIRE-01…WIRE-05, WIRE-11 at lines 75-79, 85; the
  Phase 11/12 split in the traceability table at lines 160-171; the TEST-01 standing
  rationale at line 184 (Phases 11/12 bind to fixtures, not formulas)
- `.planning/concord-audit.md` — findings **M13** (line 169, voice flag), **M14**
  (170, presence dropped), **M15** (171, hardcoded reaction kind), **M16** (172,
  reply root inheritance), **L03** (192, delete `k` tag), **L10** (199, ephemeral key)
- `.planning/ROADMAP.md` §"Phase 11: Messaging Wire Conformance" — the six success
  criteria; **note D-09's override of criterion 1**

### External specs (no local copy — vendor per D-10)

- `github.com/concord-protocol/concord` branch `master` — CORD-01 §Deletions
  (giftwrap delete by `p` tag), CORD-03 §3 (threaded replies), CORD-07 §1 (every
  channel is callable — no per-channel voice flag), CORD-07 §4 (voice presence)
- `examples.md` in that repo — the fixture source of record for every wire shape this
  phase touches

### Prior phase context

- `.planning/phases/12.3-transport-only-extra-relays-in-applesauce-concord/12.3-CONTEXT.md`
  — **D-15** (no changesets, concord unreleased), **D-16** (debug logging convention)
- `.planning/codebase/EVENT_KIND_PATTERNS.md`, `.planning/codebase/TESTING.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Confirmed sites

| Req | Site | Current state |
|---|---|---|
| WIRE-01 | `packages/concord/src/types.ts:120-121` | `voice?: boolean` — write-only, read by nothing in `src/` |
| WIRE-01 | `packages/concord/src/client/admin.ts:55-56, 188` | `CreateChannelOptions.voice`; `if (options.voice) content.voice = true` |
| WIRE-01 | `packages/concord/src/helpers/control.ts:311` | fold line preserving `voice` |
| WIRE-02 | `packages/concord/src/client/community.ts:682` | `if (decoded.rumor.kind === VOICE_PRESENCE_KIND) return;` |
| WIRE-02 | `packages/concord/src/client/private-channel.ts:316` | same drop, symmetric site |
| WIRE-03 | `packages/concord/src/client/community.ts:1104-1111` | `kind: kinds.ChatMessage` hardcoded into `ReactionFactory.create` |
| WIRE-04 | `packages/concord/src/client/community.ts:1096-1102` | pointer hand-built with `kind: kinds.ForumThread` |
| WIRE-05 | `packages/concord/src/client/community.ts:1121-1126` | `DeleteFactory.fromEvents([targetId])` — bare string |
| WIRE-11 | `packages/concord/src/operations/gift-wrap.ts:67` | `getPublicKey(generateSecretKey())` — secret discarded |

### Reusable assets

- `ensureKTag` (`packages/core/src/helpers/factory.ts`) — already invoked by
  `setDeleteEvents`' event branch; no new tag helper needed
- `createCommentTagsForEvent` — the verbatim-root-inheritance implementation, already
  wired into `setParent`'s event branch
- `channelStore(channelId)` (`client/community.ts:607`) — the public raw-store surface
  D-04 delivers voice presence through; already documented for `.timeline([{ kinds: [9] }])`
- `VOICE_PRESENCE_KIND` / `TYPING_KIND` (`helpers/voice.ts`, `helpers/typing.ts`) —
  constants-only modules; the audit confirms constants-only is correct, not a gap

### Established patterns

- **Every messaging method follows one shape:** `requireChannelKey` → `channelEpoch` →
  build via factory → `bindToChannel(channelId, epoch)` → `publishToPlane`. D-01's
  signature changes must not disturb it.
- **`route()` is the single receive funnel** shared by sync and the live subscription
  — which is why one deleted line in each of two files is the whole of WIRE-02.
- **Spec-derived assertion (TEST-01, standing).** All 189 concord tests passed while 9
  HIGH bugs were live because every test compared the implementation against itself.
  No test in this phase may assert against a snapshot of our own output.

### Integration points

- `packages/concord/src/client/community.ts` — the four messaging methods plus the
  funnel; the highest-churn file in the phase
- `packages/concord/src/operations/gift-wrap.ts` → `helpers/keys.ts:41` → publish path
  — the thread D-07's open plumbing question runs along

</code_context>

<specifics>
## Specific Ideas

- The user resolved the ROADMAP-vs-D-15 changeset conflict in favor of D-15 immediately
  and without hedging — treat "concord is unreleased, so breaking changes are cheap and
  changesets are noise" as a settled project-wide stance, not a per-phase call.
- Preference confirmed again for **making the wrong path unrepresentable** over widening
  a union or adding a fallback branch (D-01's rejection of the union option,
  D-06's reliance on `tsc` rather than an added assertion).

</specifics>

<deferred>
## Deferred Ideas

- **A time-windowed `voicePresence$` observable** — rejected for this phase (D-04). If
  durable accumulation of ephemeral presence becomes a real problem for a consumer, it
  is a clean standalone follow-up. The same latent issue applies to typing (23311).
- **The NIP-09 giftwrap-delete flow** built on D-07's retained key — retention only
  this phase (D-08).
- **`deleteChannel` preserving `custom`** (L02/WIRE-10) — Phase 12, though it touches
  `client/admin.ts` which this phase also edits.
- **Comment citations of the non-existent `CORD-06 §94`** (L11/WIRE-12) — Phase 12.

### Reviewed Todos (not folded)

- `05.1-review-followups.md` — matched at 0.6 by `todo.match-phase`, but the sole match
  reason is the keyword "phase". It concerns Phase 05.1 symbol-propagation review
  residuals and has no bearing on wire shapes. Left pending by explicit decision.

</deferred>

---

*Phase: 11-messaging-wire-conformance*
*Context gathered: 2026-07-29*
