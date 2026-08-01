---
phase: 12-document-caps-conformance
verified: 2026-08-01T14:53:38Z
status: passed
score: 7/7 must-haves verified
behavior_unverified: 0
overrides_applied: 2
overrides:
  - must_have: "A channel name is capped at 64 bytes on write and defensively on read (ROADMAP success criterion 1)."
    reason: "D-04 (12-CONTEXT.md, locked 2026-07-29): the read path deliberately accepts an over-cap name/description verbatim. helpers/control.ts's channel fold has exactly one rejection idiom (`continue`), and applying it to an over-cap name would convert a caps bug into a channel-availability bug, since the fold is the sole source of channel state. Truncating on read was also rejected — it makes two clients disagree about a channel's name. Same override precedent as Phase 11's D-09. Verified again this pass: `helpers/caps.ts`'s header comment states this override in the source itself, and no read-side guard exists in `helpers/control.ts`/`foldChannelEdition` — matching the locked decision exactly, unchanged by the gap wave."
    accepted_by: "user (12-discuss-phase, recorded as D-04 in 12-CONTEXT.md)"
    accepted_at: "2026-07-29T00:00:00Z"
  - must_have: "A deleteChannel edition preserves custom via an explicit destructure while still excluding client-only key material — never a naive spread, which would leak ch.key (ROADMAP success criterion 4, original rationale)."
    reason: "D-14 (12-CONTEXT.md, locked 2026-07-29): ChannelMetadata no longer carries key/epoch (removed earlier in the milestone as accepted breaking changes), so `ch.key` cannot exist and `tsc` rejects any code that reads it. Re-verified this pass: `types.ts`'s ChannelMetadata (lines 133-140) still has no key/epoch fields; `deleteChannel` in `client/admin.ts:228-232` still performs the destructure-and-spread (`const { channel_id: _channel_id, ...rest } = ch`). The gap wave's fold change (12-10) makes the destructure's input better-typed than before (CR-01 fixed), which strengthens rather than weakens this override's basis."
    accepted_by: "user (12-discuss-phase, recorded as D-14 in 12-CONTEXT.md)"
    accepted_at: "2026-07-29T00:00:00Z"
re_verification:
  previous_status: gaps_found
  previous_score: 6/7
  gaps_closed:
    - "CR-01: the channel-edition fold no longer regresses type-validation on `deleted`/`custom` — both fields are now governed by a total, type-derived rule table (`CHANNEL_METADATA_FOLD_RULES`) whose guards are compile-time bound to each field's declared type, closing the defect as a CLASS rather than by enumeration."
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
human_verification: []
---

# Phase 12: Document & Caps Conformance Verification Report

**Phase Goal:** Community and channel documents respect the protocol's byte and membership caps, and round-trip fields the current client doesn't understand — so two clients sharing one npub, or a future protocol revision, cannot silently destroy each other's data.

**Verified:** 2026-08-01T14:53:38Z
**Status:** passed
**Re-verification:** Yes — after gap-closure plans 12-10 and 12-11 (closing CR-01/WR-01/WR-09 from the prior VERIFICATION.md)

## Goal Achievement

### CR-01 — Explicit Scoring (the item this re-verification pass exists to check)

**Prior finding (12-VERIFICATION.md, 2026-07-30):** plan 12-08's denylist-then-spread refactor of
`helpers/control.ts`'s channel fold dropped the `typeof` guards the pre-phase fold applied to
`deleted` (`=== boolean`) and `custom` (`object`, non-null). A hostile edition with
`{"deleted":"false","custom":"not-an-object"}` produced a channel that was visible (`channels$`
applies no `deleted` filter) but silently excluded from sync/subscription/sub-engine — a
"permanently visible-but-silently-dead" channel with no deletion edition, no UI signal, no test.

**Verified this pass — CLOSED, and closed as a class, not by enumeration:**

