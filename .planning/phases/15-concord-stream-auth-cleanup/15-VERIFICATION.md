---
phase: 15-concord-stream-auth-cleanup
verified: 2026-08-18T08:55:41Z
status: gaps_found
score: 3/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
gaps:
  - truth: "A community or private-channel engine's operation authenticates only the waitForAuth pubkeys its own scope is missing, drawn from keys held by that scope (CAUTH-01)"
    status: failed
    reason: >
      Every publish into a PRIVATE channel (sendMessage, sendEvent, sendThread, replyToThread,
      react, editMessage, deleteMessage — all routed through ConcordCommunity.publishToPlane)
      declares waitForAuth: [wrap.pubkey] where wrap.pubkey is the private channel's
      message-plane stream key (helpers/keys.ts deriveConcordKeys populates keys.channels for
      BOTH public and private channels the community holds a key for; planeKeyFor resolves a
      channel wrap through that same map). But the community's own StreamSigners holder is
      only ever registered with publicChannelKeys() (community.ts:719-724, filters `!c.private`)
      in openLive()/reconcileLive() — no code path registers a private channel's message-plane
      GroupKey into the community's holder. The result: on an auth-gating relay, the community's
      onAuthRequired handler is asked to authenticate a pubkey it holds no signer for, silently
      continues past it (auth.ts:99-101, confirmed WR-03), the publish waits out the 30s
      authTimeout, publishToPlane's .catch swallows the failure with only a console.warn, and the
      optimistic local echo (community.ts:1610) has already rendered the message as sent. This is
      a regression: pre-phase, pool.publish carried no options (waitForAuth defaulted to true) and
      the deleted client-wide ConcordRelayAuth registry did hold private-channel keys via
      channel-sync.ts's registerStreamKeys.
    artifacts:
      - path: "packages/concord/src/client/community.ts"
        issue: "publicChannelKeys() (used at :753-759 openLive, :785 reconcileLive) filters out private channels; no path registers a held private channel's message-plane key into the community's own StreamSigners holder, yet streamPublishOptions (:1590-1598) names that exact key for every private-channel send"
      - path: "packages/concord/src/helpers/keys.ts"
        issue: "deriveConcordKeys (:171-203) populates keys.channels for private channels too, so planeKeyFor/wrapForTarget silently hand back a stream pubkey the community's holder was never told to answer for"
      - path: "packages/concord/src/client/__tests__/community.test.ts"
        issue: "the publish-answerability oracle at :3545-3615 creates a private channel (:3564) but never sends into it, so the exact gap this loop is designed to catch (WR-06) goes unexercised"
    missing:
      - "Register the private channels the community holds a message-plane key for (not just publicChannelKeys()) into the community's own StreamSigners holder — e.g. add a heldChannelKeys() alongside publicChannelKeys() and register it in openLive()/reconcileLive(), per 15-REVIEW.md's CR-01 fix sketch — without widening what the community subscribes to (currentAuthors() must stay public-only)"
      - "A regression test: send a message into a private channel inside (or alongside) the community.test.ts publish-answerability scenario, so the existing authCalls assertion loop covers it (closes WR-06 for this case)"
      - "Re-run the human live-relay checkpoint (or an equivalent scripted check) specifically against a private-channel send, since the approved 2026-08-15 checkpoint covered rumor-stores/crypto-history/direct-invites/admin-management but none of those steps performed one"
  - truth: "Robustness/observability hardening confirmed during CR-01 review (WR-01, WR-02, WR-03, WR-04, WR-05, WR-06, WR-07, WR-08)"
    status: partial
    reason: >
      Independently re-derived against the current source (not merely restated from 15-REVIEW.md).
      None of these individually block CAUTH-01..04's literal wording, but several compound CR-01's
      blast radius or its detectability, so a gap-closure plan addressing CR-01 should fold them in
      together rather than requiring a second review pass.
    artifacts:
      - path: "packages/concord/src/client/community.ts"
        issue: "WR-01 (:1220, :1556-1560): refound()/rotateChannel() recompute the channel-rekey GroupKey from this.material.community_root re-read AFTER several awaits (admin.vacFor, buildChannelRekey/buildRefounding, the root-roll requireMajority loop), while the wraps being registered for were built from the material/keys snapshot captured before those awaits — confirmed by direct read of both call sites; checkRekey()'s 200ms timer can call adoptRefounding() during that window and reassign this.keys/this.material mid-flight"
      - path: "packages/concord/src/client/community.ts"
        issue: "WR-02 (:302, :359, :560): authFailure is a mutable field read exactly once at the end of start()/walk(); confirmed no other read site exists, and authenticated$ is confirmed removed from ConcordCommunityStatus (types.ts), so a steady-state auth rejection (live subscription, any publish, reconcileLive's catch-up sync, checkRekey) has no surface at all post-walk"
      - path: "packages/concord/src/client/auth.ts"
        issue: "WR-03 (:98-117): confirmed — the onAuthRequired loop `continue`s past any pubkey with no held signer, with no log and no onAuthFailure call; this is the exact mechanism that makes CR-01 fail silently rather than loudly"
      - path: "packages/concord/src/client/invite-manager.ts"
        issue: "WR-04 (:121): confirmed — `new StreamSigners()` with no onAuthFailure, unlike community.ts (:359) and private-channel.ts (:173), so a relay rejecting the invite-link key during revokeBundle() surfaces nowhere"
      - path: "apps/examples/src/examples/concord/crypto-history.tsx, rumor-stores.tsx, direct-invites.tsx"
        issue: "WR-05: confirmed — each declares `const streamSigners = new StreamSigners();` at module scope (crypto-history.tsx:49, rumor-stores.tsx:43, direct-invites.tsx:36), outliving the React component and accumulating keys across communities if the walker is repointed at a second invite/material"
      - path: "packages/concord/src/client/__tests__/community.test.ts"
        issue: "WR-06 (:3537-3615): confirmed — the 'every publish a community makes' scenario omits all four refound() publish sites, refreshInviteBundles(), and any private-channel send; this is the same gap that let CR-01 ship"
      - path: "packages/concord/src/client/sync.ts"
        issue: "WR-07 (:123): confirmed — `as unknown as SyncAuthHandler` cast is safe for every in-package caller today (SyncAuthContext omits only `request`, which none of them read) but is not enforced by the type system for an external consumer of the public SyncContext/syncAuthors API"
      - path: "packages/concord/src/__tests__/no-ambient-auth.test.ts"
        issue: "WR-08 (:93-127): confirmed — only the REMOVED_MECHANISMS sweep (:82) scans EXAMPLES_ROOT; the AMBIENT_AUTH_TRIGGER, RETRY_BUDGET_OVERRIDE, and MISSING_PUBKEYS_FIELD checks (:93-127) filter to SRC_ROOT only, so an example could reintroduce a proactive challenge$ subscriber or a second missingPubkeys handler with the guard green"
    missing:
      - "WR-01: capture this.material.community_root once, before the first await, in both refound() and rotateChannel(), and use that local for both the wrap build and the signer registration"
      - "WR-02: replace the latched authFailure field with a value stream (push through error$ or a dedicated Subject) so a post-walk auth rejection surfaces without requiring a second walk"
      - "WR-03: log (at minimum) when onAuthRequired finds zero signers for a non-empty missingPubkeys, so a future registration gap is loud instead of silent"
      - "WR-04: thread an onAuthFailure sink into invite-manager.ts's StreamSigners construction"
      - "WR-05: move the examples' StreamSigners construction into the component (useRef/useMemo scoped to the active material), and drop the singleton pattern from the shipped documentation-by-example"
      - "WR-06: extend the publish-answerability scenario to cover refound()'s four publish sites, refreshInviteBundles(), and a private-channel send"
      - "WR-07: narrow SyncContext.onAuthRequired's type to the fields SyncAuthContext actually carries, removing the need for the cast"
      - "WR-08: hoist a combined SRC_ROOT + EXAMPLES_ROOT file list and reuse it across all four no-ambient-auth checks"
