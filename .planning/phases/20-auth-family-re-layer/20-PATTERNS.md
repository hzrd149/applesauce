# Phase 20: AUTH Family Re-layer - Pattern Map

**Mapped:** 2026-08-31
**Files analyzed:** 13 planned new/modified files
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/relay/src/relay.ts` | service/model | request-response, event-driven | Same file's Phase 18 `event()` and error family | exact |
| `packages/relay/src/types.ts` | model | request-response | `RelayAuthOptions` / `PublishOptions` in same file | exact |
| `packages/relay/src/__tests__/relay.test.ts` | test | request-response, event-driven | Existing raw EVENT and multi-user AUTH suites | exact |
| `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | test | event-driven | Existing auth lifecycle logging suite | exact |
| `packages/relay/src/__tests__/event-auth-types.test-d.ts` (or compile-included equivalent) | test | request-response | Existing `@ts-expect-error` guards in `relay.test.ts` | role-match |
| `packages/relay/src/group.ts` | service | batch/event-driven | Existing mirrored relay auth-name classifier | exact |
| `packages/relay/src/__tests__/group.test.ts` | test | batch/event-driven | Existing group auth-failure isolation test | exact |
| `packages/loaders/src/loaders/sync-loader.ts` | service/model | streaming | Existing `RELAY_AUTH_ERROR_NAMES` boundary | exact |
| `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` | test | streaming | Existing terminal auth-name parity tests | exact |
| `packages/concord/src/client/auth.ts` | service | request-response | Existing signer-first `authenticate()` consumers | exact |
| `packages/extra/src/vertex.ts` | service | event-driven | Existing challenge-driven `auth()` integration | exact |
| `apps/docs/loading/relays/relays.md` | config/documentation | request-response | Existing Authentication section | exact |
| `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, `.planning/phases/18-event-family-re-layer/18-CONTEXT.md`, `.changeset/relay-auth-family-re-layer.md` | config/documentation | transform | Phase 18 provenance and relay major changeset | exact |

## Pattern Assignments

### `packages/relay/src/relay.ts` (service/model, request-response + event-driven)

**Primary analog:** `packages/relay/src/relay.ts:1261-1303` — extract, rather than duplicate, the existing Phase 18 raw exchange.

**Imports pattern** (`packages/relay/src/relay.ts:1-8`, `:10-21`):

```ts
import { IAsyncEventStoreActions, IEventStoreActions, logger } from "applesauce-core";
import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { mapEventsToStore, simpleTimeout } from "applesauce-core/observable";
import { makeAuthEvent } from "nostr-tools/nip42";
import {
  BehaviorSubject, defer, filter, firstValueFrom, from,
  lastValueFrom, map, merge, Observable,
} from "rxjs";
```

Keep `.js` suffixes for local imports and add `RelayAuthenticateOptions` to the existing `./types.js` import block.

**Pinned typed-error pattern** (`packages/relay/src/relay.ts:123-178`):

```ts
export class AuthTimeoutError extends RelayClosedError {
  constructor(reason: string) {
    super(reason);
    this.name = "AuthTimeoutError";
  }
}

export class RelayEventTimeoutError extends Error {
  constructor(public readonly url: string) {
    super(`Timed out waiting for OK response from ${url}`);
    this.name = "RelayEventTimeoutError";
  }
}
```

Add the challenge-acquisition and freshness-exhaustion errors beside this family. Pin `.name` explicitly and document that the strings are mirrored across package boundaries. Preserve signer errors rather than wrapping them in one of these classes.

**Cold raw exchange pattern** (`packages/relay/src/relay.ts:1265-1302`):

```ts
return this.waitForReady(
  defer(() => {
    const messages = this.socket.pipe(
      filter((m) => m[0] === "OK" && m[1] === event.id),
      map((m): PublishResponse => ({
        ok: m[2] as boolean, message: m[3] as string, from: this.url,
      })),
      take(1),
      timeout({ first: this.eventTimeout,
        with: () => throwError(() => new RelayEventTimeoutError(this.url)) }),
      share(),
    );
    const control = defer(() => {
      this.socket.next([verb, event]);
      return messages;
    });
    return merge(this.watchTower, control).pipe(
      takeUntil(messages.pipe(ignoreElements(), endWith(true))), take(1));
  }),
);
```

Move this shape into one private verb-discriminated helper. The listener is created before `socket.next`; the outer `defer` stays unshared so each subscription is a fresh attempt; `waitForReady` remains the shared transport gate. Keep EVENT-only `auth-required:` translation in `event()`, outside the verb-neutral primitive.

**Low-level AUTH bookkeeping pattern** (`packages/relay/src/relay.ts:1305-1343`):

```ts
this.authentication$.next(authEvent);
const { [event.pubkey]: _replaced, ...rest } = this.authentications$.value;
this.authentications$.next({
  ...rest,
  [event.pubkey]: { event: authEvent, response: null },
});

