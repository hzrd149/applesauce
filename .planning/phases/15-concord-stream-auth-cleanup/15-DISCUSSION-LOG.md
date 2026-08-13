# Phase 15: Concord Stream-Auth Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-13
**Phase:** 15-concord-stream-auth-cleanup
**Areas discussed:** Scope boundary (user auth), Reconnect re-auth, Where scoped signers live, connected$/authenticated$, Duplicate AUTH dedupe

---

## Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Reconnect re-auth | Does CAUTH-02's reconnect clause fall out of authRetryOperator, or need a mechanism? | ✓ |
| Where scoped signers live | Engine-owned map vs scope-instantiated class vs plain Map | ✓ |
| connected$ / authenticated$ | What these mean once auth is lazy and demand-driven | ✓ |
| Duplicate AUTH dedupe | Concurrent operations each handling their own auth-required | ✓ |

**User's choice:** All four.

---

## Scope Boundary — Is user-key auth in scope?

| Option | Description | Selected |
|--------|-------------|----------|
| Stream keys only (recommended) | `autoAuthenticate` and the invite watcher's flag readers stay as-is; CAUTH-01/02/04 name stream keys only | |
| Both — migrate user auth too | Publishes already accept `onAuthRequired`; `autoAuthenticate` and invite-watcher's two flag readers die with the rest | ✓ |
| Discuss it | Treat as a fifth gray area | |

**User's choice:** Both — migrate user auth too.
**Notes:** Widens the phase beyond CAUTH-01..04's literal wording. Captured as a deliberate widening; REQUIREMENTS.md CAUTH-03 and ROADMAP Phase 15 criterion 3 need amending.

---

## Reconnect re-auth

Presented after tracing the pipe order: `authRetry` (innermost) → `customConnectionRetryOperator` → `customRepeatOperator` (`relay.ts:1053-1058`), with `consecutive` in `authRetry`'s `defer` closure (`auth-retry.ts:253`), so reconnect resubscription grants a fresh auth budget.

| Option | Description | Selected |
|--------|-------------|----------|
| Ride the operator (recommended) | No concord-side reconnect machinery; CAUTH-02's reconnect clause becomes a test assertion | ✓ |
| Operator + idle-scope catch-up | Also re-authenticate a scope with no live operation on reconnect | |
| Verify first, then decide | Have the researcher confirm empirically before locking the design on the trace | |

**User's choice:** Ride the operator.

### authRetries

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the default of 1 | Connection-level retry already gives a fresh budget per reconnect | ✓ |
| Raise it for stream operations | Closer to the old make-progress loop's persistence | |
| You decide | Claude's discretion | |

**User's choice:** Keep the default of 1.

### Auth failure now errors where it used to hang

| Option | Description | Selected |
|--------|-------------|----------|
| Surface on the scope's status | Catch at the engine boundary, keep the engine alive, expose as status | ✓ |
| Let it propagate | `syncAuthors` rejects, `openLive`'s subscription errors | |
| Log and swallow | Closest to today's `console.warn` behavior | |

**User's choice:** Surface on the scope's status.
**Notes:** Later refined by the `authenticated$` removal — the concrete destination became the existing `error$` rather than a new per-relay auth-state field (CONTEXT D-13).

### authTimeout

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the default (30_000ms) | Stream-key signing is local and instant; the budget is the relay's OK reply | ✓ |
| Shorten for stream keys | Fail faster on a stalling relay | |
| You decide | Claude's discretion | |

**User's choice:** Keep the default.

---

## Where scoped signers live

| Option | Description | Selected |
|--------|-------------|----------|
| New scope-owned holder (recommended) | Per community and per private channel; `ConcordRelayAuth` deleted outright | ✓ |
| `ConcordRelayAuth`, scope-instantiated | Keep the class and export name, gut the driver machinery inside it | |
| Plain Map on each engine | No abstraction; handler body written twice, as `ensureAuth` is today | |

**User's choice:** New scope-owned holder.

### Does the holder also hold the user's signer?

| Option | Description | Selected |
|--------|-------------|----------|
| One holder, branch on `missingPubkeys` (recommended) | `null` → user, list → stream keys; one handler serves reads and writes | |
| Separate user-auth handler | Keeps the local-instant `PrivateKeySigner` path apart from the possibly-prompting user signer | ✓ |
| Discuss the tradeoff | | |

**User's choice:** Separate user-auth handler. *(Against the stated recommendation.)*
**Notes:** Rationale carried into CONTEXT D-09 — different latency and different user-visible consequences.

### Which publish call sites get auth options?

| Option | Description | Selected |
|--------|-------------|----------|
| All 13 | Nothing publishes on the assumption something else already authenticated | ✓ |
| Only where load-bearing | Skip fire-and-forget paths already wrapped in `.catch(() => {})` | |
| You decide | Claude's discretion | |

**User's choice:** All 13.

### Scope of the user handler

| Option | Description | Selected |
|--------|-------------|----------|
| One client-wide user handler (recommended) | One user identity, so per-scope copies authenticate the same pubkey | ✓ |
| Per-engine | Uniform with the stream holder; costs duplicate AUTHs of the same user pubkey | |

**User's choice:** One client-wide user handler.

### Key accumulation within a scope

