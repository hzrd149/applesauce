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

| Option        | Default         | Purpose                                                 |
| ------------- | --------------- | ------------------------------------------------------- |
| `limit`       | `100`           | Maximum events requested per filter in a network batch  |
| `prefetch`    | `0.5`           | Window duration to buffer on each side                  |
| `minPrefetch` | `60`            | Minimum buffer duration in seconds                      |
| `eventStore`  | Internal memory | Store receiving every incoming event                    |
| `cache`       | None            | Cache request method loaded alongside relays            |
| `onStatus`    | None            | Callback receiving per-source and filter status changes |
| `logger`      | Timeline logger | Debug logger                                            |

Setting `prefetch: 0` disables buffering, including `minPrefetch`. Otherwise, each side uses the greater of `minPrefetch` and the window duration multiplied by `prefetch`. The buffer is anchored until half of it is consumed, and never extends beyond now. It is a loading target rather than a strict response boundary: a full batch may include older events beyond the buffer, even with `prefetch: 0`.

## Loading and coverage

```ts
const statusSub = loader.status$.subscribe((statuses) => {
  const loading = statuses.some((status) => status.state === "loading");
  const failures = statuses.filter((status) => status.state === "incomplete");
});
```

Each status identifies a source, filter, and current visible window:

- `loading`: visible ranges still need requests
- `covered`: the visible range is covered and no background request is active
- `prefetching`: the visible range is covered while the buffer loads
- `incomplete`: a request failed or a timestamp boundary could not be fully paged; `reason` distinguishes `request` failures from `boundary` uncertainty, and `error` explains why
- `removed`: an outbox source was removed or changed; emitted to `onStatus` and removed from `status$`

Completion means requests have settled; inspect status to distinguish successful coverage from failures. Empty status arrays can mean the outbox map is still unknown or has no sources. Failures do not stop healthy relays, and a new window emission retries failed sources without discarding their completed coverage.

The loader combines adjoining visible and buffered gaps instead of issuing separate requests at viewport edges. Requests use newest-first ordering and a batch limit:

- Initial and backward requests omit `since` when no older covered interval provides a stopping point, allowing a full batch of useful older events.
- When older coverage exists, `since` starts immediately after it; forward requests keep their upper bound at the buffer edge and page back toward that coverage.
- A jump starts at the new target's upper edge and stops once the target is covered, without draining every event between the old and new windows.
- An empty unbounded response establishes older exhaustion; a nonempty response only establishes coverage above its oldest boundary second.

One request runs at a time per relay. Window updates reuse in-flight work that still serves the visible range, rather than cancelling it just because it started as prefetch. It retains inclusive boundary seconds to avoid skipping events cut off by a relay limit, and only commits coverage after a request completes. Short responses are not treated as exhaustion because relays may apply smaller limits.

:::warning
Repeated boundary-only responses cannot prove that every event in that second was returned. This can happen even with an ordinary boundary event when a relay applies an unknown limit. The loader continues past the second but reports incomplete coverage for windows containing it, rather than claiming certainty or looping.
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
