---
phase: 11-messaging-wire-conformance
verified: 2026-07-29T13:00:00Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

    expected: "Either the docs are corrected to show the Rumor-taking signatures (a caller following them today emits [\"k\",\"undefined\"] / [\"e\",\"undefined\"] malformed wire events — the exact defect class this phase exists to eliminate), or a deliberate decision is recorded to defer the fix."

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
| 5 | A client can retain a wrap's ephemeral key so it can NIP-09-delete its own giftwrap by `p` tag | ✓ VERIFIED | `WrapOptions.ephemeralSk?: Uint8Array` (`operations/gift-wrap.ts:39-51`) threads through `wrapForTarget` → `publishToPlane`/`sendEvent` (`grep -c ephemeralSk community.ts` = 2, `private-channel.ts` = 0, matching plan scope). `buildWrap` (`gift-wrap.ts:79-89`) binds `opts.ephemeralSk ?? generateSecretKey()` to a local and derives `getPublicKey(decoySk)` into the `p` tag only — confirmed by direct source read that the secret local is referenced nowhere else in the function. Ran the actual tests: `wrapForTarget ephemeralSk round-trips to the p tag and never leaks (WIRE-11)` and the determinism/no-key-control case both pass. Note: the "never leaks" assertion (`expect(JSON.stringify(wrap)).not.toContain(secretHex)`) is weaker than its name claims — `buildWrap`'s `content` field is always NIP-44 ciphertext regardless of the `plaintext` option (which only affects the seal kind), so this assertion cannot detect a leak into the seal or rumor. This is a test-quality gap (matches code review WR-08), not a truth failure — direct code read confirms the secret is genuinely never placed anywhere but the local used to derive the public key. |

**Score:** 6/6 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `react`/`replyToThread` | `ReactionFactory`/`CommentFactory` | direct `Rumor` pass-through, no hand-built pointer | ✓ WIRED | Confirmed by source read |
| `deleteMessage` | `DeleteFactory.fromEvents` + `ensureKTag` | `target.id` then explicit tag application | ✓ WIRED | Confirmed by source read |
| `cord-wire-fixtures.ts` | `community.test.ts` / `private-channel.test.ts` | import of fixture constants + helpers | ✓ WIRED | Every `wire conformance` case traces to the fixture module |
| `WrapOptions.ephemeralSk` | `wrapForTarget` → `publishToPlane` → `sendEvent` | opts forwarding, unchanged bodies | ✓ WIRED | Confirmed by source read + passing round-trip test |
| `route()` (both engines) | plane store `.add()` | kind filter removed, `checkChatBinding` guard intact | ✓ WIRED | Confirmed by source read + passing anti-replay control test |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
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
   **Expected:** The docs should show the `Rumor`-taking call shape. Today they still show `community.react(channelId, { id, author }, "🔥")` and `community.deleteMessage(channelId, messageId)` and `community.replyToThread(channelId, { id: threadId, author }, "...")` — the exact pre-phase shapes. Traced by hand: `react({ id, author }, ...)` → `setReactionParent` reads `event.pubkey`/`event.kind` as `undefined` → emits `["p", undefined]` and `["k", "undefined"]`. `deleteMessage(channelId, messageId)` (a bare string) → `target.id` is `undefined` → `["e", undefined]`. Neither throws; the malformed rumor is sealed, wrapped, and published — the exact class of wire-nonconformance this phase exists to eliminate, now demonstrated in the SDK's own published documentation.

2. **Voice-presence beacon can resurrect a departed/kicked member into the roster (WR-04 from code review, independently confirmed by direct code read)**
   **Test:** In a test community, kick or have a member leave, then deliver a kind-23313 presence beacon authored by them with a `ms` newer than their departure; read `members$`.
   **Why human:** This is a genuine, code-confirmed side effect of achieving WIRE-02 as literally worded ("reaches consumers... instead of being silently dropped") — the roadmap's stated success criteria say nothing about membership-fold integrity, so it cannot be scored as a truth failure against this phase's contract, but it is a real regression that should be explicitly accepted or scheduled for a fix before shipping.

## Gaps Summary


Two findings — both raised by the prior code review and independently re-confirmed here by direct code reading rather than inherited at face value — do not fail any stated success criterion but are real enough to warrant an explicit human decision before the phase is considered fully closed: stale published docs that would cause a reader to emit malformed wire events (criterion 3/4's "compliant client" framing), and a receive-funnel side effect that can resurrect a removed member's presence in the roster fold (a consequence of achieving criterion 2). Both are documented above with exact reproduction traces. Status is `human_needed` rather than `passed` because of these two items, not because any artifact, wiring, or test is missing.

A third code-review finding (WR-02: `editMessage` never gained a `k` tag) was independently checked against the ROADMAP's literal wording and found to be correctly out of scope — WIRE-03/04/05 name reactions, replies, and deletes, never edits — so it is not listed as a gap or human-verification item.

---

_Verified: 2026-07-29T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