const current = this.authentications$.value[event.pubkey];
if (current?.event.id === event.id) {
  this.authentications$.next({
    ...this.authentications$.value,
    [event.pubkey]: { event: authEvent, response: result },
  });
}
```

Keep all state mutation in `auth()`, after a candidate becomes a genuine attempt. Apply the same latest-event identity check to deprecated `authenticationResponse$`; an older concurrent response must not replace a newer attempt's mirror. `auth()` should call the private helper with `"AUTH"`, never `event()` or `publish()`.

**High-level Promise composition analog** (`packages/relay/src/relay.ts:1322-1343` and current `authenticate()` near `:1430`): use one immediately invoked async operation (or one `firstValueFrom` conversion) per call. Capture one absolute deadline before challenge waiting, hold `watchTower` while selecting the first non-null `challenge$`, then repeat snapshot → sign → abort check → current-challenge comparison. Only a null/different post-sign challenge consumes `challengeRetries`; same-value emissions do nothing. Check abort immediately before `auth()` so a late signer cannot write or mutate state. The outer deadline races the final `auth()` Promise too; `auth()` retains its independent fixed reply timeout.

### `packages/relay/src/types.ts` (model, request-response)

**Analog:** `packages/relay/src/types.ts:102-131`.

```ts
export type RelayAuthOptions = {
  waitForAuth?: AuthRequirement;
  onAuthRequired?: RelayAuthHandler;
  authTimeout?: number | false;
  authRetries?: number;
};

export type PublishOptions = {
  retries?: boolean | number | Parameters<typeof retry>[0];
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  timeout?: number | boolean;
} & RelayAuthOptions;
```

Define a separate exported `RelayAuthenticateOptions` beside `AuthSigner`; do not reuse operation-scoped `RelayAuthOptions`. Its exact surface is `timeout?: number | false`, `challengeRetries?: number`, and `signal?: AbortSignal`, with defaults documented. Update `authenticate(signer, options?)` while leaving `auth(event)` unchanged.

### `packages/relay/src/__tests__/relay.test.ts` (test, real-wire request-response)

**Raw exchange analog** (`packages/relay/src/__tests__/relay.test.ts:469-486`):

```ts
const spy = subscribeSpyTo(relay.event(mockEvent), { expectErrors: true });
await expect(server).toReceiveMessage(["EVENT", mockEvent]);
server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);
await spy.onError();
expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
expect(server.messages.filter((m: any) => m[0] === "EVENT")).toHaveLength(1);
```

Extend this suite for fixed EVENT routing, fixed AUTH routing, AUTH `auth-required:` as a verdict, synchronous OK/listener ordering, readiness, timeout, clean/unclean close, and repeat/resubscription parity. Assert frame arrays and counts, not merely resolved values.

**AUTH timeout/verdict analog** (`packages/relay/src/__tests__/relay.test.ts:647-675`):

```ts
relay.eventTimeout = 20;
const timedOutPromise = relay.authenticate(timedOutUser);
await server.nextMessage;
await expect(timedOutPromise).rejects.toBeInstanceOf(RelayEventTimeoutError);

