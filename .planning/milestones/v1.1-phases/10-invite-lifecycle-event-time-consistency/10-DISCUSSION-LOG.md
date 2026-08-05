# Phase 10: Invite Lifecycle & Event Time Consistency - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-20
**Phase:** 10-Invite Lifecycle & Event Time Consistency
**Areas discussed:** Revocation + vsk fail-closed, Single-clock-read scope, Canonical valid-ms, expires_at unit + join check

---

## Area selection

| Area | Discussed |
|------|-----------|
| Revocation + vsk fail-closed (INVITE-01/H05) | ✓ |
| Single-clock-read scope (TIME-01/H04) | ✓ |
| Canonical 'valid ms' (TIME-03/M11) | ✓ |
| expires_at unit + join check (INVITE-04/M09) | ✓ |
| INVITE-02 array guards / INVITE-03 skip-and-continue / INVITE-05 reject-unknown-version / TIME-02 one-timestamp-per-snapshot | Not discussed — locked as mechanical from audit + fail-closed discipline |

User selected all four open decisions.

---

## Revocation + vsk fail-closed (INVITE-01 / H05)

| Option | Description | Selected |
|--------|-------------|----------|
| Deny on malformed only | Keep §1 "absent = live"; a non-numeric/NaN vsk is treated as revoked/unjoinable (closes the `Number('junk')→NaN→live` hole). | ✓ |
| Deny unless explicit vsk 6 | Join gate accepts only explicit live vsk 6; missing/NaN/9/unknown → refuse (fail-closed on absence too). | |

**User's choice:** Deny on malformed only.
**Notes:** Preserves CORD-05 §1's convention that an omitted vsk on a legit bundle stays joinable, while closing the actual audit hole (malformed vsk slipping through as not-revoked). Coordinate resolution (newest-at-`(33301,link_signer,"")`, ties→lowest id, then tombstone check, `#d:[""]` filter) captured as D-01/02/03 — `store.replaceable` is the pattern, replicated over the raw pre-join relay union.

---

## Single-clock-read scope (TIME-01 / H04)

| Option | Description | Selected |
|--------|-------------|----------|
| Full single-read thread | One `splitTime(Date.now())` per event feeds both `created_at` and the `ms` tag — closes round-vs-floor skew AND the includeMs/wrapForTarget double-read straddle. | ✓ |
| Decomposition only | Replace round with floor for coherence; leave the two clock reads separate; log the straddle as follow-up. | |

**User's choice:** Full single-read thread.
**Notes:** Meets success criterion 4 ("a single clock read via splitTime()") literally, not just the +1000ms symptom. Double-read straddle worsens under NIP-46 remote signers, so it matters for real bunker users. Same mechanism threads one pair to all snapshot chunks (TIME-02/D-08).

---

## Canonical 'valid ms' (TIME-03 / M11)

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical decimal | One shared predicate: valid iff `String(n) === tag`, integer 0..999 — rejects '42abc','0x10','007',whitespace. Both rumorMs and hasMalformedMs consume it. | ✓ |
| Number-based lenient | Valid iff `Number(tag)` is an integer 0..999 (accepts '007'→7, '0x10'→16); shared but tolerates non-canonical forms. | |

**User's choice:** Canonical decimal.
**Notes:** Makes ordering (`rumorMs`) and the fold-drop decision (`hasMalformedMs`) agree by construction rather than coincidence. Stricter than either current parser; rejects encodings honest clients never emit.

---

## expires_at unit + join check (INVITE-04 / M09)

| Option | Description | Selected |
|--------|-------------|----------|
| Seconds end-to-end | Write expires_at in unix seconds everywhere; change client.ts:454 to a seconds comparison atomically. | ✓ |
| Convert at wire only | Keep ms internally + Date.now() comparison, convert to seconds only when writing the Invite List event. | |

**User's choice:** Seconds end-to-end.
**Notes:** Ruling taken by reading CORD-05 §4 this session — example `1722400000` is seconds by magnitude (§4 never annotates the unit). No back-compat cost (concord unreleased). "Convert at wire only" was rejected because it preserves exactly the seconds/ms boundary this milestone is eliminating.

---

## Claude's Discretion

- Exact single-clock-read plumbing mechanism (shared choke point vs. per-factory threading), provided the zero-skew invariant holds.
- Shape of the shared `ms` parser (`number | null` vs. discriminated result vs. guard+parse), provided both consumers route through it.
- Error-message wording for join refusals (malformed vsk, expired, unknown fragment version) and refresh skip logging.
- Plan/commit sequencing, within the constraint that each behavioral fix lands with its spec-derived test (D-13).

## Deferred Ideas

None outside the phase boundary — no scope creep raised.

**Reviewed, not folded:** `05.1-review-followups.md` (cache/gift-wrap/symbol follow-ups; keyword-matched on `phase`, content unrelated to invites/time — same call Phase 9 made).
