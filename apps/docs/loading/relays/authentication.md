---
description: Authenticate with relays, handle auth-required refusals, and track authenticated users on a connection
---

# Authentication

The `Relay` class implements [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) authentication. It tracks the relay's challenge and every AUTH attempt on the connection, and lets each request decide how to react when the relay refuses it with `auth-required:`.

## Authenticating with a signer

`authenticate()` waits for a challenge, signs it, checks that the challenge is still current, and sends one AUTH event. It resolves with the relay's `OK` verdict.

```typescript
const controller = new AbortController();

const response = await relay.authenticate(signer, {
  timeout: 30_000,
  challengeRetries: 1,
  signal: controller.signal,
});

if (!response.ok) console.log("Relay rejected AUTH:", response.message);
```

The `signer` is any object with a `signEvent()` method, such as `window.nostr` or an applesauce signer.

- `timeout` covers waiting for the challenge, signing, re-signing and the AUTH reply (default 30s). Pass `false` to disable it.
- `challengeRetries` is how many times to re-sign if the challenge changes while signing (default `1`).
- `OK true` and `OK false` replies resolve the promise. Timeouts, signer errors, stale challenges, aborts and connection failures reject it.

## Building the AUTH event yourself

`auth()` sends an AUTH event you have already signed and resolves with the matching `OK` reply. Use it only when your app wants to own the challenge and event construction.

```typescript
import { makeAuthEvent } from "nostr-tools/nip42";

relay.challenge$.subscribe(async (challenge) => {
  if (!challenge) return;
  const event = await signer.signEvent(makeAuthEvent(relay.url, challenge));
  console.log(await relay.auth(event));
});
```

## Tracking auth state

```typescript
relay.challenge$.subscribe((challenge) => console.log("Challenge:", challenge));
relay.authenticated$.subscribe((ok) => console.log("Any user authenticated:", ok));
relay.authenticatedPubkeys$.subscribe((pubkeys) => console.log("Authenticated:", pubkeys));
relay.authentications$.subscribe((attempts) => console.log("AUTH attempts by pubkey:", attempts));

relay.authenticatedFor$(pubkey).subscribe((ok) => console.log("User authenticated:", ok));
```

`isAuthenticated(pubkey)` is the synchronous version of `authenticatedFor$()`. To authenticate as soon as the relay sends a challenge, watch `challenge$`:

```typescript
relay.challenge$.pipe(filter(Boolean)).subscribe(() => relay.authenticate(signer));
```

## Handling auth-required responses

Relays refuse individual requests with `auth-required:`, so each request handles its own refusal and never blocks other requests on the same connection. The high-level `subscription()`, `request()`, `publish()`, `count()` and `sync()` methods accept these options:

```typescript
relay.subscription(filters, {
  onAuthRequired: ({ relay }) => relay.authenticate(signer),
  waitForAuth: pubkey, // default `true`: any authenticated user
  authTimeout: 30_000,
});
```

When the relay refuses the request, it calls `onAuthRequired`, waits up to `authTimeout` for `waitForAuth` to be satisfied, then resends. `authRetries` (default `1`) limits how many refusals in a row it will tolerate.

| Situation                                 | Error               |
| ----------------------------------------- | ------------------- |
| `waitForAuth: false` or retries exhausted | `AuthRequiredError` |
| Nobody authenticated within `authTimeout` | `AuthTimeoutError`  |
| `onAuthRequired` threw or rejected        | `AuthHandlerError`  |

The handler context also includes the `challenge`, the refused `request`, the relay's `reason` and the `missingPubkeys` for the requirement. The raw `event()` and `negentropy()` methods do not retry and error with `AuthRequiredError` when refused.

## Multiple users on one connection

Call `authenticate()` once per signer. Each attempt is tracked separately by pubkey.

```typescript
await relay.authenticate(aliceSigner);
await relay.authenticate(bobSigner);

relay.isAuthenticated([alice, bob]); // true when every pubkey is authenticated

// Only resend the REQ once both users are authenticated
relay.subscription({ kinds: [1059], "#p": [alice, bob] }, { waitForAuth: [alice, bob] });
```

::: warning
Support for multiple authenticated users on one connection varies between relay implementations. Some relays only honor the most recent AUTH.
:::

## Integration

`RelayPool` and `RelayGroup` forward the same auth options to every relay. A whole-operation `timeout` on a pool or group request pauses while any relay is authenticating and resumes once all overlapping auth phases finish.

```typescript
pool.request(relays, filters, {
  onAuthRequired: ({ relay }) => relay.authenticate(manager.signer),
});
```

## Best Practices

- Prefer `authenticate()` over `auth()` unless you need to build the AUTH event yourself.
- Pass an `AbortSignal` when authentication belongs to a cancellable view or operation.
- Treat `ok: false` as the relay's verdict, and catch rejections for signer, timeout, abort and connection failures.
- Use `waitForAuth` with specific pubkeys when a request only makes sense for those users.
