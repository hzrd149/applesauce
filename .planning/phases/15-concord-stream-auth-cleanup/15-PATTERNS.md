# Phase 15: Concord Stream-Auth Cleanup - Pattern Map

**Mapped:** 2026-08-13
**Files analyzed:** 14 (2 new/rewritten artifact classes + 12 modified files, grouped)
**Analogs found:** in-repo analogs for the genuinely-new artifacts; the *target* call-site shape has **no in-repo precedent yet** — Phase 13/14 shipped the API but nothing in this repo calls it. Use RESEARCH.md's "Code Examples" section (reproduced below, verbatim-sourced) as the pattern for every migrated call site.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| Scope-owned signer holder (D-06, new; placement/name at your discretion — `community.ts`/`private-channel.ts` inline, or a shared `helpers/stream-signers.ts`) | model/utility (map-like registry) | CRUD (register/get) | `packages/concord/src/client/relay-auth.ts` `registry`/`registerStreamKeys`/`streamSigners` (lines 44-71, 118-122) — the exact piece of `ConcordRelayAuth` being kept, stripped of `version$`/drivers | subset-of-existing (same registry shape, minus the reactive/driver machinery) |
| CAUTH-03 structural guard test (new, e.g. `packages/concord/src/__tests__/no-relay-auth-callsites.test.ts` or similar) | test (structural/grep guard) | batch (source-tree walk) | `packages/concord/src/__tests__/cord-citations.test.ts` | exact — same walk-and-assert shape, different predicate |
| CAUTH-02/04 test fixtures (extend `fakePool()`/`fakePoolWithStatus()`) | test (fixture) | event-driven (auth spy) | `packages/concord/src/client/__tests__/community.test.ts:57-98` (`fakePool`, `fakePoolWithStatus`, `mkStatus`) | exact — same file, extend in place |
| `packages/concord/src/client/relay-auth.ts` | service (deleted) | event-driven | — | N/A (deletion) |
| `packages/concord/src/client/community.ts` — `ensureAuth`/publish sites/`openLive`/`status$` | controller/engine (modified) | request-response + CRUD (publish) | Itself (before/after); publish-site *target* shape has no in-tree precedent — use RESEARCH.md Code Example below | role-match, no target-shape precedent |
| `packages/concord/src/client/private-channel.ts` | controller/engine (modified) | request-response + CRUD | Mirrors `community.ts` 1:1 (`ensureAuth` `:365`, `openLive` `:378-404`) | exact structural mirror of `community.ts` |
| `packages/concord/src/client/sync.ts` — `syncAuthors`, `SyncContext` | service (modified) | streaming (sync loader) | RESEARCH.md "Migrating `syncAuthors`" Code Example (sourced from this same file, current shape) | exact — before/after on the same function |
| `packages/concord/src/client/channel-sync.ts` | service (modified) | streaming | Mirrors `sync.ts`'s two `registerStreamKeys`+`ensureAuth` pairs | exact structural mirror of `sync.ts` |
| `packages/concord/src/client/invite-watcher.ts` | service/watcher (modified) | event-driven | `relay-auth.ts`'s `autoAuthenticate` (lines 200-234) — the user-handler shape being deleted; target shape is D-08/D-09's client-wide `onAuthRequired` closure, no in-tree precedent | role-match for the thing being removed; no precedent for the replacement |
| `packages/concord/src/client/client.ts` — `status$` aggregation, publish at `:1287` | controller (modified) | CRUD (publish) + request-response (status) | `invite-manager.ts:297` (sibling user-signed publish, unmigrated) | role-match, same migration needed on both |
| `packages/concord/src/client/invite-manager.ts` — publishes `:257`/`:297` | service (modified) | CRUD | `community.ts`'s 9 publish sites — same `pool.publish(...).catch(...)` shape | exact — same shape across all 13 D-15 sites |
| `packages/concord/src/types.ts` — remove 3 `authenticated` fields | model (modified) | — | Itself | exact (deletion only) |
| `packages/concord/src/__tests__/exports.test.ts` | test (snapshot) | — | Itself, line 16 (`ConcordRelayAuth` entry) | exact |
| `apps/examples/src/examples/concord/direct-invites.tsx`, `rumor-stores.tsx`, `crypto-history.tsx` | component (modified) | request-response (React example app) | `direct-invites.tsx` itself (`:34` construction, `:256-260` `registerStreamKeys`+`authenticateStreamKeys`+`waitForAuth`) — no example anywhere in-tree already does reactive per-operation auth | role-match; no target-shape precedent (first of its kind) |
| `apps/examples/src/examples/concord/admin-management.tsx` | component (modified) | request-response | Itself, `:111-112`/`:341-342` (`status.authenticated` badge) | exact (removal/repoint target) |