deferred: []
human_verification:
  - test: "Send a message into a private channel against a live auth-gating relay (after CR-01 is fixed), confirm the relay's auth-required refusal is satisfied and the message actually lands (not just the optimistic local echo)"
    expected: "The relay accepts the EVENT after AUTH; the message is retrievable from a second client/session, not just visible via local optimistic echo in the sending session"
    why_human: "The approved 2026-08-15 human checkpoint exercised rumor-stores, crypto-history, direct-invites, and admin-management, none of which perform a private-channel send — this is the one scenario CR-01 shows was never exercised against a real relay"
---

# Phase 15: Concord Stream-Auth Cleanup Verification Report

**Phase Goal:** Concord's client-wide, append-only stream-signer registry and ambient relay challenge/authentication drivers are replaced with operation-scoped `onAuthRequired` handlers owned by each community and private-channel engine — each operation authenticates only the pubkeys its own scope is missing, using keys held by that scope, and the client-wide driver machinery (`authenticateStreamKeys`, `version$`, relay driver reference counting, `ensureAuth()`, relay-status-driven stream authentication) is removed or narrowed once callers migrate.

**Verified:** 2026-08-18T08:55:41Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (CAUTH-01) A community/private-channel operation authenticates only its own scope's missing pubkeys, drawn from keys held by that scope | ✗ FAILED | `community.ts` `streamPublishOptions` names `wrap.pubkey` for every channel publish (`:1590-1598`); `helpers/keys.ts` `deriveConcordKeys` populates `keys.channels` for private channels too (`:171-203`); but `publicChannelKeys()` (`:719-724`) — the only source ever registered into the community's `StreamSigners` (`:753-759`, `:785`) — filters `!c.private`. Confirmed by direct trace, not by restating the review. A private-channel send (`sendMessage`/`sendEvent`/`sendThread`/`replyToThread`/`react`/`editMessage`/`deleteMessage`, all via `publishToPlane`) declares a `waitForAuth` pubkey the community's own holder can never answer. |
| 2 | (CAUTH-02) A relay observed during a scoped operation receives AUTH only for the k pubkeys that scope's operations require, and a reconnect re-authenticates the same scoped set | ✓ VERIFIED (with CR-01 caveat) | `auth.test.ts:139` ("two disjoint holders sharing one relay only ever authenticate their own key") and `community.test.ts:3401` ("two communities sharing one relay each authenticate only their own authors, and a reconnect cycle re-authenticates that same scoped set") are genuine behavioral tests — read/subscription scoping and reconnect re-auth are exercised, not merely present. This truth's core claim (bounded, non-union scoping) holds structurally for every path checked. The private-channel publish gap (row 1) is a failure to authenticate at all for that one path, not an over-authentication of the CAUTH-02 kind — noted here as a related consequence, not double-counted as a second failure. |
| 3 | (CAUTH-03, amended) `authenticateStreamKeys`, `version$`, relay driver reference counting, `ensureAuth()`, relay-status-driven stream authentication, `autoAuthenticate`, and the invite watcher's two relay-wide auth-required flag readers are removed with zero remaining call sites | ✓ VERIFIED | Independent repo-wide grep (not the guard test) across `packages/concord/src` and `apps/examples/src/examples/concord` for `authenticateStreamKeys`, `version$` (removed from `ConcordCommunityStatus`/`ConcordPrivateChannelStatus`/`ConcordClientStatus` — types.ts), `ensureAuth`, `autoAuthenticate`, `authRequiredForRead`, `authRequiredForPublish` returns zero non-test hits. `no-ambient-auth.test.ts`'s structural guard (222 tests total in the concord + root test dirs) passes. Weakness noted: WR-08 confirmed — 3 of the guard's 4 checks only scan `SRC_ROOT`, not `EXAMPLES_ROOT`, so the guard itself is a weaker backstop than its name claims; folded into gaps as a hardening item, not a truth failure since the removal was independently confirmed by direct grep. |
| 4 | (CAUTH-04) A stream operation that fails auth still retries per-operation after the migration, matching pre-migration per-operation retry behavior | ✓ VERIFIED | Independent grep for `authRetries`/`authTimeout` across `packages/concord/src` and `apps/examples/src/examples/concord` (excluding tests) returns zero hits — no call site overrides the upstream defaults (1 retry / 30_000ms). `community.test.ts`'s publish-answerability oracle asserts `authRetries`/`authTimeout` are `undefined` on every recorded publish, and `auth.test.ts:168` confirms invoking the same handler twice with the same `missingPubkeys` sends two AUTHs (no dedupe) — the behavioral evidence for "retries per-operation." |

