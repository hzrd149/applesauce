---
description: Track relay reachability locally with connectivity-aware cooldowns and recovery
---

# Client-side Relay Liveness

`RelayLiveness` tracks recent connection evidence and temporarily excludes failing relays. A client cannot establish global relay availability: DNS failures, captive portals, mobile handovers, browser suspension, and regional routing failures can all resemble a dead relay.

Unknown relays remain eligible. The tracker makes no connections itself; use `filter()` or the RxJS operators to apply its cooldown policy. Expiry makes a relay eligible for the next request rather than opening a background connection.

This optional source ships in `applesauce-relay`. For shared filtering and subscription patterns, see [Relay Liveness](./liveness); to use signed monitor reports instead, see [Remote Monitor Liveness](./remote-monitor-liveness). Try it in the [local liveness example](https://applesauce.build/examples/#/example/relay/local-liveness).

## How to use it

```ts
import { RelayLiveness } from "applesauce-relay";
import { ignoreUnhealthyRelays } from "applesauce-relay/operators";

const liveness = new RelayLiveness({ storage });
await liveness.load();
liveness.connectToPool(pool);

const available$ = relayList$.pipe(ignoreUnhealthyRelays(liveness));
const group = pool.group(available$);
```

Pool attachment includes existing relays and is idempotent. Call `disconnectFromPool(pool)` to detach a pool, or `destroy()` to remove all pool subscriptions, browser listeners, and timers.

### States and retries

| State     | Meaning                                                   | Eligible for requests   |
| --------- | --------------------------------------------------------- | ----------------------- |
| Unknown   | No evidence                                               | Yes                     |
| `online`  | Recent successful connection or protocol response         | Yes                     |
| `offline` | Failed attempt or historical persisted state              | After cooldown          |
| `dead`    | Sustained failures with corroborating client connectivity | After a longer cooldown |

`dead` is temporary and client-relative. It requires the failure threshold, a minimum streak duration, and a recent success reaching **another** relay during this session. That success must follow the preceding counted failure, so responses from before a shared outage cannot corroborate a later retry. If every relay fails, the tracker continues bounded retries without promoting the whole set to dead. Another relay's success is a heuristic; it cannot rule out routing failures affecting only some destinations.

Successful observations recover even dead relays immediately. A socket reopening after failures does not erase the streak until a Nostr response arrives. Recognized protocol replies include authentication challenges and access denials: an inaccessible subscription does not imply an offline relay.

### Options

All durations use milliseconds.

| Option                  | Default   | Purpose                                                   |
| ----------------------- | --------- | --------------------------------------------------------- |
| `maxFailuresBeforeDead` | `5`       | Minimum counted failures for dead classification          |
| `minFailureDuration`    | `600000`  | Minimum elapsed failure streak before dead classification |
| `connectivityWindow`    | `60000`   | Maximum age of another relay's corroborating success      |
| `failureWindow`         | `1800000` | Maximum gap between failures in one streak                |
| `backoffBaseDelay`      | `30000`   | Initial exponential cooldown                              |
| `backoffMaxDelay`       | `300000`  | Maximum ordinary cooldown                                 |
| `deadRetryDelay`        | `3600000` | Cooldown before retrying a dead relay                     |
| `recoveryGracePeriod`   | `15000`   | Suppression of failures after recovery                    |
| `storage`               | None      | Async `getItem` / `setItem` adapter                       |

Failures during cooldown are ignored to reduce duplicate reports from shared requests. Defaults favor keeping working relays discoverable over aggressive exclusion. These timings are policy defaults, not measured guarantees.

### Client connectivity

In browsers, the tracker listens for offline/online events and foreground transitions. Failures while offline or hidden are ignored. Returning online or to the foreground clears excluded relays' failure streaks and cooldowns, then gives requests a grace period. Old session successes do not corroborate new failures after recovery.

Native/mobile applications can forward their platform connectivity signal:

```ts
liveness.setNetworkAvailable(false);
// After the platform reports connectivity has returned:
liveness.setNetworkAvailable(true);
```

An online signal only permits attempts; it does not prove Internet access. Captive portals can still produce temporary cooldowns. Automatic browser foreground recovery and explicit native connectivity integration reduce penalties from suspended applications.

### Observing and managing state

`online$`, `offline$`, and `dead$` report classifications. `healthy$` and `unhealthy$` report eligibility; corresponding synchronous getters are available. `unhealthy$` suppresses unchanged exclusion lists so routine successes do not repeatedly rebuild filtered relay sets.

```ts
const state = liveness.getState("wss://relay.example/");
const remaining = liveness.getBackoffRemaining("wss://relay.example/");
const subscription = liveness.state("wss://relay.example/").subscribe(renderState);

// Forget an exclusion and allow an immediate attempt:
liveness.reset("wss://relay.example/");
```

`revive(url)` retains its existing delayed behavior: it resets the streak and applies the maximum ordinary cooldown. Neither manual action fabricates a successful connection. URL identity uses the same normalization as `RelayPool`; `ws:` and `wss:` remain distinct endpoints.

### Persistence

When a `storage` adapter is supplied, the tracker automatically persists updates and offers `save()` to await queued writes. `load()` validates stored records, treats historical states as offline, caps restored cooldowns at `backoffMaxDelay`, and reinstalls expiry timers. Persisted dead states cannot indefinitely exclude a relay in a new session. Evidence collected while loading takes precedence over stored state.

## Integration

### Loaders and request errors

Pass the tracker to a timeline loader to classify its errors:

```ts
import { createOutboxTimelineLoader } from "applesauce-loaders/loaders";

const loader = createOutboxTimelineLoader(pool, outboxMap$, { kinds: [1] }, { eventStore, liveness });
```

The loader uses `recordRequestFailure(url, error, startedAt)` when supported. `RelayLiveness` counts typed transport failures, unclean socket closes, and the relay's typed first-response timeout. It ignores arbitrary request errors and generic RxJS deadlines, which can include connection delays, authentication interaction, or application failures. A newer recorded success also overrides an older request failure.

Custom trackers that only implement `recordFailure` retain the previous request-outcome behavior. For direct integrations, use `recordFailure(url)` only for evidence you have already classified as a reachability failure, and `recordSuccess(url)` for positive evidence. Empty successful requests are successes; event yield and retention are separate concerns.

### Subscriptions and outboxes

Use this tracker with the [shared filtering operators](./liveness#integration) before opening subscriptions or selecting outbox relays. Attaching it to a pool observes local connection evidence; it does not automatically filter the pool.

## Best Practices

- Forward native connectivity signals and retain the recovery grace period on mobile devices.
- Keep unknown relays eligible and let cooldown expiry permit another attempt.
- Count transport failures separately from authentication restrictions and empty results.
- Offer `reset(url)` for an immediate user-requested retry.
- Call `destroy()` when the owning application scope ends.
