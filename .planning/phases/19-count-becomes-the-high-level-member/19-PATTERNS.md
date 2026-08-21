# Phase 19: COUNT Becomes the High-Level Member - Pattern Map

**Mapped:** 2026-08-21
**Files analyzed:** 14 implementation, test, documentation, and provenance targets
**Analogs found:** 14 / 14 (the HLL algorithm has role-level, not exact, local analogs)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/relay/src/nip45.ts` (new) | protocol utility / validation | transform, batch | `packages/relay/src/negentropy.ts`; `packages/common/src/helpers/blossom.ts` | role-match |
| `packages/relay/src/types.ts` | model / public API | request-response | `PublishOptions` and `PublishResponse` in the same file | exact |
| `packages/relay/src/relay.ts` | service / protocol client | request-response, event-driven retry | current `count()` plus Phase 18 `publish()` | exact |
| `packages/relay/src/index.ts` | config / public barrel | transform | existing root star exports plus `exports.test.ts` | exact |
| `packages/relay/src/__tests__/nip45.test.ts` (new) | test | pure transform / batch | `packages/common/src/helpers/__tests__/blossom.test.ts` | role-match |
| `packages/relay/src/__tests__/relay.test.ts` | test | WebSocket request-response | current COUNT auth/reentrancy tests plus publish retry tests | exact |
| `packages/relay/src/__tests__/group.test.ts` | test | multi-source request-response | current COUNT `combineLatest` and option pass-through tests | exact |
| `packages/relay/src/__tests__/pool.test.ts` | test | forwarding facade | current table-driven option pass-through tests | exact |
| `packages/relay/src/__tests__/exports.test.ts` | test / API snapshot | transform | current inline root-export snapshot | exact |
| `apps/docs/loading/relays/relays.md` | documentation | request-response | existing `Counting Events` section | exact |
| `apps/docs/loading/relays/pool.md` | documentation | multi-source request-response | existing `Count Method` section | exact |
| `.planning/ROADMAP.md` | config / contract provenance | documentation | Phase 18's in-place D-01/D-07 provenance correction | exact |
| `.planning/phases/19-count-becomes-the-high-level-member/19-CONTEXT.md` (conditional) | config / decision record | documentation | Phase 18's in-place source-of-record amendments | exact |
| `.changeset/<focused-count-name>.md` (new) | config / release metadata | documentation | `.changeset/relay-event-publish-layering.md` | exact |

`packages/relay/src/group.ts`, `packages/relay/src/pool.ts`, `packages/relay/src/operators/auth-retry.ts`, `packages/relay/package.json`, `packages/relay/README.md`, and the VitePress navigation are inspect-only unless tests expose a real gap. Group and Pool already derive and forward the third COUNT argument structurally (`group.ts:324-336`, `pool.ts:236-245`); `auth-retry.ts` already supplies a call-scoped external counter and suspendable gate; root-only exports require no new package subpath.

## Pattern Assignments

### `packages/relay/src/nip45.ts` (protocol utility, transform/batch)

**Primary analog:** `packages/relay/src/negentropy.ts:28-57` keeps a protocol-specific error and pure helpers in one root module. `packages/common/src/helpers/blossom.ts:16-19,95-117` is the closest local validation/normalization/merge loop.

**Public signatures:**

```typescript
export class RelayCountResponseError extends Error { /* stable name */ }
export function mergeHllRegisters(values: Iterable<string>): string;
export function estimateHllCardinality(hll: string): number;
```

Also export a module-internal parser such as `parseRelayCountResponse(value: unknown): RelayCountResponse` for `relay.ts`; do not re-export that parser from the package barrel. One private HLL normalizer/decoder must be reused by the response parser, merge, and estimator so validation cannot drift.

**Error-class convention** (`negentropy.ts:28-37`, `management.ts:93-103`):

```typescript
export class RelayCountResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayCountResponseError";
  }
}
```

**HLL normalization contract:** full-string `/^[0-9a-fA-F]{512}$/`, exactly 256 byte pairs, lowercase output, no coercion, and no register ceiling narrower than uint8. Throw `RelayCountResponseError` for every malformed utility input and for an empty merge iterable.

**Register merge pattern** (`blossom.ts:95-117` supplies the local iterable/merge style): initialize from the first validated decoded value, then perform `merged[i] = Math.max(merged[i], current[i])` for all 256 registers. Encode a new lowercase string; never expose or mutate the decoded arrays supplied by a caller.

**Estimator contract:** fixed `m = 256`; `alpha = 0.7213 / (1 + 1.079 / m)`; raw estimate `alpha * m * m / sum(2 ** -register)`; use linear counting `m * Math.log(m / empty)` only when raw estimate is at most `2.5 * m` and at least one register is zero. Do not add the original 32-bit large-range correction: NIP-45 derives ranks from 32-byte pubkeys and leaves estimator quirks to clients.

**Response parser pattern:** validate first, then copy unknown own enumerable string fields into fresh data properties, then overwrite normalized known fields.

```typescript
if (typeof value !== "object" || value === null || Array.isArray(value)) fail("object");
const raw = value as Record<string, unknown>;
if (!Object.hasOwn(raw, "count") || !Number.isSafeInteger(raw.count) || (raw.count as number) < 0) fail("count");
if (Object.hasOwn(raw, "approximate") && typeof raw.approximate !== "boolean") fail("approximate");
const response = Object.fromEntries(Object.entries(raw)) as RelayCountResponse;
response.count = raw.count as number;
```

If `hll` is present, require a string, run the shared normalizer, and overwrite `response.hll`; preserve an absent field as absent. `Object.fromEntries(Object.entries(raw))` is the concrete safe-copy pattern because it creates own data properties, including for `"__proto__"`, instead of invoking the legacy prototype setter. Tests must still prove `Object.getPrototypeOf(result) === Object.prototype`, `Object.hasOwn(result, "__proto__")`, and no inherited pollution.

### `packages/relay/src/types.ts` (model/public API, request-response)

**Analog:** `PublishOptions` at `types.ts:120-131` defines the high-level retry/reconnect/timeout vocabulary and intersects the common auth surface once.

```typescript
export type RelayCountOptions = {
  retries?: boolean | number | Parameters<typeof retry>[0];
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  timeout?: number | boolean;
} & RelayAuthOptions;
```

Preserve all current auth fields through the intersection. Use the established precedence from `publish()` (`opts.retries` before `opts.reconnect`) and the existing boolean/number/`RetryConfig` interpretation. `timeout: true` selects the relay's COUNT default, `false` disables it, a number supplies milliseconds, and omission selects the 10-second default.

**Response shape:**

```typescript
export type RelayCountResponse = {
  count: number;
  approximate?: boolean;
  hll?: string;
  [key: string]: unknown;
};
```

The string index is intentional: strict known fields coexist with preserved future NIP-45 fields. Do not narrow Group/Pool response records or unwrap the result to `number`/`Promise`.

### `packages/relay/src/relay.ts` (service/protocol client, request-response/event-driven)

**Primary analogs:** current COUNT fresh-attempt pipeline at `relay.ts:1110-1217`; Phase 18 publish policy at `relay.ts:1547-1573`; shared auth adapter at `relay.ts:867-922`; constructor/default style at `relay.ts:237-265,408-428,521-542`.

#### Defaults and typed failures

Add `countTimeout?: number` beside `eventTimeout`/`publishTimeout`, public instance `countTimeout = 10_000`, and constructor assignment guarded with `!== undefined`, exactly like `eventTimeout` (`relay.ts:237-243,408-411,529-532`). Add `RelayCountTimeoutError` beside `RelayEventTimeoutError` (`relay.ts:170-176`) with a stable `.name`, relay URL property, and COUNT-specific message. Import `RelayCountResponseError` and the internal parser from `nip45.ts`; keep dependency direction `relay.ts -> nip45.ts`, never the reverse at runtime.

#### Socket boundary and terminal outcomes

Replace the unchecked cast at `relay.ts:1156-1158` with the parser before emission. For a non-auth `CLOSED`, throw `parseClosedError(reason) ?? new RelayClosedError(reason)` so unprefixed refusal is no longer a clean empty completion. After auth handling and `take(1)`, use `throwIfEmpty(() => new RelayCountResponseError(...))` so transport/source completion before a reply cannot become an RxJS `EmptyError` or silently strand `combineLatest`.

Malformed response, response-less completion, all non-auth CLOSED messages, terminal auth errors, and arbitrary/programming errors are terminal and must preserve error identity/class. They never enter generic retry.

#### Fresh resend attempt and sharing

Copy the existing CR-03 shape at `relay.ts:1132-1205`: the listener, `relayClosedSub`, COUNT write, and CLOSE finalizer stay inside the outer unshared `defer`. The attempt is recreated for every auth or generic retry resubscription. Preserve the attempt-local `messages.pipe(share())` only as the singleton used by `control` and the completion notifier; do not put `share()` around the attempt or policy pipeline.

```typescript
const operation = defer(() => createFreshCountAttempt()).pipe(
  this.authRetryOperator(describeRequest, opts, gate, () => true, authCounter),
  /* resolved transient policy */
  take(1),
  throwIfEmpty(() => new RelayCountResponseError("COUNT completed without a response")),
  /* resolved one-clock policy */
  share(),
);
```

Exactly one final `share()` remains outside auth/retry/timeout so four subscribers to one returned Observable cause one upstream operation and one COUNT frame. Two separate `count()` calls must allocate independent ids/gates/counters and cause independent operations.

#### Auth reentrancy and additive counters

Create both `gate` and `authCounter = { consecutive: 0 }` once per `count()` call, before any retry-resubscribed source. Pass the explicit counter to `authRetryOperator`, matching Phase 18 `publish()` at `relay.ts:1549-1567`. This prevents outer transient retry from recreating the auth budget. Preserve synchronous handler behavior: the CR-03 test at `relay.test.ts:2571-2609` proves the resent frame is not enough; the delayed second reply must reach the subscriber and only the successful attempt sends CLOSE.

#### Positive retry classification

The current `customRetryOperator` at `relay.ts:1407-1432` is publish-specific. Generalize it with a required classifier (or an equivalently centralized helper), then pass `isRetryablePublishError` from `publish()` and a COUNT classifier from `count()`. Do not use `customConnectionRetryOperator` (`relay.ts:1434-1454`), because it retries arbitrary non-`RelayClosedError` failures.

```typescript
function isRetryableCountError(error: unknown): boolean {
  return error instanceof RelayCountTimeoutError || isReconnectableTransportError(error);
}
```

Resolve policy input as `opts?.retries ?? opts?.reconnect ?? true` with `DEFAULT_RETRY_CONFIG`. The classifier is a positive allow-list: `RelayCountResponseError`, `RelayClosedError`, auth subclasses, empty-response errors, and sentinels bypass retry. See the blocking clock decision below before placing the timeout and retry operators.

### `packages/relay/src/index.ts` (public barrel)

**Analog:** the root barrel at `index.ts:1-7` and runtime export snapshot at `exports.test.ts:4-31`.

Keep existing star exports and add a named public export from `nip45.ts`:

```typescript
export {
  estimateHllCardinality,
  mergeHllRegisters,
  RelayCountResponseError,
} from "./nip45.js";
```

`RelayCountTimeoutError` remains exported through `export * from "./relay.js"`. Do not add `./nip45` to `package.json` unless the phase explicitly chooses a public subpath; the locked contract only requires package exports, and the root barrel is sufficient.

## Test Pattern Assignments

### `packages/relay/src/__tests__/nip45.test.ts` (new)

**Analog:** `packages/common/src/helpers/__tests__/blossom.test.ts:1-92` uses direct imports, focused `describe` blocks, and literal expected results for pure normalization/merge helpers.

Use test-local trivial hex encoding only to assemble fixture strings; never import a production decode/normalize helper or calculate expected estimator values with a second HLL implementation.

**Required independent estimate fixtures:**

| Registers | Expected estimate |
|---|---:|
| 256 × `0` | `0` exactly |
| one `1`, 255 × `0` | `1.0019582262108966` |
| 128 × `1`, 128 × `0` | `177.445678223346` |
| 256 × `1` | `367.7555677437675` |
| 256 × `2` | `735.511135487535` |

Use `toBeCloseTo` except for zero. The all-one fixture proves `V === 0` does not invoke linear counting; all-two proves the raw branch above the 640 threshold.

For merge, author three 256-byte arrays: each source wins at a distinct position and one position ties. Assert the complete 512-character expected string plus the winning byte positions, uppercase normalization, frozen/unchanged inputs, single-input copy behavior, and an invalid later iterable member throwing instead of returning a partial merge. Malformed controls: empty iterable, 510/514 characters, and non-hex at first/middle/last positions.

### `packages/relay/src/__tests__/relay.test.ts`

**Wire fixture pattern:** imports/setup at `relay.test.ts:1-53`; real frame assertions at `:2187-2225`; sharing at `:2253-2269`; readiness at `:2272-2286`; auth resend at `:2344-2401`; reentrancy at `:2571-2609`.

Extend the existing `describe("count")` and COUNT-auth sections rather than creating a parallel mock-only suite.

- Response matrix: valid zero/safe integer; `approximate` true and false; uppercase HLL normalization; unknown own field; JSON-created `__proto__`; null/array/missing/inherited/negative/fractional/string/non-finite/unsafe count; invalid optional fields. Every malformed case asserts zero emitted values and `RelayCountResponseError`.
- Terminal matrix: unprefixed and recognized CLOSED, completion/socket close before COUNT, malformed response, terminal auth errors, and an injected sentinel after a real frame all error once with no retry.
- Retry matrix: exact boolean/number/config defaults, reconnectable unclean transport causes a fresh real COUNT resend, and the chosen timeout semantics have a RED test before pipeline changes.
- Additive/concurrency: copy publish's exact wire-count style (`relay.test.ts:935-970`) and REQ's two-call independence (`:1635-1702`); use distinct COUNT ids and handlers and assert one call cannot consume the other's budgets.
- Sharing: retain the four-subscription oracle but also send a valid response and assert all four subscribers receive it; frame count alone can pass while subscribers are incorrectly disconnected.
- Auth clock: replace the old hardcoded fake-timer expectation (`:2240-2250`) with a short custom timeout. Adapt the real-timer arm/suspension proof at `:2496-2531` to the configurable budget, with auth duration greater than the operation budget and a successful reply after auth.
- Reentrancy: retain the delayed reply and one-CLOSE assertions at `:2571-2609`; a second COUNT frame alone is not proof of a fresh listener.

### `packages/relay/src/__tests__/group.test.ts`

**Analogs:** table-driven forwarding at `group.test.ts:192-289`; CR-03 group COUNT record at `:417-449`.

Extend the COUNT forwarding case so one options object containing auth fields plus `reconnect`, `retries`, and `timeout` reaches each `relay.count(filters, id, opts)` call with the exact caller id. Send responses carrying `approximate`, normalized `hll`, and one unknown field and prove the unchanged `Record<string, RelayCountResponse>` surface. Keep `combineLatest`, all-or-nothing errors, and non-progressive emission unchanged; those are COUNT-04/05 in Phase 23.

### `packages/relay/src/__tests__/pool.test.ts`

**Analog:** the extra-hop option table at `pool.test.ts:259-338` and direct COUNT forwarding at `:249-256`.

Add the three policy fields to the count-specific option object and assert the exact id/options reach the Relay through Pool -> Group. Include a positive compile/build assertion that the return remains `Observable<Record<string, RelayCountResponse>>`. Do not copy Phase 23 isolation/aggregation behavior into Pool tests.

### `packages/relay/src/__tests__/exports.test.ts`

**Analog:** inline sorted snapshot at `exports.test.ts:4-31`.

Add `RelayCountResponseError`, `RelayCountTimeoutError`, `estimateHllCardinality`, and `mergeHllRegisters` to the sorted runtime export snapshot. Types are checked by `pnpm --filter applesauce-relay build`, not by `Object.keys`.

## Documentation, Provenance, and Release Assignments

### `apps/docs/loading/relays/relays.md`

**Analog:** edit the existing Counting Events section at `relays.md:300-317`; do not create a standalone COUNT best-practices page.

Organize the expanded section as What it is, How to use it, Integration, then focused Best Practices. Keep each code block under about 20 lines. Document the preserved Observable/error-channel contract, caller id and auth/retry/reconnect/timeout options, validated `count`/`approximate`/`hll`, typed errors, and root HLL utility imports.

### `apps/docs/loading/relays/pool.md`

**Analog:** extend `pool.md:206-219` in place. Show Pool/Group forwarding of the same options and a compact HLL union example. Guard an empty sketch list before calling `mergeHllRegisters`; state explicitly that overlapping relay counts must not be summed. Do not claim Phase 19 isolates failures or emits partial records.

The existing VitePress sidebar already links both pages (`apps/docs/.vitepress/config.ts:60-68`), so no navigation edit is expected.

### `.planning/ROADMAP.md` and conditional `19-CONTEXT.md`

Change Phase 19 success criterion 2 at `ROADMAP.md:160-165` from “rejected promise” to “Observable error,” matching canonical COUNT-01 and the locked decision. Do not rewrite the historical backlog discussion at `ROADMAP.md:909-915`; it is useful provenance showing that Promise versus Observable was once open and later resolved.

The timeout/retry contradiction below requires an explicit decision. If the resolution changes either locked sentence, amend the existing relevant decision in `19-CONTEXT.md` in place with date/provenance; do not append a second competing contract.

### `.changeset/<focused-count-name>.md`

**Analog:** `.changeset/relay-event-publish-layering.md:1-5`.

```markdown
---
"applesauce-relay": minor
---

