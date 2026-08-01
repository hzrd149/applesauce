---
phase: 12-document-caps-conformance
reviewed: 2026-08-01T14:47:29Z
depth: standard
round: 2 (gap wave — plans 12-10 / 12-11 only; round 1 preserved in git at 53d6d39c)
diff_base: 48debd59
files_reviewed: 3
files_reviewed_list:
  - packages/concord/src/helpers/control.ts
  - packages/concord/src/helpers/__tests__/control.test.ts
  - packages/concord/src/client/__tests__/community.test.ts
findings:
  critical: 0
  warning: 6
  info: 3
  total: 9
status: issues_found
---

# Phase 12 (gap wave): Code Review Report

**Reviewed:** 2026-08-01T14:47:29Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found (0 BLOCKER, 6 WARNING, 3 INFO)

## Summary

Scope was the gap wave only: `e2fba1b8`/`06b9498b` (12-10, type-derived channel-fold rule tables)
and `58ebb95e`/`bfd3e8a9` (12-11, downstream reachability tests).

**Verdict on the three questions the scope asked:**

1. **Does the new fold logic correctly and totally validate every field?** Yes. I traced every
   guard, not just the tables. `foldChannelEdition` (`control.ts:274-303`) is total over the five
   declared `ChannelMetadata` members; no value can slip through as the wrong type. Adversarial
   paths I checked and found closed: a JSON array as the whole edition body (rejected — `name`
   guard miss on a `required` rule); a hostile own `channel_id` (never enters `passThrough`, since
   `declaredKeys` filters it — so it does not even rely on the "later entries win" mechanism the
   comment credits); an own `__proto__` on the parsed edition (does not alter the result's
   `[[Prototype]]` — `Object.fromEntries` uses `CreateDataPropertyOrThrow`); `deleted`/`custom`
   type-lies (dropped, channel retained). CR-01 is genuinely closed, and CR5-01's class (guard not
   type-bound to its slot) is genuinely closed here — verified, not assumed.

2. **Can the tables be silently disarmed by a plausible future refactor?** Mostly no, but with two
   real gaps, both guardrail-only. I probed the type machinery empirically with `tsc --strict`
   rather than reading it: an index signature reappearing on `ChannelKey` does **not** disarm
   `ChannelKeyFoldDisposition` (declared members stay required; the index branch resolves to
   `"strip"`); omitting a rule and mis-typing a guard both still error. The two live gaps are
   **WR-02** (a `"strip"` classification is a silent no-op for any field also declared on
   `ChannelMetadata` — the type system and the runtime give the two tables *opposite* precedence)
   and **WR-03** (all three tables are exported, mutable, package-public module state).
   Separately **WR-04**: the documented rationale for `DeclaredKeysOf` is verifiably false, and the
   type it is actually load-bearing for is not the one the comment names — a future author acting
   on the stated (wrong) reason could delete it and open a key-material leak with no compile error.

3. **Are the new tests non-vacuous?** The `control.test.ts` probes (Tests G/H/I/J/K/L) are genuine,
   and J/K are correctly generated from the exported tables rather than hand-enumerated. The two
   new `community.test.ts` reachability tests are currently non-vacuous, but only by an unasserted
   coincidence (**WR-05**): their stated "premise confirmation" assertion cannot distinguish "v2
   was adopted" from "v2's `prev` dangled and v1 was folded instead". Test L (**WR-01**) asserts a
   strictly narrower property than its comment claims.

**Verification performed:** all 554 concord tests pass; `tsc --noEmit -p packages/concord` clean;
six standalone `tsc --strict` probes of the mapped-type machinery; a Node repro of the
`Object.fromEntries` / `Object.assign` prototype interaction.

**No BLOCKER found.** Every finding below is a guardrail, hardening, or test-robustness gap; I
found no value reachable through a real code path that produces incorrect behavior today. Per this
project's own lesson about mislabeled BLOCKERs triggering avoidable gap rounds, none of these
should gate the milestone — WR-02/WR-03/WR-04 are the ones worth folding into the next touch of
this file.

---

## Warnings

### WR-01: A hostile edition can shadow `Object.prototype` members on every folded channel; Test L asserts a narrower property than it claims

**File:** `packages/concord/src/helpers/control.ts:274-302`, `packages/concord/src/helpers/__tests__/control.test.ts:1145-1162`

**Issue:** `passThrough` admits *every* own key that is neither stripped nor declared — including
`__proto__`, `constructor`, `toString`, `hasOwnProperty`. `Object.fromEntries` creates them as own
data properties, so the folded `ChannelMetadata` carries the attacker's payload and shadows the
corresponding `Object.prototype` member.

Test L's comment states the construction "cannot alter the result's prototype", and asserts exactly
that (`Object.getPrototypeOf(folded) === Object.prototype`) plus global cleanliness. Both pass. But
neither assertion covers the retained payload, and the payload is what re-arms downstream. Verified
repro:

```
folded own keys: [ '__proto__', 'channel_id', 'name', 'private' ]
proto is Object.prototype: true                              <- what Test L asserts
Object.assign({}, folded) proto is Object.prototype: false   <- what it does not
Object.assign({}, folded).polluted: true
```

Reachable by any authorized `MANAGE_CHANNELS` holder. `state$.value.channels` and `channels$` are
public API, and `admin.ts:232` re-serializes the folded object back onto the wire, so the payload
also survives a delete/compaction round trip.

**Not a regression** (the pre-12-10 rest-spread behaved identically) and **no in-repo consumer is
affected** — `grep -rn "Object.assign" packages/concord/src` is empty, and no `Object.assign`/merge
over a `ChannelMetadata` exists anywhere in `packages/*/src` or `apps/*/src`. The concern is
external consumers, plus the false sense of closure Test L's comment creates.

**Fix:** exclude prototype-hazard names from `passThrough` (not plausible protocol field names, so
this does not weaken D-13's round-trip obligation), and widen Test L to assert payload absence:

```ts
const PROTOTYPE_HAZARD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const passThrough = Object.entries(parsed).filter(
  ([key]) =>
    !PROTOTYPE_HAZARD_KEYS.has(key) &&
    !CHANNEL_KEY_STRIPPED_FIELDS.includes(key) &&
    !declaredKeys.includes(key),
);

// Test L, additionally:
expect(Object.prototype.hasOwnProperty.call(folded!, "__proto__")).toBe(false);
expect(Object.getPrototypeOf(Object.assign({}, folded!))).toBe(Object.prototype);
```

---

### WR-02: A `"strip"` classification is a silent no-op for any field `ChannelMetadata` also declares — the two tables have opposite precedence at type level and at runtime

**File:** `packages/concord/src/helpers/control.ts:229-246`, `274-302`

**Issue:** `ChannelKeyFoldDisposition` permits `"strip" | "metadata-field"` for any `ChannelKey`
field that is also a declared `ChannelMetadata` member. Verified with `tsc --strict`: classifying
`name: "strip"` produces **no** compile error.

At runtime the strip loses. A key that is both stripped and declared is filtered out of
`passThrough` (`:277`) — but the `declared` loop (`:281-300`) unconditionally re-adds it from
`CHANNEL_METADATA_FOLD_RULES`. So the type system says "strip wins" for non-metadata names while
the runtime says "declared wins" for shared names, and nothing reconciles the two.

**Guardrail-only today.** The single shared name is `name`, correctly classified
`"metadata-field"`, so every shipped value is correct. The failure scenario is a future field added
to *both* types — exactly the growth path these tables exist to survive: a contributor classifies it
`"strip"` believing that suppresses it, the compiler accepts it, `CHANNEL_KEY_STRIPPED_FIELDS`
grows, and the field is emitted anyway from the rules table. That is the key-material-leak class the
original WR-01 named, re-opened through the new mechanism.

**Fix:** make the overlap unrepresentable rather than merely unused — either forbid the shared case
in the type, or enforce the invariant at module load beside the derived strip set:

```ts
// Type-level: a ChannelKey field ChannelMetadata also declares may ONLY be "metadata-field".
export type ChannelKeyFoldDisposition = {
  [K in keyof Required<ChannelKey>]: K extends keyof ChannelMetadataDeclared ? "metadata-field" : "strip";
};

// Or, runtime invariant beside CHANNEL_KEY_STRIPPED_FIELDS:
for (const field of CHANNEL_KEY_STRIPPED_FIELDS)
  if (field in CHANNEL_METADATA_FOLD_RULES)
    throw new Error(`fold tables disagree: "${field}" is stripped but also a declared metadata rule`);
```

---

### WR-03: The three rule tables are exported, mutable, package-public module state — the validation can be disarmed process-wide at runtime

**File:** `packages/concord/src/helpers/control.ts:213-255`

**Issue:** `CHANNEL_METADATA_FOLD_RULES`, `CHANNEL_KEY_FOLD_DISPOSITION` and
`CHANNEL_KEY_STRIPPED_FIELDS` are `export const`, which freezes the *binding*, not the contents.
`packages/concord/src/helpers/index.ts:11` (`export * from "./control.js"`) plus the
`./helpers` / `./helpers/*` subpath exports in `package.json` make all three package-public API. The
`readonly string[]` annotation on the strip set is erased at runtime.

Any consumer — or a future test, or a mis-ordered module side effect — can write
`CHANNEL_METADATA_FOLD_RULES.deleted = { disposition: "optional", guard: () => true }` or
`(CHANNEL_KEY_STRIPPED_FIELDS as string[]).length = 0` and silently disarm both CR-01's and WR-01's
fixes for every fold in the process. The scope asked "can the tables be silently disarmed" — this is
the most direct answer, and it needs no refactor at all.

**Guardrail-only:** nothing mutates them today (the tests only read them).

**Fix:**

```ts
export const CHANNEL_METADATA_FOLD_RULES: ChannelMetadataFoldRules = Object.freeze({ /* ... */ });
export const CHANNEL_KEY_FOLD_DISPOSITION: ChannelKeyFoldDisposition = Object.freeze({ /* ... */ });
export const CHANNEL_KEY_STRIPPED_FIELDS: readonly string[] = Object.freeze(
  Object.entries(CHANNEL_KEY_FOLD_DISPOSITION).filter(([, d]) => d === "strip").map(([f]) => f),
);
```

---

### WR-04: `DeclaredKeysOf`'s documented rationale is verifiably false, and names the wrong type as the beneficiary

**File:** `packages/concord/src/helpers/control.ts:139-152` (and the summary claim at `:127-137`)

**Issue:** The doc block asserts that keying the rule table directly over
`keyof Required<ChannelMetadata>` "degenerates into an unenforcing index signature that compiles and
checks nothing", and that stripping the index-signature keys "is what makes
`ChannelMetadataFoldRules` total over the five declared members".

Both halves are false. TypeScript treats `{ [K in keyof Required<ChannelMetadata>]: ... }` as a
homomorphic mapped type and preserves the declared members as required properties. Verified with
`tsc --strict` against the exact repo types:

| probe | with `DeclaredKeysOf` | **without** it |
|---|---|---|
| omit the `deleted` rule | error TS1360 | **error TS1360** (`Property 'deleted' is missing`) |
| `deleted` guard typed `v is string` | error TS2322 | **error TS2322** |
| junk key `typo_delted` in the table | error | accepted |

Totality and guard-type binding therefore hold with or without the abstraction; the only thing it
adds for `ChannelMetadataFoldRules` is junk-key rejection, which the `: ChannelMetadataFoldRules`
annotation already supplies via excess-property checking on the object literal.

`DeclaredKeysOf` **is** genuinely load-bearing — but in `ChannelKeyFoldDisposition`'s conditional
(`:230`), which the comment never mentions. Verified: substituting `keyof Required<ChannelMetadata>`
there makes `{ id: "strip", key: "metadata-field", epoch: "metadata-field", name: "metadata-field",
held: "metadata-field" }` compile cleanly, because `K extends string | number` is always true — a
direct key-material leak.

This matters because the false rationale is the sole recorded reason the abstraction exists. A
future author who checks the claim, finds it wrong, and "simplifies" `ChannelMetadataDeclared` back
to `Required<ChannelMetadata>` gets no compile error anywhere and re-opens the leak.

(The adjacent `Required<...>` claim at `:154-161` **is** correct — verified: dropping `Required<>`
lets both the `deleted` and `custom` rules be omitted with no error.)

**Fix:** rewrite the block to state the demonstrated behaviour — that the index signature does not
break the metadata table's totality, that `DeclaredKeysOf` exists so
`K extends keyof ChannelMetadataDeclared` in `ChannelKeyFoldDisposition` stays a *discriminating*
condition, and that without it every `ChannelKey` field becomes classifiable as `"metadata-field"`.

---

### WR-05: The two new downstream tests' "premise confirmation" assertion cannot detect the failure it exists to detect

**File:** `packages/concord/src/client/__tests__/community.test.ts:1786-1791`, `1893-1897`

**Issue:** Both new CR-01 tests build a v2 edition by hand and chain it with
`computeEditionHash({ vsk, eid, version: 1, content: JSON.stringify({ name, private: false }) })`,
*reconstructing* what `createChannel` published rather than reading it back. The stated guard is:

```ts
// "Confirms v2 was actually adopted for HOSTILE before anything else is asserted."
expect(Object.prototype.hasOwnProperty.call(foldedHostile!, "deleted")).toBe(false);
```

That assertion is equally true when v2 was **not** adopted. If the reconstructed `v1Content` ever
diverges by a byte, `v2.prev !== v1.selfHash`, `headCandidates` (`control.ts:91-96`) breaks the
contiguous walk and holds the head at v1 — and the folded v1 has no `deleted` property either. Every
remaining assertion in both tests (channel registered in `publicChannelKeys()`, present in
`currentAuthors()`, sub-engine retained) then passes trivially for a channel that never carried a
hostile `deleted` at all.

The `deadId` control does not cover this: the CHAN-07 sticky scan (`control.ts:487-503`) inspects
*all* authorized candidates, not just the chain head, so `deadId` is dropped whether or not v2 is
the head.

**Currently non-vacuous** — I verified `admin.ts:196` emits exactly
`JSON.stringify({ name, private: isPrivate })` with matching key order, `publishEdition`
(`admin.ts:144-150`) uses `version: 1` with no `prevHash` for the first edition, and `editionHash`
(`crypto.ts:223-238`) excludes `vsk`/`vac`, so the chain links today. The finding is that nothing in
the tests holds that coincidence in place: adding one field to `createChannel`'s content object
silently converts both tests into always-green no-ops, with no failing assertion anywhere.

**Fix:** make v2 carry a value only v2 could have supplied, and assert it:

```ts
async function publishV2(channelId: string, name: string, deleted: unknown): Promise<string> {
  const v2Name = `${name}-v2`;
  // ...build v2 with content JSON.stringify({ name: v2Name, private: false, deleted })
  return v2Name;
}
const hostileV2Name = await publishV2(hostileId, hostileName, "false");
// Fails loudly if the prev-hash chain broke and the fold held the head at v1:
expect(foldedHostile!.name).toBe(hostileV2Name);
```

---

### WR-06: The central claim of 12-10 — "adding a field fails the build" — has no automated coverage, because both test files are excluded from typechecking

**File:** `packages/concord/tsconfig.json` (`exclude: ["src/**/*.test.ts", "src/**/__tests__/**/*"]`), `packages/concord/src/helpers/__tests__/control.test.ts:1103-1143`

**Issue:** The entire justification for 12-10 is a *compile-time* guarantee, and nothing exercises
it. Both changed test files are excluded from `tsc`, so no `@ts-expect-error` fixture proving
"omitting a rule fails" or "a wrong-typed guard fails" can live there — and none exists elsewhere.
Tests J and K are runtime probes over the tables' *current contents*; neither would notice if the
types stopped enforcing anything, because both tables would still be populated correctly.

Related symptom: `control.test.ts:1121`'s comment (`// narrows for tsc; already filtered above`)
reasons about a compiler that never reads the file.

I confirmed the guarantee holds today by hand (six `tsc --strict` probes; results in WR-04's table),
but a claim that must survive future edits and is checked by no gate will drift.

**Fix:** add a type-only fixture under `src/` (which *is* typechecked) — e.g.
`helpers/__type-tests__/control-fold-rules.ts`, emitting nothing at runtime — with
`@ts-expect-error` on a rules literal missing `deleted`, on a `deleted` rule guarded by
`isStringValue`, and on a `ChannelKeyFoldDisposition` classifying `key` as `"metadata-field"`. Each
`@ts-expect-error` becomes a build failure the moment the guardrail stops working.

---

## Info

### IN-01: The `!c.deleted` gates the new tests were written to protect are now provably unreachable-false

**File:** `packages/concord/src/client/__tests__/community.test.ts:1755-1764` (comment), `packages/concord/src/client/community.ts:757`, `807`, `830`

The CHAN-07 sticky scan `continue`s before the fold loop for any entity with an authorized
`deleted === true` candidate, over the *same* `authorized` list and the *same* non-null-object
precondition as the fold loop. So `state.channels` can never contain an entry with
`deleted === true`, and `filter(c => !c.private && !c.deleted)` / `if (!c.private || c.deleted)
continue` are dead conditions — not merely "correct because the fold guarantees boolean-or-absent",
as the new test's comment frames it. Not a defect, and the decision not to tighten them to
`=== true` is settled; recorded so the rationale is not carried forward inaccurately.

### IN-02: `admin.ts`'s channel doc block still documents the removed denylist-then-spread fold

**File:** `packages/concord/src/client/admin.ts:204-226`

Outside the reviewed file set, but invalidated by the in-scope change. The block explains
`deleteChannel`'s spread in terms of "the channel fold's denylist-then-spread (D-13/D-14)" and "the
fold's own denylist additionally prevents a hostile edition's `key` field from ever becoming a live
property" — a mechanism `e2fba1b8` deleted. The conclusion is still true (now via
`CHANNEL_KEY_STRIPPED_FIELDS`), but the stated reason no longer exists in the codebase.

### IN-03: An `optional` guard miss erases the field from `deleteChannel`'s re-serialized tombstone

**File:** `packages/concord/src/helpers/control.ts:294-299`, `packages/concord/src/client/admin.ts:231-232`

A malformed `custom` written by a newer client is dropped by the fold, and `deleteChannel` spreads
the *folded* object, so the tombstone edition this client publishes no longer carries it — a narrow
CORD-02 §6 round-trip loss. Bounded: `deleteChannel` is the only path that re-serializes a folded
`ChannelMetadata` back into an edition (`grep -rn "VSK.CHANNEL" packages/concord/src` shows only
`createChannel` and `deleteChannel` publishing channel editions), and the channel is terminal at
that point. Consistent with the locked D-04/D-15 read-side precedent; recorded only, no action
proposed.

---

_Reviewed: 2026-08-01T14:47:29Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (gap-wave scope, 48debd59..HEAD)_