- `packages/concord/src/helpers/control.ts:212-219` — `CHANNEL_METADATA_FOLD_RULES` is a rule
  table whose TYPE (`ChannelMetadataFoldRules`, line 189-191) is a total mapped type over
  `ChannelMetadataDeclared` (the five declared `ChannelMetadata` fields with optionality removed).
  `deleted` is ruled `{ disposition: "optional", guard: isBooleanValue }`; `custom` is ruled
  `{ disposition: "optional", guard: isCustomRecord }` (which additionally rejects arrays — a
  strengthening beyond the pre-08 check). Because the table type is total and `Required<>`-wrapped,
  omitting either rule, or omitting the `deleted`/`custom` rules specifically, is a compile error
  (`error TS1360`), not a silent gap — this is the mechanism that makes the fix a CLASS closure:
  any future declared `ChannelMetadata` field forces a new rule at the same compile gate that would
  have caught CR-01's original omission.
- `foldChannelEdition` (`control.ts:274-303`) applies each rule: a guard miss on an `"optional"`
  field OMITS just that field (matches the D-04 precedent — a validation miss must not become an
  availability miss); a guard miss on a `"required"` field (`name`, `private`) rejects the whole
  candidate, preserving pre-existing behavior (Test D, unchanged).
- `ChannelFieldGuard<V>` binds each guard's type predicate to its slot's declared type at the type
  level (`ChannelFieldRule<V>`), independently closing Phase 12.3's backlogged CR5-01 class (a
  rule's `kind` not type-bound to its field) for these two tables specifically — verified by reading
  the type definitions at `control.ts:164-186`, not merely asserted.
- WR-01 (from the same prior gap wave — `held` missing from the old hand-written key-material
  denylist) is also closed: `CHANNEL_KEY_FOLD_DISPOSITION` (`control.ts:229-246`) is a total map
  over `keyof Required<ChannelKey>` (`id`, `key`, `epoch`, `name`, `held`), and `held` is classified
  `"strip"`. `CHANNEL_KEY_STRIPPED_FIELDS` is DERIVED at module load from this table via `.filter()`
  (`control.ts:253-255`), not a hand-written literal array — so a future `ChannelKey` field cannot
  reproduce the same enumeration-drift defect that produced both CR-01 and WR-01, closing the root
  cause rather than the two instances.

**Regression coverage (WR-09, closed) — read and confirmed non-vacuous by direct execution:**
`packages/concord/src/helpers/__tests__/control.test.ts` Tests G (non-boolean `deleted`: `"false"`,
`"true"`, `1`, `null` — all dropped, channel remains live and reachable via a `!c.deleted` gate,
with genuine `false`/`true` discriminating controls), H (non-object `custom`: string/null/array — all
dropped, genuine nested object survives deep-equal), I (WIRE-09 non-regression: the SAME hostile
edition carrying bad `deleted`+`custom`+`held` still round-trips an unrecognized `future_flag` and
`future_object` byte-identically), J (WR-01, **generated** from `CHANNEL_KEY_STRIPPED_FIELDS` at
runtime rather than hand-enumerated — so a future stripped field gains test coverage automatically),
K (WR-09, **generated** from `CHANNEL_METADATA_FOLD_RULES` — proves every `"optional"` rule omits on
a guard miss and every `"required"` rule rejects the edition), and L (`__proto__` key does not alter
the folded object's prototype). Ran directly (not trusting SUMMARY.md's claim):

```
pnpm --filter applesauce-concord exec vitest run \
  src/helpers/__tests__/control.test.ts src/client/__tests__/community.test.ts -t "CR-01"
→ Test Files  2 passed (2)
→ Tests  4 passed | 82 skipped (86)
```

