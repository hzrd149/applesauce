# Phase 1: Generic store foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 1-Generic store foundation
**Areas discussed:** Undefined verify warning, Model interfaces boundary, verifyRumor test

---

## Undefined verify warning

| Option | Description | Selected |
|--------|-------------|----------|
| Keep the warning | Always warn when verifyEvent ends up undefined, even for intentional opt-out | ✓ |
| Silence when explicit | Only warn when verification is unexpectedly absent, not on explicit `verifyEvent: undefined` | |

**User's choice:** Keep the warning
**Notes:** "keep the warning since the rumor store will have its own verifier" — rumor consumers use RumorStore (Phase 3) with `verifyRumor`, so a default `EventStore` with no verifier remains the unusual, warning-worthy case.

---

## Model interfaces boundary

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 2 | `Model`/`ModelConstructor`/`ModelEventStore` genericized with the models in Phase 2 | ✓ |
| Include in Phase 1 | Genericize all listed infrastructure interfaces as one foundation pass | |

**User's choice:** Defer to Phase 2
**Notes:** Keeps Phase 1 aligned with CORE-05's named surface (store/database/manager interfaces) and treats the model layer as one coherent Phase 2 change.

---

## verifyRumor test

| Option | Description | Selected |
|--------|-------------|----------|
| Test verifyRumor in Phase 1 | Add unit test (correct id → true, wrong id → false) where the verifier is introduced | ✓ |
| Defer to Phase 3 | Introduce verifyRumor untested; cover via RumorStore tests in Phase 3 | |

**User's choice:** Test verifyRumor in Phase 1
**Notes:** Proves ROADMAP success criterion #3 at the phase where the verifier lands; low cost. RumorStore behavioral tests stay in Phase 3.

---

## Claude's Discretion

- Ordering of the type migration (helpers → interfaces → managers → store) and internal generic-parameter threading, provided defaults stay `NostrEvent` and runtime behavior is unchanged.

## Deferred Ideas

- Model framework + Model/ModelConstructor/ModelEventStore interfaces → Phase 2.
- Cast infrastructure genericization → Phase 2 (partial work already in `casts/event.ts`).
- RumorStore class + kind-5 delete + `EventCast<Rumor>` tests → Phase 3.
- `applesauce-common` helpers/casts → Phase 4.
