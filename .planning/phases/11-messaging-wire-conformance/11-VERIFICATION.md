---
phase: 11-messaging-wire-conformance
verified: 2026-07-29T13:00:00Z
status: human_needed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Decide whether apps/docs/concord/community.md's stale react()/replyToThread()/deleteMessage() call examples (still showing the pre-phase {id, author} pointer shape) are in-scope doc debt to fix now, or an accepted follow-up."
    expected: "Either the docs are corrected to show the Rumor-taking signatures (a caller following them today emits [\"k\",\"undefined\"] / [\"e\",\"undefined\"] malformed wire events — the exact defect class this phase exists to eliminate), or a deliberate decision is recorded to defer the fix."
    why_human: "No plan in this phase claimed apps/docs/concord/community.md in files_modified, so it is a scope decision, not a code-correctness question — the underlying SDK/tests are correct and green."
  - test: "Decide whether WIRE-02's removal of the kind-23313 receive-funnel drop, which now lets ConcordObservedAuthorsModel's unfiltered store.timeline([{}]) feed presence beacons into foldMembers's observed-authors roster fold, is an accepted trade-off or needs a follow-up fix before shipping."
    expected: "Either a decision that a kicked/left member being able to resurrect their membership by leaving a voice-presence client running is accepted (matching D-04's stated ephemeral-accumulation trade-off, which named store growth but not roster resurrection), or a follow-up plan is scheduled to exclude presence kinds from the observed-authors fold."
    why_human: "This is a real, code-confirmed regression with no test coverage in either direction (no test proves the resurrection, and no test proves it's excluded) — it is a judgment call about severity, not a verifiable pass/fail against this phase's stated success criteria, which say nothing about membership-fold integrity."
---

# Phase 11: Messaging Wire Conformance Verification Report