**Downstream reachability (12-11, closed with a noted robustness caveat — WR-05, non-blocking):**
`packages/concord/src/client/__tests__/community.test.ts`'s two `CR-01:` tests (lines 1740, 1833)
drive the hostile-`deleted` edition through the REAL `client/community.ts` gates end-to-end
(`publicChannelKeys()`, `currentAuthors()`, `channels$`, `reconcilePrivateChannels`'s sub-engine
retention) rather than re-testing the fold in isolation, proving CR-01's fix reaches the paths the
original finding named (`community.ts:757`, `:807`, `:830`). Both pass. **Caveat, read and
confirmed:** both tests' "premise confirmation" assertion
(`hasOwnProperty(foldedHostile, "deleted") === false`) is equally true if the hand-rebuilt v2's
`prevHash` chain broke and the fold's head stayed at v1 (which never had `deleted` either) — the
tests are non-vacuous TODAY only because the v1 content string byte-matches `createChannel`'s real
output, not because anything asserts the v2-adoption premise directly. This is a real test-robustness
gap (WR-05, 12-REVIEW.md) but does not affect whether CR-01 itself is fixed — `control.test.ts`'s
Tests G/H/I/J/K prove the fold-level fix directly and are not subject to this coincidence. Recorded
as a warning, not a gap; see Anti-Patterns below.