const rejectedPromise = relay.authenticate(rejectedUser);
const msg = (await server.nextMessage) as [string, NostrEvent];
server.send(["OK", msg[1].id, false, "restricted: not allowed"]);
expect((await rejectedPromise).error).toBeInstanceOf(RelayEventVerdictError);
```

Build the Phase 20 matrix around real socket messages plus fake timers/deferred signers: fresh connection and challenge hold, no-challenge deadline, signer rejection identity, null/different/same challenge, exact retry exhaustion, whole-call deadline across sign and reply, abort and late resolution, stable false verdict, transport failure, one Promise awaited twice versus two calls, and same-pubkey out-of-order responses.

**State analog** (`packages/relay/src/__tests__/relay.test.ts:2096-2104`): preserve the existing multi-user/keyed assertions and add a concurrent same-pubkey test proving both keyed state and deprecated mirrors remain on the newest attempt.

### Compile-time selector guard (test, request-response)

**Analog:** inline TypeScript guards at `packages/relay/src/__tests__/relay.test.ts:570-571` use `// @ts-expect-error`, but Phase 18 verification shows runtime test files are excluded from package build. Put the new guard in a file included by an explicit typecheck command:

```ts
relay.event(event);
// @ts-expect-error public EVENT routing has no verb selector
relay.event(event, "AUTH");
relay.auth(event);
```

The plan must name the exact command that compiles this fixture; Vitest execution alone is not evidence because JavaScript accepts extra arguments.

### `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` (test, event-driven)

**Analog:** existing tests around `:63-120`, `:160-235`, and `:500-555` capture debug output, drive real AUTH/REQ frames, and assert redaction and per-user ordering. Follow that harness for challenge wait, signing attempt, challenge-changed/re-sign, actual send, accepted/rejected result, deadline, and abort. Assertions should use truncated challenge fingerprints or stage labels; never assert full challenge/event/key material in logs.

### `packages/relay/src/group.ts` and `packages/relay/src/__tests__/group.test.ts` (service + test, batch/event-driven)

**Classifier analog** (`packages/relay/src/group.ts:69-75`, `:367-373`):

```ts
const RELAY_AUTH_ERROR_NAMES = new Set([
  "AuthRequiredError", "AuthHandlerError", "AuthTimeoutError",
]);

const reason = RELAY_AUTH_ERROR_NAMES.has(err?.name)
  ? `an auth failure (${err.name})`
  : err?.message || "an unknown error";
this.log(`Dropped relay ${relay.url} from group sync: ${reason}`, err);
return EMPTY;
```

Append every new terminal authenticate error name and update the coupling comment. Preserve name-based classification. Extend the existing group failure test near `group.test.ts:345-380` with actual imported relay error instances plus a non-auth control.

### `packages/loaders/src/loaders/sync-loader.ts` and loader tests (service/model + test, streaming)

**Structural boundary analog** (`packages/loaders/src/loaders/sync-loader.ts:39-51`):

```ts
export interface SyncAuthRelay {
  url: string;
  authenticate(signer: {
    signEvent: (event: EventTemplate) => NostrEvent | Promise<NostrEvent>;
  }): Promise<unknown>;
  auth(event: NostrEvent): Promise<unknown>;
}
```

If compatibility requires exposing the options argument structurally, derive or mirror only the minimal fields; do not add a production dependency on `applesauce-relay`.

**Duck-typed classifier analog** (`packages/loaders/src/loaders/sync-loader.ts:83-90`, `:631-643`): append new pinned names to `RELAY_AUTH_ERROR_NAMES`; keep the no-fallback branch based on `.name` and rethrow the original error.

**Parity test analog** (`packages/loaders/src/loaders/__tests__/sync-loader.test.ts:1012-1072`): retain the parameterized name coverage but strengthen the new cases by constructing exported relay error classes. A test-only workspace dependency or root cross-package fixture is acceptable; production duck typing must remain unchanged.

### `packages/concord/src/client/auth.ts` (service, request-response)

**Consumer analog** (`packages/concord/src/client/auth.ts:178-197`, `:225-243`):

```ts
try {
  const res = await ctx.relay.authenticate(signer);
  if (isOkResponse(res) && res.ok) {
    authLog("stream-key auth succeeded pk=%s relay=%s", pk.slice(0, 8), ctx.url);
  } else {
    this.fail(ctx.url, pk, "relay rejected the AUTH");
  }
} catch (err) {
  const message = (err as Error)?.message ?? String(err);
  this.fail(ctx.url, pk, message);
}
```

This already matches the verdict-value/error-rejection contract. Use build/type compatibility checks and only change it if the new option type or log wording requires it; do not convert false verdicts into thrown client failures.

### `packages/extra/src/vertex.ts` (service, event-driven)

