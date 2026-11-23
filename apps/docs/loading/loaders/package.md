---
description: Event loaders package for fetching Nostr data from relays with automatic caching and relay discovery
---

# Loaders

The `applesauce-loaders` package provides a set of pre-built loaders for common methods of loading events from a relay pool.

## Features

- Easy to setup and use
- Built-in request batching
- Built-in event deduplication (using an event store)
- Flexible enough to work with any relay connection pool

## Installation

:::code-group

```sh [npm]
npm install applesauce-loaders
```

```sh [yarn]
yarn install applesauce-loaders
```

```sh [pnpm]
pnpm install applesauce-loaders
```

:::

## Sync loader completeness

`createSyncLoader` uses NIP-77 when available and otherwise paginates requests backward, including the oldest second again to recover events split across pages.

`status.done` means all relays have finished working, not that every relay returned exhaustive history. Check each relay's `state` before advancing a durable history cursor:

- `"complete"`: the range was exhausted under the relay's reported limits, or negentropy finished successfully.
- `"incomplete"`: a repeated timestamp boundary could not be exhausted; `incomplete.reason` is `"boundary"` and `incomplete.timestamp` identifies the first uncertain Unix second.
- `"error"` or `"skipped"`: the relay failed or was excluded.

Handle `"incomplete"` in exhaustive state maps and switches alongside the other terminal states.

Incomplete runs preserve received events and continue fetching older history, but later empty pages do not clear the uncertainty. Unknown relay caps prevent trusting short pages, so even a repeated boundary-only page smaller than the requested limit is conservative evidence of incomplete coverage.

```ts
const { status$, events$ } = createSyncLoader({ eventStore, pool })({ relays, filter });
status$.subscribe(({ done, relays }) => {
  if (done && Object.values(relays).every((relay) => relay.state === "complete")) {
    // Retrieved events can now be considered exhaustive for these relay responses.
  }
});
```

An exactly full second is also potentially truncated: timestamp-only filters cannot distinguish a full bucket from one containing additional hidden events. Use NIP-77 where available; do not treat overlaps or repeated identical pages as proof of exhaustive history.
