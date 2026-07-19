# Roadmap: Applesauce

## Milestones

- ✅ **v1.0 event-store-supports-rumors** — Phases 1–4 (shipped 2026-07-09)
- 🚧 **v1.1 first-fixes** — Phases 5–12 (in progress)

## Phases

<details>
<summary>✅ v1.0 event-store-supports-rumors (Phases 1–4) — SHIPPED 2026-07-09</summary>

Genericized the applesauce event layer over `E extends StoreEvent = NostrEvent` so it can operate on unsigned NIP-59 `Rumor` events, with zero behavior change for signed-`NostrEvent` consumers. Full details: [`milestones/v1.0-ROADMAP.md`](milestones/v1.0-ROADMAP.md).

- [x] Phase 1: Generic store foundation (4/4 plans) — completed 2026-07-09
- [x] Phase 2: Generic models & casts (3/3 plans) — completed 2026-07-09
- [x] Phase 3: RumorStore & verification (3/3 plans, Part A gate) — completed 2026-07-09
- [x] Phase 4: Common package rumor support (1/1 plan) — completed 2026-07-09

</details>

### 🚧 v1.1 first-fixes (In Progress)

**Milestone Goal:** Bring `applesauce-concord` into conformance with the CORD-01..07 protocol specs by fixing all 43 findings from the 2026-07-15 audit, and fix the shared `applesauce-core` cache defect that causes three of them.

