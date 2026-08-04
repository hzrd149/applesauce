---
phase: 12-document-caps-conformance
plan: 10
subsystem: concord-control-plane
tags: [concord, CR-01, WR-01, WR-09, channel-fold, type-derived-rules]
dependency graph:
  requires: ["12-08"]
  provides: ["CHANNEL_METADATA_FOLD_RULES", "CHANNEL_KEY_FOLD_DISPOSITION", "CHANNEL_KEY_STRIPPED_FIELDS", "foldChannelEdition"]
  affects: ["packages/concord/src/helpers/control.ts", "packages/concord/src/helpers/__tests__/control.test.ts"]
tech-stack:
  added: []
  patterns: ["type-derived total rule tables (mirrors 12.3-14's ExhaustiveBundleRules<T> precedent)", "DeclaredKeysOf<T> key-remapping to strip index-signature keys before mapping"]
key-files:
  created: []
  modified:
    - packages/concord/src/helpers/control.ts
    - packages/concord/src/helpers/__tests__/control.test.ts
decisions:
  - "Task 3's P2 index-signature negative case required a non-homomorphic mapped-type form (factored keyof alias) to actually reproduce the degenerate exit-0 case; the plan's literal prose (a direct homomorphic mapping) unexpectedly still enforces the field in TS 5.9.3 — both forms recorded verbatim."
metrics:
  duration: "Task 3 only (continuation agent); prior Tasks 1-2 duration recorded by the original executor instance"
  completed: "2026-08-01"
status: complete
---

# Phase 12 Plan 10: Close CR-01 channel-fold regression with type-derived rule tables Summary

Replaced the hand-maintained channel-fold denylist (which twice drifted from the real `ChannelKey`/`ChannelMetadata` types — CR-01 and WR-01) with two total, type-derived rule tables (`CHANNEL_METADATA_FOLD_RULES`, `CHANNEL_KEY_FOLD_DISPOSITION`) and a rule-driven `foldChannelEdition` builder, closing CR-01/WR-01/WR-09 by construction rather than by patch.

**Continuation context:** This SUMMARY covers all three tasks. Tasks 1 and 2 were completed by a prior executor instance (commits `e2fba1b8`, `06b9498b`) that terminated on an API stream error before Task 3. This executor resumed at Task 3, verified the landed Tasks 1–2 state, and executed the five demonstration probes.

## What Was Built (Tasks 1-2, landed by prior executor — verified, not redone)

`packages/concord/src/helpers/control.ts` gained:

