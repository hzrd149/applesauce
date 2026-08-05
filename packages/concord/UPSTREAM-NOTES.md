# Upstream Notes

Clarification requests filed against the [concord-protocol/concord](https://github.com/concord-protocol/concord) spec, discovered while bringing `applesauce-concord` into conformance (v1.1 first-fixes milestone). These are spec-text observations, not bug reports against this package — the fixes for the ambiguities below already shipped here under the reading recorded in each entry.

## CORD-04 §2 vs §3 — does a Grant's target-member rank binding apply to revoke/demote? (D-03)

**Status:** Open — request for upstream clarification. Not filed as a GitHub issue; recorded here per D-03 (mechanism left to executor's discretion).

**The ambiguity:**

- CORD-04 §2 states the Grant authorization rule specifically in terms of the roles being handed out: the actor must **outrank every Role it hands out**. Applied literally to a *revoke* (a Grant with an empty `role_ids`), this rule is vacuous — `[].every(...)` is trivially true regardless of the actor's rank relative to the Grant's target member. Read in isolation, §2 would let any `MANAGE_ROLES` holder revoke or demote a senior member's Grant, including the owner's.
- CORD-04 §3 states a general rule for authority actions: the actor must hold the action's required permission bit **AND strictly outrank its target**. §5's "Authorizing an Action" procedure restates this same rule as a numbered step ("Confirms the actor holds the action's required bit and strictly outranks its target, traced to the owner"), which reads as binding on every authority action — and a Grant is explicitly "an authority action" per §1's framing ("Every authority action is an edition on the Control Plane").
- The two readings diverge exactly where it matters: a Grant that revokes or demotes a senior member. Under the permissive §2-only reading, a junior `MANAGE_ROLES` holder can strip or demote every admin above them (owner excepted structurally by position 0, not by any explicit rule). Under the strict §3/§5 reading, that same revoke is rejected unless the actor also strictly outranks the target's current standing.

**The reading this codebase implements:** the strict reading. A non-self Grant folds only when the signer strictly outranks the target member's *current* standing, ANDed with (not replacing) the existing "outrank every role handed out" check from §2. Self-targeting Grants (a member revoking their own role, i.e. leaving) and Grants to a roleless (never-granted) target are exempt from the target-rank check, since there is no senior standing to violate in either case. See `packages/concord/src/helpers/control.ts`'s Grant fold and the AUTH-07 spec-derived tests in `packages/concord/src/helpers/__tests__/control.test.ts` for the shipped behavior.

**Request:** tighten the upstream spec text so §2 explicitly cross-references the §3/§5 target-rank constraint for the Grant case, removing the ambiguity for the revoke/demote path.

## CORD-05 §1 vs §4 — is `expires_at` unix ms or unix seconds? (D-05)

**Status:** Open — request for upstream clarification. Not filed as a GitHub issue; recorded here per the 2026-07-21 binding ruling (mechanism left to executor's discretion, mirroring D-03 above).

**The ambiguity:**

- CORD-05 §1's `CommunityInvite` struct comment literally annotates the bundle-level field: `expires_at, // optional, unix ms: past it, the preview still renders, joining refuses`. Read in isolation, this settles the unit as milliseconds.
- CORD-05 §4's Invite List (kind 13303) example gives `"expires_at": 1722400000` — a 10-digit value. As milliseconds this decodes to a moment in January 1970; as seconds it is a plausible 2024 date and matches the magnitude of the adjacent, unambiguously-seconds `created_at` field in the same example object. §4 never annotates the unit in prose — the magnitude is the only signal.
- This spec corpus does write full-magnitude ms examples elsewhere when a field is genuinely milliseconds: CORD-02 §8's Community List example uses `"added_at": 1719800000000, // ms` (13 digits, explicitly commented). §4's `expires_at` does not follow that convention.
- The two readings diverge by a factor of 1000 wherever `expires_at` is written or compared, which is a wire-format interop defect (not a local bug, since this codebase's write and read were previously both consistently-wrong in the same unit) — a conformant peer reading §4 literally as seconds would misinterpret a ms-encoded value by roughly three orders of magnitude.
- What's unclear: whether §1's "unix ms" annotation is a spec typo, or whether the bundle-level `expires_at` (§1, kind 33301) and the Invite-List-entry-level `expires_at` (§4, kind 13303) are intentionally distinct fields that happen to share a name — CORD-02 §8 separately warns that link fields ("expiry and attribution") never copy from the invite into Community List join material, which is consistent with the two `expires_at` occurrences having independent lifecycles even if this codebase currently unifies their representation.

**The reading this codebase implements:** unix SECONDS, end-to-end, at every `expires_at` site (`types.ts`, `helpers/invite-bundle.ts`, `client/invite-manager.ts`, `client/community.ts`, `client/client.ts`'s join-time check, `casts/direct-invite.ts`'s `expired()`) — governed by §4's magnitude reading, since §4 is the Invite List field this codebase's INVITE-04 requirement targets. See `packages/concord/src/helpers/__tests__/invite-bundle.test.ts`'s `expires_at` round-trip test for the shipped behavior and the inline dual-citation of both spec passages.

**Request:** disambiguate §1's "unix ms" annotation against §4's seconds-magnitude example — either correct §1's prose to "unix seconds" if the two `expires_at` occurrences are the same field, or explicitly state in both §1 and §4 that the bundle-level and Invite-List-entry-level `expires_at` fields are distinct and independently unitted.
