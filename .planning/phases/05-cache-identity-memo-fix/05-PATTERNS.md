# Phase 5: Cache Identity Memo Fix - Pattern Map

**Mapped:** 2026-07-15
**Files analyzed:** 8 (2 primary changes + 3 test files + 1 changeset + comment-sweep pattern + 1 concord comment fix)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|-----------------|---------------|
| `packages/core/src/helpers/cache.ts` | utility (memoization) | transform | itself (18 lines, being edited in place) | n/a — read in full below |
| `packages/core/src/helpers/__tests__/cache.test.ts` (new) | test | transform + request-response | `packages/common/src/operations/__tests__/tags.test.ts` (memo/spread half) + `packages/common/src/factories/__tests__/git-lists.test.ts` (real-signing half) | exact (composite) |
| `packages/concord/src/helpers/__tests__/keys.test.ts` | test | CRUD (fixture-derived) | itself — existing `describe("ConcordKeys", …)` suite, new case added | exact (extend existing file) |
| `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` | test | CRUD (fixture-derived) | itself — existing `describe("channel-scoped rekey", …)` suite, new case added | exact (extend existing file) |
| ~33 comment-only sweep sites (`core`/`common`) | (mixed: helper/operation) | n/a (comment only) | `packages/concord/src/helpers/keys.ts:90-100` (`BaseKeysSymbol` block comment) and `packages/core/src/helpers/pipeline.ts:4` (`PRESERVE_EVENT_SYMBOLS` one-liner JSDoc) | role-match (comment-density template) |
| `packages/concord/src/helpers/keys.ts:98-104` | comment correction | n/a | itself (in-place edit) | n/a |
| `.changeset/*.md` (new, core patch) | config/doc | n/a | `.changeset/cache-group-key-derivation.md` | exact |

## Pattern Assignments

### `packages/core/src/helpers/cache.ts` (utility, transform) — MODIFY IN PLACE

**Current full content** (18 lines, `packages/core/src/helpers/cache.ts:1-18`):
```typescript
export function getCachedValue<T extends unknown>(event: any, symbol: symbol): T | undefined {
  return Reflect.get(event, symbol);
}

export function setCachedValue<T extends unknown>(event: any, symbol: symbol, value: T) {
  Reflect.set(event, symbol, value);
}

/** Internal method used to cache computed values on events */
export function getOrComputeCachedValue<T extends unknown>(event: any, symbol: symbol, compute: () => T): T {
  if (Reflect.has(event, symbol)) {
    return Reflect.get(event, symbol);
  } else {
    const value = compute();
    Reflect.set(event, symbol, value);
    return value;
  }
}
```

**Required change (D-02):** both `Reflect.set(event, symbol, value)` call sites (lines 6 and 15) become:
```typescript
Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true });
```
`getCachedValue`/`Reflect.has`/`Reflect.get` reads are unaffected — only the two writes change.

