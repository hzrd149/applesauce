---
description: Reduce signature checks for events from relays that have earned trust
---

# Optimistic Verification

`OptimisticEventVerifier` is a drop-in `verifyEvent` callback for the [Event Store](./event-store.md) that checks fewer signatures as relays prove they only deliver valid events. Every event still has its structure and id hash checked; only the Schnorr signature check is sampled.

Use it when signature verification is a real cost, such as large timeline or sync loads, and accepting some unchecked signatures is acceptable.

## How it works

The verifier records successful signature checks for each relay in the event's seen relays. As a relay builds history, its trust grows from `0` to `1`, and the chance of checking a signature falls from 100% to `minimumVerificationRate`.

- Trust requires both volume (`verifiedEventsForTrust` checks) and time (`daysForTrust` UTC days with at least `verifiedEventsPerDay` checks each)
- Each day credits at most `verifiedEventsForTrust / daysForTrust` checks, so trust cannot be earned in one burst
- Evidence older than `historyDays` expires
- Events seen on several relays use the strictest relay's sampling rate
- Events without seen relays are always fully verified
- An invalid event resets the evidence of every relay it was seen on

Optimistically accepted events never get the nostr-tools `verifiedSymbol`, so code that calls `verifyEvent` directly still checks the signature.

## Usage

```ts
import { EventStore, OptimisticEventVerifier } from "applesauce-core";

const verifier = new OptimisticEventVerifier({ storage: localStorage });
const eventStore = new EventStore({ verifyEvent: verifier.verifyEvent });
```

### Options

These are the defaults:

```ts
const verifier = new OptimisticEventVerifier({
  storage: localStorage, // optional, evidence is in-memory without it
  minimumVerificationRate: 0.1, // lowest chance of checking a signature
  verifiedEventsForTrust: 10_000, // checks for full volume trust
  daysForTrust: 14, // qualifying days for full time trust
  verifiedEventsPerDay: 20, // checks for a day to qualify
  historyDays: 30, // evidence retention, at least daysForTrust
  cacheSize: 10_000, // recently verified events to remember
});
```

Counts must be positive safe integers and `minimumVerificationRate` must be greater than zero and at most one, otherwise the constructor throws a `RangeError`. A rate of `1` keeps every uncached signature check.

### Persistence

The `storage` option accepts anything with string `getItem` and `setItem` methods, sync or async, so both `localStorage` and [localForage](https://github.com/localForage/localForage) work.

```ts
import localforage from "localforage";

const verifier = new OptimisticEventVerifier({ storage: localforage });
```

Evidence loads lazily per relay and signatures are fully checked until it has loaded. Writes are batched in the background, and storage errors never block event ingestion. Instances sharing storage, such as other tabs, adopt a newer reset instead of overwriting it.

### Observing trust

```ts
verifier.relay$(relay).subscribe((state) => {
  console.log(state.trust, state.verificationProbability, state.history);
});
```

- `getRelayState(url)` returns a snapshot with `ready`, `trust`, `verificationProbability`, `verified`, and daily `history`
- `relay$(url)`, `trust$(url)`, and `history$(url)` update on new evidence, after loading, and at UTC day boundaries
- `relays$` emits every relay URL the verifier has seen
- `verifications$` emits the outcome of every check: `verified`, `skipped`, `cached`, or `invalid`

```ts
verifier.verifications$.pipe(filter((v) => v.result === "skipped")).subscribe(() => saved++);
```

See the [optimistic verification example](https://applesauce.build/examples/#/example/relay/optimistic-verification) for a live view of trust growth.

## Integration

### With RelayPool

Relays from `applesauce-relay` already add seen relays to events, so no extra wiring is needed:

```ts
pool.subscription(relays, filters).pipe(mapEventsToStore(eventStore)).subscribe();
```

### With other transports

Pass the source URL to `add` so the event has a seen relay; otherwise it is fully verified:

```ts
eventStore.add(event, "wss://relay.example.com");
```

### With multiple stores

Share one verifier so stores share evidence and skip repeat checks:

```ts
const eventStore = new EventStore({ verifyEvent: verifier.verifyEvent });
const asyncStore = new AsyncEventStore({ database, verifyEvent: verifier.verifyEvent });
```

## Best Practices

### Keep full verification for high-value events

Sampling cannot guarantee authenticity. A trusted relay that turns malicious can get forged events accepted, and a forged replaceable event with a future `created_at` stays as the newest version. Wrap the verifier to always check profiles, contact lists, relay lists, and anything used for payments or authorization:

```ts
import { verifyEvent } from "nostr-tools";

const strict = new Set([0, 3, 10002]);
eventStore.verifyEvent = (event) => (strict.has(event.kind) ? verifyEvent(event) : verifier.verifyEvent(event));
```

### Only attach real provenance

Seen relays are the verifier's only trust input. Never copy them onto a different event or pass a relay URL to `add` that the event didn't come from.

### Treat stored evidence as trusted input

Anything that can write to the storage can grant a relay trust. Avoid shared origins where other apps can write the same `localStorage`.

### Deletes bypass verification

The Event Store handles kind `5` delete events before calling `verifyEvent`, so the verifier never sees them.
