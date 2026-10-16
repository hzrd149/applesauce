---
description: Read and edit a user's favorite, search, blocked, lookup, and DM relay lists and relay sets
---

# Relay Lists

Besides their inbox and outbox relays, users publish lists of relays for specific jobs: favorites to browse, relays to search, relays to avoid, relays for profile lookups, and relays for receiving direct messages. Relay sets are named, addressable groups of relays. For inbox and outbox relays, see [Outbox](/features/outbox).

| List            | Kind  | User observable             | Cast              |
| --------------- | ----- | --------------------------- | ----------------- |
| Favorite relays | 10012 | `user.favoriteRelays$`      | `FavoriteRelays`  |
| Search relays   | 10007 | `user.searchRelays$`        | `SearchRelays`    |
| Blocked relays  | 10006 | `user.blockedRelays$`       | `BlockedRelays`   |
| Lookup relays   | 10086 | `user.lookupRelayList$`     | `LookupRelayList` |
| DM relays       | 10050 | `user.directMessageRelays$` | none (`string[]`) |
| Relay sets      | 30002 | none                        | none              |

## Reading relay lists

Each list observable loads the list from the user's outboxes. The casts share one API: `relays` returns the public relay URLs.

```ts
const search = use$(user.searchRelays$);
const blocked = use$(user.blockedRelays$);
const dmRelays = use$(user.directMessageRelays$); // string[] | undefined

pool.request(search?.relays ?? defaultSearchRelays, { kinds: [1], search: query });
```

## Unlocking hidden relays

Favorite, search, blocked, and lookup lists can hold hidden relays encrypted to the user. `hidden$` emits once they are unlocked.

```ts
if (favorites.hasHidden && !favorites.unlocked) await favorites.unlock(signer);

const hiddenRelays = use$(favorites.hidden$);
```

## Editing relay lists

Each list has add and remove actions that publish to the user's outboxes and create the list if it's missing. Most take a single URL or an array, plus a `hidden` flag.

```ts
await actions.run(AddFavoriteRelay, "wss://relay.example.com");
await actions.run(AddSearchRelay, ["wss://search.example.com"], true);
await actions.run(RemoveBlockedRelay, "wss://spam.example.com");
await actions.run(AddDirectMessageRelay, "wss://inbox.example.com");
```

| List            | Actions                                                                                                         |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Favorite relays | `AddFavoriteRelay`, `RemoveFavoriteRelay`, `AddFavoriteRelaySet`, `RemoveFavoriteRelaySet`, `NewFavoriteRelays` |
| Search relays   | `AddSearchRelay`, `RemoveSearchRelay`, `NewSearchRelays`                                                        |
| Blocked relays  | `AddBlockedRelay`, `RemoveBlockedRelay`                                                                         |
| DM relays       | `AddDirectMessageRelay`, `RemoveDirectMessageRelay`, `NewDirectMessageRelays`                                   |

DM relay actions have no `hidden` flag, since senders need to read the list. The `New*` actions throw if the list already exists.

## Relay sets

Relay sets are addressable lists identified by their `d` tag. Favorite relay lists can reference them with `AddFavoriteRelaySet`.

```ts
await actions.run(CreateRelaySet, "Japan", { description: "Relays in Japan", public: [a, b] });
await actions.run(AddRelayToRelaySet, "wss://c.example.com", "japan-identifier");
await actions.run(RemoveRelayFromRelaySet, "wss://a.example.com", setEvent);
await actions.run(UpdateRelaySetInformation, "japan-identifier", { title: "JP relays" });
```

Read a set's relays with `getRelaysFromList(event)` from `applesauce-common/helpers`.

## Building relay list events

Every relay list factory in `applesauce-common/factories` extends `NIP51RelayListFactory`, which adds `addRelay(relay, hidden?)` and `removeRelay(relay, hidden?)` to the list helpers `title()`, `description()`, and `image()`. The factories are `FavoriteRelaysFactory`, `SearchRelaysFactory`, `BlockedRelaysFactory`, `LookupRelayListFactory`, `DmRelaysFactory`, and `RelaySetFactory`.

```ts
const signed = await LookupRelayListFactory.create()
  .addRelay(["wss://purplepag.es", "wss://indexer.example.com"])
  .sign(signer);
```

`FavoriteRelaysFactory` also has `addRelaySet()` and `removeRelaySet()`. There are no actions for the lookup list, so use its factory.

## Helpers and models

- `getRelaysFromList(event, type?)` returns relay URLs, with `type` set to `"public"` (the default), `"hidden"`, or `"all"`
- `isValidFavoriteRelaysList`, `isValidSearchRelaysList`, `isValidBlockedRelaysList`, `isValidLookupRelayList`, and `isValidDirectMessageRelaysList` check the kind
- `FavoriteRelaysModel`, `FavoriteRelaySetsModel`, `SearchRelaysModel`, and `BlockedRelaysModel` take a pubkey and an optional `type`, and return plain arrays

## Best Practices

- Fall back to app defaults when a user has no search or lookup relays
- Skip relays from `blockedRelays` when picking relays to connect to, including hidden ones once unlocked
- Keep DM relays public so other users can deliver messages
- Use relay sets for curated groups of relays instead of overloading favorites