**Phase Goal:** Reactions, threaded replies, deletes, and voice presence carry the exact wire shape CORD-01/03/07 define, so a compliant client can express a full-depth thread, receive voice presence, and clean up its own giftwraps.
**Verified:** 2026-07-29T13:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP success criterion) | Status | Evidence |
|---|---|---|---|
| 1 | `ChannelMetadata.voice` no longer exists — no per-channel voice flag read/written/gated (D-09: field removal alone scores this) | ✓ VERIFIED | `packages/concord/src/types.ts` `ChannelMetadata` has no `voice` field. `grep -rIn -E '\.voice\b\|voice\?:\|voice:\s*true' packages/concord/src apps/examples/src/examples/concord apps/docs/concord` returns zero matches. `apps/examples/src/examples/concord/admin-management.tsx` confirmed clean (no `setVoice`, sibling `checked={isPrivate}` and `channel.deleted` reads intact). `apps/docs/concord/channels.md` shows only public/private examples, no voice example. No `.changeset/*.md` file added by this phase (confirmed via `.changeset/` directory listing against phase commits). |
| 2 | Kind 23313 voice presence reaches consumers through the receive funnel instead of being silently dropped, so a client can implement CORD-07 §4 | ✓ VERIFIED (see WARNING below) | `route()` in `packages/concord/src/client/community.ts:676-691` and the symmetric `route()` in `packages/concord/src/client/private-channel.ts:310-324` no longer test the decoded rumor's kind against `VOICE_PRESENCE_KIND` — only the `checkChatBinding` anti-replay guard remains. Confirmed by direct source read (kind filter line absent in both files) and by running the actual test suite: `pnpm --filter applesauce-concord test community -t "wire conformance"` — both WIRE-02 cases pass (presence readable from `channelStore`, matches `examples.md` §2.8 via `missingFixtureTags`; a rumor bound to a different channel is still dropped, proving only the kind filter was removed). `pnpm --filter applesauce-concord test private-channel` (11/11) passes, including the symmetric receive case. **However:** a real, code-confirmed side effect was found — see the human-verification item below. |
| 3 | A reaction's `k` tag names its target's actual kind rather than a hardcoded `9`, and a threaded reply inherits its parent's root tags verbatim while deriving `K`/`k` from the real target kind — a reply off a kind-9 message and nesting beyond depth 1 are both expressible | ✓ VERIFIED (see WARNING below) | `react(channelId, target: Rumor, reaction)` (`community.ts:1103`) passes `target` straight into `ReactionFactory.create` — no hand-built identity object, no hardcoded kind. `replyToThread(channelId, parent: Rumor, body)` (`community.ts:1096`) passes `parent` straight into `CommentFactory.create`. Ran the actual tests: `WIRE-03: a reaction to a threaded reply names the reply's real kind (1111), not a hardcoded 9` passes; `WIRE-04: a depth-1 reply ... matches examples.md §2.2 verbatim` and `WIRE-04: a depth-2 reply inherits the ROOT from the message, not from its immediate parent` both pass, with the depth-2 case asserting both a positive root-identity match and a negative inequality against the intermediate reply — confirmed by source read of the actual assertions (`community.test.ts:1406-1449`), not just the SUMMARY's description. **However:** `apps/docs/concord/community.md:95,106` — the only published documentation for these two methods — still shows the pre-phase `{ id, author }` pointer shape. See human-verification item below. |
| 4 | A `deleteMessage` event carries a `k` tag naming its target's kind | ✓ VERIFIED | `deleteMessage(channelId, target: Rumor)` (`community.ts:1117-1128`) passes `target.id` into `DeleteFactory.fromEvents`, then explicitly applies `ensureKTag(template.tags, target.kind)` before binding — confirmed by direct source read, matching the corrected D-02 mechanism (a Concord `Rumor` has no `sig`, so `isEvent` is false and `setDeleteEvents`'s own `ensureKTag` branch never fires without this explicit application). Ran the actual tests: `WIRE-05: delete of a genuine sig-less Rumor matches examples.md §2.4, with a real 64-hex e tag` and `WIRE-05: delete of a kind-1111 reply names the reply's real kind, not the message's` both pass — including an explicit `"sig" in message === false` precondition assertion and a 64-character `e`-tag length check. `editMessage` (out of scope per ROADMAP wording and PLAN 04's explicit fence) is unaffected and still lacks a `k` tag — correctly not covered by this criterion. |
| 5 | A client can retain a wrap's ephemeral key so it can NIP-09-delete its own giftwrap by `p` tag | ✓ VERIFIED | `WrapOptions.ephemeralSk?: Uint8Array` (`operations/gift-wrap.ts:39-51`) threads through `wrapForTarget` → `publishToPlane`/`sendEvent` (`grep -c ephemeralSk community.ts` = 2, `private-channel.ts` = 0, matching plan scope). `buildWrap` (`gift-wrap.ts:79-89`) binds `opts.ephemeralSk ?? generateSecretKey()` to a local and derives `getPublicKey(decoySk)` into the `p` tag only — confirmed by direct source read that the secret local is referenced nowhere else in the function. Ran the actual tests: `wrapForTarget ephemeralSk round-trips to the p tag and never leaks (WIRE-11)` and the determinism/no-key-control case both pass. Note: the "never leaks" assertion (`expect(JSON.stringify(wrap)).not.toContain(secretHex)`) is weaker than its name claims — `buildWrap`'s `content` field is always NIP-44 ciphertext regardless of the `plaintext` option (which only affects the seal kind), so this assertion cannot detect a leak into the seal or rumor. This is a test-quality gap (matches code review WR-08), not a truth failure — direct code read confirms the secret is genuinely never placed anywhere but the local used to derive the public key. |
| 6 | (TEST-01, standing, fixture-anchored) Every wire shape this phase touches has at least one test asserting against the `examples.md` fixture tag set, never a snapshot of our own output | ✓ VERIFIED | `packages/concord/src/__tests__/cord-wire-fixtures.ts` vendors the four `examples.md` tag sets plus two prose rules, each with a `section` citation; `packages/concord/src/__tests__/cord-wire-fixtures.test.ts` (13 tests) proves the helpers non-vacuous. All 8 `wire conformance` tests in `community.test.ts` route their expected values through `substituteFixtureTags`/`missingFixtureTags`/`tagValues` imported from that module (`grep -c 'cord-wire-fixtures' community.test.ts` ≥ 1, confirmed by source read of every case — none hardcodes its own tag literal as the expected side). Comparisons use `missingFixtureTags`, not positional array equality, matching the documented order-independence rationale. |

**Score:** 6/6 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/concord/src/types.ts` | `ChannelMetadata` with no `voice` field | ✓ VERIFIED | Field absent; `deleted`/`custom`/`channel_id`/`name`/`private` intact |
| `packages/concord/src/client/admin.ts` | `CreateChannelOptions` with no `voice`; `createChannel` write removed; `deleteChannel` untouched | ✓ VERIFIED | Confirmed by grep + code read |
| `packages/concord/src/helpers/control.ts` | Fold no longer privileges `voice` | ✓ VERIFIED | `deleted`/`custom` spreads intact, `voice` spread gone |
| `apps/examples/src/examples/concord/admin-management.tsx` | No voice UI, sibling UI intact | ✓ VERIFIED | `setVoice`=0, `checked={isPrivate}`=1, `channel.deleted` intact |
| `apps/docs/concord/channels.md` | Voice example removed | ✓ VERIFIED | Private example intact |
| `packages/concord/src/operations/gift-wrap.ts` | `ephemeralSk` option, `buildWrap` derives only public key | ✓ VERIFIED | Confirmed by code read |
| `packages/concord/src/helpers/keys.ts` | `wrapForTarget` opts widened | ✓ VERIFIED | `grep -c ephemeralSk` ≥ 2 |
| `packages/concord/src/client/community.ts` | `react`/`replyToThread`/`deleteMessage` take `Rumor`; `route()` no longer drops 23313 | ✓ VERIFIED | Confirmed by code read of both concerns |
| `packages/concord/src/client/private-channel.ts` | Symmetric `route()` fix, `ephemeralSk`=0 (Pitfall 4, receive-only) | ✓ VERIFIED | Confirmed |
| `packages/concord/src/__tests__/cord-wire-fixtures.ts` / `.test.ts` | Vendored fixtures + non-vacuous helper proofs | ✓ VERIFIED | 13 tests pass |
| `packages/concord/src/client/__tests__/community.test.ts` | 8 fixture-anchored `wire conformance` cases | ✓ VERIFIED | All 8 pass (ran directly, not from SUMMARY) |
| `packages/concord/src/client/__tests__/private-channel.test.ts` | Symmetric voice-presence receive case | ✓ VERIFIED | 11/11 pass |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `react`/`replyToThread` | `ReactionFactory`/`CommentFactory` | direct `Rumor` pass-through, no hand-built pointer | ✓ WIRED | Confirmed by source read |
| `deleteMessage` | `DeleteFactory.fromEvents` + `ensureKTag` | `target.id` then explicit tag application | ✓ WIRED | Confirmed by source read |
| `cord-wire-fixtures.ts` | `community.test.ts` / `private-channel.test.ts` | import of fixture constants + helpers | ✓ WIRED | Every `wire conformance` case traces to the fixture module |
| `WrapOptions.ephemeralSk` | `wrapForTarget` → `publishToPlane` → `sendEvent` | opts forwarding, unchanged bodies | ✓ WIRED | Confirmed by source read + passing round-trip test |
| `route()` (both engines) | plane store `.add()` | kind filter removed, `checkChatBinding` guard intact | ✓ WIRED | Confirmed by source read + passing anti-replay control test |
| `route()`'s delivered rumor | `ConcordObservedAuthorsModel` → `foldMembers` | `store.timeline([{}])` unfiltered | ⚠️ WIRED, undesired side effect | See human-verification item — this link now also carries presence beacons into the membership-observation fold, which was not true before this phase |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full concord suite green | `pnpm --filter applesauce-concord test` | 52 files, 495 tests passed | ✓ PASS |
| Wire-conformance block green | `pnpm --filter applesauce-concord test community -t "wire conformance"` | 8 tests passed | ✓ PASS |
| Private-channel suite green | `pnpm --filter applesauce-concord test private-channel` | 11 tests passed | ✓ PASS |
| Full workspace suite green | `pnpm test` | 269 files (1 skipped), 2370 passed / 2 skipped | ✓ PASS |
| Unfiltered workspace build | `pnpm build` | Fails — 9 pre-existing `StoredEvent`/`NostrEvent` errors in `apps/examples`, confirmed via `git log` that each file's last edit (`e2c77999`, "Upgrade Noble and Scure dependencies") predates the phase's start commit (`73ce1952`) | ✓ PASS (pre-existing, not a phase-11 regression) |
| `admin-management.tsx` contributes zero build errors | `pnpm exec turbo build --filter=applesauce-examples --force \| grep admin-management` | No match | ✓ PASS |
| No changeset added | `.changeset/` directory listing | No new file matching phase-11 content (voice/wire/ephemeralSk/rumor-signature) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| WIRE-01 | 11-02 | `ChannelMetadata.voice` removed | ✓ SATISFIED | Truth 1 |
| WIRE-02 | 11-01, 11-06 | Kind 23313 reaches consumers | ✓ SATISFIED | Truth 2 (with flagged side effect) |
| WIRE-03 | 11-01, 11-04, 11-05 | Reaction `k` tag names real kind | ✓ SATISFIED | Truth 3 |
| WIRE-04 | 11-01, 11-04, 11-05 | Threaded reply root inheritance | ✓ SATISFIED | Truth 3 |
| WIRE-05 | 11-01, 11-04, 11-05 | Delete `k` tag names real kind | ✓ SATISFIED | Truth 4 |
| WIRE-11 | 11-03 | Retainable ephemeral decoy key | ✓ SATISFIED | Truth 5 |