**Verdict: CR-01 is CLOSED, and closed as a class** — the fix replaced an enumerable, editable
denylist with total type-derived tables whose omission is a compile error, matching the
`already_adjudicated_do_not_reopen` note that CR5-01's class ("rule `kind` not type-bound to field
type") is independently closed for these two tables via `(v: unknown) => v is <declared field
type>` guards.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Channel `name` capped at 64 UTF-8 bytes on write, defensively on read | PASSED (override) | `createChannel` (`client/admin.ts:192`) calls `assertByteCap(name, NAME_MAX_BYTES, "channel name")`. Read-side guard deliberately absent per locked D-04 override. Unchanged by the gap wave — re-confirmed by direct grep this pass. |
| 2 | Community `name` (64B) / `description` (10000B) caps enforced, alongside the 50-membership constant | ✓ VERIFIED | `client/admin.ts:163-164` (`editMetadata`, against merged `next`) and `helpers/community.ts` (`createCommunity`) both call `assertByteCap`. `COMMUNITY_LIST_MAX_MEMBERSHIPS = 50` enforced at `recordJoin`. Unchanged by the gap wave. |
| 3 | Community List and Invite List round-trip unknown top-level document fields | ✓ VERIFIED | `documentExtras` carriers spread-first at every publish site; unchanged by the gap wave (out of its file scope). |
| 4 | `deleteChannel` preserves `custom` via explicit destructure, excludes client-only key material | PASSED (override) | `client/admin.ts:228-232`. `ChannelMetadata` has no `key`/`epoch`. **No longer coupled to an upstream defect** (contrast with the prior pass's caveat) — the fold that produces `ch` is now itself type-total, so this destructure's input is well-typed for every declared field. |
| 5 | Code comments cite real, existing spec sections | ✓ VERIFIED | Unchanged by the gap wave; zero invalid citations outside test fixtures. |
| 6 | (TEST-01, standing) Every cap/document rule is asserted against spec-transcribed or fixture values, never the implementation's own constant | ✓ VERIFIED | Unchanged by the gap wave for the pre-existing suite; the gap wave's own new tests (G, H, I, J, K, L and the two `community.test.ts` CR-01 tests) assert against literal hostile values and the real code paths, not against `helpers/control.ts`'s own constants. |
| 7 (derived) | The channel-fold refactor does not itself introduce a new way for an authorized-but-hostile actor to silently corrupt shared channel state | ✓ VERIFIED | CR-01 closed as a class (see above): `deleted`/`custom` are validated by compile-time-bound, total rule tables; a guard miss on an optional field omits the field (never fakes deletion, never silently disables the channel); `held` is now stripped alongside `key`/`epoch`; regression tests (fold-level and downstream-reachability) both pass by direct execution. |

**Score:** 7/7 truths verified (2 by locked override, 0 present-but-behavior-unverified), 0 failed

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/concord/src/helpers/control.ts` | Type-derived, total channel-fold rule tables | ✓ VERIFIED | `CHANNEL_METADATA_FOLD_RULES`, `CHANNEL_KEY_FOLD_DISPOSITION`, `CHANNEL_KEY_STRIPPED_FIELDS`, `foldChannelEdition` all present, exported, wired into `foldControl`; `deleted`/`custom` guards restored and type-bound; `held` added to the strip set |
| `packages/concord/src/helpers/__tests__/control.test.ts` | Regression coverage for CR-01/WR-01/WR-09 | ✓ VERIFIED | Tests G, H, I, J, K, L present and passing; J and K are table-generated (not hand-enumerated), extending coverage automatically to future fields |
| `packages/concord/src/client/__tests__/community.test.ts` | Downstream reachability proof through real `client/community.ts` gates | ✓ VERIFIED (with WR-05 robustness caveat) | Two `CR-01:` tests present, passing, exercise `publicChannelKeys()`, `currentAuthors()`, `channels$`, and private sub-engine retention on both the public-sync and private-sub-engine paths |
| `packages/concord/src/client/admin.ts` | `deleteChannel` destructure-and-spread | ✓ VERIFIED | Confirmed unchanged at `:228-232`, now fed by a well-typed fold |
| (carried from prior pass, unchanged) `helpers/caps.ts`, `helpers/community-list.ts`, `helpers/invite-list.ts`, `helpers/invite-bundle.ts`, `__tests__/cord-wire-fixtures.ts`/`cord-citations.test.ts` | — | ✓ VERIFIED (regression check only) | Not touched by the gap wave; no evidence of drift found |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `helpers/control.ts::foldChannelEdition` | `CHANNEL_METADATA_FOLD_RULES` | rule lookup per declared field, guard applied before admission | WIRED | Confirmed — `deleted`/`custom` no longer ride through an unvalidated `...rest` |
| `helpers/control.ts::foldChannelEdition` | `CHANNEL_KEY_STRIPPED_FIELDS` | pass-through filter excludes stripped names before spread | WIRED | Confirmed — `held` now excluded alongside `key`/`epoch`/`id` |
| `client/community.ts:757,807,830` (`!c.deleted` gates) | `helpers/control.ts`'s fold guarantee | fold now guarantees `deleted` is boolean-or-absent on every folded `ChannelMetadata` | WIRED, CLOSED | Prior pass: WIRED BUT UPSTREAM DEFECT. This pass: the upstream defect is fixed, so the (unchanged) gates are now sound over their precondition — confirmed both by static reading and by `community.test.ts`'s two CR-01 downstream tests exercising exactly these three call sites |
| `client/admin.ts::deleteChannel` | folded `ChannelMetadata` (spread `ch`) | destructure-and-spread of the fold's output | WIRED | The fold's output is now well-typed for all declared fields, closing the "not fully independent of Gap 1" caveat the prior pass recorded against this same link |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| WIRE-06 | 12-01, 12-04 | Channel `name` 64-byte cap, write (+read, overridden) | ✓ SATISFIED | Unchanged; re-confirmed |
| WIRE-07 | 12-01, 12-04 | Community `name`/`description` byte caps | ✓ SATISFIED | Unchanged; re-confirmed |
| WIRE-08 | 12-01, 12-02, 12-03, 12-05 | 50-membership cap, byte-cap removal, nostr-tools bump | ✓ SATISFIED | Unchanged; re-confirmed |
| WIRE-09 | 12-07, 12-08, 12-09, 12-10, 12-11 | Round-trip unknown top-level fields (Lists + channel fold) | ✓ SATISFIED | The co-located regression noted last pass (CR-01) is fixed; round-trip property re-confirmed non-regressed by Test I on the SAME hostile edition |
| WIRE-10 | 12-08, 12-10, 12-11 | `deleteChannel` preserves `custom`, excludes key material | ✓ SATISFIED | Destructure-and-spread confirmed; now fed by a fully-validated fold rather than a partially-validated one |
| WIRE-12 | 12-01, 12-06 | Real spec-section citations everywhere | ✓ SATISFIED | Unchanged; re-confirmed |
| TEST-01 (standing) | all plans | Spec-anchored, non-self-referential assertions | ✓ SATISFIED | Gap-wave tests assert against literal hostile values and real code paths; pre-existing suite unchanged |