**Analog:** the file's relay challenge subscription and direct `auth()` call near its constructor (search `challenge$` / `authenticate`). Preserve its manual challenge-driven flow as the raw-path compatibility case: a pre-signed event continues through `auth()` exactly once. Do not migrate it to `authenticate()` unless the consumer already owns a signer compatible with the high-level API and the plan explicitly calls for that semantic change.

### `apps/docs/loading/relays/relays.md` (documentation, request-response)

**Analog:** Authentication section at `apps/docs/loading/relays/relays.md:126-188`. Keep the established order: what authentication is, high-level `authenticate()` usage, manual `challenge$` + `auth()` integration, then multi-user behavior. Add the options/freshness/abort contract at the connection point, using code blocks under 20 lines. Explain that `event()` is always EVENT and `auth()` is always AUTH; remove any public verb-selector examples. Do not add a summary or standalone best-practices page.

### Provenance, requirements, and changeset (config/documentation, transform)

**Phase 18 analog:** `.planning/phases/18-event-family-re-layer/18-CONTEXT.md:16-41` records fixed low/high ownership and explicit supersession points. Add a dated Phase 20 amendment stating that Phase 18's one-attempt transport invariants survive while its public EVENT/AUTH verb selector is intentionally replaced.

Update `.planning/ROADMAP.md` Phase 20 success criterion 4 (currently says `auth()` sends via `event()`) and `.planning/REQUIREMENTS.md` AUTHF-04 to the private shared primitive/fixed-routing invariant.

**Changeset analog** (`.changeset/relay-event-publish-layering.md:1-5`):

```md
---
"applesauce-relay": major
---

Make event a one-attempt raw interaction and move authentication, retry, reconnect, and timeout policy to publish.
```

Create one focused relay major changeset for removal of `event(event, "AUTH")`; its body must be exactly one Markdown sentence. Use separate one-change changesets only if other independently releasable behavior requires them.

## Shared Patterns

### Protocol Verdict vs Client Failure

**Source:** `packages/relay/src/relay.ts:1267-1287`  
**Apply to:** raw helper, `event()`, `auth()`, `authenticate()`, Concord compatibility tests.

Matching `OK true` and `OK false` are `PublishResponse` values. EVENT alone translates `auth-required:` to `AuthRequiredError`. Timeout, abort, signer, freshness, and transport failures reject. AUTH must never feed the EVENT authentication loop.

### One Logical Clock and Cancellation

**Source:** the absolute whole-operation timeout precedent in `Relay.count()` at `packages/relay/src/relay.ts:1240-1257`, adapted without auth-phase suspension.  
**Apply to:** `authenticate()` and its fake-timer tests.

Capture the deadline once, before readiness/challenge/signing. `timeout: false` disables only this outer deadline; the private raw exchange retains `eventTimeout`. Register one abort listener and remove it in `finally`; recheck after every awaited signer and immediately before `auth()`.

### Cross-package Error Names

**Sources:** `packages/relay/src/relay.ts:139-160`, `packages/relay/src/group.ts:69-75`, `packages/loaders/src/loaders/sync-loader.ts:83-90`.  
**Apply to:** every new terminal authenticate error.

The class name, pinned `.name`, both classifier sets, coupling comments, and parity tests change atomically. Production boundaries stay duck-typed; tests import real instances.

### Redacted Lifecycle Logging

**Source:** `packages/relay/src/helpers/auth-log.ts`, imported at `packages/relay/src/relay.ts:56`, and `auth-lifecycle-logging.test.ts`.  
**Apply to:** every challenge/sign/retry/send/result/timeout/abort stage.

Use `authLog`, `describeWireRequest`, and `truncateForLog`. Log stage, relay, pubkey or bounded identifier; never the full challenge, signed event, or private material. Place the send log inside the actual write `defer`, not before readiness.

## No Analog Found

None. The repository already contains direct patterns for every planned role. The only weak spot is test harness placement for compile-time extra-argument rejection; the planner must select a compile-included fixture and verification command because runtime tests are excluded from the relay package build.

## Metadata

**Analog search scope:** `packages/relay/src`, `packages/loaders/src`, `packages/concord/src`, `packages/extra/src`, `apps/docs/loading/relays`, `.planning`, `.changeset`  
**Primary analog files read:** 12 source/test/doc files plus Phase 18 context and verification  
**Pattern extraction date:** 2026-08-31
