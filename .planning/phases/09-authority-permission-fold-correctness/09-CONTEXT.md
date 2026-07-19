# Phase 9: Authority & Permission Fold Correctness - Context

**Gathered:** 2026-07-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Grant, Kick, Ban, and Role folds enforce the CORD-04 rank comparisons and reject malformed input **locally**, instead of defaulting to permit or throwing out of `foldControl` and failing every member's community state. Fail-closed everywhere; rank semantics are inherited from the Phase 6/8 primitives (`canActOn`/`canDo`/`standingOf`/`vacVerifier`), never reinvented.

**Requirements:** AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, plus TEST-01 (standing). **Plus one pulled-in rider** (read-path banlist rank + owner exemption — see D-14).

**Two spec-ruling-blocked requirements were resolved as this phase's first task** (both rulings taken against the upstream CORD-04 text, per the standing "check the spec, not just the audit paraphrase" direction):
- **AUTH-07 (S01) — RESOLVED "strict":** CORD-04 §3's "the actor must hold the required bit **and** *strictly* outrank its target — equal cannot act on equal (an admin cannot ban a peer admin)" is the general authority rule and **binds a Grant's target member**, not only the roles handed out. §2's "outrank every Role it hands out" is an *additional* constraint, vacuous for a revoke (empty `role_ids`). The permissive reading is the real junior-strips-senior privilege-escalation path. Fix lands this phase; an upstream clarification note is filed alongside it (§2/§3 wording let it be read two ways).
- **AUTH-08 (S02) — RESOLVED "required + validated":** CORD-04 §5 is explicit — non-owner actions **require** `vac`, the owner omits it, and the verifier resolves the actor's rank against its *current* refuse-downgrade roster (so a superseded/demoted actor is dropped). Implemented by mirroring the Phase-8 `vacVerifier` pattern (D-08/D-12), **not** full version/hash pinning or a sync floor.

**In scope:** the read-path grant coordinate check (AUTH-03), the malformed-grant guard (AUTH-04), the two local-reject client checks (AUTH-05), the `Role.position` validation (AUTH-06), the AUTH-07 target-rank gate + upstream note, the AUTH-08 Kick `vac` gate, the pulled-in banlist read-path rank/owner-exemption fix (D-14), and spec-derived tests for every derivation and fold touched (TEST-01).

**Out of scope (own phases / not this milestone slice):** invite lifecycle & event-time (Phase 10); messaging wire conformance (Phase 11); document/caps conformance (Phase 12). No new authority *capabilities* — only correctness of the folds already specified.
</domain>

<decisions>
## Implementation Decisions

### AUTH-07 — Grant target-member rank gate (S01 ruling)
- **D-01: §3 binds the Grant's target member.** In addition to the existing "signer outranks every role handed out" check (`control.ts:187`), a Grant is authorized only if the signer **strictly outranks the target member's current standing**. This closes the vacuous-`[].every()` revoke hole (a junior `MANAGE_ROLES` holder stripping a senior admin).
- **D-02: Gate scope is *every non-self Grant*, not only lowering ones.** Require the actor to outrank the target's current standing for any Grant whose `member` is someone other than the actor. This is spec-truer to §3 ("acting on a target you don't outrank" is forbidden regardless of direction), subsumes revoke + demote, and needs no before/after standing diff. `target === actor` is exempt (a self-revoke/leave must not be blocked by an outrank-yourself check). Owner short-circuits (`s.isOwner`). Roleless targets are `0xffffffff`, so initial grants and junior promotions sail through.
- **D-03: File an upstream clarification note.** §2 states the Grant rule specifically ("outrank every Role it hands out") while §3 states the general "strictly outrank its target"; the two readings diverge for revoke/demote. Draft a short upstream note/issue so the spec text is tightened to match the strict reading we implement. Mechanism (GH issue vs. an in-repo note referenced from the changeset) is Claude's discretion during execution.

