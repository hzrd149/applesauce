# Phase 9: Authority & Permission Fold Correctness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-19
**Phase:** 9-Authority & Permission Fold Correctness
**Areas discussed:** AUTH-07 ruling, AUTH-08 ruling, AUTH-04 malformed-grant handling, AUTH-03/05/06 (coordinate + local-reject + position) — plus a pulled-in banlist rider

---

## AUTH-07 — does §3's "strictly outrank its target" bind a Grant's target member?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict + note upstream | Yes, §3 binds the target member; add the rank check + fix this phase, AND file an upstream clarification note on §2/§3 wording | ✓ |
| Strict, no upstream note | Yes, fix this phase; treat §3 as unambiguous and skip the upstream note | |
| Permissive — no change | §2 fully specifies the Grant rule; close AUTH-07 as "no change needed" | |

**User's choice:** Strict + note upstream.
**Notes:** Ruling taken against the upstream CORD-04 text. §3 ("the actor must hold the required bit and strictly outrank its target — equal cannot act on equal") is the general rule; a revoke/demote acts on a member, so the target is bound. The permissive reading is the junior-strips-senior escalation. `[].every()` being vacuously true is the tell.

### AUTH-07 scope (follow-up)

| Option | Description | Selected |
|--------|-------------|----------|
| Gate all non-self Grants | Actor must outrank the target's current standing for ANY non-self Grant; cleaner, subsumes revoke+demote, no before/after diff | ✓ |
| Gate only lowering Grants | Only gate revoke/net-demote; under-enforces §3, needs a standing diff | |

**User's choice:** Gate all non-self Grants.
**Notes:** Self (`target === actor`) exempt; owner short-circuits; roleless targets are `0xffffffff` so promotions/initial grants pass.

---

## AUTH-08 — is `vac` required for non-owner Kicks and validated against the cited Grant?

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror Phase-8 vacVerifier (D-12) | Owner exempt; non-owner requires vac; vac[0] === grantLocator(cid, actor); current roster grants PERM.KICK; pure over folded state; keep rank-vs-victim check | ✓ |
| Mirror D-12 + upstream note | Same, plus a note that §5's literal version/hash pinning is met in outcome-not-mechanism | |
| Full §5 pinning + sync floor | Validate vac version+hash against the synced Grant and defer until synced; diverges from D-12, adds store lookup + statefulness | |

**User's choice:** Mirror Phase-8 vacVerifier (D-12).
**Notes:** CORD-04 §5 is explicit (non-owner requires vac, owner omits, resolve against current roster, demoted actor dropped) — the "blocked" tag was over-conservative. Current-roster resolution achieves §5's outcome without the version/hash re-fetch and sync floor Phase 8 (D-12) deliberately avoided.

---

## AUTH-04 — malformed Grant handling

| Option | Description | Selected |
|--------|-------------|----------|
| Array + string-entry check | Skip candidate unless role_ids is an array AND every entry is a string; defense-in-depth, explicit | ✓ |
| Array-only check | Skip unless Array.isArray(role_ids); minimal fix for the TypeError | |

**User's choice:** Array + string-entry check.
**Notes:** Skip-candidate (not drop-entity), matching the JSON.parse catch. Empty `role_ids` stays a valid revoke, not malformed. Only a non-array `role_ids` actually throws; non-string entries were flagged for explicit fail-closed handling.

---

## AUTH-03 / AUTH-05 / AUTH-06 (+ banlist rider)

**AUTH-03** treated as a locked mechanical fix (fold a Grant only at `grantLocator(cid, grant.member)`, mirroring the banlist coordinate fold) — no option needed.

### AUTH-05 — local reject for kick()/ban()

| Option | Description | Selected |
|--------|-------------|----------|
| Throw-and-abort | Local canDo(bit, target.position) check + throw before publishing, mirroring rotateChannel/refound | ✓ |
| Return / no-op silently | Check locally and quietly skip the publish | |

**User's choice:** Throw-and-abort.

### Banlist read-path rank gap (surfaced mid-trace)

| Option | Description | Selected |
|--------|-------------|----------|
| Defer / note as observation | Record as deferred idea; outside the enumerated AUTH-03..08 set | |
| Pull into Phase 9 | Add per-target rank enforcement + owner-exemption to the read-path banlist fold this phase | ✓ |

**User's choice:** Pull into Phase 9.
**Notes:** The banlist fold checks only the author's BAN bit and `members.delete(banned)` has no owner exemption, so a junior BAN-holder can drop the owner. Same "junior acts on senior" shape as AUTH-07. Deliberate scope addition; must be recorded as a new finding (D-14) and carries its own spec-derived test.

### AUTH-06 — Role.position validation

| Option | Description | Selected |
|--------|-------------|----------|
| Positive integer | `Number.isInteger(position) && position > 0` | |
| Positive int, below sentinel | Also require `position < 0xffffffff` to avoid colliding with the roleless sentinel | ✓ |

**User's choice:** Positive int, below sentinel.

---

## Claude's Discretion

- Upstream-note mechanism for AUTH-07 (GH issue vs. in-repo note + changeset citation).
- How the `verifyVac` predicate is threaded into `foldMembers` (inline vs. injected), keeping the fold pure over folded state.
- Error-message wording for the AUTH-05 throws and any fold-time skip logging.
- Plan/commit sequencing, within the constraint that each behavioral fix lands with its spec-derived test.

## Deferred Ideas

- Full CORD-04 §5 `vac` pinning (version + content hash) + sync-floor deferral — deliberately not implemented (consistent with Phase 8 D-12); reconsider milestone-wide only if current-roster resolution proves insufficient.
- Reviewed-not-folded todo: `05.1-review-followups.md` (cache/gift-wrap/symbol follow-ups) — unrelated to authority folds; belongs to milestone/backlog review (note the security-relevant CR-01 gift-wrap seal-verify bypass).
