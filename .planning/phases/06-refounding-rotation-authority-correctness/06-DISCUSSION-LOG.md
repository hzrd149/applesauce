# Phase 6: Refounding Rotation & Authority Correctness - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-16
**Phase:** 6-Refounding Rotation & Authority Correctness
**Areas discussed:** Member-removal gate (ROTATE-04), Send-path authority (AUTH-02), Receive-path authority (AUTH-01), Rotation test scope (ROTATE-01/02, TEST-01)

---

## Member-removal gate (ROTATE-04) — epoch scoping

Reframed after the user asked to verify against the upstream Concord spec. My initial "snapshot-timestamp floor" framing was a heuristic; CORD-02 §5 ("the Guestbook rides the epoch") shows the fix is structural epoch separation.

| Option | Description | Selected |
|--------|-------------|----------|
| Floor inside foldMembers | Compute the current refounder snapshot ms as an epoch floor, gate the observed loop on it | (withdrawn — spec-mismatched heuristic) |
| Key plane stores per epoch | `planeStoreKey` includes epoch; fold reads current-epoch store only; observed scoped to current epoch | ✓ |
| Stamp epoch, filter in fold | Keep one store, stamp epoch into PlaneInfo/rumors, filter in foldMembers + observed | |
| You decide after research | Capture requirement, let planner pick mechanism | |

**User's choice:** Key plane stores per epoch.
**Notes:** User endorsed it because "each epoch's guestbook becomes isolated and cannot break future epochs," and raised a follow-up on old-store cleanup (below).

### Follow-up — old-epoch store cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Tie to held_roots retention | Dispose an epoch's stores when its root drops out of `held_roots` — one retention horizon for keys + stores | ✓ |
| Drop guestbook stores on rotation | Dispose prior guestbook store immediately on adopt; keep content stores for history | |
| Keep for community lifetime | Dispose only at community dispose; accept bounded growth | |

**User's choice:** Tie to `held_roots` retention.
**Notes:** Keys and stores share one horizon — an epoch you no longer hold the root for cannot be decoded, so its store is dead weight.

---

## Send-path authority (AUTH-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Throw, abort the whole Refounding | Per-target BAN outrank loop before building; throw on first un-outranked target, mirroring rotateChannel | ✓ |
| Drop un-outranked targets, proceed | Silently refound with the rest | |

**User's choice:** Throw, abort the whole Refounding.
**Notes:** Atomic — no partial rotation, no publishes on failure; consistent with the shipped channel-rekey-outrank behavior.

---

## Receive-path authority (AUTH-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Fail closed — deny removal | Unsupplied `canRemoveSelf` denies; root path always supplies the outrank predicate; rewrite the misleading docstring | ✓ |
| Keep default-permit, just supply it on root | Fix the symptom only, leave the default-permit short-circuit | |

**User's choice:** Fail closed — deny removal.
**Notes:** Kills the "guard defaults to permit" defect shape the milestone exists to eliminate.

---

## Rotation test scope (ROTATE-01/02, TEST-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Add a concord-level spread guard | Extend the H01 probe (seed memo → rollForward → assert new-epoch address) to guestbook + rekey | ✓ |
| Rely on the mandated per-address tests | Treat the success-criterion-5 assertions as sufficient | |
| You decide during planning | Let the planner decide on a dedicated probe | |

**User's choice:** Add a concord-level spread guard.
**Notes:** H01 self-heals on restart, so it can regress silently; cheap insurance at the concord layer beyond the mandated per-address assertions.

---

## Claude's Discretion

- Exactly which planes feed the current-epoch `observed` set (guestbook only vs. + control + current-epoch chat).
- Error-message wording for the send-path throw and any receive-path logging.
- Whether the per-epoch store-key change touches channel routing here or defers channel epoch-keying to Phase 7.
- Plan/commit sequencing within the fixed constraints.

## Deferred Ideas

- `vac`-citation on rotations (just-demoted admin) — ROTATE-08, Phase 8.
- Channel keying / private-channel derivation (H07/H08) — Phase 7.
- CI grep/lint contract against undocumented enumerable symbol-writes — milestone-wide reconsideration.
- Rotation robustness (racing rotations, transient-signer retry, partial chunks) — ROTATE-05..13, Phase 8.