No orphaned requirements. All six phase requirement IDs (WIRE-06, WIRE-07, WIRE-08, WIRE-09,
WIRE-10, WIRE-12) plus TEST-01 (standing) are claimed by at least one plan's frontmatter, including
12-10/12-11's `[WIRE-09, WIRE-10, TEST-01]`, and REQUIREMENTS.md's Phase 12 traceability rows match.
WIRE-11 exists in REQUIREMENTS.md but is explicitly scoped to a different phase (giftwrap deletion,
not document caps) — correctly not claimed here.

### Anti-Patterns Found (this pass's scope: the gap-wave diff, `48debd59..HEAD`)

Independently re-derived by reading the code (not copied from 12-REVIEW.md), then cross-checked
against it. All six are guardrail/hardening findings on the FIX itself — none is a reachable defect
in shipped behavior today, matching 12-REVIEW.md's own verdict (0 BLOCKER / 6 WARNING / 3 INFO).

| File | Line(s) | Pattern | Severity | Impact |
|------|---------|---------|----------|--------|
| `helpers/control.ts:274-302` | `passThrough` admits `__proto__`/`constructor`/`prototype` as own keys | ⚠️ Warning (WR-01, gap-wave numbering) | External consumers doing `Object.assign` over a folded `ChannelMetadata` could be prototype-shadowed; no in-repo consumer does this today (`grep` confirmed empty); Test L's comment claims a broader guarantee than it asserts |
| `helpers/control.ts:229-246` | `ChannelKeyFoldDisposition` permits `"strip"` for a field also declared on `ChannelMetadata`, but the runtime's `declared` loop always wins for such fields | ⚠️ Warning (WR-02) | Guardrail-only today (only `name` is shared, correctly classified `"metadata-field"`); a future shared field misclassified `"strip"` would compile but be silently ineffective |
| `helpers/control.ts:213-255` | The three rule tables are `export const` (binding frozen, contents mutable) and package-public via `helpers/index.ts` | ⚠️ Warning (WR-03) | A consumer or test could mutate a table at runtime and disarm the fold process-wide; nothing does so today |
| `helpers/control.ts:139-161` | `DeclaredKeysOf`'s doc comment gives a false rationale (verified false via `tsc --strict` probes: totality holds with or without it); the abstraction's real load-bearing use is in `ChannelKeyFoldDisposition`'s conditional, uncredited | ⚠️ Warning (WR-04) | A future author acting on the stated (wrong) reason could remove the abstraction believing it inert, reopening a key-material-leak path with no compile error |
| `client/__tests__/community.test.ts:1780-1785, 1861-1864` | Both CR-01 downstream tests' "premise confirmation" assertion cannot distinguish "v2 adopted" from "v2's `prev` dangled, v1 (no `deleted`) stayed head" | ⚠️ Warning (WR-05) | Currently non-vacuous by a verified content-string byte-match coincidence with `createChannel`'s real output; one field added to that content object would silently turn both tests into always-green no-ops |
| `packages/concord/tsconfig.json` (`exclude`), `helpers/__tests__/control.test.ts:1121` | The central 12-10 claim ("adding a field fails the build") is demonstrated only by manual, undocumented-as-automated `tsc --strict` probe transcripts in 12-10-SUMMARY.md — both test files are `tsc`-excluded, so no `@ts-expect-error` fixture enforces this going forward | ⚠️ Warning (WR-06) | Confirmed by reading `tsconfig.json`'s `exclude` array; the guarantee holds today (verified by re-running the probe transcripts' underlying claim by inspection) but is not gated by CI |

No unreferenced `TBD`/`FIXME`/`XXX` debt markers found in the gap-wave file set.

