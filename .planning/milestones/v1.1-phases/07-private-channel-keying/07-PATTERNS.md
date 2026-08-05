# Phase 7: Private Channel Keying - Pattern Map

**Mapped:** 2026-07-17
**Files analyzed:** 4 new/modified artifact groups (error class, ChannelView type, tests, reactivity plumbing) + 4 existing modify sites (already exact-cited in CONTEXT.md, confirmed only)
**Analogs found:** 4 / 4 for new artifacts

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `MissingChannelKeyError` (new, in `client/community.ts`) | error class | request-response (thrown from `sendMessage`) | `packages/relay/src/management.ts:94` `RelayManagementError` | role-match (only `extends Error` convention in repo family; no base class in `packages/concord`) |
| `ChannelView` (new type, `client/community.ts` near `channels$`) | model / enriched view | event-driven (client-local flag on emitted stream) | `packages/concord/src/client/community.ts:511` composite `status$` via `combineLatest({...})`, and `packages/relay/src/relay.ts:511` `Relay.status$` | exact (same package's own composite-observable convention) |
| Five TEST-02 Accordian tests + channel-deletion-terminality test | test | CRUD / spec-derived assertion | `helpers/__tests__/keys.test.ts:216-260` (rollForward spec-derived probe) and `helpers/__tests__/channel-rekey.test.ts:92-118` (channel-plane spec-derived probe) | exact |
| `materialChanged$` reactivity plumbing | event-driven / pub-sub | Subject-driven re-emission | `packages/concord/src/client/community.ts:232-249` (`slice()` helper + `dissolved$`/`channels$` pattern) and `packages/relay/src/relay.ts:411-417` (`combineLatest([...]).pipe(distinctUntilChanged())`) | exact |

## Pattern Assignments

### `MissingChannelKeyError` (error class)

**Analog:** `packages/relay/src/management.ts:94` — `RelayManagementError` (closest existing exported custom error class in the monorepo family; confirmed via research that **no** `extends Error` class exists anywhere in `packages/concord/src` today — every throw site there is a bare `new Error(...)`, e.g. `client/community.ts:767,778,922,923,929,949,1057,1058,1111,1119`).

**Pattern to copy** — minimal subclass, no shared base, name mirrored in `.name`:
```typescript
// packages/relay/src/management.ts:94 (analog convention: extends Error, sets .name, carries one typed field)
export class RelayManagementError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = "RelayManagementError";
  }
}
```

**Apply as** (per RESEARCH.md §5, D-06 — co-locate with the throw site, no base class needed since none exists in this package):
```typescript
// client/community.ts, co-located near sendMessage
export class MissingChannelKeyError extends Error {
  constructor(public readonly channelId: string) {
    super("missing private channel key");
    this.name = "MissingChannelKeyError";
  }
}
```

**Instanceof-catch convention** — consumers `instanceof`-catch to distinguish from the generic `planeKeyFor` "unknown channel" throw (`keys.ts:209`), matching the general pattern of typed errors used for consumer-facing branching rather than generic `Error`. No existing `instanceof MyError` catch site was found in `packages/concord` (first custom error in the package) — this establishes the convention, it does not extend one.

**Export path:** co-located with `sendMessage` in `client/community.ts` (matches this package's convention of defining error-adjacent logic next to its throw site — confirmed by RESEARCH.md §5), then re-exported from the package's public `index.ts` alongside other client exports.

---

### `ChannelView` (enriched view type carrying `accessible: boolean`)

**Analog 1 — composite/derived observable within `ConcordCommunity` itself:** `packages/concord/src/client/community.ts:255-258` (composite `status$` combining multiple granular `$` fields):
```typescript
this.connected$ = this.relayAuth.connected$(this.relays());
this.authenticated$ = this.relayAuth.authenticated$(this.relays(), () => this.currentAuthors());
this.status$ = combineLatest({
  phase: this.phase$,
  epoch: this.epoch$,
  // ...additional granular fields merged into one emitted object
});
```

**Analog 2 — the `slice()` distinctUntilChanged helper already used for every granular `$` field**, `client/community.ts:238-246`:
```typescript
const slice = <T>(select: (s: CommunityState) => T): Observable<T> =>
  this.state$.pipe(map(select), distinctUntilChanged());
this.metadata$ = slice((s) => s.metadata);
this.channels$ = slice((s) => s.channels);
// members$ deviates with a content comparator instead of reference:
this.members$ = this.state$.pipe(map((s) => s.members), distinctUntilChanged(sameSet));
```

**Analog 3 (applesauce Relay-class precedent, per phase context's naming):** `packages/relay/src/relay.ts:411-417`:
```typescript
this.authenticated$ = combineLatest([this.authenticatedPubkeys$, this.authenticationResponse$]).pipe(
  map(/* derive composite boolean */),
  distinctUntilChanged(),
);
this.authenticatedAs$ = combineLatest([this.authenticatedPubkeys$, this.authenticated$, this.authentication$]).pipe(/* ... */);
```

**Pattern to apply (from RESEARCH.md, matches all three analogs' shape):**
```typescript
export type ChannelView = ChannelMetadata & { accessible: boolean };

this.channels$ = combineLatest([
  slice((s) => s.channels),
  this.materialChanged$.pipe(startWith(undefined as void)),
]).pipe(
  map(([channels]) => channels.map((c): ChannelView => ({
    ...c,
    accessible: !c.private || hasChannelKey(this.material, c.channel_id),
  }))),
  distinctUntilChanged(sameChannelViews), // must compare `accessible` per-entry, like `members$`'s `sameSet` comparator, not just reference
);
```
Note the `members$` precedent (content comparator instead of bare reference `distinctUntilChanged()`) is the direct analog for why `channels$` needs a custom `sameChannelViews` comparator once it becomes a derived/mapped array rather than a raw `state$` slice.

---

### Five TEST-02 Accordian-named tests + channel-deletion-terminality test

**Analog 1:** `helpers/__tests__/channel-rekey.test.ts:92-118` — full spec-derived-expected-value pattern (**copy this shape verbatim for every new test**):
```typescript
it("rollForwardChannel's plane address matches the CORD-03 §1 private formula over the new key/epoch", async () => {
  const { material } = await genesis();
  const channel = privateChannel();

  // ARM THE MEMO: ... deriveChannelKeys must be called explicitly on the
  // ORIGINAL channel to write ChannelPlaneKeysSymbol onto it ...
  const before = deriveChannelKeys(material, channel);

  const newKey = bytesToHex(generateSecretKey());
  const newEpoch = channel.epoch + 1;

  // EXPECTED, independently derived from the spec formula's PRIVATE branch:
  const expected = channelGroupKey(hexToBytes(newKey), hexToBytes(channel.id), newEpoch);

  const rolled = rollForwardChannel(channel, newKey, newEpoch);
  const after = deriveChannelKeys(material, rolled);

  expect(after.current.pk).toBe(expected.pk);
  expect(after.current.pk).not.toBe(before.current.pk);
});
```

**Analog 2:** `helpers/__tests__/keys.test.ts:216-260` — same "EXPECTED, independently derived ... never via [implementation function]" comment convention, plus the "ARM THE MEMO" non-vacuity guard comment — both must be replicated in every new spec-derived test in this phase (per RESEARCH.md's own repeated warning about vacuous tests that pass even against pre-fix code).

**Key conventions to replicate exactly, per D-11/D-12 and RESEARCH.md's Common Pitfalls:**
1. Comment stating which spec section/formula backs the expected value (e.g. "CORD-03 §1").
2. Comment stating the expected value is computed ONLY from `crypto.ts` primitives (`channelGroupKey`/`controlGroupKey`), never via `channelKeyFor`/`deriveConcordKeys`/`rollForwardChannel` — explicitly named as non-self-referential.
3. An explicit "ARM THE MEMO" step where the pre-refactor object's memo is populated before the roll-forward/mutation, so a regression would be caught rather than the test passing vacuously.
4. Keyless-private assertion (D-11's sharpest case) must assert `channelKeyFor(...)` / `channelSecret(...)` returns `null`/nothing — **never** assert equality against the independently-derived public address (that equality IS the H07 bug being tested against).

**Channel-deletion-terminality test — additional analog for the compaction round-trip shape** (per RESEARCH.md Pitfall 1's required simulation): delete → resurrect-attempt → compact via `buildRefounding` → fold a fresh `foldControl` using only the compacted heads (simulating a new joiner) → assert still-deleted. No existing test does this compaction-then-fresh-fold round trip; model it on `channel-rekey.test.ts`'s `genesis()` + `buildRefounding()` setup helpers (same file, lines preceding `:92`) since those are the only existing calls to `buildRefounding` in a test context.

**Home for new tests:** No dedicated `helpers/__tests__/control.test.ts` exists — CHAN-04/CHAN-07 fold-level tests should land in `helpers/__tests__/community.test.ts` (already imports from `../community.js`, adjacent to `control.ts`) unless a new file is deliberately created; confirm during planning per RESEARCH.md's Wave 0 Gaps note.

---

### `materialChanged$` reactivity plumbing (CHAN-06 gap)

**Analog 1 — the existing `slice()` + granular-field convention this must slot into,** `client/community.ts:232-249` (already shown above) — establishes that every `$` field in this class is either a plain `state$` slice or a `combineLatest` composite; `materialChanged$` is a new third category (a raw internal `Subject` with no backing `state$` value) needed because `this.keys.material.channels` mutations currently have **no** observable path into the class's reactive graph at all.

**Analog 2 — `dissolved$`'s minimal derivation shape** (`client/community.ts:232-235`), useful as the smallest example of a one-line derived observable in this file:
```typescript
this.dissolved$ = this.state$.pipe(
  map((s) => s.dissolved),
  distinctUntilChanged(),
);
```

**Analog 3 — applesauce Relay class's `combineLatest([...]).pipe(distinctUntilChanged())` composite pattern**, `packages/relay/src/relay.ts:411-417` (cited above) — same shape recommended for the new `channels$` definition combining the state slice with the new `materialChanged$` Subject.

**Pattern to apply (from RESEARCH.md's own recommended fix, matches Analog 1's `slice()` idiom extended with a `Subject`):**
```typescript
private materialChanged$ = new Subject<void>();

// Call sites that must emit — the four found by RESEARCH.md:
// receiveChannelKeys (:601-610), persistChannelKey (:636-640),
// dropChannelKey (:651-660), mintChannelKey callback wired via admin.ts (:297-300)
private noteMaterialChanged(): void {
  this.materialChanged$.next();
}
```
Each of the four mutation sites gains one call to `this.materialChanged$.next()` (or the private helper above) right after mutating `this.keys.material.channels`, mirroring how `state$.next(...)` is called after every fold mutation elsewhere in the same file — i.e., "mutate state, then notify the reactive graph" is the established idiom this plumbing extends to material, not a new one.

## Shared Patterns

### `combineLatest` composite-observable convention (applies to `channels$` AND `materialChanged$`)
**Source:** `packages/concord/src/client/community.ts:255-258` (`status$`) and `packages/relay/src/relay.ts:411-417` (`authenticated$`/`authenticatedAs$`)
**Apply to:** the redefined `channels$` (CHAN-06) — combine the existing `state$`-derived slice with the new `materialChanged$` Subject, always terminating in `distinctUntilChanged()` with a content comparator when the emitted value is a derived array/object rather than a stable reference (mirrors `members$`'s `sameSet` comparator at `client/community.ts:248-250`).

### Custom error class convention (applies to `MissingChannelKeyError`)
**Source:** `packages/relay/src/management.ts:94` (`RelayManagementError`) — only existing `extends Error` convention in the monorepo family; `packages/concord/src` has none prior to this phase.
**Apply to:** `MissingChannelKeyError` — `extends Error`, sets `this.name`, carries one typed field (`channelId`), thrown from `sendMessage` before the generic `planeKeyFor` "unknown channel" backstop (`keys.ts:209`) is ever reached.

### Spec-derived, non-self-referential test convention (applies to all TEST-02/TEST-01/ROTATE-03 tests)
**Source:** `helpers/__tests__/channel-rekey.test.ts:92-118`, `helpers/__tests__/keys.test.ts:216-260`
**Apply to:** every new test in this phase — comment citing the spec section, expected value computed only via `crypto.ts` primitives, an explicit "ARM THE MEMO" non-vacuity step wherever a memoized/cached value is involved, and the keyless-private case asserting `null`/nothing rather than an address match.

## No Analog Found

None — all four new-artifact categories had a strong (exact or role-match) analog either within `packages/concord/src` itself or in the adjacent `packages/relay/src` package within the same monorepo family. The existing modify sites (`community.ts`, `control.ts`, `keys.ts`, `types.ts`) are direct edits to code already fully cited by file:line in `07-CONTEXT.md`'s `<canonical_refs>` and needed no separate analog search.

## Metadata

**Analog search scope:** `packages/concord/src/client/community.ts`, `packages/concord/src/helpers/__tests__/*.test.ts`, `packages/relay/src/relay.ts`, `packages/relay/src/management.ts`
**Files scanned:** 6 (2 concord source, 2 concord test, 2 relay source), plus grep sweep of `packages/concord/src` for `extends Error` / `export class.*Error` (zero matches, confirming no in-package base error class)
**Pattern extraction date:** 2026-07-17