No orphaned requirements: every ID REQUIREMENTS.md maps to Phase 11 (WIRE-01/02/03/04/05/11) appears in at least one plan's `requirements:` frontmatter, and every ID in every plan's `requirements:` frontmatter is one of the six phase requirement IDs given. WIRE-06 through WIRE-10 and WIRE-12 are correctly scoped to Phase 12 and not claimed here.

### Anti-Patterns Found

None. Scanned all files this phase modified for `TBD`/`FIXME`/`XXX` (debt markers — zero matches, no blocker), `TODO`/`HACK`/`PLACEHOLDER` (zero matches), and stub-shaped empty returns — none found. `editMessage` remaining on its bare-id signature (no `k` tag) is a deliberate, explicitly-scoped-out decision (WR-02 in the code review), not an anti-pattern of this phase's own work — WIRE-03/04/05's roadmap wording names reactions, replies, and deletes only, never edits.

### Human Verification Required

1. **Stale published docs for the three changed method signatures (CR-01 from code review, independently confirmed)**
   **Test:** Read `apps/docs/concord/community.md` lines 92-107 and compare against `packages/concord/src/client/community.ts`'s current `react`/`replyToThread`/`deleteMessage` signatures.
   **Expected:** The docs should show the `Rumor`-taking call shape. Today they still show `community.react(channelId, { id, author }, "🔥")` and `community.deleteMessage(channelId, messageId)` and `community.replyToThread(channelId, { id: threadId, author }, "...")` — the exact pre-phase shapes. Traced by hand: `react({ id, author }, ...)` → `setReactionParent` reads `event.pubkey`/`event.kind` as `undefined` → emits `["p", undefined]` and `["k", "undefined"]`. `deleteMessage(channelId, messageId)` (a bare string) → `target.id` is `undefined` → `["e", undefined]`. Neither throws; the malformed rumor is sealed, wrapped, and published — the exact class of wire-nonconformance this phase exists to eliminate, now demonstrated in the SDK's own published documentation.
   **Why human:** No plan in this phase claimed `apps/docs/concord/community.md` in its `files_modified`, so this is a scope decision (fix now vs. tracked follow-up), not a code-correctness verdict — the SDK code and its test suite are correct and green.