## Pattern Assignments

### Scope-owned signer holder (D-06, new)

**Analog:** `packages/concord/src/client/relay-auth.ts:44-71` and `:118-122` — the registry half of `ConcordRelayAuth`, with `version$`/`drivers`/`authenticateStreamKeys` stripped out per D-06.

**Registry pattern to keep** (`relay-auth.ts:44-67`):
```typescript
export class ConcordRelayAuth {
  /** pubkey (x-only hex) → the signer that NIP-42-authenticates it. */
  private readonly registry = new Map<string, PrivateKeySigner>();

  /** Register stream keys (idempotent). Returns the pubkeys newly added. */
  registerStreamKeys(keys: GroupKey[]): string[] {
    const added: string[] = [];
    for (const k of keys) {
      if (this.registry.has(k.pk)) continue;
      this.registry.set(k.pk, new PrivateKeySigner(k.sk));
      added.push(k.pk);
    }
    return added;
  }
}
```

**Lookup pattern to keep** (`relay-auth.ts:118-122`, adapt `streamSigners()`'s shape to a plain `.get(pk)` since D-02's handler only needs single-key lookup, not the whole list):
```typescript
streamSigners(): { pubkey: string; signer: PrivateKeySigner }[] {
  return [...this.registry.entries()].map(([pubkey, signer]) => ({ pubkey, signer }));
}
```

**What to drop from the analog:** `version$` (`:51`), `drivers`/`Driver` interface (`:39-42`, `:53`), `authenticateStreamKeys` (`:133-189`), `autoAuthenticate` (`:200-234`), `connected$`/`authenticated$` (`:85-116`), the `pool: RelayPool` constructor dependency (the new holder needs no pool reference at all — it is a pure key→signer map, per D-06/D-07 "not client-wide, not a driver").

**Registration call sites to preserve exactly (unchanged shape, same two-per-file pattern):** `sync.ts:136`/`:190`, `channel-sync.ts:48-49`/`:95-96`, `community.ts`/`private-channel.ts`'s own `registerStreamKeys` calls at their `openLive`/rekey sites — only the receiver changes (new holder instead of `this.relayAuth`), the call shape (`holder.registerStreamKeys([...])`) stays identical.

**onAuthRequired handler body — this is the whole D-02 mechanism, no in-tree precedent, sourced from CONTEXT.md D-02 / RESEARCH.md Pattern 1:**
```typescript
onAuthRequired: async ({ relay, missingPubkeys }) => {
  for (const pk of missingPubkeys ?? []) {
    const signer = holder.get(pk); // holder.get, not streamSigners() — single lookup
    if (signer) await relay.authenticate(signer);
  }
};
```

---

### CAUTH-03 structural guard test (new)

**Analog:** `packages/concord/src/__tests__/cord-citations.test.ts` (full file read, 116 lines) — this is the named precedent in RESEARCH.md's Validation Architecture ("mirroring `cord-citations.test.ts`'s precedent of a source-tree-walk guard").

**Walk/assert shape to copy** (`cord-citations.test.ts:24-67`, imports + file-collector):
```typescript
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SELF = fileURLToPath(import.meta.url);
const SRC_ROOT = join(dirname(SELF), "..");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith(".ts") && full !== SELF) out.push(full);
  }
  return out;
}
```