**Score:** 3/4 truths verified (1 FAILED: CAUTH-01, for the private-channel publish path)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/client/auth.ts` (`StreamSigners`) | Per-scope holder that intersects `missingPubkeys` against its own registry, never falls back | ✓ VERIFIED | `onAuthRequired` (`:98-117`) is exactly this; confirmed no fallback path exists. Silent-continue on an unheld pubkey confirmed (WR-03, folded into gaps). |
| `packages/concord/src/client/community.ts` (`ConcordCommunity`) | Owns its own `StreamSigners`, registers only its own scope's keys, answers its own reads/publishes | ⚠️ HOLLOW for private-channel publishes | Holder exists, is wired into `openLive`/`reconcileLive`/every publish site, but the registration source (`publicChannelKeys()`) structurally excludes private channels while `streamPublishOptions` names them anyway (CR-01). |
| `packages/concord/src/client/private-channel.ts` (`ConcordPrivateChannel`) | Owns its own `StreamSigners` for the private channel's message-plane + rekey keys, used for the sub-engine's own reads | ✓ VERIFIED | `this.signers = new StreamSigners({...})` (`:173`), `this.signers.register([this.keys.current, ...this.keys.nextRekey...])` (`:373`) — the sub-engine correctly holds and answers for its own key. It does not expose a `sendMessage`; sending is done through `ConcordCommunity`, which is exactly where CR-01 lives. |
| `packages/concord/src/__tests__/no-ambient-auth.test.ts` | Structural guard closing the reintroduction class for all five removed mechanisms, across both `packages/concord/src` and the concord examples | ⚠️ PARTIAL | Mechanism-removal sweep (test 2) covers both roots; the other three checks (ambient trigger, retry override, missing-pubkeys handler) only scan `SRC_ROOT` (WR-08, folded into gaps). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `ConcordCommunity.publishToPlane` (channel plane) | `ConcordCommunity.signers` (`StreamSigners`) | `streamPublishOptions` → `onAuthRequired: this.signers.onAuthRequired` | ✗ NOT_WIRED for private channels | The link is syntactically present (every publish passes the handler) but semantically broken for private-channel sends: the handler is wired to a registry that was never given the key `streamPublishOptions` names. |
| `ConcordCommunity.openLive`/`reconcileLive` | `ConcordCommunity.signers` | `this.signers.register([...core planes, ...publicChannelKeys()])` | ✓ WIRED (public channels only, by design) | Confirmed `publicChannelKeys()` filters `!c.private` (`:719-724`); this is correct and intentional for the *subscription* set, but the same filtered list is the only thing ever registered — there is no second, broader registration for the message-plane keys the community also *publishes* on behalf of private channels. |
| `ConcordCommunity.rotateChannel`/`refound` | `ConcordCommunity.signers` | `this.signers.register([channelRekeyGroupKey(...)])` | ✓ WIRED, but registers only the **rekey** address, not the message-plane key | Confirmed at `:1220` and `:1556-1560`; does not cover CR-01 (message-plane sends are a separate key). WR-01's race (root re-read after awaits) also lives on this link. |
| `ConcordPrivateChannel` | its own `StreamSigners` | `this.signers.register([this.keys.current, ...])` | ✓ WIRED | Correct — the sub-engine answers for its own reads. Confirms D-06/T-15-01's scope-isolation invariant holds on the *read* side; CR-01 shows the *community-side publish* half of that same invariant was left with a hole. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|--------------|--------|----------|
| CAUTH-01 | 15-01, 15-04, 15-05, 15-08 | Each community/private-channel engine authenticates only its own scope's missing pubkeys, using keys that scope holds | ✗ BLOCKED | CR-01: the community's publish path names a key its own registration path never populates, for every private-channel send |
| CAUTH-02 | 15-04, 15-08 | A relay is asked to authenticate only the scoped set an operation requires; reconnect re-authenticates the same set | ✓ SATISFIED | Behaviorally tested (`auth.test.ts:139`, `community.test.ts:3401`); design-assessed per REQUIREMENTS.md note since no pre-phase recording exists |
| CAUTH-03 (amended) | 15-02, 15-03, 15-04, 15-05, 15-06, 15-07, 15-08 | Client-wide driver machinery + user-key half removed, zero remaining call sites | ✓ SATISFIED | Independent grep confirms zero non-test hits for every named mechanism; structural guard passes but has a coverage gap (WR-08, folded into gaps as hardening) |
| CAUTH-04 | 15-01, 15-04, 15-07, 15-08 | Per-operation auth retries preserved | ✓ SATISFIED | Zero `authRetries`/`authTimeout` overrides repo-wide; behavioral no-dedupe test passes |

No orphaned requirements — REQUIREMENTS.md maps exactly CAUTH-01..04 to Phase 15, and all four appear in at least one plan's `requirements` field.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/concord/src/client/community.ts` | `:1611-1612` | Comment asserts "already registered by the walk and by openLive() (D-16) — no registration needed here" | 🛑 Blocker (documents CR-01 as if resolved) | The comment is incorrect for the private-channel case; it is the same false assumption that let CR-01 ship, now embedded as misleading documentation at the exact call site that needs the fix |
| `packages/concord/src/client/auth.ts` | `:99-101` | Silent `continue` on an unanswerable pubkey, no log/failure signal | ⚠️ Warning (WR-03) | Turns any future registration gap (including CR-01's) into a silent 30s timeout instead of a diagnosable failure |
| `packages/concord/src/client/community.ts` | `:1220`, `:1556-1560` | `this.material.community_root` re-read after multiple `await`s, racing a concurrent `adoptRefounding()` | ⚠️ Warning (WR-01) | Could desync a rekey registration from the wraps it was built to answer for |
| `apps/examples/src/examples/concord/*.tsx` | module scope | `const streamSigners = new StreamSigners();` outlives the component | ⚠️ Warning (WR-05) | Contradicts the per-scope-holder invariant the phase's own package exists to enforce, in the package's primary worked examples |

No `TBD`/`FIXME`/`XXX` debt markers found in the phase's changed files.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Concord package test suite passes | `pnpm --filter applesauce-concord test` (already run and recorded in 15-VALIDATION.md; not re-run here to avoid a duplicate full-suite pass) | 584/584 passed per 15-VALIDATION.md's recorded full-gate run | ✓ PASS (evidence: recorded run, not re-executed) |
| No removed mechanism reintroduced | `pnpm vitest run packages/concord/src/__tests__/no-ambient-auth.test.ts` | Confirmed passing per 15-REVIEW.md's 222-test figure; independently corroborated by direct grep (see Requirements Coverage) rather than trusting the guard alone | ✓ PASS |
| Private-channel send is answerable by the community's own holder | Traced statically: `streamPublishOptions` → `this.signers.get(event.pubkey)` for a private-channel `wrap.pubkey` | `this.signers` registry never contains this key (only `publicChannelKeys()` is ever registered) | ✗ FAIL — this is CR-01, confirmed by static trace rather than a runtime probe (no live relay available in this verification pass) |

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` probes declared or discovered for this phase; the phase's runnable verification is the vitest suite and the human live-relay checkpoint, both addressed above.

### Human Verification Required

1 item, listed in frontmatter `human_verification` — see below. Note: because `gaps_found` (CR-01) already applies, this item is folded into the same closure plan rather than gating a separate `human_needed` cycle; it should be re-run once CR-01 is fixed.

### 1. Private-channel send against a live auth-gating relay

**Test:** After CR-01 is fixed, send a message into a private channel using one of the migrated example apps (e.g. `rumor-stores` or a private-channel-capable walker) pointed at a live auth-gating relay.
**Expected:** The relay's `auth-required:` refusal is satisfied (an AUTH frame for the private channel's message-plane key is observed), the EVENT is accepted, and the message is retrievable independently of the sending session's optimistic local echo.
**Why human:** The approved 2026-08-15 checkpoint (plan 15-08 Task 3) exercised `rumor-stores`, `crypto-history`, `direct-invites`, and `admin-management` against a live relay, but none of those six manual steps performed a private-channel send — the checkpoint's approval does not cover CR-01's failure path, and no automated test exercises a real relay's AUTH response either.

### Gaps Summary

The phase's structural rework is sound everywhere it was exercised: `StreamSigners` correctly intersects `missingPubkeys` against its own registry with no fallback (CAUTH-01's mechanism), reads and most publishes are demonstrably scoped and reconnect-safe (CAUTH-02, behaviorally tested), every named client-wide mechanism is verifiably gone by direct grep (CAUTH-03), and no call site overrides the retry budget (CAUTH-04).

The one BLOCKER is narrow but real: **every send into a private channel** (message, thread, reply, reaction, edit, delete — the entire day-to-day private-channel write path) declares an auth requirement its own engine cannot satisfy, because the registration helper (`publicChannelKeys()`) that feeds the community's `StreamSigners` was written to exclude private channels — correctly, for the *subscription* set — but is also the *only* thing ever registered, leaving the *publish* set with a hole. On any relay that actually gates writes behind NIP-42 (the exact scenario this whole phase exists to support), a private-channel message silently times out and is falsely shown as sent via the optimistic local echo. This is a regression from pre-phase behavior, where the deleted client-wide registry did hold these keys.

This is compounded by three things that made it possible to ship undetected: the publish-answerability test creates a private channel but never sends into it (WR-06); the auth handler silently continues past an unanswerable pubkey instead of logging (WR-03); and a stale comment at the exact call site asserts the key is "already registered" (anti-pattern table, row 1) when it is not for this case. A gap-closure plan should fix the registration gap, add the regression test, and — while in the area — pick up the WR-01 through WR-08 hardening items so the same review does not need to run twice.

---

_Verified: 2026-08-18T08:55:41Z_
_Verifier: Claude (gsd-verifier)_