2. **Voice-presence beacon can resurrect a departed/kicked member into the roster (WR-04 from code review, independently confirmed by direct code read)**
   **Test:** In a test community, kick or have a member leave, then deliver a kind-23313 presence beacon authored by them with a `ms` newer than their departure; read `members$`.
   **Expected:** Before this phase, 23313 was dropped at the receive funnel, so it could never reach `ConcordObservedAuthorsModel`'s `store.timeline([{}])` (confirmed unfiltered by all kinds, `packages/concord/src/models/observed.ts:9`) or `foldMembers`'s `if (!c || c.present || lastMs > c.ms) members.add(author)` re-entry branch (`packages/concord/src/helpers/guestbook.ts:123-126`). After this phase's WIRE-02 fix, a presence beacon is exactly the kind of rumor that now reaches the store and can satisfy `lastMs > c.ms`, silently re-adding the member. No test in this phase (or the pre-existing suite) exercises this path in either direction.
   **Why human:** This is a genuine, code-confirmed side effect of achieving WIRE-02 as literally worded ("reaches consumers... instead of being silently dropped") — the roadmap's stated success criteria say nothing about membership-fold integrity, so it cannot be scored as a truth failure against this phase's contract, but it is a real regression that should be explicitly accepted or scheduled for a fix before shipping.

## Gaps Summary

No must-have truth failed. All six ROADMAP success criteria are code-verified and test-verified (tests were run directly by this verification, not taken from SUMMARY claims). The full concord suite (495/495), the full workspace suite (2370 passed/2 skipped), and the unfiltered build's pre-existing-only failure mode were all independently reproduced.

Two findings — both raised by the prior code review and independently re-confirmed here by direct code reading rather than inherited at face value — do not fail any stated success criterion but are real enough to warrant an explicit human decision before the phase is considered fully closed: stale published docs that would cause a reader to emit malformed wire events (criterion 3/4's "compliant client" framing), and a receive-funnel side effect that can resurrect a removed member's presence in the roster fold (a consequence of achieving criterion 2). Both are documented above with exact reproduction traces. Status is `human_needed` rather than `passed` because of these two items, not because any artifact, wiring, or test is missing.

A third code-review finding (WR-02: `editMessage` never gained a `k` tag) was independently checked against the ROADMAP's literal wording and found to be correctly out of scope — WIRE-03/04/05 name reactions, replies, and deletes, never edits — so it is not listed as a gap or human-verification item.

---

_Verified: 2026-07-29T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