- `DeclaredKeysOf<T>` — key-remapping mapped type dropping index-signature keys (`ChannelMetadata` carries `[k: string]: unknown` from plan 12-08, so `keyof Required<ChannelMetadata>` would otherwise degenerate to `string | number`).
- `ChannelMetadataDeclared = Required<DeclaredKeysOf<ChannelMetadata>>` — the five declared fields with optionality removed (the `Required` wrapper is load-bearing: without it a missing `deleted`/`custom` rule would not be a type error).
- `ChannelFieldGuard<V>`, `ChannelFieldRule<V>` (discriminated union: `derived` / `required` / `optional`), `ChannelMetadataFoldRules`.
- Three module-private guards: `isStringValue`, `isBooleanValue`, `isCustomRecord` (the last deliberately rejects arrays — a strengthening beyond the pre-12-08 check).
- `CHANNEL_METADATA_FOLD_RULES` — the five-entry table (`channel_id` derived; `name`/`private` required; `deleted`/`custom` optional).
- `ChannelKeyFoldDisposition` — a total conditional map over `keyof Required<ChannelKey>`, where the non-strip escape hatch (`"metadata-field"`) is reachable ONLY for names `ChannelMetadata` itself declares.
- `CHANNEL_KEY_FOLD_DISPOSITION` — classifies `id`, `key`, `epoch`, `held` as `strip` and `name` as `metadata-field`.
- `CHANNEL_KEY_STRIPPED_FIELDS` — derived at module load via `Object.entries(...).filter(...).map(...)`, never a literal array.
- `foldChannelEdition(parsed, eid)` — builds the folded object via `Object.fromEntries([...passThrough, ...declared])`, pass-through first, declared last (so a hostile edition's own `channel_id` cannot shadow the coordinate-derived one), using data-property creation (never bracket assignment, so a `__proto__` key cannot alter the prototype).
- The CHAN-04/D-13/D-22 comment block above the channel loop was rewritten to state the real guarantees (see `packages/concord/src/helpers/control.ts:432-465`), including the deliberate boundary that `JoinMaterial` is NOT covered by the strip set.

`packages/concord/src/helpers/__tests__/control.test.ts` gained Tests G, H, I, J, K, L plus an extended Test B (adds `held`/`id` absence assertions).

**Divergence from plan prose, recorded per instruction 2:** The plan's task 1 action text (`<action>` §1c) describes `CHANNEL_KEY_STRIPPED_FIELDS` and doesn't explicitly name Test L in the task 2 prose's bullet list of test names in the same enumeration style used for G/H/I/J/K, but the "New test symbols" table (plan lines 119-129) does list Test L (`__proto__` on an edition does not alter the folded object's prototype`) — the landed code matches the table, not a gap. No other divergence found between the plan's specified symbol names/shapes and the landed source; every exported symbol name in the "New exported symbols" table matches the actual `control.ts` declarations verbatim.

## CR-01 Acceptance — Demonstrated, Not Asserted

Five probes executed sequentially from a throwaway script driven manually (edit → run → capture → revert) against the repo working tree, HEAD `4f01f83e` (Tasks 1-2 already committed at `e2fba1b8`/`06b9498b`). Before each probe, `git status --short` was confirmed empty; after each revert, confirmed empty again.

### P1 — a new `ChannelKey` field cannot be forgotten

**Edit applied** (`packages/concord/src/types.ts`, inside `interface ChannelKey`, after `held?: HeldKeyEntry[];`):

```ts
held?: HeldKeyEntry[];
/** PROBE P1 (12-10 Task 3): intentionally has no entry in CHANNEL_KEY_FOLD_DISPOSITION. */
probeChannelKeyField?: string;
```

No corresponding entry was added to `CHANNEL_KEY_FOLD_DISPOSITION`.

**Command:** `pnpm --filter applesauce-concord build`

**Verbatim output (trimmed to the relevant error block):**

```
src/helpers/control.ts:240:14 - error TS2741: Property 'probeChannelKeyField' is missing in type '{ id: "strip"; key: "strip"; epoch: "strip"; name: "metadata-field"; held: "strip"; }' but required in type 'ChannelKeyFoldDisposition'.

240 export const CHANNEL_KEY_FOLD_DISPOSITION: ChannelKeyFoldDisposition = {
                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~

  src/types.ts:179:3
    179   probeChannelKeyField?: string;
          ~~~~~~~~~~~~~~~~~~~~
    'probeChannelKeyField' is declared here.

src/helpers/invite-bundle.ts:432:14 - error TS2741: Property 'probeChannelKeyField' is missing in type '{ id: { kind: "hex-key"; onInvalid: "reject"; onAbsent: "reject"; }; key: { kind: "hex-key"; onInvalid: "reject"; onAbsent: "reject"; }; epoch: { kind: "safe-integer"; onInvalid: "reject"; onAbsent: "reject"; }; name: { ...; }; held: { ...; }; }' but required in type 'ExhaustiveBundleRules<ChannelKey>'.

432 export const CHANNEL_KEY_FIELD_RULES: ExhaustiveBundleRules<BundleChannel> = {
                 ~~~~~~~~~~~~~~~~~~~~~~~

  src/types.ts:179:3
    179   probeChannelKeyField?: string;
          ~~~~~~~~~~~~~~~~~~~~
    'probeChannelKeyField' is declared here.

Found 2 errors in 2 files.
```

**Result:** FAILED as predicted — the error names both `ChannelKeyFoldDisposition` and `probeChannelKeyField`. A second, unrelated error also fired at `invite-bundle.ts:432` (`CHANNEL_KEY_FIELD_RULES`, Phase 12.3's own `ExhaustiveBundleRules<ChannelKey>` table) — this is a real side effect of `ChannelKey` gaining a field (that table is ALSO total over `ChannelKey` per 12.3-14), not a defect in this plan's mechanism; noted because the plan's acceptance criterion asks for a TypeScript error naming both the injected field and the responsible rule table, which the FIRST error block satisfies exactly.

**Comparison — why this beats the review's suggested one-directional `satisfies` fix:** a `satisfies readonly (keyof ChannelKey)[]` array would still compile (exit 0) with `probeChannelKeyField` simply absent from the array — `satisfies` only checks that listed names ARE keys of `ChannelKey`, never that every key of `ChannelKey` IS listed. The landed `ChannelKeyFoldDisposition` mapped type is total in the other direction (`{ [K in keyof Required<ChannelKey>]: ... }`), so a forgotten field is a missing-property error, not a silent no-op. This is precisely why the plan rejected the review's own suggested repair.

**Revert:** `git checkout -- packages/concord/src/types.ts`. Confirmed `git status --short` prints nothing; `grep -c probeChannelKeyField packages/concord/src/types.ts` returns `0`.

### P2 — a new declared `ChannelMetadata` field cannot be forgotten

**Edit applied** (`packages/concord/src/types.ts`, inside `interface ChannelMetadata`, before the index signature):

```ts
custom?: Record<string, unknown>;
/** PROBE P2 (12-10 Task 3): intentionally has no entry in CHANNEL_METADATA_FOLD_RULES. */
probeMetadataField?: string;
[k: string]: unknown;
```

No corresponding rule was added to `CHANNEL_METADATA_FOLD_RULES`.

**Command:** `pnpm --filter applesauce-concord build`

**Verbatim output:**

```
src/helpers/control.ts:213:14 - error TS2741: Property 'probeMetadataField' is missing in type '{ channel_id: { disposition: "derived"; }; name: { disposition: "required"; guard: (value: unknown) => value is string; }; private: { disposition: "required"; guard: (value: unknown) => value is boolean; }; deleted: { ...; }; custom: { ...; }; }' but required in type 'ChannelMetadataFoldRules'.

213 export const CHANNEL_METADATA_FOLD_RULES: ChannelMetadataFoldRules = {
                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~

  src/types.ts:140:3
    140   probeMetadataField?: string;
          ~~~~~~~~~~~~~~~~~~
    'probeMetadataField' is declared here.

Found 1 error in src/helpers/control.ts:213
```

**Result:** FAILED as predicted — names both `ChannelMetadataFoldRules` and `probeMetadataField`. Reverted `types.ts` was NOT yet run; the index-signature negative case (below) requires `probeMetadataField` to remain in place while `ChannelMetadataFoldRules`'s definition is temporarily rewritten.

**Index-signature negative case — required to prove `DeclaredKeysOf` is load-bearing, not decorative.**

The first attempt at this negative case used the literal form the plan's prose suggests — mapping directly and homomorphically over `keyof Required<ChannelMetadata>`:

```ts
export type ChannelMetadataFoldRules = {
  [K in keyof Required<ChannelMetadata>]: ChannelFieldRule<Required<ChannelMetadata>[K]>;
};
```

This did **NOT** exit 0 as the plan predicts — TypeScript 5.9.3 still raised `TS2741` naming `probeMetadataField`, because `{ [K in keyof T]: X }` written directly against a concrete interface reference is a **homomorphic** mapped type: TypeScript preserves `T`'s literal member list (and their modifiers) through this form even when `T` also carries a string index signature, rather than collapsing to the union `keyof T` would report as a standalone type query. This is a genuine divergence from the plan's stated prediction, recorded per the instruction to record what actually fired rather than paper over it. It was isolated and confirmed with an out-of-repo scratch snippet (`interface Foo { a: string; b: number; [k: string]: unknown }`, `type M1 = { [K in keyof Required<Foo>]: string }`) — omitting `b` from an `M1`-typed object literal still raised `TS2741`.

The genuinely degenerate form — the one that actually produces the silent exit-0 the plan is warning against — factors the `keyof` computation into a **separate named type alias first**, which is no longer syntactically homomorphic:

```ts
type ProbeAllChannelMetadataKeys = keyof Required<ChannelMetadata>;
export type ChannelMetadataFoldRules = {
  [K in ProbeAllChannelMetadataKeys]: ChannelFieldRule<Required<ChannelMetadata>[K]>;
};
```

**Command:** `pnpm --filter applesauce-concord build`

**Verbatim output:** (empty — exit 0, no diagnostics)

**Result:** exited 0 as predicted for THIS form — `probeMetadataField` compiled silently with no rule, confirming the underlying degeneration mechanism the plan's `DeclaredKeysOf` JSDoc describes is real, but only manifests once the `keyof` result is factored out of the mapped type's own clause (a refactor a future contributor could plausibly make without realizing the safety consequence — e.g. "extracting a type alias for readability"). This means `DeclaredKeysOf`'s protection is somewhat more robust than the plan's own prose implies (a naive direct homomorphic rewrite is unexpectedly still safe in TS 5.9.3), but the danger is real and reachable via the factored-alias form, which is the more natural thing an author reaching for `keyof Required<ChannelMetadata>` would actually write. `DeclaredKeysOf` is confirmed load-bearing.

**Revert:** `git checkout -- packages/concord/src/types.ts packages/concord/src/helpers/control.ts`. Confirmed `git status --short` prints nothing; `grep -c probeMetadataField packages/concord/src/types.ts` returns `0`; `grep -c ProbeAllChannelMetadataKeys packages/concord/src/helpers/control.ts` returns `0`.

### P3 — a rule's guard is bound to its field's type (Phase 12.3's CR5-01, closed not inherited)

**Edit applied** (`packages/concord/src/helpers/control.ts`, in `CHANNEL_METADATA_FOLD_RULES`):

```ts
// PROBE P3 (12-10 Task 3): swap deleted's guard for the string guard.
deleted: { disposition: "optional", guard: isStringValue },
```

(was `guard: isBooleanValue`)

**Command:** `pnpm --filter applesauce-concord build`

**Verbatim output:**

```
src/helpers/control.ts:218:39 - error TS2322: Type '(value: unknown) => value is string' is not assignable to type 'ChannelFieldGuard<boolean>'.
  Type predicate 'value is string' is not assignable to 'value is boolean'.
    Type 'string' is not assignable to type 'boolean'.

218   deleted: { disposition: "optional", guard: isStringValue },
                                          ~~~~~

Found 1 error in src/helpers/control.ts:218
```

**Result:** FAILED as predicted — a `TS2322` type-predicate assignability error, stating precisely that `value is string` is not assignable to `value is boolean`.

**Prose: Phase 12.3's CR5-01 class does not apply to these tables.** CR5-01 (STATE.md, backlog 999.9) found that `ExhaustiveBundleRules<T> = { [K in keyof Required<T>]: BundleFieldRule }` binds WHICH fields a rule table must name, but never consults `T[K]` to bind WHAT TYPE a rule's guard must assert — so a `kind: "safe-integer"` rule could sit on a `string`-typed field with no compile error (downgraded from BLOCKER to a latent guardrail gap only, since no shipped rule was actually wrong). `ChannelFieldRule<V>` here is different: `guard` is typed `ChannelFieldGuard<V>` where `V` is the rule table's OWN mapped-type parameter `ChannelMetadataDeclared[K]` at each slot — the guard's asserted type is structurally forced to match the slot's declared field type at the type level, not merely checked for the field's PRESENCE. P3 demonstrates this directly: swapping `deleted`'s guard for a `string`-typed predicate is caught at the exact assignment site, by the type checker, with no runtime component. CR5-01's class is closed here, not reproduced.

**Revert:** `git checkout -- packages/concord/src/helpers/control.ts`. Confirmed `git status --short` prints nothing; `grep -c isStringValue packages/concord/src/helpers/control.ts` returns `2` (the `function isStringValue` declaration plus its one legitimate use on `name`'s rule — `deleted` no longer references it).

### P4 — the escape hatch is unreachable for a non-metadata field

**Edit applied** (`packages/concord/src/helpers/control.ts`, in `CHANNEL_KEY_FOLD_DISPOSITION`):

```ts
name: "metadata-field",
// PROBE P4 (12-10 Task 3): reclassify held as metadata-field (it isn't).
held: "metadata-field",
```

(was `held: "strip"`)

**Command:** `pnpm --filter applesauce-concord build`

**Verbatim output:**

```
src/helpers/control.ts:246:3 - error TS2322: Type '"metadata-field"' is not assignable to type '"strip"'.

246   held: "metadata-field",
      ~~~~

  src/types.ts:177:3
    177   held?: HeldKeyEntry[];
          ~~~~
    The expected type comes from property 'held' which is declared here on type 'ChannelKeyFoldDisposition'

Found 1 error in src/helpers/control.ts:246
```

**Result:** FAILED as predicted — the string-literal type at `held`'s slot in `ChannelKeyFoldDisposition` is the single literal `"strip"` (not the two-member union `"strip" | "metadata-field"`), because `held` is not a key of `ChannelMetadataDeclared`. This is a stronger property than mere detection: a future author **cannot even deliberately** reclassify a sensitive `ChannelKey`-only field as safe — the conditional type `K extends keyof ChannelMetadataDeclared ? "strip" | "metadata-field" : "strip"` narrows the value's own type at that slot before any value is ever written, so there is no assignment that satisfies it.

**Revert:** `git checkout -- packages/concord/src/helpers/control.ts`. Confirmed `git status --short` prints nothing; `grep -n 'held: "strip"' packages/concord/src/helpers/control.ts` returns exactly one match.

### P5 — the behavioral tests are non-vacuous

**Edit applied** (`packages/concord/src/helpers/control.ts`, replacing the channel loop's fold construction — the block that calls `foldChannelEdition` — with the pre-Task-1 destructure-and-rest-spread form, byte-for-byte from commit `a8e13299` (the 12-08 predecessor), while leaving Task 2's tests, the exported tables, and every other line of the file untouched):

```ts
// PROBE P5 (12-10 Task 3): restored the pre-Task-1 destructure+spread
// fold body verbatim (from commit a8e13299, the 12-08 predecessor),
// bypassing foldChannelEdition/the rule tables entirely, to prove Tests
// G/H/J/K are non-vacuous against the pre-fix behavior.
for (const cand of authorized) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cand.content);
  } catch {
    continue;
  }
  if (parsed === null || typeof parsed !== "object") continue;
  const { key: _key, epoch: _epoch, name, private: isPrivate, ...rest } = parsed as Record<string, unknown>;
  if (typeof name !== "string" || typeof isPrivate !== "boolean") continue;
  const meta: ChannelMetadata = { ...rest, channel_id: eid, name, private: isPrivate };
  heads.set(eid, cand.source);
  channels.push(meta);
  break;
}
```

(replacing the `foldChannelEdition(parsed as Record<string, unknown>, eid)` call and its surrounding `if (!meta) continue;` / `heads.set` / `channels.push` / `break`)

**Command:** `pnpm --filter applesauce-concord test -- control`

**Verbatim output (trimmed to the failing-test summary and the six failure blocks):**

```
 ❯ src/helpers/__tests__/control.test.ts (28 tests | 6 failed) 56ms
     × Test B: hostile key/epoch/held/id fields do NOT survive the fold, while an unrelated unknown key does (WR-01) 8ms
     × Test G: a non-boolean `deleted` is dropped rather than folded — CR-01's visible-but-silently-dead channel is unreachable 1ms
     × Test H: a non-object `custom` (string, null, array) is dropped rather than folded, while a genuine object survives 1ms
     × Test I: closing CR-01 does not regress the unknown-key round-trip (WIRE-09) 1ms
     × Test J (WR-01, generated probe): every name CHANNEL_KEY_STRIPPED_FIELDS classifies is absent from the folded channel 1ms
     × Test K (WR-09, generated probe): every optional rule omits its field on a guard miss, every required rule rejects the edition 1ms

 FAIL  src/helpers/__tests__/control.test.ts > control fold — unknown-key round-trip (WIRE-09/WIRE-10/D-22/D-24) > Test B: hostile key/epoch/held/id fields do NOT survive the fold, while an unrelated unknown key does (WR-01)
AssertionError: expected true to be false // Object.is equality
 ❯ src/helpers/__tests__/control.test.ts:845:67
    845|     expect(Object.prototype.hasOwnProperty.call(folded!, "held")).toBe…

 FAIL  src/helpers/__tests__/control.test.ts > control fold — unknown-key round-trip (WIRE-09/WIRE-10/D-22/D-24) > Test G: a non-boolean `deleted` is dropped rather than folded — CR-01's visible-but-silently-dead channel is unreachable
AssertionError: expected true to be false // Object.is equality
 ❯ src/helpers/__tests__/control.test.ts:983:72
    983|       expect(Object.prototype.hasOwnProperty.call(folded!, "deleted"))…

 FAIL  src/helpers/__tests__/control.test.ts > control fold — unknown-key round-trip (WIRE-09/WIRE-10/D-22/D-24) > Test H: a non-object `custom` (string, null, array) is dropped rather than folded, while a genuine object survives
AssertionError: case string: expected true to be false // Object.is equality
 ❯ src/helpers/__tests__/control.test.ts:1034:88
    1034|       expect(Object.prototype.hasOwnProperty.call(folded!, "custom"), …

 FAIL  src/helpers/__tests__/control.test.ts > control fold — unknown-key round-trip (WIRE-09/WIRE-10/D-22/D-24) > Test I: closing CR-01 does not regress the unknown-key round-trip (WIRE-09)
AssertionError: expected true to be false // Object.is equality
 ❯ src/helpers/__tests__/control.test.ts:1066:70
    1066|     expect(Object.prototype.hasOwnProperty.call(folded!, "deleted")).t…

 FAIL  src/helpers/__tests__/control.test.ts > control fold — unknown-key round-trip (WIRE-09/WIRE-10/D-22/D-24) > Test J (WR-01, generated probe): every name CHANNEL_KEY_STRIPPED_FIELDS classifies is absent from the folded channel
AssertionError: field id: expected true to be false // Object.is equality
 ❯ src/helpers/__tests__/control.test.ts:1099:86

 FAIL  src/helpers/__tests__/control.test.ts > control fold — unknown-key round-trip (WIRE-09/WIRE-10/D-22/D-24) > Test K (WR-09, generated probe): every optional rule omits its field on a guard miss, every required rule rejects the edition
AssertionError: field deleted: expected true to be false // Object.is equality
 ❯ src/helpers/__tests__/control.test.ts:1137:88

 Test Files  1 failed | 53 passed (54)
      Tests  6 failed | 546 passed (552)
```

**Result:** Tests G, H, J and K — the four required by the plan's acceptance criteria — all went RED against the pre-fix fold body, exactly as predicted. Two additional tests also went RED as a direct, expected consequence of the same reversion and are recorded here rather than omitted: Test B (extended in Task 2 to assert `held`/`id` absence — the pre-fix body only destructures out `key`/`epoch`, so `held` and `id` survive) and Test I (the round-trip-not-regressed test, which also asserts hostile `deleted`/`custom`/`held` absence on the same edition). Neither B nor I was named in the plan's list of four required RED tests, but their failure is consistent with — not a divergence from — the predicted mechanism: both assert exactly the same "hostile field absent" property that G/H/J/K assert, just from different angles, so their going RED alongside the four named tests reinforces non-vacuity rather than contradicting the prediction.

**Restore:** `git checkout -- packages/concord/src/helpers/control.ts`. Confirmed `git status --short` prints nothing; `grep -c foldChannelEdition packages/concord/src/helpers/control.ts` returns `2` (the function declaration plus its one call site, restored).

**Re-run, GREEN:**

```
$ pnpm --filter applesauce-concord test -- control
 Test Files  54 passed (54)
      Tests  552 passed (552)
```

### Final gate — run once after the fifth revert

```
$ pnpm --filter applesauce-concord build
$ tsc
BUILD EXIT CODE: 0

$ pnpm --filter applesauce-concord test
 Test Files  54 passed (54)
      Tests  552 passed (552)
TEST EXIT CODE: 0

$ pnpm exec tsc --noEmit -p packages/concord/tsconfig.json
TSC EXIT CODE: 0 (no output)

$ pnpm -r test
Scope: 18 of 19 workspace projects
... (all 18 packages with a `test` script pass; applesauce-examples has no `test`
    script defined in its package.json, so it is not part of this scope and
    contributes nothing to attribute — the pre-existing StoredEvent/NostrEvent
    build-only breakage recorded in STATE.md for `applesauce-examples` affects
    `pnpm build`, not `pnpm -r test`, and did not surface here)
PNPM -r TEST EXIT: 0
```

`git diff --name-only` across this task's probes shows nothing (every probe edit was reverted before the next began); `git status --short` prints nothing at task completion.

## Deviations from Plan

### Auto-fixed Issues

None — Task 3 makes no source changes; every probe edit was applied and reverted per the plan's own procedure.

### Recorded divergences from plan prose (not defects)

**1. P2's index-signature negative case used a different syntactic form than the plan's literal prose suggests, because the literal form does not reproduce the degenerate behavior in TypeScript 5.9.3.** The plan's Task 3 action text says to run the probe "against a table mapped over `keyof Required<ChannelMetadata>` directly" — read literally (`{ [K in keyof Required<ChannelMetadata>]: ... }`), this is a **homomorphic** mapped type, and TypeScript 5.9.3 does NOT degenerate it to an unenforcing index signature; it still enforces every literal property, including a newly-added one, because homomorphic mapped types preserve a concrete source type's literal member list regardless of an accompanying index signature. This was confirmed both in-repo (exit 2, not exit 0) and via an isolated scratch snippet outside the repo. The genuinely degenerate form — the one that DOES exit 0, proving `DeclaredKeysOf` load-bearing — factors the `keyof` computation into a separately-named type alias FIRST (`type X = keyof Required<ChannelMetadata>; type Rules = { [K in X]: ... }`), which is no longer syntactically homomorphic. Both forms and their outputs are recorded verbatim above under P2. This is a probe-construction nuance discovered during execution, not a defect in Tasks 1–2's landed code — `DeclaredKeysOf` is real and load-bearing against the actually-dangerous (factored-alias) form, and, as a bonus finding, the naive direct rewrite is unexpectedly *more* robust than the plan's own prose implies.

**2. P5 produced two additional RED tests (B, I) beyond the four the plan names (G, H, J, K).** This is a consequence of Task 2's Test B extension (adds `held`/`id` absence assertions, which the pre-fix body — restoring only `key`/`epoch` from the denylist — cannot satisfy) and Test I (the round-trip test, which also asserts hostile-field absence on the same edition Tests G/H exercise). Recorded under P5 above rather than treated as a discrepancy: the plan's four named tests are a **minimum**, not an exhaustive list of everything that must go RED, and both additional failures assert the identical property (hostile-field absence) the four named tests were designed to catch.

No other divergence from the plan's Task 3 action text was found. All acceptance criteria for Task 3 are satisfied: five probes executed and reverted clean, P1/P2 name both the injected field and the responsible table, P2 additionally carries the index-signature negative case, P3 shows the type-predicate assignability error with the CR5-01 prose, P4 shows the string-literal assignability error, P5 names Tests G/H/J/K as RED against the pre-fix body and GREEN after restore, and no commit in this task touches `packages/concord/src/**`.

## Deliberate Strengthenings Beyond Bare Parity With the Pre-12-08 Fold

Two deliberate strengthenings beyond restoring the exact pre-12-08 fold behavior, both landed in Task 1 (`e2fba1b8`) and confirmed still in place by this task's probes:

1. **Arrays are rejected for `custom`, not merely non-objects.** `isCustomRecord` (`packages/concord/src/helpers/control.ts`) tests `value !== null && typeof value === "object" && !Array.isArray(value)` — the pre-12-08 fold (and a naive restoration of the old `typeof === "object"` check) would accept an array, which passes a bare `typeof` test while producing numeric indices under `Object.keys`/enumeration, the identical type-lie CR-01 named for a string `custom`. P4 of plan 12.3-14's precedent established the pattern of demonstrating such strengthenings explicitly rather than shipping them silently; this SUMMARY does the same via Test H's array case (Task 2) and this note.
2. **`id` is added to the stripped set, as a structural consequence of deriving the strip set from `ChannelKey` rather than restating it by hand.** The pre-12-08 denylist named only `key`/`epoch`; WR-01 found `held` also missing. Because `CHANNEL_KEY_STRIPPED_FIELDS` is now DERIVED from `CHANNEL_KEY_FOLD_DISPOSITION`, a total classification over every `ChannelKey` field, `id` (a channel-key identifier, not previously in any hand-written denylist) is stripped automatically — not because anyone thought to add it, but because it is a `ChannelKey` field that `ChannelMetadata` does not itself declare, and the disposition table's conditional type makes that classification the ONLY one reachable for such a field. This is the mechanism, not a one-off fix, and is exactly what P1 and P4 demonstrate structurally.

## Self-Check

- `packages/concord/src/helpers/control.ts` — FOUND (contains `CHANNEL_METADATA_FOLD_RULES`, `CHANNEL_KEY_FOLD_DISPOSITION`, `foldChannelEdition`, confirmed by `grep` during P1–P5).
- `packages/concord/src/helpers/__tests__/control.test.ts` — FOUND (Tests G, H, I, J, K, L present and exercised RED/GREEN during P5).
- Commit `e2fba1b8` (Task 1) — `git log --oneline --all | grep -q e2fba1b8` → FOUND.
- Commit `06b9498b` (Task 2) — `git log --oneline --all | grep -q 06b9498b` → FOUND.
- `git status --short` at task completion — prints nothing → CONFIRMED.
- Final gate (build, test, tsc --noEmit, `pnpm -r test`) — all exit 0 → CONFIRMED, transcripts above.

## Self-Check: PASSED