**Anti-vacuity + assertion shape to copy** (`cord-citations.test.ts:76-107`):
```typescript
describe("<guard name>", () => {
  it("scans well over fifty .ts files under packages/concord/src (anti-vacuity: a broken glob cannot pass silently)", () => {
    const files = collectTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(50);
  });

  it("no remaining call sites for the five removed mechanisms", () => {
    const files = collectTsFiles(SRC_ROOT);
    const offenders: string[] = [];
    const FORBIDDEN = /authenticateStreamKeys|ensureAuth|ConcordRelayAuth|autoAuthenticate/;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (FORBIDDEN.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]); // enumerates offenders on failure, per this analog's convention
  });
});
```

**Adaptation notes:** RESEARCH.md's CAUTH-03 test map (`grep -rn "authenticateStreamKeys\|ensureAuth\|ConcordRelayAuth\|autoAuthenticate" packages/concord/src apps/examples/src/examples/concord`) also wants `apps/examples/` covered — the analog's `SRC_ROOT` is scoped to `packages/concord/src` only; either add a second `collectTsFiles` root for `apps/examples/src/examples/concord`, or run two guard `it`s. `ensureAuth` will also appear in this very PATTERNS.md / historical comments if grepped broadly — scope the walk to `.ts` source files only (as the analog already does) to avoid false hits on `.md`.

---

### CAUTH-02/04 test fixtures (extend in place)

**Analog:** `packages/concord/src/client/__tests__/community.test.ts:57-98` — `fakePool()`, `fakePoolWithStatus()`, `mkStatus()` (verbatim, current source):
```typescript
// Every relay in the request acks ok:true — the default "everyone is listening"
// shape, satisfying refound()'s per-wrap majority gate (D-11) for any relay count.
const okAll = async (relays: string[]): Promise<PublishResponse[]> => relays.map((from) => ({ ok: true, from }));

// A RelayPool stand-in whose per-relay methods are inert (no sockets). The sync
// loader probes `getSupported` (→ no NIP-77) and pages `request` (→ no events).
function fakePool(): RelayPool {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: () => EMPTY,
    publish: okAll,
  } as unknown as RelayPool;
}

// Like fakePool, but with a controllable `status$` so tests can drive connection state.
function fakePoolWithStatus(): { pool: RelayPool; status$: BehaviorSubject<Record<string, RelayStatus>> } {
  const status$ = new BehaviorSubject<Record<string, RelayStatus>>({});
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };
  const pool = {
    status$,
    relay: () => relay,
    subscription: () => NEVER,
    request: () => EMPTY,
    publish: okAll,
  } as unknown as RelayPool;
  return { pool, status$ };
}
```

**Extension needed for CAUTH-02:** the fixture's `authenticate: async () => ({ ok: true })` needs to become a spy that records `(pubkey, relayUrl)` — RESEARCH.md's Wave-0 gap spec — e.g. replace with `vi.fn(async (signer) => { authCalls.push({ pk: await signer.getPublicKey(), url: relay.url }); return { ok: true }; })`. Keep `authenticate` on the same inert `relay` object shape; do not add a second relay object or change `relay.url`/`challenge$`'s shape, since other existing tests construct these fixtures assuming that exact shape.

**Extension needed for CAUTH-04:** `fakePool()`'s `authenticate` needs a variant that resolves `{ ok: false }` once then `{ ok: true }` (or errors), to exercise the `authRetries: 1` bound — build as a second factory function alongside `fakePool`/`fakePoolWithStatus`, same file, same construction shape (inert `relay` object + `RelayPool`-shaped return), not a new file.

