---
description: Search profiles and check reputation with the Vertex web-of-trust relay
---

# Vertex

::: warning Deprecated
`Vertex` is deprecated and will be removed in a future major release. Vertex now offers the [Open Ranking](./open-ranking.md) API at `https://ranking.vertexlab.io`, so use the `OpenRanking` client with that endpoint instead of this DVM-based client.
:::

`Vertex` from `applesauce-extra/vertex` is a [`Relay`](/loading/relays/relays) subclass for [Vertex](https://vertexlab.io/docs/services/), a paid web-of-trust service. It sends signed DVM requests (kinds 5315 and 5312) and returns users ranked by pagerank or follower count.

## How to use it

Vertex requires authentication, so the client takes a signer and answers the relay's NIP-42 challenge automatically:

```ts
import { Vertex } from "applesauce-extra/vertex";

const vertex = new Vertex(signer);

const pointers = await vertex.userSearch("hzrd149", "globalPagerank", 20);
const reputation = await vertex.verifyReputation({ target: pubkey, limit: 5 });
const credits = await vertex.getCreditBalance();
```

`userSearch` returns profile pointers ranked highest first and caches results for an hour. `verifyReputation` returns a user's rank, follow counts, and top followers. `getCreditBalance` shows how many credits the account has left.

Rankings can be sorted by global pagerank, personalized pagerank (from the signer's point of view), or follower count.

Requests throw with Vertex's error message when the service rejects them, for example when the account is out of credits.

## Integration

`userSearch` returns pointers, not profiles. Load them with your [event loaders](/loading/loaders/event-loader) or the event store's `profile()`:

```ts
const pointers = await vertex.userSearch(term);
const profile$ = eventStore.profile(pointers[0]);
```

Requests are signed by the account the client was created with. When the active account changes, close the old client and create a new one:

```ts
const client = new Vertex(account.signer);
// ...when the account changes
client.close();
```

**Example:** [Vertex search](https://applesauce.build/examples/#/example/search/vertex)

## Best Practices

- Each request costs credits; debounce search inputs and rely on the built-in cache.
- Call `close()` when discarding a client to stop its auto-authentication subscription.
- Use [Open Ranking](./open-ranking.md) instead when you need an unauthenticated or provider-neutral HTTP API.
