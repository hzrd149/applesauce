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