**`mkStatus` signature** (needed for CAUTH-02's `pool.status$`-adjacent assertions, though D-01 means status is no longer read for auth-gating — only for `connected$`):
```typescript
function mkStatus(over: Partial<RelayStatus> & { url: string }): RelayStatus {
  // ... (read community.test.ts:100+ for the body if a plan task needs the full defaults)
}
```

---

### `packages/concord/src/client/sync.ts` — `syncAuthors` (modified)

**Analog / before-after:** itself, current source (`sync.ts:104-115`, verified) — no other in-tree call site already does this migration, so this is the literal diff to make, reproduced from RESEARCH.md's "Code Examples" section (source-verified in this session):
```typescript
// BEFORE (current, sync.ts:104-115)
export async function syncAuthors(ctx: SyncContext, authors: string[]): Promise<NostrEvent[]> {
  if (authors.length === 0) return [];
  const loader = createSyncLoader({ eventStore: ctx.eventStore, pool: ctx.pool });
  const { events$ } = loader({
    relays: ctx.relays,
    filter: { kinds: BACKFILL_KINDS, authors },
    waitForAuth: authors,
  });
  return firstValueFrom(events$.pipe(toArray()));
}

// AFTER — the ONLY change is adding onAuthRequired; waitForAuth: authors is already correct.
export async function syncAuthors(ctx: SyncContext, authors: string[]): Promise<NostrEvent[]> {
  if (authors.length === 0) return [];
  const loader = createSyncLoader({ eventStore: ctx.eventStore, pool: ctx.pool });
  const { events$ } = loader({
    relays: ctx.relays,
    filter: { kinds: BACKFILL_KINDS, authors },
    waitForAuth: authors,
    onAuthRequired: ctx.onAuthRequired, // NEW — replaces ctx.relayAuth/ctx.ensureAuth entirely
  });
  return firstValueFrom(events$.pipe(toArray()));
}
```

**`SyncContext` shape change** (`sync.ts:69-93`) — drop `relayAuth: ConcordRelayAuth` (`:71`) and `ensureAuth: (relays: string[]) => void` (`:82`); add `onAuthRequired: RelayAuthHandler` (imported from `applesauce-relay`'s `types.ts`, per canonical_refs "read-only, do not modify"). The two `registerStreamKeys` call sites (`syncEpoch`, `sync.ts:136`/`:190`) keep calling the new holder directly — they do NOT move into `onAuthRequired`; only the `ctx.ensureAuth(ctx.relays)` calls immediately after them (`:137`, `:191`) are deleted outright (D-01: no proactive `ensureAuth` trigger; the handler fires reactively off the relay's own `auth-required:`, not off registration).

**`channel-sync.ts` mirrors this 1:1** at its two `registerStreamKeys`+`ensureAuth` pairs (`:48-49`, `:95-96`) — same before/after shape, same context-field change.

---

### `packages/concord/src/client/community.ts` / `private-channel.ts` — publish sites (D-15/D-16)

**Analog:** no in-tree call site has migrated yet; this is RESEARCH.md's "Migrating a publish site" Code Example, built from the actual current shape at `community.ts:1246` (verified) plus D-16's ruling:
```typescript
// BEFORE (current shape, e.g. community.ts:1246, :1543, :1564, :1565, :1584 — all 9 in this file)
await this.pool.publish(relays, wrap).catch((err) => {
  this.publishLog("... publish failed: %s", (err as Error)?.message ?? err);
  console.warn("... publish failed", err);
});

// AFTER — D-16: waitForAuth is the WRAP's OWN author (stream sk), never the user's.
await this.pool.publish(relays, wrap, {
  waitForAuth: [wrap.pubkey],
  onAuthRequired: this.streamOnAuthRequired, // the scope's own handler (D-06 holder), not the user's
}).catch((err) => {
  this.publishLog("... publish failed: %s", (err as Error)?.message ?? err);
  console.warn("... publish failed", err);
});
```

**Every publish site in this file follows the identical `.catch(...)` error-handling shape** — confirmed at all 9 D-15 sites in `community.ts` (`:1246`, `:1300`, `:1352`, `:1375`, `:1414`, `:1543`, `:1564`, `:1565`, `:1584`; sampled at `:1300` "bundle publish failed", `:1352` "invite bundle refresh publish failed", `:1375` "bundle revocation publish failed", `:1414` "channel grant publish failed") — copy this `.catch((err) => { this.publishLog(...); console.warn(...); })` shape verbatim per site, only inserting the options bag.

**Two exceptions within `community.ts`:** `refoundAuthority`'s `requireMajority` helper (around `:1540-1560`, uses `await this.pool.publish(...)` directly without `.catch` because it re-throws on insufficient acks) and the fire-and-forget compaction/snapshot publishes (`:1564`/`:1565`, `.catch(() => {})` — empty catch, not the logged shape) — both still need the same `{ waitForAuth: [wrap.pubkey], onAuthRequired }` options bag added, just keep each site's own existing catch behavior unchanged.

**`private-channel.ts` mirrors the same publish + `.catch` shape** wherever it publishes (confirmed structurally identical to `community.ts` throughout the file, per CONTEXT.md's "mirrored surface" framing).

---

### `packages/concord/src/client/invite-manager.ts` — user-signed publishes (D-17)

**Analog:** the file's own existing `.catch` shape, e.g. `invite-manager.ts` "invite list publish failed" site (verified, ~line 297):
```typescript
this.pool.publish(this.transport(), signed).catch((err) => {
  this.log("invite list publish failed: %s", (err as Error)?.message ?? err);
  console.warn("invite list publish failed", err);
});
```
This is one of the two D-17 user-signed sites (the other is `client.ts:1287`) — both get the **client-wide user handler** (D-08), not a stream-scope handler:
```typescript
this.pool.publish(this.transport(), signed, {
  waitForAuth: [this.pubkey], // the USER's pubkey, not a stream key — this publish is user-authored
  onAuthRequired: this.userOnAuthRequired,
}).catch((err) => {
  this.log("invite list publish failed: %s", (err as Error)?.message ?? err);
  console.warn("invite list publish failed", err);
});
```
`invite-manager.ts:257` (the OTHER invite-manager publish site, stream-authored per D-17's table) instead gets the stream-scope handler and `waitForAuth: [event.pubkey]` — do not conflate the two sites; they take different handlers despite being in the same file.

---

### `packages/concord/src/client/invite-watcher.ts` — user handler only (D-09)

**Analog for what's removed:** `relay-auth.ts:200-234`, `autoAuthenticate` — this IS the mechanism `invite-watcher.ts:156` currently constructs `ConcordRelayAuth` to get, and it is the direct precedent for "what a client-wide user-signed auth loop looked like" even though the replacement doesn't reuse its `pool.status$` subscription shape (D-01 forbids status-driven auth):
```typescript
// relay-auth.ts:200-234 — being deleted; DO NOT port the pool.status$ subscription pattern.
// Its only reusable idea is the two-arg `.then` note at :219-225: `authenticate` RESOLVES
// with `{ ok: false }` on relay refusal, so success must be read off the payload, not a catch.
```
**Replacement shape** (D-08/D-09, RESEARCH.md Pattern 2, no in-tree precedent — this is the literal handler `invite-watcher.ts` builds once in its constructor from `this.signer`):
```typescript
const userOnAuthRequired: RelayAuthHandler = async ({ relay, missingPubkeys }) => {
  if (missingPubkeys === null || missingPubkeys.includes(pubkey)) await relay.authenticate(signer);
};
```
Remove `autoAuthenticate` option/field (`:78`/`:122`/`:243`), `authenticateUser()` (`:249-267`), `userNeedsAuth()` (`:426-438`), and the two flag readers (`:258`, `:435`) outright — do not repurpose any of them, per RESEARCH.md Pitfall 2.

---

## Shared Patterns

### The `onAuthRequired` handler body (D-02) — the single most-copied pattern in this phase
**Source:** CONTEXT.md D-02 / RESEARCH.md Pattern 1 (no in-repo call site exists yet — this is the canonical shape every stream-scope engine implements once)
**Apply to:** `community.ts`, `private-channel.ts`, `sync.ts`, `channel-sync.ts` — every read/sync/publish call site owned by a community or private-channel scope.
```typescript
onAuthRequired: async ({ relay, missingPubkeys }) => {
  for (const pk of missingPubkeys ?? []) {
    const signer = holder.get(pk);
    if (signer) await relay.authenticate(signer);
  }
};
```

### The client-wide user handler (D-08/D-09) — built once, two separate instances
**Source:** RESEARCH.md Pattern 2, `relay-auth.ts:200-234` for what's being replaced
**Apply to:** `client.ts` (one instance, constructor-built from `this.signer`), `invite-manager.ts:297`, `invite-watcher.ts` (its OWN separate instance, per D-09 — do not share with `client.ts`'s).
```typescript
const userOnAuthRequired: RelayAuthHandler = async ({ relay, missingPubkeys }) => {
  if (missingPubkeys === null || missingPubkeys.includes(pubkey)) await relay.authenticate(signer);
};
```

### The `.catch((err) => { logger(...); console.warn(...); })` publish error shape
**Source:** `packages/concord/src/client/community.ts` (all 9 D-15 sites), `invite-manager.ts` (both sites)
**Apply to:** every one of the 13 D-15 publish sites — unchanged by this migration except for the inserted options bag; do not alter error handling while adding auth options.
```typescript
.catch((err) => {
  this.publishLog("<action> failed: %s", (err as Error)?.message ?? err);
  console.warn("<action> failed", err);
});
```

### `connected$` inlined per engine (D-12)
**Source:** `relay-auth.ts:76-91` (`lookupStatus` + `connected$`) — the ONLY piece of `relay-auth.ts` that survives, moved rather than rewritten.
**Apply to:** `community.ts`, `private-channel.ts` — each engine gets its own ~6-line copy (or a shared free function, per CONTEXT.md's discretion note).
```typescript
function lookupStatus(statuses: Record<string, RelayStatus>, url: string): RelayStatus | undefined {
  return statuses[normalizeURL(url)] ?? statuses[url];
}
connected$(relays: string[]): Observable<boolean> {
  return this.pool.status$.pipe(
    startWith({} as Record<string, RelayStatus>),
    map((statuses) => relays.some((url) => lookupStatus(statuses, url)?.connected ?? false)),
    distinctUntilChanged(),
  );
}
```

### Derive-and-store logger (SEED-001, 14-D-18)
**Source:** `relay-auth.ts:32`, `const log = logger.extend("auth");` — module-scope, never re-`.extend()`d per call.
**Apply to:** wherever auth-failure logging lands after `relay-auth.ts` is deleted (likely inlined into `community.ts`/`private-channel.ts`'s existing `publishLog`/`this.logger` — check whether those engines already have a derived `:auth`-suffixed child logger before adding a new one).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Every migrated `pool.publish`/`pool.subscription`/sync-loader call site's **target shape** (i.e., `{ waitForAuth, onAuthRequired }` actually wired up) | controller/service | request-response, streaming | Phase 13 shipped the `RelayAuthOptions` API in `applesauce-relay`/`applesauce-loaders`, but grepped confirmed **zero** existing concord call sites (or any other package) currently pass `onAuthRequired`. Every "after" excerpt above is synthesized from RESEARCH.md's Code Examples (themselves derived from reading `packages/relay/src/types.ts`'s `RelayAuthOptions`/`RelayAuthContext` verbatim), not copied from a working analog. Treat RESEARCH.md's Code Examples section as the closest thing to ground truth for this shape. |
| `apps/examples/src/examples/concord/direct-invites.tsx`/`rumor-stores.tsx`/`crypto-history.tsx`'s migrated form | component | request-response | No example anywhere in `apps/examples/` demonstrates reactive per-operation `onAuthRequired` — these three ARE the pre-migration pattern (`registerStreamKeys` + `authenticateStreamKeys` + manual `authDrivers` cleanup, e.g. `direct-invites.tsx:256-260`). The migrated form must be authored fresh using the shared `onAuthRequired` pattern above, passed to `pool.publish(relays, wrap, { waitForAuth: [keys.guestbook.pk], onAuthRequired })` in place of the current driver-subscribe/unsubscribe block. |

## Metadata

**Analog search scope:** `packages/concord/src/client/` (all engine files), `packages/concord/src/__tests__/`, `packages/concord/src/client/__tests__/`, `packages/relay/src/types.ts` (read-only API shape), `apps/examples/src/examples/concord/`
**Files scanned:** `relay-auth.ts` (full), `community.ts` (targeted ranges), `private-channel.ts` (grepped), `sync.ts` (full), `channel-sync.ts` (grepped), `invite-watcher.ts` (grepped), `client.ts` (grepped), `invite-manager.ts` (targeted ranges), `types.ts` (grepped), `exports.test.ts` (head), `cord-citations.test.ts` (full), `community.test.ts` (fixture section), `direct-invites.tsx` (head + accept-flow section)
**Pattern extraction date:** 2026-08-13