**Carried forward from the prior pass, unaffected by this gap wave (not re-scored — outside 12-10/
12-11's file scope, and either already-adjudicated or already a non-blocking warning):** WR-03/WR-04/
WR-06/WR-08/WR-13 (12-VERIFICATION.md numbering) are explicitly listed in this task's
`already_adjudicated_do_not_reopen` as non-blocking and deliberately out of the gap wave. CR-02 is
settled by locked decision D-07/D-25.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CR-01 fold-level and downstream regression tests pass | `pnpm --filter applesauce-concord exec vitest run src/helpers/__tests__/control.test.ts src/client/__tests__/community.test.ts -t "CR-01"` | 2 files passed, 4/4 named tests passed | ✓ PASS |
| Full concord suite passes (independently confirmed baseline, not re-run in full per this milestone's single-full-run rule) | `pnpm --filter applesauce-concord test` | 554/554 (per orchestrator baseline) | ✓ PASS (trusted per task's independently-verified baseline) |
| Package typechecks | `pnpm exec tsc --noEmit -p packages/concord/tsconfig.json` | exit 0 (per orchestrator baseline) | ✓ PASS (trusted per baseline) |
| `held` stripped alongside `key`/`epoch`/`id` | Read `CHANNEL_KEY_FOLD_DISPOSITION` (`control.ts:240-246`) | all four classified `"strip"` | ✓ PASS |
| `deleteChannel`/`ChannelMetadata` overrides (D-04/D-14) unregressed | `grep` + direct file read | Both confirmed unchanged | ✓ PASS |
| Working tree clean | `git status --short` | empty | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or phase-declared probes found for this phase. Skipped
(consistent with the prior pass).

### Human Verification Required

None. Every must-have this pass, including CR-01's closure, was resolvable programmatically by
direct code reading and by running the named regression tests. WR-05's test-robustness gap is
independently understood (not a mystery requiring human judgment) and is recorded as a warning, not
routed to human verification, because it does not affect whether CR-01 itself is fixed — the
fold-level tests (G/H/I/J/K) prove the fix directly.

### Gaps Summary

No gaps. The single BLOCKER from the prior verification pass (CR-01) is closed, and closed as a
class: `helpers/control.ts`'s channel fold now validates `deleted` and `custom` via a total,
type-derived rule table whose omission of any declared field — including any added in the future —
is a compile error, not a silent gap. `held` (WR-01) is folded into the same total table alongside
`key`/`epoch`/`id`. Regression coverage (WR-09) is closed at both the fold level (Tests G, H, I, J,
K, L — two of which are table-generated, so future fields inherit coverage automatically) and the
downstream-reachability level (12-11's two `CR-01:` tests, driving the real `client/community.ts`
gates end-to-end).

The gap-wave's own fresh code review (12-REVIEW.md) found six new WARNING-level items on the fix
itself (WR-01 through WR-06 in that document's numbering) and three INFO items. All six are
independently re-derived and confirmed in this pass: they are guardrail-hardening or test-robustness
concerns on code that behaves correctly today, not reachable defects — matching the review's own
"0 BLOCKER" verdict. WR-04 (a false doc-comment rationale that could mislead a future simplification)
and WR-06 (the central "fails the build" claim has no automated enforcement, only manual transcripts)
are the two most worth folding into the next touch of `control.ts`, but neither blocks this phase's
goal achievement today.

All six ROADMAP success criteria are achieved: criteria 1, 2, and 4 via their locked D-04/D-07/D-14
overrides (re-verified, unregressed by the gap wave); criteria 3, 5, and 6 unchanged and re-confirmed.
The phase goal — "cannot silently destroy each other's data" — now holds against the specific failure
mode CR-01 demonstrated (an authorized-but-hostile `MANAGE_CHANNELS` holder silently disabling a
channel via a type-lying `deleted`/`custom`), in addition to the multi-device and future-protocol-
revision scenarios the goal statement names directly.

Per this project's standing lesson, this report does not flip the ROADMAP checkbox or mark the phase
complete — that is `phase.complete`'s responsibility after this `passed` verdict.

---

_Verified: 2026-08-01T14:53:38Z_
_Verifier: Claude (gsd-verifier)_