### AUTH-08 — Kick `vac` gate (S02 ruling)
- **D-04: Mirror the Phase-8 `vacVerifier` (D-08/D-12) for the Kick fold.** Gate a Kick with the same predicate shape channel-rekey/refound already use: owner exempt; non-owner **requires** `vac`; `vac[0]` must structurally equal `grantLocator(cid, actor)`; the **current** folded roster must still grant `PERM.KICK`. **Pure over folded state** — no re-fetch of the cited edition's version/hash, no sync floor. This still yields §5's material outcome (a demoted actor's Kick is dropped because the current roster denies them).
- **D-05: Keep the existing rank-vs-victim check.** The Kick fold's current `hasPerm(actor, PERM.KICK) && actor.position < victim.position` (`guestbook.ts:83`) stays; the `vac` gate is *added*, not a replacement. Thread a `verifyVac`-style predicate into `foldMembers` (mirroring the `verifyVac?: (rotator, vac) => boolean` already on `channel-sync.ts:32`/`private-channel.ts:62`) rather than passing the whole state — keeps the fold pure. Exact threading is Claude's discretion.
- **D-06: Write path already attaches `vac`.** `kick()` at `community.ts:1013-1014` already computes `vacFor(this.pubkey)` and passes it to `KickFactory.create`. The AUTH-05 local reject (D-09) ensures a non-owner without the bit/rank fails before publishing; a non-owner with authority always carries `vac` (owner gets `undefined` by design).

### AUTH-04 — Malformed Grant guard
- **D-07: Skip the candidate unless `role_ids` is an array AND every entry is a string.** The `try/catch` at `control.ts:183` wraps only `JSON.parse`; a non-array `role_ids` makes `.every` throw an uncaught `TypeError` out of `foldControl`, failing every member's fold. Validate the shape before use; the array-check kills the throw and the string-entry check is cheap fail-closed defense-in-depth.
- **D-08: Skip-candidate semantics, empty stays a revoke.** A malformed candidate does `continue` to the next candidate in its coordinate group (matching the `JSON.parse` catch) — never drop the whole entity/member. An **empty `role_ids` (`[]`) is a valid revoke**, not malformed, and must pass through to the authorization + AUTH-07 target-rank check.

### AUTH-05 — Local authority reject for `kick()`/`ban()`
- **D-09: Throw-and-abort on missing bit or rank.** Before building/publishing, `kick()` and `ban()` do a local `canDo(PERM.KICK / PERM.BAN, standingOf(target).position)` check (bit **and** rank vs. the target) and **throw** on failure, mirroring `rotateChannel`/`refound` and Phase 6 D-05/D-06. Gives the UI a clear error instead of the current silent no-op (the read path already enforced, so no authority was leaked — only the optimistic UI lied).

### AUTH-03 — Grant read-path coordinate check
- **D-10: Fold a Grant only at its derived coordinate.** Mirror the banlist (`control.ts:293`, folds only at `banlistLocator`): accept a grant candidate only when its eid equals `grantLocator(cid, grant.member)`. Today the loop (`control.ts:174`) discards the eid key and folds every group, trusting `grant.member` from the *content* — a forged edition at a bogus eid claiming another member's coordinate gets folded. The coordinate check also makes folding delivery-order-independent (two grants for one member share the coordinate → same group → version-ordered). Mechanical.

### AUTH-06 — `Role.position` validation
- **D-11: Skip a Role unless `Number.isInteger(position) && position > 0 && position < 0xffffffff`.** `control.ts:162-163` already rejects `position <= 0`, but `NaN`/`1.5`/`undefined` slip both guards (`NaN <= x` is `false`) and fold, conferring permission bits. Require a positive integer strictly below the roleless sentinel (`0xffffffff`) so a role cannot collide with a roleless member's standing. Skip-candidate on failure.

### TEST-01 (standing) — spec-derived tests
- **D-12: Every derivation and fold this phase touches gets a hand-derived spec-value test** — computed from the CORD-04 formula, never read back from the implementation under test. Concretely: the `grantLocator` coordinate derived by hand from the §5 formula (not read from the write path that produces it); the AUTH-07 target-rank and union-of-bits/min-position rank outcomes tabulated from §2 by hand; a malformed-`role_ids` fold that must degrade (skip) rather than throw; the banlist per-target-rank + owner-exemption outcome (D-14) derived from §3. Include a non-vacuity check per fix (the test fails without the guard).

### Pulled-in rider — read-path banlist rank + owner exemption
- **D-13 → D-14: Harden the read-path banlist fold (user pulled this into scope).** The banlist fold (`control.ts:295`) checks only that the list's author holds `PERM.BAN` — no per-entry rank check — and `foldMembers` applies `members.delete(banned)` unconditionally with **no owner exemption**, so a junior BAN-holder can list the owner's pk and drop them from the roster. Fix: honor a banned pk only when the list author **strictly outranks** that pk's current standing, and **never** ban the owner (position 0). This is a deliberate scope addition beyond the audit's enumerated AUTH-03..08 findings; it belongs to the same authority-fold domain, closes a real privilege hole, and carries its own spec-derived test (D-12). Flag it as a new finding when updating REQUIREMENTS/audit traceability.

### Claude's Discretion
- The upstream-note mechanism for D-03 (GH issue vs. in-repo note + changeset citation).
- How the `verifyVac` predicate is threaded into `foldMembers` (D-05) — inline vs. injected predicate — provided the fold stays pure over folded state.
- Error-message wording for the AUTH-05 throws (D-09) and any fold-time skip logging.
- Exact plan/commit sequencing within the fixed constraint that each behavioral fix lands **with** its spec-derived test (TEST-01), and a failing test attributes to the fix, not a later refactor.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authoritative protocol spec (verify fixes against this, not only the audit paraphrase)
- Upstream Concord spec — `https://github.com/concord-protocol/concord` (raw: `https://raw.githubusercontent.com/concord-protocol/concord/main/<NN>.md`). For this phase: **CORD-04 §2/§3/§5** (`04.md` — §2 Grant maps member→roles, honored only if signer outranks every role handed out, empty `role_ids` = revoke; §3 "the actor must hold the required bit **and** *strictly* outrank its target — equal cannot act on equal," "no edition may claim a position at or above its own signer"; §5 `vac` = authority citation pinned by coordinate/version/hash, non-owner actions require it, owner omits it, resolves rank against the current refuse-downgrade roster, a superseded/demoted citation is dropped). **CORD-02 §5** (`02.md` — defers Kick's `vac` rule to CORD-04 §5). `examples.md` for wire fixtures. *(Rulings for AUTH-07/08 were taken against this text, 2026-07-19.)*

### Milestone authority
- `.planning/concord-audit.md` — M05 (grants folded without verifying their coordinate; `grantLocator` exists, used on write, never on read — `control.ts:174,194`), M06 (unvalidated `role_ids` throws an uncaught `TypeError` killing `foldControl` — `control.ts:183-193`), L04 (`kick()`/`ban()` publish with no local authority check — `community.ts`/`admin.ts`), L05 (`Role.position` not validated — `control.ts:162-163`), S01/S02 (the two rulings). Carries file:line, violated spec sentence, symptom, fix per finding.
- `.planning/REQUIREMENTS.md` — AUTH-03..08 (+ the standing TEST-01 closure rule; TEST-01 does NOT close at this phase). Add the D-14 banlist rider as a new finding/requirement when updating traceability.
- `.planning/ROADMAP.md` — Phase 9 detail: goal, success criteria 1-6, the AUTH-07/08 "blocked-on-ruling, resolved as first task" note.
- `.planning/PROJECT.md` — v1.1 constraints: the spec-derived-test standard (assert against independently-derived spec values, never implementation output); fail-closed guard discipline.
- `.planning/phases/06-refounding-rotation-authority-correctness/06-CONTEXT.md` — the authority precedents this phase inherits: fail-closed guards (D-07), rank semantics via `canActOn` (D-09), throw-and-abort local rejects (D-05/D-06), the "bring the omitted path up to the correct sibling path" pattern.

### Primary source files (verify current line numbers this session)
- `packages/concord/src/helpers/control.ts` — `foldControl`; role fold + position guard (`:150-170`, AUTH-06/D-11); grant fold (`:174-195`, AUTH-03/D-10, AUTH-04/D-07, AUTH-07/D-01-02); the banlist coordinate precedent to mirror (`:288-300`, and the read-path rank/owner gap for D-14).
- `packages/concord/src/helpers/permissions.ts` — `resolveStanding` (`:38-59`), `canActOn`/`canDo`/`hasPerm`, `refoundAuthority` (`:77-82`), **`vacVerifier(state, requiredPerm)` (`:85-115`)** — the D-08/D-12 predicate AUTH-08 reuses (owner exempt, non-owner requires `vac`, `vac[0] === grantLocator(cid, rotator)`, current roster grants the perm, pure over folded state).
- `packages/concord/src/helpers/guestbook.ts` — `foldMembers` (`:48-116`); the Kick authorization branch (`:77-84`, add the `vac` gate D-04/D-05, keep the rank-vs-victim check); the banlist application `members.delete(banned)` (`:114`, add owner exemption D-14).
- `packages/concord/src/helpers/crypto.ts` — `grantLocator(communityId, memberXonlyHex)` (`:184`), `banlistLocator` (`:189`); the coordinate primitives for AUTH-03 and the AUTH-08 `vac[0]` check.
- `packages/concord/src/client/admin.ts` — `vacFor(actor)` (`:133-142`, owner→undefined, else `[grantLocator, version, hash]`); `ban()` (`:257-263`, add local reject D-09); grant write path (`:251`).
- `packages/concord/src/client/community.ts` — `kick()` (`:1011-1014`, already attaches `vacFor`; add local reject D-09); `vacVerifier` wiring for channel-rekey (`:707`) and refound (`:785`) — the precedents.

### Existing tests (extend / add alongside)
- `packages/concord/src/helpers/__tests__/control.test.ts` (or the `foldControl` suite) — add: malformed-`role_ids` degrades-not-throws (AUTH-04); grant coordinate mismatch is dropped (AUTH-03); AUTH-07 non-self target-rank gate (junior cannot revoke/demote senior); `Role.position` NaN/float/sentinel rejected (AUTH-06); banlist per-target rank + owner-unbannable (D-14).
- `packages/concord/src/helpers/__tests__/guestbook.test.ts` — Kick `vac` gate (non-owner without vac / wrong-coordinate vac is dropped; demoted actor's Kick dropped by current roster) alongside the existing rank-vs-victim tests.
- `packages/concord/src/client/__tests__/community.test.ts` / `admin` tests — `kick()`/`ban()` local throw when caller lacks bit or rank (AUTH-05).
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`vacVerifier(state, requiredPerm)`** (`permissions.ts:85-115`) — the exact predicate AUTH-08 needs; channel-rekey (`community.ts:707`) and refound (`community.ts:785`) already gate through it. Call it with `PERM.KICK` for the Kick fold. No new vac logic.
- **`vacFor(actor)`** (`admin.ts:133`) — already produces the `[grantLocator, version, hash]` citation and returns `undefined` for the owner; `kick()` already wires it.
- **`canDo`/`canActOn`/`standingOf`** — the rank-comparison primitives for AUTH-05, AUTH-07, and D-14; owner=0, roleless=`0xffffffff`. Inherited from Phase 6 (D-09). No new rank logic.
- **The banlist coordinate fold** (`control.ts:288-300`) — the template for AUTH-03's grant coordinate check (swap `banlistLocator` → `grantLocator(cid, grant.member)`).
- **`rotateChannel`/`refound` local outrank throws** — the template for AUTH-05's `kick()`/`ban()` local reject.
- **The `verifyVac?: (rotator, vac) => boolean` injection on `channel-sync.ts:32` / `private-channel.ts:62`** — the pattern for threading the Kick `vac` predicate into `foldMembers` without passing the whole state.

### Established Patterns
- **The recurring defect class is "a guard that defaults to permit" or "a shape unvalidated after `JSON.parse`."** AUTH-04's `.every` throw, AUTH-06's NaN-position, AUTH-07's vacuous `[].every()`, and AUTH-08's missing `vac` gate are all instances. Every fix defaults to deny / skip.
- **"Bring the omitted path up to the correct sibling path."** The write path validates grant coordinates; the read path doesn't (AUTH-03). Channel-rekey/refound gate `vac`; the Kick fold doesn't (AUTH-08). Channel-rekey/refound reject locally; `kick()`/`ban()` don't (AUTH-05). The correct sibling already exists in every case.
- **Spec-derived tests only** (milestone standard, D-12) — expected coordinates and rank outcomes computed by hand from the CORD-04 formula via `crypto.ts`/`permissions.ts` primitives, never by calling `foldControl`/`foldMembers`/`grantLocator` under test.

### Integration Points
- `foldControl` (`control.ts`) is the single read-path authority fold for roles/grants/metadata/channels/banlist — AUTH-03/04/06 and D-14 all land here; keep the 4-pass fixpoint loop's convergence intact (the AUTH-07 target-standing read rides the same evolving-standing machinery the role check already uses).
- `foldMembers` (`guestbook.ts`) is the membership fold — AUTH-08's Kick `vac` gate and D-14's banlist owner-exemption land here; the fold must stay pure over folded state (no live-store re-fetch), consistent with D-12.
- `kick()`/`ban()` (`community.ts`/`admin.ts`) are the client write entry points — AUTH-05's local rejects land here, before any publish.
</code_context>

<specifics>
## Specific Ideas

- **The two "blocked" rulings both resolve toward "the fix is required."** Reading the upstream spec (not just the audit paraphrase) showed §3 is the general authority rule that plainly binds a Grant's target (AUTH-07), and §5 is explicit that non-owner Kicks require a validated `vac` (AUTH-08). Neither is genuinely ambiguous once the spec text is in hand — the audit hedged conservatively.
- **AUTH-08 deliberately does NOT reintroduce version/hash pinning or a sync floor.** Phase 8's D-12 already ruled the sibling paths pure-over-folded-state; resolving against the *current* roster achieves §5's "demoted actor is dropped" outcome without the store lookups D-12 rejected. Keep Kick consistent with the rest of the milestone.
- **The banlist rider (D-14) was surfaced mid-trace and pulled in by the user.** It's the same "junior acts on senior" shape as AUTH-07, applied to bans, plus a missing owner exemption — a real privilege hole, not scope creep, but it is beyond the audit's enumerated AUTH set and must be recorded as a new finding.
</specifics>

<deferred>
## Deferred Ideas

- **Full CORD-04 §5 `vac` pinning (version + content hash) and a sync-floor deferral** — deliberately NOT implemented (D-04, consistent with Phase 8 D-12). Reconsider milestone-wide only if the current-roster approach proves insufficient in practice.
- Nothing else surfaced outside the phase boundary — the discussion stayed within the authority-fold domain (the banlist rider was pulled *into* scope, not deferred).

### Reviewed Todos (not folded)
- **`05.1-review-followups.md`** ("Phase 05.1 code-review follow-ups") — keyword-matched (`phase`, `code`, `existing`) but its content is cache / gift-wrap / symbol-propagation follow-ups (CR-01 seal author-spoofing, WR-01 replaceable version symbol copy, etc.), entirely unrelated to Phase 9's authority folds. Reviewed and **not folded**; belongs to milestone/backlog review. Note the security-relevant CR-01 (gift-wrap `getGiftWrapSeal` discards `verifyWrappedEvent`) is worth prioritizing there.
</deferred>

---

*Phase: 9-Authority & Permission Fold Correctness*
*Context gathered: 2026-07-19*
