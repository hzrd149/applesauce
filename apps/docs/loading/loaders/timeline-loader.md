---
description: Reactively load and prefetch time windows across multiple relays
---

# Timeline Loader

The Timeline Loader follows a finite time window and loads its missing ranges independently from each relay. It prioritizes gaps intersecting the visible window and includes adjoining buffer ranges in the same requests, so small scroll movements reuse loaded coverage.

Network batches are internal. Relays returning different event counts or covering different time periods do not define application pages.

## Usage

Create one input stream for the viewport and keep its subscription alive while the timeline is displayed:

```ts
import { BehaviorSubject } from "rxjs";
import { createTimelineLoader } from "applesauce-loaders/loaders";

const until = Math.floor(Date.now() / 1000);
const windows$ = new BehaviorSubject({ since: until - 3600, until });
const loader = createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore });
const sub = loader(windows$).subscribe();

// Scrolling changes the desired range, without queuing independent jobs.
windows$.next({ since: until - 7200, until: until - 3600 });

// Stop requests when the timeline is no longer displayed.
sub.unsubscribe();
```

Both bounds are inclusive integer Unix timestamps, with `0 <= since <= until`. Newer bounds are capped at now. The loader rejects missing bounds, numeric arguments, and infinite bounds.

A single window is also accepted. Its observable completes after visible and buffered requests settle:

```ts
loader({ since: yesterday, until: today }).subscribe();
```

Coverage belongs to the loading subscription. Keep a stream of windows subscribed to reuse coverage across scrolling and jumps. Separate calls or subscriptions start separate sessions; reuse the returned observable to share a session between consumers.

## Options

| Option            | Default         | Purpose                                                        |
| ----------------- | --------------- | -------------------------------------------------------------- |
| `limit`           | `100`           | Maximum events requested per filter in a network batch         |
| `prefetch`        | `limit`         | Events to buffer past each side of the window per source       |
| `retryDelay`      | `5000`          | First retry delay in ms after a failure, doubled up to 5 min   |
| `responseTimeout` | `10000`         | Time in ms a source may stay silent before it counts as failed |
| `liveness`        | None            | Tracker receiving relay failures and successes                 |
| `eventStore`      | Internal memory | Store receiving every incoming event                           |
| `cache`           | None            | Cache request method loaded alongside relays                   |
| `onStatus`        | None            | Callback receiving per-source and filter status changes        |
| `logger`          | Timeline logger | Debug logger                                                   |

The buffer is a number of events, not a duration, so it stays the same size as the window grows, shrinks, or moves through busy and quiet periods. Setting `prefetch: 0` disables it. Buffering starts once the visible window is covered.

The two sides load differently because NIP-01 returns newest events first:

- **Older**: each request below the buffer is an exact page, so the loader keeps paging until `prefetch` events sit below the window.
- **Newer**: relays cannot page forward, so the loader estimates how long the next `prefetch` events take from the density of loaded events near the edge, then fills that range newest first. The estimate is reused until half of it scrolls into view, and never reaches past the newest time the app has requested.

## Loading and coverage

```ts
const statusSub = loader.status$.subscribe((statuses) => {
  const loading = statuses.some((status) => status.state === "loading");
  const failures = statuses.filter((status) => status.state === "incomplete");
});
```

Each status identifies a source, filter, and current visible window. Its `buffer` is the visible window plus the prefetch buffer for that source, growing as older pages arrive, which is useful for visualizing prefetch:

- `loading`: visible ranges still need requests
- `covered`: the visible range is covered and no background request is active
- `prefetching`: the visible range is covered while the buffer loads
- `incomplete`: a request failed or a timestamp boundary could not be fully paged; `reason` distinguishes `request` failures from `boundary` uncertainty, and `error` explains why
- `removed`: an outbox source was removed or changed; emitted to `onStatus` and removed from `status$`

Completion means requests have settled; inspect status to distinguish successful coverage from failures. Empty status arrays can mean the outbox map is still unknown or has no sources. Failures do not stop healthy relays. A failed range is retried after `retryDelay`, doubling for each consecutive failure up to five minutes, and window changes don't retry it sooner. A source that sends nothing for `responseTimeout` counts as failed even when window changes keep cancelling its requests, so a hanging relay is backed off too.

The loader combines adjoining visible and buffered gaps instead of issuing separate requests at viewport edges. Requests use newest-first ordering and a batch limit:

