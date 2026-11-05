---
description: Search and score pubkeys with any Open Ranking web-of-trust provider over HTTP
---

# Open Ranking

`OpenRanking` from `applesauce-extra/open-ranking` is a client for the [Open Ranking protocol](https://github.com/Open-Ranking/protocol), a plain HTTP/JSON interface that web-of-trust providers expose. One client works with any compliant provider, such as Brainstorm or Vertex.

## How to use it

Create a client for a provider URL. It defaults to `https://staging.brainstorm.world`:

```ts
import { OpenRanking } from "applesauce-extra/open-ranking";

const ranking = new OpenRanking("https://ranking.vertexlab.io");

const capabilities = await ranking.discover();
const results = await ranking.userSearch("hzrd149", 20);
const stats = await ranking.stats(pubkey);
```

`discover()` reads the provider's capabilities, including which ranking algorithms it offers. `userSearch` returns pubkeys sorted by rank, and `stats` returns a pubkey's rank plus follower, mute, and report counts where the provider supports them.

Requests throw with the provider's `X-Reason` header when they fail.

### Algorithms and point of view

Pass `algorithm` to choose one from `discover()`, otherwise the provider's default is used. Algorithms marked `pov: true` rank from a specific user's point of view and need both a `pov` pubkey and a signer:

```ts
const ranking = new OpenRanking(provider, { signer });

await ranking.userSearch(term, 20, { algorithm: algorithm.id, pov: pubkey });
```

The signer issues a [Nostr Web Token](/apps/auth/nostr-web-tokens) for each request. The token is cached and reused until it expires (five minutes by default, set with `tokenExpiration`), so scoring many pubkeys prompts the signer once. Use `setSigner()` to switch or clear the signer when the account changes.

## Integration

Results are bare pubkeys. Load their profiles through the event store:

```ts
const results = await ranking.userSearch(term);
const profile$ = eventStore.profile({ pubkey: results[0].pubkey });
```

**Examples:** [Open Ranking search](https://applesauce.build/examples/#/example/search/open-ranking), [Rank contacts](https://applesauce.build/examples/#/example/contacts/open-ranking)

## Best Practices

- Call `discover()` before offering algorithm choices, and disable `pov` algorithms when no user is signed in.
- Keep one client per provider so its capability, search, and token caches are shared.
- Only set a signer for point-of-view requests; public algorithms don't need authentication.
