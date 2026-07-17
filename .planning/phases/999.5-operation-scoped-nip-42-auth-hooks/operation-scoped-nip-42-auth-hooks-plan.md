# Operation-Scoped NIP-42 Auth Hooks Plan

## Goal

Simplify NIP-42 authentication for relay consumers by moving auth handling from ambient relay/pool status subscriptions into the specific operation that receives `auth-required:`.

Downstream apps and Concord should not need to subscribe to `challenge$`, `status$`, `authRequiredForRead$`, or `authRequiredForPublish$` just to authenticate. Instead, request-like operations should expose a callback that is invoked when that operation is rejected for auth, then the operation should wait for the requested auth state and retry.

## Current Problem

`Relay` currently uses `authRequiredForRead$` and `authRequiredForPublish$` as broad cached flags. Once a relay sends `auth-required:` for one read or publish, later operations can pre-wait on relay-level auth state before attempting the operation.

That is too broad for real relay behavior:

- A relay may gate only certain kinds, such as `1059`, behind auth.
- A relay may require specific stream/user pubkeys for one request but not another.
- A relay may require multiple authenticated pubkeys on the same connection.
- A relay-level flag cannot safely represent which filters, event kinds, or pubkeys are gated.
- Apps currently need messy status/challenge watchers to know when to authenticate.

Concord currently works around this with `ConcordRelayAuth.autoAuthenticate` and stream-key auth drivers, but this creates repeated-auth risk and makes lifecycle ownership unclear.

## Desired Model

Operation behavior should key off concrete `auth-required:` responses, not cached relay-level auth-required flags.

For `req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, and negentropy:

1. Start the operation normally.
2. If the relay responds with `auth-required:`, mark the relevant auth-required flag for informational status only.
3. If `waitForAuth === false`, reject with `AuthRequiredError`.
4. If `onAuthRequired` is provided, call it with operation-local context.
5. If `onAuthRequired` rejects, reject only this operation.
6. If `onAuthRequired` resolves, wait for `waitForAuth` to be satisfied.
7. Apply `authTimeout` while waiting for auth state.
8. Retry the same operation according to `authRetries`.

No internal auth-handler dedupe or single-flight guard should be added. Apps/libraries own prompt dedupe, signer queuing, retry suppression, and user intent policy.

## Public API

Add these types to `packages/relay/src/types.ts`:

```ts
export type RelayAuthOperation = "read" | "publish" | "sync";

export type RelayAuthContext = {
  relay: Relay;
  url: string;
  challenge: string | null;
  operation: RelayAuthOperation;
  requirement: AuthRequirement;
  missingPubkeys: string[] | null;
  reason: string;
};

