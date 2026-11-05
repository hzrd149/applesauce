---
description: Query Primal's caching server for search, trending content, recommendations, and notifications
---

# Primal Cache

::: warning
Primal's caching server uses a custom, Primal-only protocol. For event counts and stats, use [NIP-45 counting](/loading/relays/counting) on standard relays instead.
:::

`PrimalCache` from `applesauce-extra/primal` is a [`Relay`](/loading/relays/relays) subclass for [Primal's caching server](https://github.com/PrimalHQ/primal-server). Primal indexes a large part of the network and answers custom `cache` requests that normal relays don't support, such as full-text search, trending feeds, and scored users.

## How to use it

Create one client and call its typed methods. It connects to `wss://cache2.primal.net/v1` by default:

```ts
import { PrimalCache } from "applesauce-extra/primal";

const primal = new PrimalCache();

const profiles = await primal.userSearch("hzrd149", 20);
const trending = await primal.exploreGlobalTrending24h(50);
```

Each method sends one request, collects the response events into a sorted timeline, and resolves once the server ends the request. Pass a URL to the constructor to use a different Primal-compatible server.

### What you can ask for

Methods are grouped by what they return:

- **Search:** `userSearch` for profiles, `search` and `advancedSearch` for notes.
- **Discovery:** trending notes, hashtags, and images (`exploreGlobalTrending24h`, `trendingHashtags`, `trendingImages`), plus recommended and suggested users.
- **Scored content:** a user's top notes and media, and scored user lists.
- **Notifications:** a user's notifications and their seen state.
- **Feeds:** Primal's advanced feeds and feed directives.

`userSearch` returns only kind 0 profiles. Other methods return every event Primal sends, which can include Primal-specific kinds that carry stats alongside the notes.

Use `cacheRequest()` for a server method this class doesn't wrap yet. It returns the raw observable:

```ts
primal.cacheRequest(["user_search", { query: "bitcoin", limit: 5 }]).subscribe(console.log);
```

## Integration

Add results to your `EventStore` so profiles and notes render through the same models as relay data:

```ts
const profiles = await primal.userSearch(term, 20);
for (const event of profiles) eventStore.add(event);
```

`PrimalCache` is a normal relay, so it can also be added to a [`RelayPool`](/loading/relays/pool) or used with [loaders](/loading/loaders/event-loader) for standard `REQ` filters.

**Example:** [Primal search](https://applesauce.build/examples/#/example/search/primal)

## Best Practices

- Create one `PrimalCache` per app and reuse it; each instance opens its own connection.
- Debounce search inputs before calling `userSearch` or `search`.
- Treat Primal as a discovery index, not a source of truth; load events users act on from their own relays.