**Canonical taxonomy prose (D-06) lands here** — model the explanatory-comment density on the `BaseKeysSymbol` block comment excerpted below (concord's own worked, prose-heavy symbol-memo doc comment) rather than the one-line JSDoc currently on `getOrComputeCachedValue`. Cross-reference `PRESERVE_EVENT_SYMBOLS` (`pipeline.ts:5`) and `event-store.ts:219`'s merge list per D-07.

---

### `packages/core/src/helpers/__tests__/cache.test.ts` (new file, test)

No test file exists for `cache.ts` today — this is the highest-value analog gap. Two source files supply the two D-13 halves.

**Import/describe/it shape** (from `packages/core/src/helpers/__tests__/encrypted-content.test.ts:1-6`, the sibling test file in the *same* `__tests__/` directory — use this for the `.js`-extension import convention and top-level `describe` grouping):
```typescript
import { describe, it, expect } from "vitest";
import { kinds } from "../event.js";
import { getEncryptedContentEncryptionMethods, EncryptedContentSigner } from "../encrypted-content.js";

describe("getEncryptedContentEncryptionMethods", () => {
  // ...
  it("should return nip04 encryption methods for EncryptedDirectMessage", () => {
    const methods = getEncryptedContentEncryptionMethods(kinds.EncryptedDirectMessage, mockSigner);
    expect(methods).toBe(mockSigner.nip04);
  });
});
```
For `cache.test.ts`, import from `../cache.js` (`getCachedValue`, `setCachedValue`, `getOrComputeCachedValue`).

**Half 1 — memo DROPPED by spread (proves CACHE-01).** Closest existing shape is `packages/common/src/operations/__tests__/tags.test.ts:30-53` — it writes a symbol onto a plain object literal and asserts via `Reflect.get`/`Reflect.has` after a transform, which is the exact assertion shape needed (just invert the expectation to "no longer present after spread"):
```typescript
it("should set EncryptedContentSymbol with plaintext hidden tags", async () => {
  const operation = modifyHiddenTags(user, (tags) => [...tags, ["e", "test-id"]]);
  const draft = await operation({ kind: kinds.BookmarkList, content: "", tags: [], created_at: unixNow() });

  expect(Reflect.get(draft, EncryptedContentSymbol)).toBe(JSON.stringify([["e", "test-id"]]));
});
```
Adapt: `setCachedValue(obj, symbol, value)` on a plain mutable object → `const spread = { ...obj, field: "changed" }` → `expect(Reflect.has(spread, symbol)).toBe(false)`.

**Half 2 — CARRY-FORWARD survives real pipe + real signing (proves CACHE-03, D-15).** This is the single most valuable excerpt in the whole map — a real factory builder driving `.as(user)... .sign()` then reading decrypted content back off the signed event, from `packages/common/src/factories/__tests__/git-lists.test.ts:26-36`:
```typescript
it("adds hidden authors", async () => {
  const user = new FakeUser();
  const author = HEX("c");
  const event = await GitAuthorsFactory.create().as(user).addAuthor(author, true).sign();

  expect(event.tags).toEqual([]);
  await unlockHiddenTags(event, user);
  expect(getHiddenTags(event)).toEqual([["p", author]]);
  expect(event.content).not.toBe("");
});
```
And the lower-level `eventPipe(...)(...)` shape (no factory builder, just the pipe directly — useful if `cache.test.ts` drives `eventPipe`/`tagPipe` directly rather than through a factory) from `packages/common/src/operations/__tests__/tags.test.ts:55-61`:
```typescript
it("should set hidden tags", async () => {
  const draft = await eventPipe(modifyHiddenTags(user, (tags) => [...tags, ["e", "test-id"]]))(
    blankEventTemplate(30000),
  );
  expect(getHiddenTags(draft)).toEqual([["e", "test-id"]]);
});
```
For CACHE-03, swap in an encrypted-content operation (e.g. from `operations/event.ts:134,163`, the `stamp`/`sign` `EncryptedContentSymbol` write sites) and finish with `signer.signEvent(...)` (via `FakeUser`, see below) then `getEncryptedContent(signedEvent)` / `getHiddenTags(signedEvent)`.

**`FakeUser` test fixture** (`packages/common/src/__tests__/fixtures.ts:16-50`) — the shared signer used across the codebase's real-signing tests; reuse directly rather than hand-rolling a mock signer:
```typescript
export class FakeUser implements EncryptedContentSigner, EventSigner {
  key = generateSecretKey();
  pubkey = getPublicKey(this.key);
  nip04 = { encrypt: (pubkey, plaintext) => nip04.encrypt(this.key, pubkey, plaintext), decrypt: /* ... */ };
  nip44 = { encrypt: /* ... */, decrypt: /* ... */ };
  getPublicKey() { return this.pubkey; }
  signEvent(draft: EventTemplate | UnsignedEvent) { return finalizeEvent(draft, this.key); }
}
```
Note: `packages/core/src/helpers/__tests__/` has no local fixtures file of its own (core doesn't depend on common) — either inline a minimal signer matching `EventSigner`/`EncryptedContentSigner`, or construct one ad hoc with `generateSecretKey()`/`finalizeEvent` from `applesauce-core/helpers/keys` and `applesauce-core/helpers/event` directly (both already imported by `fixtures.ts` above, confirming they're core-native, no cross-package dependency needed).

**`pipeFromAsyncArray`/`PRESERVE_EVENT_SYMBOLS` mechanism under test** (`packages/core/src/helpers/pipeline.ts:1-70`, read in full — 70 lines):
```typescript
export const PRESERVE_EVENT_SYMBOLS = new Set([EncryptedContentSymbol]);

export function eventPipe(...operations: (EventOperation | undefined)[]): EventOperation {
  return pipeFromAsyncArray(operations.filter((o) => !!o), PRESERVE_EVENT_SYMBOLS);
}

export function pipeFromAsyncArray<T, R>(fns: Array<Operation<T, R>>, preserve?: Set<symbol>): Operation<T, R> {
  return async function piped(input: T): Promise<R> {
    return fns.reduce(async (prev: any, fn: Operation<T, R>) => {
      const result = await fn(await prev);
      if (preserve && typeof result === "object" /* ... */) {
        const keys = Reflect.ownKeys(result).filter((key) => typeof key === "symbol");
        for (const symbol of keys) {
          if (!preserve.has(symbol)) Reflect.deleteProperty(result, symbol);
        }
      }
      return result;
    }, input as any);
  };
}
```
This is *why* `configurable: true` is required in the D-02 fix — `Reflect.deleteProperty` at line 63 throws on a non-configurable property.

---

### `packages/concord/src/helpers/__tests__/keys.test.ts` (existing, gaining H01(a) case)

**File header comment convention** (lines 1-3) — every concord test file opens with a prose comment naming the spec/CORD reference and what's exercised; new case's surrounding file already has this, no new header needed, but the *pattern* for any new describe block is:
```typescript
// The single ConcordKeys state object + its functional operations, exercised
// with no ConcordClient: derive → wrap → decode-via-planes → refound → readRekey
```

**Fixture/genesis helper reused** (lines 24-28):
```typescript
async function genesis(name = "Test") {
  const owner = new PrivateKeySigner(generateSecretKey());
  const ownerPub = await owner.getPublicKey();
  const g = await createCommunity({ ownerPubkey: ownerPub, name, relays: ["wss://x"] });
  return { owner, ownerPub, material: g.material, generalChannelId: g.generalChannelId };
}
```
New H01(a) case should call `genesis()`, then `rollForward(deriveConcordKeys(material, []), newRoot, newEpoch, refounder, [])` and compare `.control.pk` against `controlGroupKey(newRoot, hexToBytes(communityIdBytes), newEpoch).pk` (from `crypto.ts:123-125`, imported independently — never from `keys.ts`/`deriveConcordKeys` itself, per D-18).

**Assertion style** (lines 44-55, `deriveConcordKeys` test) — `toMatchObject`/`toBe` directly on `.control.pk`, `.planes.get(...)`:
```typescript
it("deriveConcordKeys builds every plane address + a decrypt lookup", async () => {
  const { material } = await genesis();
  const keys = deriveConcordKeys(material, []);
  expect(keys.planes.get(keys.control.pk)).toMatchObject({ type: "control", convKey: keys.control.convKey });
});
```

**`crypto.ts` signatures to import directly** (`packages/concord/src/helpers/crypto.ts:118-125`):
```typescript
export function channelGroupKey(secret: Uint8Array, channelId: Uint8Array, epoch: number): GroupKey {
  return groupKey("concord/channel", secret, channelId, epoch);
}
export function controlGroupKey(root: Uint8Array, communityId: Uint8Array, epoch: number): GroupKey {
  return groupKey("concord/control", root, communityId, epoch);
}
```

---

### `packages/concord/src/helpers/__tests__/channel-rekey.test.ts` (existing, gaining H01(c) case)

**Existing `rollForwardChannel` case to extend alongside** (lines 68-83) — this is the exact shape the new spec-derived case slots next to:
```typescript
it("rollForwardChannel retains the prior key (newest-first) so old epochs still derive", async () => {
  const { material } = await genesis();
  const channel = privateChannel();
  const rolled = rollForwardChannel(channel, bytesToHex(generateSecretKey()), 2);

  expect(rolled.epoch).toBe(2);
  expect(rolled.held?.[0]).toMatchObject({ epoch: 1, key: channel.key });
  expect(channel.held).toBeUndefined(); // input untouched (pure)

  const keys = deriveChannelKeys(material, rolled);
  expect(keys.planes.get(keys.held[0].key.pk)).toMatchObject({ type: "channel", epoch: 1 });
});
```
**`privateChannel()` fixture builder** (lines 29-31) to construct the `ChannelKey` input:
```typescript
function privateChannel(name = "secret-room"): ChannelKey {
  return { id: bytesToHex(generateSecretKey()), key: bytesToHex(generateSecretKey()), epoch: 1, name };
}
```
New H01(c) case: `const rolled = rollForwardChannel(channel, newKeyHex, newEpoch)`, then `deriveChannelKeys(material, rolled).current.pk` compared against `channelGroupKey(hexToBytes(newKeyHex), hexToBytes(channel.id), newEpoch).pk` computed independently via `crypto.ts`.

---

### ~33 comment-only sweep sites (`core`/`common`) — no behavior change, D-08

**Template A — dense worked-example block comment** (`packages/concord/src/helpers/keys.ts:90-100`, the `BaseKeysSymbol`/`ChannelKeysSymbol` comment — use this density/shape for the canonical taxonomy prose in `cache.ts` itself, and as the model for any sweep site that needs more than one line):
```typescript
/**
 * Every group key derives from `material` (...), which is a STABLE object on
 * the hot path — `deriveConcordKeys` returns the same `material` it was
 * handed, and `reconcileLive` threads that one object through every state
 * emission. So we memoize the expensive secp256k1 derivations directly on it
 * (the repo's `getOrComputeCachedValue` symbol pattern), computed once and
 * reused until a rekey/Refounding mints a fresh `material` — exactly when the
 * keys must change.
 */
```

**Template B — one-line pointer comment** (`packages/core/src/helpers/pipeline.ts:4`, the model for each of the 33 sweep sites — a single line naming the category and pointing back at `cache.ts`):
```typescript
/** An array of Symbols to preserve when building events with {@link eventPipe} */
export const PRESERVE_EVENT_SYMBOLS = new Set([EncryptedContentSymbol]);
```
Each sweep site gets a comment in this shape, e.g.:
```typescript
// Identity memo (see cache.ts taxonomy) — must NOT survive a spread; recomputed from HiddenTagsSymbol's own decrypted content.
Reflect.set(event, HiddenTagsSymbol, tags);
```

---

### `packages/concord/src/helpers/keys.ts:98-104` (comment-only correction, D-11)

**Current (false) prose to correct** (already excerpted above as Template A) — the phrase `"until a rekey/Refounding mints a fresh material — exactly when the keys must change"` is the false claim (it was false before the memo fix, is made true by it); correct it to state that this is now true post-fix, or soften the claim to acknowledge the prior bug and this phase's resolution, per D-11.

---

### `.changeset/*.md` (new file, config)

**Exact frontmatter + single-sentence body shape**, from `.changeset/cache-group-key-derivation.md:1-5` (note: this existing changeset is for a *related but different* prior fix — same package/area, useful as the closest sibling example):
```markdown
---
"applesauce-concord": patch
---

Memoize group-key derivation on the community key material so a community's stream keys are derived once instead of on every folded-state change and twice per synced epoch.
```
Per D-03, the new changeset targets `"applesauce-core": patch` with a single sentence describing the identity-memo-vs-spread fix (e.g., "Fix `setCachedValue`/`getOrComputeCachedValue` to write non-enumerable so a cached memo does not survive an object spread"). One file, one sentence, no bullets/code blocks — per CLAUDE.md's changeset rule.

## Shared Patterns

### Symbol-keyed caching write mechanism
**Source:** `packages/core/src/helpers/cache.ts` (post-fix)
**Apply to:** the two write call sites inside `cache.ts` itself; referenced (not modified) by all ~149 downstream callers and all 33 sweep-comment sites.

### `Reflect`-based symbol assertions in tests
**Source:** `packages/common/src/operations/__tests__/tags.test.ts:34,51-52`
**Apply to:** `cache.test.ts`'s memo-drop half
```typescript
expect(Reflect.get(draft, EncryptedContentSymbol)).toBe(/* value */);
expect(Reflect.has(spreadCopy, symbol)).toBe(false);
```

### Real-signing end-to-end test shape
**Source:** `packages/common/src/factories/__tests__/git-lists.test.ts:26-36` + `packages/common/src/__tests__/fixtures.ts` (`FakeUser`)
**Apply to:** `cache.test.ts`'s carry-forward half — `.as(user)....sign()` (or raw `eventPipe(...)` + `signer.signEvent(...)`) then read decrypted content back off the signed result.

### Concord test file header + genesis fixture
**Source:** `packages/concord/src/helpers/__tests__/keys.test.ts:1-28`, `channel-rekey.test.ts:1-51`
**Apply to:** the two new spec-derived cases — reuse `genesis()`/`privateChannel()` rather than hand-building `JoinMaterial`/`ChannelKey`.

### Independent spec-formula computation (never call code under test)
**Source:** `packages/concord/src/helpers/crypto.ts:118-125` (`channelGroupKey`, `controlGroupKey`)
**Apply to:** both new spec-derived test cases' expected-value computation, per D-18 — import directly from `crypto.ts`, never derive expected values via `rollForward`/`rollForwardChannel`/`deriveConcordKeys`/`deriveChannelKeys`.

## No Analog Found

None — every file/site in the phase's settled scope has at least a role-match analog above.

## Metadata

**Analog search scope:** `packages/core/src/helpers/`, `packages/core/src/helpers/__tests__/`, `packages/common/src/{operations,factories,helpers}/__tests__/`, `packages/common/src/__tests__/fixtures.ts`, `packages/concord/src/helpers/`, `packages/concord/src/helpers/__tests__/`, `.changeset/`
**Files scanned:** ~15 (cache.ts, pipeline.ts, encrypted-content.ts + its test, tags.test.ts, git-lists.test.ts, fixtures.ts, keys.test.ts, channel-rekey.test.ts, keys.ts excerpts, crypto.ts excerpt, one changeset)
**Pattern extraction date:** 2026-07-15
```