**Authoritative spec:** `.planning/concord-audit.md` — every phase below cites finding IDs (H##/M##/S##/L##) from this audit.

**Hard sequencing:** Phase 5 (cache fix, `applesauce-core`) must land before any rotation work — it is the root cause of ROTATE-01/02/03 and H01 currently masks H02 (ROTATE-04). Phase 6 schedules ROTATE-04 immediately after Phase 5 so the fix and its unmasked consequence land in the same milestone. Phase 7 pairs CHAN-05 with ROTATE-03 because they are independent root causes of the same bug (H08) and either alone leaves a rekeyed channel on its old plane.

**TEST-01 is a standing criterion across Phases 5–12, not a single phase's deliverable.** It is anchored at Phase 5 for requirement accounting, but it does **not** close there. Every phase that touches a derivation, fold, or wire shape the specs define by formula or example carries an explicit spec-derived-assertion criterion in its numbered list below (Phases 5, 6, 7, 8, 9, 10, 11, 12). Rationale: all 189 concord tests passed while 9 HIGH bugs were live because every test compared the implementation against itself. A phase permitted to assert against its own output reintroduces the milestone's root cause. Phase 7 is the sharpest case — the channel-keying derivations CORD-03 §1 defines by formula are precisely where H07 hid, and a spec-derived probe is what exposed it.

- [ ] **Phase 5: Cache Identity Memo Fix** - Core cache memos stop surviving object spread in `applesauce-core`, unblocking every downstream rotation fix (in gap closure — CACHE-02 open, reduced round-3 scope)
- [x] **Phase 5.1: Symbol Propagation Redesign (INSERTED)** - Every symbol write becomes non-enumerable and the factory pipeline carries the `PRESERVE_EVENT_SYMBOLS` whitelist explicitly, collapsing the identity-memo/carry-forward taxonomy into one rule and deleting the strip loops (completed 2026-07-16)
- [x] **Phase 6: Refounding Rotation & Authority Correctness** - A Refounding actually rotates its addresses in-session, drops excluded members from the memberlist, and is honored only from a rotator who outranks every removed target (completed 2026-07-16)
- [x] **Phase 7: Private Channel Keying** - Channel key material derives only from held keys — no public-address fallthrough, no edition-JSON key material, and a first-class access-vs-key-possession distinction (closes the Accordian-blocking bug) (completed 2026-07-17)
- [ ] **Phase 8: Rotation Robustness & Consensus** - Racing rotations, transient signer errors, and malformed/partial chunk sets converge correctly instead of forking the community or falsely evicting a member
- [ ] **Phase 9: Authority & Permission Fold Correctness** - Grant, Kick, Ban, and Role folds enforce rank comparisons and reject malformed input without failing every member's community state
- [ ] **Phase 10: Invite Lifecycle & Event Time Consistency** - A revoked invite stays unjoinable under a lagging relay, and an event's timestamp and `ms` tag compose into one true instant
- [ ] **Phase 11: Messaging Wire Conformance** - Reactions, threaded replies, deletes, and voice presence carry the wire shape CORD-01/03/07 define
- [ ] **Phase 12: Document & Caps Conformance** - Community and channel documents respect protocol byte/membership caps and round-trip unknown fields

## Phase Details

### Phase 5: Cache Identity Memo Fix

**Goal**: A value memoized onto a config object by `applesauce-core`'s cache helper does not survive an object spread, so a rolled-forward copy recomputes its derivation instead of returning the source's stale memo — the single root cause behind three HIGH concord findings.
**Depends on**: Nothing new (first phase of v1.1; builds on the v1.0 generic-store foundation)
**Requirements**: CACHE-01, CACHE-02, CACHE-03, TEST-01 *(anchor only — TEST-01 stands across Phases 6–12 and does not close here)*
**Success Criteria** (what must be TRUE):

  1. A value written by `setCachedValue`/`getOrComputeCachedValue` is stored as a non-enumerable property, so spreading a `material`-like object with a changed field recomputes the derivation instead of returning the source's memo.
  2. The cache helper's source carries a comment distinguishing identity memos (must NOT survive a spread) from carry-forward payloads like `EncryptedContentSymbol` (MUST survive a spread), so a future cleanup cannot collapse the two conventions onto one write mechanism.
  3. `getEncryptedContent`/`getHiddenTags` still return correct plaintext when read off a signed event that passed through the factory pipe's spread operations — the memo fix does not disturb the deliberate carry-forward path.
  4. `pnpm -r test` passes across the full workspace (baseline: 1989 tests, exit 0) — the shared core change regresses nothing downstream.
  5. **(TEST-01, standing)** Every derivation this phase touches has at least one test computing its expected value independently from the spec formula — never by calling the implementation under test — and asserting the implementation matches. Concretely: a test derives the expected epoch-N control address from the CORD-02 §4 formula by hand and asserts a rolled-forward object matches it, reproducing and closing H01's exact failure mode.

**Plans**: 14/14 plans executed

Plans:

- [x] 05-12-PLAN.md
- [x] 05-13-PLAN.md
- [x] 05-14-PLAN.md

**Wave 1**

- [x] 05-01-PLAN.md — Fix `cache.ts` to write memos non-enumerable, land the canonical taxonomy prose, add the patch changeset (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-02-PLAN.md — New `cache.test.ts`: the two-sided convention test (memo dropped by spread / plaintext survives real pipe + signing) (wave 2)
- [x] 05-03-PLAN.md — Classify-and-comment sweep over 35 symbol-write sites in core + common, plus the false-comment correction at concord `keys.ts:98-104` (wave 2)
- [x] 05-04-PLAN.md — Spec-derived concord tests closing H01(a) control address and H01(c) channel plane address (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-05-PLAN.md — Phase gate: non-vacuity probes proving each new test fails without the fix, plus `pnpm -r test` against the 1989 baseline (wave 3)

#### Gap closure *(Success Criterion 2 / CACHE-02 failed verification — the taxonomy's own citations are false for the examples they cite. Criteria 1, 3, 4, 5 PASSED and are not reopened; the runtime fix is correct and stays untouched. All gap-closure work is comment/prose-only except 05-10's test.)*

**Gap Wave 1**

- [x] 05-06-PLAN.md — Repair the canonical `cache.ts` taxonomy and its restatement in `operations/event.ts`: drop the false machine-readable-definition framing, reclassify `setEncryptedContentCache` as carry-forward, correct the descriptor rationale, disclose the frozen-object throw (gap wave 1)

**Gap Wave 2** *(blocked on 05-06 — every downstream comment cites the corrected taxonomy)*

- [x] 05-07-PLAN.md — Remove every false "propagated via the merge list" citation in core + common (`relays.ts`, `event-store.ts`, `async-event-store.ts`, `encrypted-content-cache.ts`) (gap wave 2)
- [x] 05-08-PLAN.md — Reword the six core write-site comments that assert a spread-survival property their enumerable writes lack, plus the `setEncryptedContentCache` classification mirror (gap wave 2)
- [x] 05-09-PLAN.md — Reword the eight common write-site comments that assert a spread-survival property their enumerable writes lack (gap wave 2)
- [x] 05-10-PLAN.md — Make `cache.test.ts`'s carry-forward half genuinely enforce the D-13 contract via an intervening uncompensated spread, proven by a recorded non-vacuity probe (gap wave 2)
- [x] 05-11-PLAN.md — Correct the residual false comments (`common/helpers/gift-wrap.ts` sentinel, `common/operations/gift-wrap.ts` propagation claims, concord `keys.ts` "hand-rolled") and record the deferral register for every unclosed review finding (gap wave 2)

### Phase 05.1: Symbol Propagation Redesign (INSERTED)

**Goal:** Symbol propagation has one teachable rule instead of three overlapping mechanisms: every symbol write is non-enumerable (via `setCachedValue`), nothing survives an object copy implicitly, and the factory pipeline explicitly carries the `PRESERVE_EVENT_SYMBOLS` whitelist forward between operations — with `stamp`/`sign` keeping their explicit copies so standalone `sign(signer)(draft)` still preserves plaintext.
**Scope:** (1) Move `GiftWrapSymbol`/`SealSymbol`/`RumorSymbol` to core (re-exported from common), making `PRESERVE_EVENT_SYMBOLS` a static set with no import-time mutation. (2) Add the whitelist carry-forward half to `pipeFromAsyncArray` and `EventFactory.chain`. (3) Migrate the ~41 enumerable symbol write sites across core, common, wallet, wallet-connect, and concord onto `setCachedValue`, fixing the `filter.ts` shared-Set defect and the `groups.ts` undefined-memoization defect en route (both sites are touched anyway; see STATE.md Deferred Items). (4) Delete the two strip loops last, once no enumerable write remains. (5) Rewrite `cache.test.ts`'s carry-forward suite against the pipeline-carry mechanism and delete `cache.ts`'s superseded taxonomy prose. Audit the out-of-pipe spreads (`unlockHiddenTags`'s `{ ...draft, pubkey }`, gift-wrap's `{ ...draft }` rumor copy) before migrating their sources.

**Folded-in behavioral bug fixes (decision 2026-07-16 — Phase 5 code review, full detail in `.planning/phases/05-cache-identity-memo-fix/05-REVIEW.md`).** Five confirmed blocker-severity defects in write-sites this redesign already touches are fixed here rather than in a standalone phase. **Fix each in its OWN commit with its OWN spec-derived regression test, landed BEFORE the enumerable→non-enumerable migration rewrites the site — so a failing test attributes to the bug fix, not the refactor. Do not let a migration commit and a behavioral fix share a commit.** The five:

  - **CR-01/CR-02 — unlock-guard family returns `undefined` typed as an array.** `isHiddenContactsUnlocked` (`packages/core/src/helpers/contacts.ts:72-75`) type-asserts the symbol is present but only checks `isHiddenTagsUnlocked`; `unlockHiddenContacts:106` then returns `undefined` as `ProfilePointer[]`. Same shape in `emoji-pack.ts:137-159`, `mute.ts:69-72`, `trusted-assertions.ts:100-102`. The correct pattern already exists at `bookmark.ts:82-86` / `groups.ts:146-148` (`isHiddenTagsUnlocked && (Symbol in event || getter() !== undefined)`).
  - **CR-03 — `lockAppData` does not lock.** `packages/common/src/helpers/app-data.ts:98-100` deletes `HiddenContentSymbol` but the decrypted+parsed payload on `AppDataContentSymbol` (written `:71`) survives, so `getAppDataContent` keeps returning plaintext after a lock. Data exposure. (Compare `lockHiddenTags`, which deletes both.)
  - **CR-04 — `copySymbolsToDuplicateEvent` fails open on the wrong operator.** `packages/core/src/event-store/event-store.ts:200-205` throws only when pubkey **and** identifier both differ; the invariant (per its own message) needs `||`. Lets `verifiedSymbol` + decrypted plaintext merge onto an unrelated event. Pre-existing; this phase only commented the function.
  - **CR-05 — `stamp()` mutates its caller's draft.** `packages/core/src/operations/event.ts:126-127` deletes `id`/`sig` from `draft` before copying; `stripSignature`/`stripStamp` copy first. `eventPipe(sign(user))(someSignedEvent)` strips the caller's `EventMemory`-indexed event.

  The 11 WARNING-severity findings in the same review are lower priority; fold in opportunistically where a site is touched, otherwise leave for milestone review.
**Requirements**: TBD (governed by CONTEXT.md decisions D-01..D-14; CACHE-02 superseded+reinterpreted per D-06)
**Depends on:** Phase 5
**Plans:** 13/13 plans complete

Plans:
**Wave 1**

- [x] 05.1-01-PLAN.md — Mechanism: move gift-wrap symbols to core, static PRESERVE_EVENT_SYMBOLS, carry-forward half in both strip loops (wave 1)
- [x] 05.1-02-PLAN.md — Core guard fixes: CR-01 contacts unlock-guard, CR-04 copySymbols replaceable guard (wave 1)
- [x] 05.1-03-PLAN.md — Core input-safety fixes: CR-05 stamp copy-then-delete, Site-1 unlockHiddenTags spread (wave 1)
- [x] 05.1-04-PLAN.md — Common unlock-guard family: CR-02 emoji-pack/mute/trusted-assertions (wave 1)
- [x] 05.1-05-PLAN.md — Common lock + memo: CR-03 lockAppData, groups D-02/D-03 fix + line-139 delete (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05.1-06-PLAN.md — Mechanism proof + docs: cache.test.ts carry-forward rewrite (non-vacuous), cache.ts one-rule doc (wave 2)
- [x] 05.1-07-PLAN.md — Core helper migrations: filter/event/cast/encrypted-content/relays/hidden-tags/contacts (wave 2)
- [x] 05.1-08-PLAN.md — Core event-store migrations: copySymbols merge, EventStoreSymbol sync+async (wave 2)
- [x] 05.1-09-PLAN.md — Common identity-memo migrations: mute/emoji/trusted/app-data/bookmark/lists/enc-content-cache (wave 2)
- [x] 05.1-10-PLAN.md — Common gift-wrap helper migrations (6 sites) (wave 2)
- [x] 05.1-11-PLAN.md — Downstream migrations: concord/wallet/wallet-connect + Wave-0 gap tests (wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05.1-12-PLAN.md — Group-B build-path migrations: tags/encrypted-content/gift-wrap operations (wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05.1-13-PLAN.md — Strip-loop deletion (delete-loop half removed, carry-forward kept) + full-suite gate (wave 4)

### Phase 6: Refounding Rotation & Authority Correctness

**Goal**: A Refounding is no longer a cryptographic no-op in-session — it rotates every plane address, actually drops excluded members from the memberlist, and is honored only from a rotator who strictly outranks every target it removes.
**Depends on**: Phase 5 (CACHE-01 must land first — ROTATE-04 is masked by the cache bug and only activates once it's fixed)
**Requirements**: ROTATE-01, ROTATE-02, ROTATE-04, AUTH-01, AUTH-02
**Success Criteria** (what must be TRUE):

  1. After a Refounding, `rollForward(...).control.pk` (and the guestbook/rekey addresses alongside it) equal the spec formula computed over the new root, so a removed member holding the old root no longer reads current Control/Guestbook traffic.
  2. Each held epoch's material addresses a distinct plane, so the epoch walk fetches every historical epoch instead of collapsing onto one address.
  3. A member excluded by a Refounding is absent from the new epoch's Complete Memberlist even when they have a prior-epoch Join or an `observed` entry — the new epoch's Guestbook is seeded only by the snapshot, and passing `state.members` as the next `refound()`'s `keep` list does not re-admit them.
  4. A rotator who does not strictly outrank a target named in a root Refounding's exclusion list is rejected on both the send path (`refound()`) and the receive path (`readRekey`'s guard denies by default when the outrank check is absent, matching the already-correct channel path).
  5. **(TEST-01, standing)** Every derivation and fold this phase touches has at least one test computing its expected value independently from the CORD-02 §4/§5 formula — never by calling the implementation under test — and asserting the implementation matches. Covers the new epoch's control/guestbook/rekey addresses and the post-Refounding memberlist, each derived by hand from the spec.

**Plans**: 3/3 plans complete

Plans:

**Wave 1**

- [x] 06-01-PLAN.md — Spec-derived guestbook + base-rekey address tests with memo-armed spread guards (ROTATE-01/02, D-10/D-11) (wave 1)
- [x] 06-02-PLAN.md — Memberlist epoch-scoping: epoch-keyed guestbook store + scoped observed set + D-03 retention trim (ROTATE-04/02, D-01..D-04) (wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-03-PLAN.md — Authority guards both paths: refound() send-path outrank loop + fail-closed readRekey receive path (AUTH-01/02, D-05..D-09) (wave 2)

### Phase 7: Private Channel Keying

**Goal**: Private channel access derives only from held key material — never a fallthrough to the public `community_root` formula and never from Control-Plane edition JSON — and a client can tell "visible metadata" apart from "key held" without hand-rolling a lookup. Closes the field-confirmed Accordian-blocking bug (H07/H08) end to end.
**Depends on**: Phase 5 (the channel-plane cache memo is the second independent root cause of H08 — CHAN-05's threading fix alone is not sufficient)
**Requirements**: CHAN-01, CHAN-02, CHAN-03, CHAN-04, CHAN-05, CHAN-06, CHAN-07, ROTATE-03, TEST-02
**Success Criteria** (what must be TRUE):

  1. A private channel with visible metadata but no held key material derives no channel `GroupKey`, gets no `keys.channels`/`keys.channelEpochs` entry, and its plane is never registered, subscribed, or published to.
  2. Sending to a private channel without key material rejects with a distinct, clear error (e.g. `missing private channel key`), never the generic `unknown channel`.
  3. Channel key material is read only from `material.channels` — an edition-JSON `key`/`epoch` field is never used to derive a plane — and a channel Rekey's new secret takes effect immediately, with `rollForwardChannel`'s output addressing the new epoch's plane without a client reload.
  4. A client can query whether a folded channel is visible-but-inaccessible versus one it holds a key for, without hand-rolling a `material.channels` lookup; a channel marked deleted cannot be revived by a later edition.
  5. All five Accordian-named tests pass: keyless private metadata derives nothing; public channels still derive from `community_root`; keyed private channels still derive from their own key; sending to a keyless private channel rejects; the direct-invite/private-channel grant flow still works once key material is folded.
  6. **(TEST-01, standing — sharpest case in the milestone)** Every channel derivation this phase touches has at least one test computing its expected value independently from the CORD-03 §1 formula — never by calling the implementation under test — and asserting the implementation matches. Both §1 branches are covered by hand-derived values: the public `group_key("concord/channel", community_root, channel_id, root_epoch).pk` and the private `group_key("concord/channel", channel_key, channel_id, channel_epoch).pk`. The keyless-private case asserts the implementation derives **nothing** rather than asserting it matches the independently-derived public address — the byte-identical collision that *was* H07.

**Plans**: 4/4 plans complete

Plans:

- [x] 07-04-PLAN.md

**Wave 1**

- [x] 07-01-PLAN.md — Channel-key source-of-truth refactor + CHAN-04 explicit field pick + CHAN-07 sticky-deletion with heads pinning; removes ChannelMetadata.key/.epoch (breaking); spec-derived derivation + fold tests (CHAN-01/03/04/05/07, ROTATE-03, TEST-02 cases 1-3) (wave 1)

**Wave 2** *(depends on 07-01)*

- [x] 07-02-PLAN.md — CHAN-06 accessible/ChannelView via materialChanged$ reactivity plumbing + hasChannelKey adoption; reactivity test (CHAN-06) (wave 2)

**Wave 3** *(depends on 07-01, 07-02)*

- [x] 07-03-PLAN.md — CHAN-02 MissingChannelKeyError send guard + client-level ROTATE-03 rotate→send + TEST-02 cases 4-5 (CHAN-02/05, ROTATE-03, TEST-02) (wave 3)

**Note**: CHAN-07 ruling resolved (D-07): CORD-03 §2 "deletion is terminal; the id is never reused" — enforced via a sticky-deleted fold rule with heads pinning (not "no change needed"). Landed in 07-01 alongside the source-of-truth refactor because both rewrite the same foldControl channel loop.

### Phase 8: Rotation Robustness & Consensus

**Goal**: Rotation behaves correctly under real-world adversity — racing Refoundings, a bunker signer that blips mid-decrypt, and malformed or partial chunk sets — instead of silently forking the community or evicting a member who was never removed.
**Depends on**: Phase 6 (robustness fixes build on a base Refounding that already rotates correctly)
**Requirements**: ROTATE-05, ROTATE-06, ROTATE-07, ROTATE-08, ROTATE-09, ROTATE-10, ROTATE-11, ROTATE-12, ROTATE-13
**Success Criteria** (what must be TRUE):

  1. A transient signer/decrypt error while reading a rekey blob is retried and never interpreted as removal — a NIP-46 bunker timeout no longer permanently evicts a member who was never excluded.
  2. Two rotations racing to the same epoch converge down-only to a single lower-keyed sibling, the winner is computed among all authorized and continuity-checked candidates (not only those the local client happened to receive), and a converged community can never re-fork.
  3. A rotation cites the Grant it acts under (`vac`), a receiver verifies that citation against its folded Roster before honoring it, and compaction/snapshot wraps publish only after the root roll's publication is confirmed.
  4. Rotation chunk sets correlate on `chunkCount` and `prevepoch` identity is validated across a rotation's chunks, so a resumed rotation's stale generation cannot complete a set or forge continuity.
  5. Historical epoch material does not inherit the tip's `refounder`, and a Refounding that cannot reliably fold the whole Control Plane aborts rather than publishing a partial compaction.
  6. **(TEST-01, standing)** Every derivation and fold this phase touches has at least one test computing its expected value independently from the CORD-06 spec — never by calling the implementation under test — and asserting the implementation matches. Covers the continuity math, the `lowerKeyWins` tie-break, and the complete-set gate, each with expected outcomes derived by hand from the §2/§3 rules rather than observed from the implementation.

**Plans**: 6 plans

Plans:

**Wave 1** *(the re-read spine is the load-bearing prerequisite for ROTATE-05/06/07)*

- [ ] 08-01-PLAN.md — Down-only re-read spine + per-epoch anti-refork latch (D-04): sync/channel-sync re-read of held epochs + cascade rebuild, rekeyHandled Set→Map (ROTATE-06) (wave 1)
- [ ] 08-02-PLAN.md — Chunk-set consistency guards: groupRotations multiset check over chunkCount + prevepoch, `consistent` flag (D-02, ROTATE-10/11) (wave 1)

**Wave 2** *(depends on the spine)*

- [ ] 08-03-PLAN.md — readRekeyScoped convergence restructure: transient-decrypt≠removal + decryptable/opaque partition defer (D-06/D-10, ROTATE-05/06/07) (wave 2)
- [ ] 08-04-PLAN.md — refound() per-wrap majority-confirmed publish gate before adoption/compaction (D-09/D-11, ROTATE-09) (wave 2)

**Wave 3** *(vac threads keys/rekey/community/sync — serial after their prior-wave edits)*

- [ ] 08-05-PLAN.md — vac citation (emit) + first receive-side folded-Roster verification (D-08/D-12, ROTATE-08) (wave 3)

**Wave 4** *(build/chain hardening on keys.ts + sync.ts, after vac)*

- [ ] 08-06-PLAN.md — buildRefounding abort-on-unfoldable-head + per-epoch refounder de-inheritance (D-01/L01, ROTATE-13/12) (wave 4)

**Note**: Both spec rulings were resolved during discuss/plan (neither "no change"). ROTATE-13 (M-conflict) → D-01: fail-closed abort (08-06). ROTATE-10 (S03) → D-02: consistency-guard, NOT a correlation-key change (08-02). D-10/D-11/D-12 further ruled this planning session (opaque-fork defer; per-wrap majority; folded-Roster structural vac check).

### Phase 9: Authority & Permission Fold Correctness

**Goal**: Grant, Kick, Ban, and Role folds enforce the rank comparisons CORD-04 specifies and reject malformed input locally, instead of defaulting to permit or throwing out of `foldControl` and failing every member's community state.
**Depends on**: Phase 6 (shares the Refounding authority code paths and outrank-guard pattern established there)
**Requirements**: AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08
**Success Criteria** (what must be TRUE):

  1. A Grant edition is folded only at its derived coordinate (`grantLocator`) on the read path — the same rule already enforced for the write path and the banlist beside it — so two conflicting Grants for one member are not delivery-order dependent.
  2. A malformed Grant (invalid `role_ids`) is skipped rather than throwing an uncaught `TypeError` out of `foldControl` and failing every member's fold.
  3. `kick()` and `ban()` reject locally when the caller lacks the bit or the rank, matching the existing local checks in `rotateChannel()`/`refound()`.
  4. `Role.position` is validated as a positive integer before a role confers any permission bit.
  5. A Grant that revokes or demotes is gated by a rank comparison against its target member, and a Kick's `vac` is validated against its cited Grant and required for non-owner Kicks (both post-ruling).
  6. **(TEST-01, standing)** Every derivation and fold this phase touches has at least one test computing its expected value independently from the CORD-04 spec — never by calling the implementation under test — and asserting the implementation matches. Covers the `grantLocator` coordinate (derived by hand from the §5 formula, not read back from the write path that produces it) and the union-of-bits/min-position rank outcomes, tabulated from §2 rather than observed.

**Plans**: TBD
**Note**: AUTH-07 (S01) and AUTH-08 (S02) are blocked on spec rulings, resolved as this phase's first task. AUTH-07: whether CORD-04 §3's "strictly outrank its target" binds a Grant's target member, not just the roles it hands out — the permissive reading is a real privilege-escalation path. AUTH-08: CORD-02 §5 defers Kick's `vac` rule to CORD-04 §5; confirm there first.

### Phase 10: Invite Lifecycle & Event Time Consistency

**Goal**: A revoked invite link is unjoinable regardless of relay lag, malformed bundles fail closed at the validation boundary, and an event's `created_at`/`ms` pair is always one true decomposition of a single clock read — so ordering and membership never silently disagree.
**Depends on**: Phase 5 (workspace-wide stability from the cache fix; otherwise independent of the rotation/channel work in Phases 6–9)
**Requirements**: INVITE-01, INVITE-02, INVITE-03, INVITE-04, INVITE-05, TIME-01, TIME-02, TIME-03
**Success Criteria** (what must be TRUE):

  1. A revoked invite link is unjoinable even when a lagging relay still serves the old bundle — the coordinate resolves to its newest event first, then the tombstone is evaluated, reusing `ConcordInviteList.bundles$`'s already-correct `store.replaceable` pattern.
  2. `validateInviteBundle` fails closed on a bundle whose `channels`/`relays` are not arrays, and `decodeFragment` rejects a fragment version it does not know rather than decoding it against the wrong dictionary.
  3. `refreshInviteBundles` skips a link it cannot rebuild and continues refreshing the rest, instead of aborting every link after it; the Invite List's `expires_at` is written in the spec-correct unit (confirmed against CORD-05 §4 first).
  4. An event's `created_at` and `ms` tag come from a single clock read via `splitTime()`, so `created_at * 1000 + ms` is a true decomposition of one instant with zero skew.
  5. All chunks of one Guestbook snapshot share one timestamp (including `created_at`), and `rumorMs`/`hasMalformedMs` agree on what a valid `ms` tag is, so ordering and membership can never disagree about the same rumor.
  6. **(TEST-01, standing)** Every derivation this phase touches has at least one test computing its expected value independently — never by calling the implementation under test — and asserting the implementation matches. Covers the `inviteBundleKey` derivation and the invite coordinate `(33301, link_signer, "")` (hand-derived from CORD-05 §2), plus the time decomposition asserted against hand-computed `{created_at, ms}` pairs at a chosen instant — including the ≥500ms remainder that produced H04's +1000ms skew.

**Plans**: TBD

### Phase 11: Messaging Wire Conformance

**Goal**: Reactions, threaded replies, deletes, and voice presence carry the exact wire shape CORD-01/03/07 define, so a compliant client can express a full-depth thread, receive voice presence, and clean up its own giftwraps.
**Depends on**: Phase 5 (workspace-wide stability; otherwise independent of Phases 6–10)
**Requirements**: WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-05, WIRE-11
**Success Criteria** (what must be TRUE):

  1. `ChannelMetadata.voice` no longer exists — every channel is callable and no per-channel voice flag is read, written, or gated on (breaking change; changeset + migration note included).
  2. Kind 23313 voice presence reaches consumers through the receive funnel instead of being silently dropped, so a client can implement CORD-07 §4.
  3. A reaction's `k` tag names its target's actual kind rather than a hardcoded `9`, and a threaded reply inherits its parent's root tags verbatim while deriving `K`/`k` from the real target kind — a reply off a kind-9 message and nesting beyond depth 1 are both expressible.
  4. A `deleteMessage` event carries a `k` tag naming its target's kind.
  5. A client can retain a wrap's ephemeral key so it can NIP-09-delete its own giftwrap by `p` tag.
  6. **(TEST-01, standing — fixture-anchored)** This phase has no crypto derivations, so its spec-derived obligation binds to the **`examples.md` fixtures**: every wire shape this phase touches has at least one test asserting the emitted event against the expected tag set transcribed from the `examples.md` fixture (or the CORD-01/03/07 spec text) — never against a snapshot of our own output. Covers the reaction `k` tag, the threaded-reply `K`/`k` and inherited root tags, and the delete `k` tag.

**Plans**: TBD

### Phase 12: Document & Caps Conformance

**Goal**: Community and channel documents respect the protocol's byte and membership caps, and round-trip fields the current client doesn't understand — so two clients sharing one npub, or a future protocol revision, cannot silently destroy each other's data.
**Depends on**: Phase 5 (workspace-wide stability; otherwise independent of Phases 6–11)
**Requirements**: WIRE-06, WIRE-07, WIRE-08, WIRE-09, WIRE-10, WIRE-12
**Success Criteria** (what must be TRUE):

  1. A channel `name` is capped at 64 bytes (UTF-8 byte length via `TextEncoder`, not UTF-16 code units) on write and defensively on read.
  2. Community `name` (64B) and `description` (10000B) byte caps are enforced, alongside the Community List's 50-membership protocol constant (already-enforced byte cap included).
  3. The Community List and Invite List round-trip unknown top-level document fields — not just per-entry unknowns — so a second client sharing one npub cannot wipe fields it doesn't recognize.
  4. A `deleteChannel` edition preserves `custom` via an explicit destructure while still excluding client-only key material (never a naive spread, which would leak `ch.key`).
  5. Code comments cite real, existing spec sections (no more `CORD-06 §94`, a line number mistaken for a section).
  6. **(TEST-01, standing — constant- and fixture-anchored)** Every cap and document rule this phase touches is asserted against the value transcribed from the spec text or the `examples.md` fixture — never against the implementation's own constant. Each cap test names its literal spec value (64B, 10000B, 50 entries) independently of the source constant, so renaming or mis-setting that constant fails the test; the byte caps are exercised with a multi-byte UTF-8 string whose UTF-16 `.length` and UTF-8 byte length differ.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 5 → 5.1 → 6 → 7 → 8 → 9 → 10 → 11 → 12

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Generic store foundation | v1.0 | 4/4 | Complete | 2026-07-09 |
| 2. Generic models & casts | v1.0 | 3/3 | Complete | 2026-07-09 |
| 3. RumorStore & verification | v1.0 | 3/3 | Complete | 2026-07-09 |
| 4. Common package rumor support | v1.0 | 1/1 | Complete | 2026-07-09 |
| 5. Cache Identity Memo Fix | v1.1 | 14/14 | In gap closure | - |
| 5.1 Symbol Propagation Redesign (INSERTED) | v1.1 | 13/13 | Complete    | 2026-07-16 |
| 6. Refounding Rotation & Authority Correctness | v1.1 | 3/3 | Complete    | 2026-07-16 |
| 7. Private Channel Keying | v1.1 | 4/4 | Complete    | 2026-07-17 |
| 8. Rotation Robustness & Consensus | v1.1 | 0/TBD | Not started | - |
| 9. Authority & Permission Fold Correctness | v1.1 | 0/TBD | Not started | - |
| 10. Invite Lifecycle & Event Time Consistency | v1.1 | 0/TBD | Not started | - |
| 11. Messaging Wire Conformance | v1.1 | 0/TBD | Not started | - |
| 12. Document & Caps Conformance | v1.1 | 0/TBD | Not started | - |

**TEST-01 closure rule:** TEST-01 is not satisfied until Phase 12 completes. Do not mark it Complete at Phase 5 — its anchor phase is an accounting convenience, not its scope. Each phase's `(TEST-01, standing)` criterion is verified by that phase's own verification step; the requirement closes only when all eight have passed.

## Backlog

### Phase 999.1: Concord sync debug logging (BACKLOG)

**Goal:** [Captured for future planning] Concord community client and private channel sync need proper debug logging across the board — and most specifically for syncing, so that it is possible to know when synced events fail to decrypt. Today a decryption failure during sync is silent, which makes it impossible to tell "no events" apart from "events arrived but could not be decrypted."
**Requirements:** TBD
**Plans:** 4/4 plans complete

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.2: Concord media epoch key decryption audit (BACKLOG)

**Goal:** [Captured for future planning] Review and check concord's file/media encryption and decryption to confirm that media sent in past epochs is decrypted with the correct keys **from that epoch**, not with the latest keys. Suspected failure mode: the decrypt path resolves keys from current epoch state rather than from the epoch the media was encrypted under, which would make historical media undecryptable after a rotation.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.3: Concord sync skips ephemeral kind 21059 (BACKLOG)

**Goal:** [Captured for future planning] Concord community sync should not sync kind 21059 events — they are ephemeral and should only be reached via a live subscription, never a historical fetch/backfill filter. Grounding: `EPHEMERAL_GIFT_WRAP_KIND = 21059` (`packages/concord/src/helpers/gift-wrap.ts:25`); kinds 20000–29999 are ephemeral under NIP-01, so relays do not retain them and a sync filter for 21059 can only ever return nothing — wasted round-trips, and a misleading "synced" signal for events that by definition cannot arrive that way.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.4: NIP-42 lifecycle debug logging (BACKLOG)

**Goal:** [Captured for future planning] The NIP-42 relay authentication lifecycle needs more debug logging around it — the auth challenge/response/result flow should emit enough diagnostic detail to tell where an auth attempt is in its lifecycle and why it succeeded or failed, so that silent auth stalls or rejections are observable rather than opaque.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 999.5: Operation-Scoped NIP-42 Auth Hooks (BACKLOG)

**Goal:** [Captured for future planning] Move NIP-42 auth handling out of ambient relay/pool status subscriptions and into the specific operation that receives `auth-required:` — request-like operations (`req`/`request`/`subscription`/`count`/`publish`/`event`/`sync`/negentropy) expose an `onAuthRequired` callback plus `authTimeout`/`authRetries` options, keying off concrete `auth-required:` responses instead of the broad cached `authRequiredForRead$`/`authRequiredForPublish$` flags, so consumers (and Concord) no longer hand-roll status/challenge watchers to authenticate. Behavior change for `applesauce-relay` and `applesauce-loaders`; Concord auth cleanup is a follow-up. Full drafted plan: `operation-scoped-nip-42-auth-hooks-plan.md` in this phase directory.
**Requirements:** TBD
**Plans:** 0 plans

Plans:

- [ ] TBD (promote with /gsd-review-backlog when ready)