| Option | Description | Selected |
|--------|-------------|----------|
| Accumulate within the scope | Historical epoch re-walks still authenticate; invisible under the `missingPubkeys` filter | ✓ |
| Track current keys only | Tightest reading of "keys held by that scope"; risks a historical walk finding no signer | |
| You decide | Claude's discretion | |

**User's choice:** Accumulate within the scope.

---

## connected$ / authenticated$

First pass presented three options for redefining `authenticated$` (engine-owned demand-driven / status-derived but narrowed / drop it). The user paused the question to clarify.

**User's ruling (free text):** *"okay in this case we can probably safely remove the authenticated$ observable on the concord client. since auth is handled all from within the sync and live requests now there isn't a need for the client to see it. at least for the moment"*

**Notes:** Selected the option the first pass had ranked last. Removal is explicitly marked revisitable. Also removes the `authenticated` field from `ConcordCommunityStatus` and `ConcordPrivateChannelStatus`.

### Does an auth failure need to reach application state?

Re-framed after verifying that both concord paths already degrade gracefully — `RelayGroup.internalSubscription` catches per relay (`group.ts:177-183`), and `syncAuthors`' `events$` completes on per-relay error (`sync.ts:112`).

| Option | Description | Selected |
|--------|-------------|----------|
| No — debug logs only | Phase 14's `:auth` namespace already explains it | |
| Fold into the existing `error$` | UI can say why a community looks empty rather than showing a blank | ✓ |
| Only when every relay fails | Needs cross-relay outcome counting the engine does not keep today | |

**User's choice:** Fold into the existing `error$`.

### Where connected$ lives

| Option | Description | Selected |
|--------|-------------|----------|
| Inline on each engine | ~6 lines each; the `switchMap` over `extras.relays$` already lives there | ✓ |
| Small shared helper | Writes the `lookupStatus` normalization once | |
| You decide | Claude's discretion | |

**User's choice:** Inline on each engine.

---

## Duplicate AUTH dedupe

First pass framed this around a publish-loop "prompt storm" at `community.ts:1564-1565`. The user paused to ask which signers the auth requests would actually hit.

**User's question (free text):** *"tell me what signers these auth requests will hit? if its the intenral keys for the concord group then its probably [fine] since the private keys will always be in memory"*

**Investigation result — the first framing was wrong.** `operations/gift-wrap.ts:81-89` builds wraps with `finalizeEvent(…, streamSk)`: the `p` tag decoy is ephemeral but the *author* is the stream pubkey. So the looped publishes authenticate as in-memory stream keys, not the user's signer. Full audit found 11 of 13 publishes resolve from in-memory keys (stream `sk`, invite-link `sk`, NIP-59 ephemeral); only `invite-manager.ts:297` and `client.ts:1287` sign with the user's signer, and neither is in a loop.

### What does each publish wait for?

| Option | Description | Selected |
|--------|-------------|----------|
| `waitForAuth: [event.pubkey]` (recommended) | Each publish waits on its own author; matches what a gating relay checks on a write | |
| `waitForAuth: true`, handler picks the key | Tolerant of relays requiring only *some* auth; `missingPubkeys` is `null` in that mode | |
| Discuss it | | |

**User's choice (free text):** *"publishing should take the same reactive authentication approch that we did with subscribing and syncing."*
**Notes:** Confirms the first option, but stated as a principle rather than a per-site config — one uniform reactive pattern, no special-cased publish auth path. Captured as CONTEXT D-01/D-15/D-16.

### Dedupe

| Option | Description | Selected |
|--------|-------------|----------|
| No dedupe anywhere (recommended) | In-memory keys make a duplicate AUTH one signature and one frame | ✓ |
| Dedupe the 2 user-signer sites only | Covers the sites that can surface a bunker or extension dialog | |
| Cheap `isAuthenticated` re-check only | Trims the common repeat case; loses the simultaneous-check race | |

**User's choice:** No dedupe anywhere.
**Notes:** A deliberate reversal of what the refcounted driver existed for — that concern was priced against a whole-registry AUTH, not against one key.

---

## Claude's Discretion

- Naming and file placement of the scope-owned signer holder, and its API for registering keys as epochs advance and channels are revealed.
- Whether `connected$`'s `lookupStatus` normalization is duplicated per engine or extracted.
- Wording and granularity of the `error$` message written on auth failure.
- How the two user-signed publishes receive the client-wide user handler.

## Deferred Ideas

- A standing "am I authenticated" surface for UI — the demand-driven per-relay record (url → attempted/authenticated/rejected/reason) discussed and declined as premature, not wrong.
- Relay-side prompt/AUTH dedupe — declined at three levels (RAUTH-05, REQUIREMENTS.md Out of Scope, and CONTEXT D-18). Belongs in a downstream app's signer if it ever bites.
- Value-signalling the remaining `CLOSED` prefixes (blocked, rate-limited, invalid) — carried forward unchanged from 13- and 14-CONTEXT.md.

### Reviewed Todos (not folded)

- `05.1-review-followups.md` — matched at 0.6 on generic keywords ("phase", "pre", "status", "2026"); content is gift-wrap/seal helpers in `applesauce-common`, unrelated to relay auth. Same disposition as Phases 13 and 14. The user was told it was being declined and did not object.