- Initial and backward requests omit `since` when no older covered interval provides a stopping point, allowing a full batch of useful older events.
- When older coverage exists, `since` starts immediately after it; forward requests keep their upper bound at the buffer edge and page back toward that coverage.
- A jump starts at the new target's upper edge and stops once the target is covered, without draining every event between the old and new windows.
- An empty unbounded response establishes older exhaustion; a nonempty response only establishes coverage above its oldest boundary second.

One request runs at a time per relay. Window updates reuse in-flight work that still serves the visible range, rather than cancelling it just because it started as prefetch. It retains inclusive boundary seconds to avoid skipping events cut off by a relay limit, and only commits coverage after a request completes. A response that only repeats known events counts as exhaustion when it is smaller than a page the source has already returned. Otherwise the source may be applying a smaller limit.

:::warning
Repeated boundary-only responses as large as the relay's biggest page cannot prove that every event in that second was returned. This can happen when a relay applies an unknown limit. The loader continues past the second but reports incomplete coverage for windows containing it, rather than claiming certainty or looping.
:::

Large jumps query the new window directly. Previously covered intervals remain reusable; the loader does not crawl the time between disconnected windows. Coverage is a snapshot of completed requests, not a live guarantee about events subsequently published or backfilled into those ranges.

## Integration

### EventStore and React

Store incoming events before rendering a reactive, sorted timeline. Use `use$` to own the loading subscription:

```tsx
use$(() => loader(windows$), [loader]);
const statuses = use$(loader.status$);
const events = use$(() => eventStore.timeline(filter), [filter]);
```

The loader deduplicates emitted events across relays after sending each arrival to the EventStore, preserving relay metadata. Without `eventStore`, it uses an internal EventMemory.

### Cache

Cache coverage is independent of relay coverage. A successful cache query never suppresses a missing relay request:

```ts
const loader = createTimelineLoader(pool, relays, filter, {
  eventStore,
  cache: cacheRequest,
});
```

### Outbox maps

```ts
import { createOutboxTimelineLoader } from "applesauce-loaders/loaders";

const loader = createOutboxTimelineLoader(pool, outboxMap$, { kinds: [1] }, { eventStore });
const sub = loader(windows$).subscribe();
```

Unchanged relay filters keep their requests and coverage. Removed or changed filters cancel their work. New relays receive the latest window even if the map arrives after it.

### Relay liveness

Pass a `RelayLiveness` tracker to report failing relays, and filter the outbox relays with it so they drop out of the map until their backoff ends:

```ts
const liveness = new RelayLiveness();
liveness.connectToPool(pool);

const outboxes$ = user.outboxes$.pipe(ignoreUnhealthyRelays(liveness), map(toOutboxMap));
const loader = createOutboxTimelineLoader(pool, outboxes$, { kinds: [1] }, { eventStore, liveness });
```

### Observable operators

Use the operators directly when composing your own store and status handling:

```ts
windows$
  .pipe(loadBlocksFromRelays(pool, relays, filter, { onStatus: updateStatus }), mapEventsToStore(eventStore))
  .subscribe();
```

`loadBlocksFromRelay`, `loadBlocksFromCache`, `loadBlocksFromFilterMap`, `loadBlocksFromOutboxMap`, and `loadBlocksFromOutboxMapCache` use the same window scheduler. Direct operators emit boundary and cross-relay duplicates; use an EventStore for rendering.

## Migrating page-based consumers

`loader()`, numeric timestamps, and infinite bounds are no longer supported. The directional block operators and deprecated `cacheTimelineLoader` / `relaysTimelineLoader` wrappers have been removed.

Applications own their requested time ranges. A “show older” control can extend `since`; a scrolling viewport can emit both bounds. Do not interpret a relay's batch limit as an application page size.

## Best Practices

- Keep one subscribed window stream per timeline session to retain coverage.
- Render the visible range from the EventStore; prefetch may insert events outside it.
- Check visible loading status instead of waiting for a long-lived stream to complete.
- Keep live subscriptions separate; historical coverage is not automatically refreshed.
- Use the default buffer first, then measure request counts and visible loading latency before tuning it.
- Render as soon as one relay covers a window and let slower relays stream in, rather than waiting for every relay.
- Filter outbox relays with `ignoreUnhealthyRelays(liveness)` so dead relays leave the relay set instead of being retried.