export type RelayAuthHandler = (ctx: RelayAuthContext) => void | Promise<void>;
```

Add these operation options wherever auth is supported:

```ts
onAuthRequired?: RelayAuthHandler;
authTimeout?: number | false;
authRetries?: number;
```

Default behavior:

- `waitForAuth: true`
- `authTimeout: 30_000`
- `authRetries: 1`

`authRetries: 1` means the operation may handle one `auth-required:` response and retry once. If the retry receives another `auth-required:`, reject unless the caller configured a higher retry count.

`authTimeout: false` preserves indefinite waiting after `auth-required:` for callers that want external auth state to satisfy the operation later.

## Option Semantics

`waitForAuth` should no longer mean “pre-block this operation if the relay-level auth-required flag is true.”

It should mean “after this operation receives `auth-required:` and the auth handler resolves, wait for this auth state before retrying.”

Examples:

```ts
pool.request(relays, filter, {
  waitForAuth: pubkey,
  onAuthRequired: async ({ relay }) => relay.authenticate(signer),
});
```

```ts
pool.subscription(relays, filters, {
  waitForAuth: authors,
  onAuthRequired: async ({ relay, missingPubkeys }) => {
    await auth.authenticateStreamKeys(relay, missingPubkeys ?? authors);
  },
});
```

`missingPubkeys` rules:

- `waitForAuth: true` -> `null`
- `waitForAuth: "pk"` -> `["pk"]` if missing, otherwise `[]`
- `waitForAuth: ["a", "b"]` -> only pubkeys not currently authenticated

## Files To Update

Primary relay package:

- `packages/relay/src/types.ts`
- `packages/relay/src/relay.ts`
- `packages/relay/src/group.ts`
- `packages/relay/src/pool.ts`
- `packages/relay/src/negentropy.ts` if its option type needs the new fields
- `packages/relay/src/__tests__/relay.test.ts`
- `packages/relay/src/__tests__/pool.test.ts`

Sync loader pass-through:

- `packages/loaders/src/loaders/sync-loader.ts`
- `packages/loaders/src/loaders/__tests__/sync-loader.test.ts`

Later Concord cleanup:

- `packages/concord/src/client/relay-auth.ts`
- `packages/concord/src/client/community.ts`
- `packages/concord/src/client/private-channel.ts`
- `packages/concord/src/client/sync.ts`
- `packages/concord/src/client/invite-watcher.ts`

The first implementation can stop after relay package and sync loader support. Concord can be refactored in a follow-up once the operation hook exists.

## Relay Implementation Notes

Add internal helpers to `Relay`:

- Compute missing pubkeys from `AuthRequirement`.
- Build `RelayAuthContext` from operation, reason, and options.
- Run `onAuthRequired` when present.
- Wait for `authSatisfied$(waitForAuth)` with `authTimeout`.
- Convert handler rejection or timeout into an operation-local error.

Remove operation pre-waiting based on `authRequiredForRead$` / `authRequiredForPublish$` from request paths. Keep those observables and status fields, but treat them as informational only.

Keep `event(..., "AUTH")` exempt from auth waiting and auth callbacks.

Preserve `waitForAuth: false` behavior: concrete `auth-required:` responses should reject immediately with `AuthRequiredError`.

## Request And Subscription Changes

For `Relay.req`:

- Send the initial `REQ` without checking `authRequiredForRead$`.
- On `CLOSED auth-required:`, set `receivedAuthRequiredForReq`.
- Invoke `onAuthRequired` if provided.
- Wait for `authSatisfied$(waitForAuth)` with `authTimeout`.
- Retry the `REQ` while `authRetries` allows.

`Relay.request` and `Relay.subscription` should inherit this behavior through `req`.

## Count Changes

`Relay.count` currently marks auth-required but does not fully mirror `req` retry behavior. Update it to follow the same auth callback, wait, timeout, and retry model.

## Publish Changes

For `Relay.publish` / `Relay.event`:

- Do not pre-wait on `authRequiredForPublish$`.
- On `OK false "auth-required:"`, set `receivedAuthRequiredForEvent` and throw `AuthRequiredError` for publish retry handling.
- Invoke `onAuthRequired` from the auth retry path.
- Wait for `authSatisfied$(waitForAuth)` with `authTimeout`.
- Retry according to `authRetries` and existing publish retry behavior.

Be careful to keep non-auth publish retries intact. Auth retries and connection/publish retries should not accidentally multiply into unbounded loops.

## Sync And Negentropy Changes

For `Relay.negentropy` / `Relay.sync`:

- Do not pre-wait on `authRequiredForRead$`.
- On `NEG-ERR auth-required:`, set `receivedAuthRequiredForReq`.
- Invoke `onAuthRequired`.
- Wait for `authSatisfied$(waitForAuth)` with `authTimeout`.
- Retry the negentropy negotiation according to `authRetries`.
- Preserve abort behavior: if `opts.signal` aborts while waiting for auth, return/complete as existing sync cancellation expects.

## Sync Loader Changes

Thread `onAuthRequired`, `authTimeout`, and `authRetries` through `SyncMethodOptions` and `SyncLoadRequest` so both negentropy sync and paginated request receive the same auth behavior.

## Tests

Relay tests should cover:

- A later unrelated request is not preblocked after an earlier `auth-required` read.
- `onAuthRequired` fires on `REQ` `CLOSED auth-required:` with relay, challenge, operation, requirement, missing pubkeys, and reason.
- A handler that authenticates causes the operation to retry.
- A handler rejection rejects only that operation.
- `authTimeout` rejects only that operation when auth is not satisfied.
- `authTimeout: false` waits indefinitely until external auth state satisfies the requirement.
- `authRetries: 1` fails after a second `auth-required:` response.
- `authRetries: 2` allows two auth handling cycles.
- Multi-pubkey `waitForAuth` waits for all requested pubkeys after the handler resolves.
- Concurrent operations each call their own handler; there is no relay-internal dedupe.
- `waitForAuth: false` still throws `AuthRequiredError` without calling `onAuthRequired`.
- `event(..., "AUTH")` never invokes `onAuthRequired`.
- `authRequiredForRead$` and `authRequiredForPublish$` still update for UI/status.

Pool/group tests should cover:

- `onAuthRequired`, `authTimeout`, and `authRetries` pass through to relay methods.

Sync loader tests should cover:

- Options pass to negentropy sync.
- Options pass to paginated request.

## Concord Follow-Up

After the relay API lands, simplify Concord auth code.

Replace long-lived status/challenge watchers where practical with operation-local handlers:

```ts
this.pool.subscription(this.relays(), filters, {
  waitForAuth: authors,
  onAuthRequired: ({ relay, missingPubkeys }) =>
    this.relayAuth.authenticateStreamKeys(relay, missingPubkeys ?? authors),
});
```

For direct invite user auth:

```ts
this.pool.request(relays, requestFilters, {
  waitForAuth: this.pubkey,
  onAuthRequired: ({ relay }) => relay.authenticate(this.signer),
});
```

`ConcordRelayAuth.autoAuthenticate` should either be removed or converted into a helper that returns a `RelayAuthHandler` instead of subscribing to `pool.status$`.

Any dedupe or signer-prompt suppression belongs in Concord/app code, not in `applesauce-relay`.

## Changeset Guidance

This is a behavior change for `applesauce-relay` and `applesauce-loaders`:

- Add a changeset for `applesauce-relay` describing operation-scoped NIP-42 auth callbacks and timeout/retry behavior.
- Add a changeset for `applesauce-loaders` describing pass-through support in the sync loader.

Each changeset body must be a single markdown sentence.

## Verification

Run at minimum:

```sh
pnpm --filter applesauce-relay test
pnpm --filter applesauce-loaders test
```

If Concord is refactored in the same branch, also run:

```sh
pnpm --filter applesauce-concord test
```
