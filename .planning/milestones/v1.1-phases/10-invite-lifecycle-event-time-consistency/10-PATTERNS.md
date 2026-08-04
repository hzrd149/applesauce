# Phase 10: Invite Lifecycle & Event Time Consistency - Pattern Map

**Mapped:** 2026-07-21
**Files analyzed:** 9 modified + 2 net-new test files (11 total)
**Analogs found:** 11 / 11 (this is "activate/extend a correct sibling" work — every file's analog is named directly in RESEARCH.md and verified this session)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `packages/concord/src/client/client.ts` (`joinByLink`) | service/controller | request-response (relay fetch + collapse) | `packages/core/src/event-store/event-store.ts:255-270,308-322` (NIP-01 replaceable collapse) | exact (logic to replicate, different call site) |
| `packages/concord/src/helpers/invite-bundle.ts` (`validateInviteBundle`) | utility (validator) | transform (fail-closed guard) | `packages/concord/src/helpers/control.ts:210` (AUTH-04 `Array.isArray` guard) | exact |
| `packages/concord/src/helpers/invite-bundle.ts` (`decodeFragment`) | utility (parser) | transform | itself, prior-phase guard idiom (`control.ts` fail-closed convention) | role-match |
| `packages/concord/src/helpers/invite-bundle.ts` (`getInviteBundleVsk`/`isInviteBundleRevoked`) | utility (parser) | transform | `packages/concord/src/helpers/stream.ts:35-39` (`hasMalformedMs`'s "present but unparseable ⇒ treat specially" shape) | role-match |
| `packages/concord/src/client/community.ts` (`refreshInviteBundles`) | service | batch (per-item try/skip loop) | same file, `revokeInvite`/adjacent per-link publish-with-catch pattern (`.pool.publish(...).catch(...)` at `client.ts` and `community.ts:1148`) | role-match |
| `packages/concord/src/client/invite-manager.ts`, `client/community.ts`, `helpers/invite-bundle.ts`, `types.ts` (`expires_at` unit sites) | model/utility | transform (unit conversion, no logic branch) | itself — mechanical multi-site rename/unit-fix, no external analog needed | n/a (locked/mechanical) |
| `packages/concord/src/operations/channel.ts` (`includeMs`/`bindToChannel`) | utility (EventOperation) | transform (choke-point single clock read) | `packages/concord/src/helpers/stream.ts:16-18` (`splitTime`, the dead-code correct pairing) | exact |
| `packages/concord/src/operations/guestbook.ts` (`includeSnapshotChunk`) + `packages/concord/src/factories/guestbook.ts` (`SnapshotFactory`/`buildSnapshotFactories`) | utility/factory | transform (caller-threaded shared timestamp) | `packages/concord/src/operations/channel.ts:22-38` (`includeMs`/`bindToChannel`, once TIME-01 fixed) | role-match (same mechanism, one call-depth up) |
| `packages/concord/src/helpers/stream.ts` (`parseMs`, `rumorMs`, `hasMalformedMs`) | utility (shared predicate) | transform | itself — introduces the shared parser both existing functions route through | n/a (locked/mechanical) |
| `packages/concord/src/helpers/__tests__/stream.test.ts` (net-new) | test | unit | `packages/concord/src/client/__tests__/client.test.ts` (`describe`/`it` structure + hand-derived-value assertion style) | role-match |
| `packages/concord/src/helpers/__tests__/invite-bundle.test.ts` (net-new) | test | unit | `packages/concord/src/client/__tests__/client.test.ts` `asyncServingPool` DI-pool idiom (for any fixture-building conventions reused) + inline hand-derived-coordinate assertions | role-match |

## Pattern Assignments

### `packages/concord/src/client/client.ts` — `joinByLink` (D-01/D-02/D-03/D-05)

**Analog:** `packages/core/src/event-store/event-store.ts:255-270, 308-322` (NIP-01 replaceable-collapse rule)

**Current buggy shape** (`client.ts:410-436`, read this session — matches RESEARCH.md's citation exactly):
```typescript
async joinByLink(url: string): Promise<ConcordCommunity> {
  const parsed = parseInviteLink(url);
  const relays = parsed.bootstrapRelays.length ? parsed.bootstrapRelays : this.defaultRelays;
  const events = await lastValueFrom(
    this.pool
      .request(relays, [{ kinds: [INVITE_BUNDLE_KIND], authors: [parsed.linkSigner] }])   // <- D-02: add "#d": [""]
      .pipe(mapEventsToTimeline(), timeout(10000)),
    { defaultValue: [] as NostrEvent[] },
  ).catch(() => [] as NostrEvent[]);

  const live = events
    .filter((e) => isValidInviteBundle(e) && !isInviteBundleRevoked(e))   // <- D-01 bug: tombstone filtered OUT first
    .sort((a, b) => b.created_at - a.created_at)[0];                       // <- then picks newest survivor
  if (!live) throw new Error("invite bundle not found or revoked");

  const bundle = validateInviteBundle(getInviteBundle(live, parsed.token));
  if (!bundle) throw new Error("invite failed owner verification");

  return this.joinFromBundle(bundle, relays);
}

private async joinFromBundle(bundle: InviteBundle, fallbackRelays: string[]): Promise<ConcordCommunity> {
  if (bundle.expires_at && Date.now() > bundle.expires_at) throw new Error("invite expired");  // <- D-05: ms compare, must become seconds
  ...
}
```

**Analog collapse rule to replicate** (`packages/core/src/event-store/event-store.ts:264-267`):
```typescript
let winner = existing[0];
for (const e of existing) {
  if (e.created_at > winner.created_at || (e.created_at === winner.created_at && e.id < winner.id)) winner = e;
}
```
Same rule repeated verbatim at `event-store.ts:316-319` for the "remove all losing versions" path — this is the literal newest-wins/tie-lowest-id logic `joinByLink` must reproduce inline over its raw pre-join relay union (no store exists yet, per D-03).

**Fix shape (from RESEARCH.md, verified against both analogs above):**
```typescript
function newestAtCoordinate(events: NostrEvent[]): NostrEvent | undefined {
  let winner: NostrEvent | undefined;
  for (const e of events) {
    if (!winner || e.created_at > winner.created_at || (e.created_at === winner.created_at && e.id < winner.id))
      winner = e;
  }
  return winner;
}
// in joinByLink, request filter gets "#d": [""] (D-02); collapse runs over the
// FULL union (isValidInviteBundle only, tombstone included) THEN checks isInviteBundleRevoked
// on the single winner (D-01); joinFromBundle's expires_at check becomes unixNow() > bundle.expires_at (D-05).
```

**Error handling pattern:** identical to current — `throw new Error(...)` synchronously inside the async method body, no custom error class in this file. Keep this convention (no new error type needed for D-01/D-04/D-05/D-12 refusals).

---

### `packages/concord/src/helpers/invite-bundle.ts` — `validateInviteBundle` (D-10)

**Analog:** `packages/concord/src/helpers/control.ts:200-215` (AUTH-04, Phase 9)

**Analog excerpt** (`control.ts:205-210`):
```typescript
// AUTH-04: role_ids shape must be validated unconditionally, BEFORE
// `authorized` — an owner-signed malformed Grant short-circuits
// `s.isOwner` and would otherwise reach `.every`/`.join` unguarded
// and throw, taking down every member's fold with it. An empty array
// satisfies this vacuously and is a valid revoke, not malformed (D-08).
if (!Array.isArray(grant.role_ids) || !grant.role_ids.every((rid) => typeof rid === "string")) continue;
```

**Current code to fix** (`invite-bundle.ts:212-228`, read this session):
```typescript
export function validateInviteBundle(bundle: InviteBundle | undefined): InviteBundle | undefined {
  if (!bundle || typeof bundle !== "object") return undefined;
  if (typeof bundle.owner !== "string" || typeof bundle.owner_salt !== "string") return undefined;
  let expected: string;
  try {
    expected = bytesToHex(communityId(bundle.owner, hexToBytes(bundle.owner_salt)));
  } catch {
    return undefined;
  }
  if (expected !== bundle.community_id) return undefined;
  const channels = bundle.channels ?? [];
  if (channels.length > INVITE_BUNDLE_MAX_CHANNELS) return undefined;        // <- D-10: no Array.isArray guard
  const relays = (bundle.relays ?? []).slice(0, INVITE_BUNDLE_RELAY_CAP);    // <- same hole
  const refounder = typeof bundle.refounder === "string" ? bundle.refounder : undefined;
  return { ...bundle, channels, relays, refounder };
}
```
Fix: insert `if (!Array.isArray(bundle.channels) || !Array.isArray(bundle.relays)) return undefined;` immediately before the `channels.length` read — same "guard-before-array-method" ordering as `control.ts:210`, same fail-closed return convention already used two lines above (`return undefined`) for the owner-proof mismatch.

---

### `packages/concord/src/helpers/invite-bundle.ts` — `decodeFragment` (D-12)

**Current guard** (`invite-bundle.ts:81`, read this session):
```typescript
export function decodeFragment(fragment: string): { token: Uint8Array; relays: string[] } {
  const bytes = base64urlnopad.decode(fragment);
  let i = 0;
  const version = bytes[i++];
  if (version < FRAGMENT_VERSION) throw new Error("legacy invite link, unsupported");  // <- only rejects LOWER
  ...
```
Fix: `if (version !== FRAGMENT_VERSION) throw new Error("unsupported invite fragment version");` — same throw-with-`Error` convention already in this function, just a stricter comparison operator.

---

### `packages/concord/src/helpers/invite-bundle.ts` — `getInviteBundleVsk` (D-04)

**Current code** (`invite-bundle.ts:249-257`, read this session):
```typescript
/** The bundle's `vsk` edition tag (defaults to live, CORD-05 §1). */
export function getInviteBundleVsk(event: NostrEvent): number {
  const raw = event.tags.find((t) => t[0] === "vsk")?.[1];
  return raw === undefined ? INVITE_BUNDLE_VSK_LIVE : Number(raw);   // <- Number("junk") -> NaN -> stays live downstream
}

export function isInviteBundleRevoked(event: NostrEvent): boolean {
  return getInviteBundleVsk(event) === INVITE_BUNDLE_VSK_REVOKED;
}
```
**Analog for the "distinguish absent vs malformed" shape:** `helpers/stream.ts:35-39`'s `hasMalformedMs` — already distinguishes "tag absent" (not malformed) from "tag present but out of range" (malformed) via a two-step `if (!tag) return false;` then a validity check. Mirror that two-branch structure here: absent → `INVITE_BUNDLE_VSK_LIVE`; present-but-NaN → a value that is neither `INVITE_BUNDLE_VSK_LIVE` nor equal to any known "6/9" vocabulary but that callers must treat as revoked (per D-04, "present-but-unparseable ⇒ deny" — the caller-facing `isInviteBundleRevoked` predicate, or a sibling `isInviteBundleMalformed`, is the shape Claude's discretion covers per RESEARCH.md D-04).

---

### `packages/concord/src/client/community.ts` — `refreshInviteBundles` (D-11)

**Current code** (`community.ts:1133-1150`, read this session):
```typescript
async refreshInviteBundles(links: ConcordInviteLink[]): Promise<void> {
  const state = this.state$.value;
  const inviteRelays = this.relays();
  for (const link of links) {
    const bundle = buildInviteBundle(this.material, {           // <- throws unguarded; aborts whole loop
      name: state.metadata?.name,
      icon: state.metadata?.icon,
      creator_npub: this.pubkey,
      label: link.label,
      expires_at: link.expiresAt,
      channels: link.channels,
    });
    const template = await InviteBundleFactory.create(bundle, hexToBytes(link.token));
    const signed = finalizeEvent(template, hexToBytes(link.signerSk));
    this.eventStore.add(signed);
    this.pool.publish(inviteRelays, signed).catch((err) => console.warn("invite bundle refresh publish failed", err));
  }
}
```
**In-file analog for per-item catch-and-continue:** the same function's own `.pool.publish(...).catch((err) => console.warn(...))` line — the publish step already treats a per-link failure as "warn and move on." Fix: wrap the loop body (from `buildInviteBundle` through `eventStore.add`) in `try { ... } catch (err) { console.warn(...); continue; }`, reusing that exact `console.warn` idiom rather than inventing a new error-reporting channel. `buildInviteBundle`'s only currently-known throw site is `helpers/invite-bundle.ts:175` ("not a private channel we hold a key for").

---

### `packages/concord/src/operations/channel.ts` — `includeMs`/`bindToChannel` (D-06/D-07)

**Analog:** `packages/concord/src/helpers/stream.ts:15-18` (`splitTime`, dead code, zero call sites — confirmed this session)
```typescript
/** Split a JS millisecond timestamp into (created_at seconds, ms remainder). */
export function splitTime(nowMs: number = Date.now()): { created_at: number; ms: number } {
  return { created_at: Math.floor(nowMs / 1000), ms: nowMs % 1000 };
}
```

**Current code** (`operations/channel.ts:22, 34-38`, structure confirmed):
```typescript
export function includeMs(ms: number = Date.now()): EventOperation { ... }
export function bindToChannel(channelId: string, epoch: number, ms?: number) {
  ...
  const remainder = includeMs(ms);
  ...
}
```
Fix (per RESEARCH.md's verified recommended shape): `includeMs` imports `splitTime` from `../helpers/stream.js`, computes `{ created_at, ms: remainder } = splitTime(ms)` from the single passed/defaulted `Date.now()` value, and overrides **both** `draft.created_at` and the `ms` tag from that one pair — this is the D-07 "relocate where `created_at` is stamped" requirement, and it propagates to every `bindToChannel` call site with zero other file changes for the single-event case.

---

### `packages/concord/src/operations/guestbook.ts` + `packages/concord/src/factories/guestbook.ts` — snapshot chunk sharing (D-08)

**Analog:** `operations/channel.ts`'s `includeMs`/`bindToChannel` pair, once fixed above — same mechanism, applied one call-depth higher because N chunks must share one instant by construction (a per-chunk clock read reintroduces the bug even after TIME-01 lands).

**Current code** (`operations/guestbook.ts:36-41`, `factories/guestbook.ts:67-104`, confirmed this session):
```typescript
// operations/guestbook.ts
export function includeSnapshotChunk(
  members: string[], snapshotIdHex: string, index: number, count: number,
  ms: number = Date.now(),   // <- default per-chunk read, the bug
): EventOperation { ... }

// factories/guestbook.ts
export class SnapshotFactory extends EventFactory<typeof SNAPSHOT_KIND> {
  static create(..., ms: number = Date.now()): SnapshotFactory { ... }  // <- also per-call default
}
export function buildSnapshotFactories(
  members: string[], snapshotIdHex: string, ms: number = Date.now(),   // <- caller-level default, correct SHAPE
): SnapshotFactory[] {
  ...
  return chunks.map((chunk, i) => SnapshotFactory.create(chunk, snapshotIdHex, i + 1, n, ms));  // <- ms IS already threaded per-chunk (good), but created_at is NOT derived from it
}
```
Fix: `buildSnapshotFactories` computes `const time = splitTime(nowMs)` **once**, threads the `{created_at, ms}` pair (not a raw `ms` number) into every `SnapshotFactory.create(...)` call; `includeSnapshotChunk` takes the pre-computed pair as a parameter and stamps `draft.created_at` from `time.created_at` (never `Date.now()` internally) exactly as `includeMs` does after its own fix — the caller-threads-the-pair shape already exists in `buildSnapshotFactories`'s signature, it just needs to carry `{created_at, ms}` instead of a bare `ms`.

---

### `packages/concord/src/helpers/stream.ts` — `parseMs`, `rumorMs`, `hasMalformedMs` (D-09)

**Current code** (`stream.ts:20-40`, full file read this session):
```typescript
export function rumorMs(rumor: Rumor): number {
  const tag = rumor.tags.find((t) => t[0] === "ms");
  const ms = tag ? parseInt(tag[1], 10) : 0;
  const remainder = Number.isFinite(ms) && ms >= 0 && ms <= 999 ? ms : 0;
  return rumor.created_at * 1000 + remainder;
}

export function hasMalformedMs(rumor: Rumor): boolean {
  const tag = rumor.tags.find((t) => t[0] === "ms");
  if (!tag) return false;
  const ms = Number(tag[1]);
  return !Number.isInteger(ms) || ms < 0 || ms > 999;
}
```
Both already share the `rumor.tags.find((t) => t[0] === "ms")` lookup idiom — the analog for the new `parseMs` is literally these two functions' own bodies, unified. Fix: introduce
```typescript
export function parseMs(tag: string | undefined): number | null {
  if (tag === undefined) return null;
  const n = Number(tag);
  return Number.isInteger(n) && n >= 0 && n <= 999 && String(n) === tag ? n : null;
}
```
and rewrite `rumorMs`/`hasMalformedMs` to both call `parseMs(tag)`, keeping each function's existing early-return/absent-tag convention (`rumorMs`: absent → `0` remainder; `hasMalformedMs`: absent → `false`, not malformed).

---

### Net-new: `packages/concord/src/helpers/__tests__/stream.test.ts`

**Analog:** `packages/concord/src/client/__tests__/client.test.ts` — overall `describe`/`it` structure and its hand-derived-value assertion style (no DI-pool needed here since `splitTime`/`parseMs` are pure functions with no I/O).

Key assertions to structure per D-13: a table-driven `it.each` (or manual cases) for the ≥500ms remainder repro (`1700000000700 → {created_at: 1700000000, ms: 700}`, verifying it does NOT skew to `1700000001`), the `…000700` vs `…001400` ordering repro, and the canonical-`ms` malformed table (`"42abc"`, `"0x10"`, `"007"`, `" 5"`, `"+1"` all → malformed under both `rumorMs`-derived ordering and `hasMalformedMs`).

---

### Net-new: `packages/concord/src/helpers/__tests__/invite-bundle.test.ts`

**Analog:** `packages/concord/src/client/__tests__/client.test.ts` — the `asyncServingPool` DI helper (lines ~779-804, excerpted below) is the project's established "relay serves matching events asynchronously" fixture idiom, reusable if any test in this file needs to construct a fake bundle event and route it through fetch-like code; more directly, most of this file's assertions are pure-function calls (`validateInviteBundle`, `decodeFragment`, `getInviteBundleVsk`) that don't need the DI pool at all — only import the pattern's *event-fixture shape*, not the pool itself.

```typescript
// packages/concord/src/client/__tests__/client.test.ts:779-804 (read this session)
function asyncServingPool(events: NostrEvent[]): RelayPool {
  const serve = (filters: unknown) => {
    const fs = (Array.isArray(filters) ? filters : [filters]) as Array<{ kinds?: number[]; authors?: string[] }>;
    const match = events.filter((e) =>
      fs.some((f) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))),
    );
    return from(match).pipe(delay(0));
  };
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true, from: "wss://fake" }),
    getSupported: async () => null,
    sync: () => EMPTY,
    request: (filters: unknown) => serve(filters),
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: (_relays: string[], filters: unknown) => serve(filters),
    publish: async () => [],
  } as unknown as RelayPool;
}
```
The `joinByLink` lagging-relay/collapse-then-tombstone regression test (D-01/D-02, INVITE-01) belongs in `client.test.ts` (extending this existing `describe("ConcordClient.joinByLink ...")` block with a new decoy-event + tombstone case), not in the new `invite-bundle.test.ts` file — `invite-bundle.test.ts` covers the pure-function pieces (`validateInviteBundle`, `decodeFragment`, `getInviteBundleVsk`, the hand-derived `(33301, link_signer, "")` coordinate via `getInviteBundleLocator`).

---

## Shared Patterns

### Fail-closed guard-before-array-method (INVITE-02/D-10)
**Source:** `packages/concord/src/helpers/control.ts:210` (`Array.isArray(grant.role_ids) || !grant.role_ids.every(...)`)
**Apply to:** `validateInviteBundle` (`helpers/invite-bundle.ts`)
```typescript
if (!Array.isArray(bundle.channels) || !Array.isArray(bundle.relays)) return undefined;
```

### Single clock read via `splitTime` (TIME-01/TIME-02/D-06/D-07/D-08)
**Source:** `packages/concord/src/helpers/stream.ts:16-18`
**Apply to:** `operations/channel.ts` (`includeMs`), `operations/guestbook.ts` (`includeSnapshotChunk`), `factories/guestbook.ts` (`buildSnapshotFactories`)
```typescript
export function splitTime(nowMs: number = Date.now()): { created_at: number; ms: number } {
  return { created_at: Math.floor(nowMs / 1000), ms: nowMs % 1000 };
}
```
Rule: the clock is read exactly once per logical event (TIME-01) or once per snapshot (TIME-02), by the outermost caller that owns that scope, and the resulting `{created_at, ms}` pair is threaded down — never re-read inside a per-chunk/per-tag operation.

### NIP-01 replaceable-collapse (INVITE-01/D-01/D-03)
**Source:** `packages/core/src/event-store/event-store.ts:264-267` (and its twin at `308-321`)
**Apply to:** `client/client.ts` (`joinByLink`), replicated inline (no store available pre-join)
```typescript
if (e.created_at > winner.created_at || (e.created_at === winner.created_at && e.id < winner.id)) winner = e;
```
Rule: collapse over the FULL union (all editions, tombstone included) to find the ONE newest event at the coordinate; only then branch on that winner's content (revoked vs. live). Never filter by content before collapsing — that inverts the NIP-01 replacement rule.

### Shared validator consumed by two call sites that must never disagree (TIME-03/D-09)
**Source:** the existing `hasMalformedMs`/`rumorMs` split being unified into one `parseMs`
**Apply to:** `helpers/stream.ts`
```typescript
export function parseMs(tag: string | undefined): number | null {
  if (tag === undefined) return null;
  const n = Number(tag);
  return Number.isInteger(n) && n >= 0 && n <= 999 && String(n) === tag ? n : null;
}
```

### Per-item try/skip-and-continue over a best-effort batch (INVITE-03/D-11)
**Source:** `refreshInviteBundles`'s own existing `.pool.publish(...).catch((err) => console.warn(...))` line (`community.ts:1148`)
**Apply to:** the same function's `buildInviteBundle`/sign/store block
```typescript
for (const link of links) {
  try {
    /* build, sign, store, publish */
  } catch (err) {
    console.warn(`invite refresh skipped for link ${link.token}`, err);
  }
}
```

## No Analog Found

None. Every file in scope has a confirmed same-package sibling or a directly-cited prior-phase pattern (per RESEARCH.md's "activate/extend a correct sibling that already exists" framing) — this phase introduces no genuinely new pattern shape.

## Out of Scope (explicitly excluded per CONTEXT.md deferral)

`packages/concord/src/operations/rekey.ts` (`includeRekeyChunk`) and `packages/concord/src/helpers/rekey.ts` (`buildRekeyRumors`) carry the identical TIME-02 defect shape but are explicitly deferred — do not classify, do not modify, do not reference as an analog target (only as a *source* of the same-defect-class pattern shape if a future phase needs it).

## Metadata

**Analog search scope:** `packages/concord/src/{client,helpers,operations,factories,casts}/`, `packages/core/src/event-store/`, `packages/core/src/observable/`
**Files scanned:** `client/client.ts`, `client/community.ts`, `client/invite-manager.ts`, `client/__tests__/client.test.ts`, `helpers/invite-bundle.ts`, `helpers/invite-list.ts`, `helpers/stream.ts`, `helpers/control.ts`, `operations/channel.ts`, `operations/guestbook.ts`, `factories/guestbook.ts`, `casts/invite-list.ts`, `packages/core/src/event-store/event-store.ts`
**Pattern extraction date:** 2026-07-21