Make COUNT a validated high-level Observable with configurable policy and NIP-45 HLL utilities.
```

Use exactly one package and one Markdown sentence. `minor` is the smallest applicable bump for additive options, optional response fields, public errors, and helpers while preserving the Observable signature. Do not edit the existing auth/count changesets: they describe separate already-landed changes.

## Blocking Design Decision: One Clock vs Timeout Retry

The locked requirements cannot all be implemented by ordinary RxJS operator ordering:

```text
attempt -> suspendableTimeout -> retry
           retry sees timeout, but each retry gets a fresh clock and backoff is outside it

attempt -> retry -> suspendableTimeout
           one total clock includes readiness/backoff, but retry can never see its downstream timeout
```

A deadline error occurs only when the total budget is exhausted, so a “retry after that same deadline” has no useful budget left. Reusing one remaining-budget clock inside retry only changes the failure into immediate zero-budget resubscriptions (and any configured retry delay escapes the bound); it does not provide a meaningful response window.

The planner must surface and record one of these choices before changing `count()`:

1. **Whole-operation terminal timeout (research recommendation):** keep one suspendable outer clock covering readiness, backoff, and attempts; `RelayCountTimeoutError` is terminal; only reconnectable unclean transport failure resends. This preserves the stronger bounded-operation invariant but amends the sentence saying timeout is retryable.
2. **Retryable per-attempt timeout:** place the clock inside retry so a timeout causes a real resend; accept that the clock resets and does not include all backoff. This amends the whole-operation/single-clock semantic.
3. **Two clocks:** a retryable reply clock inside plus a terminal operation deadline outside. This satisfies useful timeout resend and total bounding but explicitly abandons the “one clock/no duplication” decision.

Do not hide the choice in operator order or write mutually inconsistent tests. The RED test must encode the selected behavior: total elapsed bound for option 1, a real post-timeout COUNT resend with a fresh response window for option 2, or both separately named clocks for option 3.

## Shared Patterns

### Observable ownership and freshness

- One returned COUNT Observable owns one high-level operation and ends with one outer `share()`.
- Every auth/transient resend resubscribes an unshared `defer` that creates a fresh listener and wire write together.
- Separate `count()` calls never share a gate, auth counter, retry counter, id, or operation clock.

### Authentication and clock suspension

- Reuse `AuthPhaseGate` and `authRetryOperator`; do not reimplement NIP-42 handling.
- Pass an explicit call-scoped auth counter so generic retry cannot reset it.
- `gate.begin()`/`end()` remain owned by `authRetry` (`auth-retry.ts:297-351`); the operation clock observes the same gate and pauses only while active.
- Preserve synchronous handler normalization and immediate resend (`auth-retry.ts:307-376`).

### Error and retry taxonomy

| Outcome | Error/value | Generic retry |
|---|---|---|
| Valid COUNT | one validated value, complete | no |
| Malformed known field | `RelayCountResponseError` | never |
| Completion/close without COUNT | typed response/no-response error | never |
| Non-auth CLOSED/refusal | `RelayClosedError` | never |
| Terminal auth failure | existing auth subclass | never |
| Arbitrary/programming error | original error identity | never |
| Reconnectable unclean transport | transport error | yes |
| COUNT timeout | `RelayCountTimeoutError` | blocked on clock decision |

### Forward-compatible response safety

- Require own `count`; do not accept inherited values or coercion.
- Preserve `approximate: false` exactly and infer no relationship among `count`, `approximate`, and `hll`.
- Preserve unknown own enumerable string fields through a fresh data-property-safe copy.
- Normalize valid HLL hex to lowercase before any value is emitted.

### Phase boundary

- No low-level COUNT sibling and no Promise convenience wrapper.
- No `RelayGroup.count()` isolation, progressive `scan`, aggregate scalar, or automatic HLL merge in Phase 19.
- Utilities enable correct union estimation; callers and Phase 23 decide when compatible sketches are available.

## Verification Commands

```bash
pnpm --filter applesauce-relay exec vitest run src/__tests__/nip45.test.ts
pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts -t "count|COUNT"
pnpm --filter applesauce-relay exec vitest run src/__tests__/group.test.ts src/__tests__/pool.test.ts
pnpm --filter applesauce-relay exec vitest run src/__tests__/exports.test.ts
pnpm --filter applesauce-relay build
pnpm --filter applesauce-relay test
pnpm --dir apps/docs build
```

At the phase gate, also audit that the new changeset body is one sentence, ROADMAP says Observable error, no unchecked `m[2] as RelayCountResponse` remains, Group still uses `combineLatest`, and root exports contain all four runtime additions.

## Principal Risks

| Risk | Concrete guard |
|---|---|
| Timeout/retry tests encode contradictory semantics | Resolve and amend the clock decision before implementation; start with a RED ordering test. |
| Retry recreates auth budget | Allocate and pass one explicit `authCounter` outside the retry-resubscribed source; assert additive frame count. |
| Auth resend writes but misses reply | Preserve CR-03 fresh `defer`; assert delayed reply and exactly one client CLOSE. |
| Final sharing moves inward | Four subscribers must see one frame and the same validated response. |
| Response validation strips future fields | Assert unknown field and `approximate: false` survive. |
| `__proto__` mutates prototype | Construct via data properties and assert own property plus unchanged prototype. |
| HLL tests duplicate implementation | Hard-code independent estimator constants and hand-authored merge winners. |
| Phase 23 leaks into Phase 19 | Assert `group.ts` retains `combineLatest` and record-shaped Observable output. |
| Public helpers exist but are unreachable | Update root barrel and runtime export snapshot; declaration build must pass. |

## Planner File Ownership Guidance

| Suggested work unit | Files owned | Dependency |
|---|---|---|
| NIP-45 types, parser, HLL math, and exports | `nip45.ts`, `types.ts`, `nip45.test.ts`, `index.ts`, `exports.test.ts` | none |
| COUNT policy and wire validation | `relay.ts`, COUNT regions of `relay.test.ts` | clock decision + NIP-45 parser |
| Group/Pool contract forwarding | `group.test.ts`, `pool.test.ts` | widened types/policy; no production edit expected |
| Docs, roadmap truth, and release entry | `relays.md`, `pool.md`, `ROADMAP.md`, conditional `19-CONTEXT.md`, new changeset | runtime contract green |

Because `relay.ts` and `relay.test.ts` contain the attempt, auth, retry, timeout, validation, and sharing seams together, give one executor sequential ownership of that unit. Do not split operator ordering and its wire tests across parallel edits.

## No Exact Analog Found

| File / concern | Reason | Planner fallback |
|---|---|---|
| `packages/relay/src/nip45.ts` HLL estimator | No HLL implementation exists in the repository | Use the formula and independent constants in `19-RESEARCH.md`; retain local pure-helper/error conventions. |

## Metadata

**Analog search scope:** Phase 18 plans/summaries/pattern map; current Relay COUNT/EVENT/REQ/publish/auth/retry/defaults; Group/Pool forwarding; relay and pure-helper tests; root exports/package exports; relay docs/VitePress navigation; relevant changesets; ROADMAP and COUNT-01..03.

**Strong analogs used:** 5 (`Relay.count`, `Relay.publish`, `authRetry`/`suspendableTimeout`, Group/Pool structural forwarding, Blossom pure-helper tests)

**Pattern extraction date:** 2026-08-21
