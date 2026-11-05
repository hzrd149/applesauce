---
description: Cast Nostr events into observable models with reactive properties
---

# Casting Events

Event casts wrap Nostr events into observable models with reactive properties. Each cast provides type-safe access to event data and related content through observables.

Import casts from `applesauce-common/casts`:

```typescript
import { castEvent, Note, Article } from "applesauce-common/casts";
```

## castEvent()

Cast any Nostr event to a specific cast class:

```typescript
const note = castEvent(event, Note, eventStore);
const article = castEvent(event, Article, eventStore);
```

Events are cached per class, so casting the same event twice returns the same instance:

```typescript
const cast1 = castEvent(event, Note, eventStore);
const cast2 = castEvent(event, Note, eventStore);
console.log(cast1 === cast2); // true
```

## Casting Observables

Use `castEventStream()` and `castTimelineStream()` to cast observables of events:

```typescript
import { castEventStream, castTimelineStream } from "applesauce-common/observable";

// Cast a single event observable
const note$ = eventStore.event(eventPointer).pipe(castEventStream(Note, eventStore));

// Cast a timeline observable
const notes$ = eventStore.timeline({ kinds: [1] }).pipe(castTimelineStream(Note, eventStore));
```

**Example:** [Thread Viewer](https://applesauce.build/examples#thread)

## Base EventCast

All casts extend the `EventCast` base class which provides common properties:

```typescript
cast.id; // Event ID
cast.uid; // Unique ID (id:pubkey)
cast.createdAt; // Date object
cast.author; // User cast
cast.seen; // Set of relay URLs where event was seen
cast.event; // Original Nostr event
cast.store; // Event store reference
```

## Feature casts

Each feature page shows how to read its casts alongside the loaders, factories, and actions that go with them.

| Casts                                                                | Feature                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `Note`                                                               | [Notes & Threads](/features/social/notes-and-threads)                        |
| `Article`                                                            | [Articles](/features/publishing/articles)                                        |
| `Comment`                                                            | [Comments](/features/social/comments)                                        |
| `Profile`                                                            | [Profiles](/features/social/profiles)                                        |
| `Reaction`, `Share`                                                  | [Reactions & Reposts](/features/social/reactions-and-reposts)                |
| `Zap`, `ZapGoal`                                                     | [Zaps](/features/social/zaps)                                                |
| `Mutes`, `Report`                                                    | [Mutes & Reports](/features/moderation/mutes-and-reports)                               |
| `BookmarksList`, `BookmarksSet`                                      | [Bookmarks](/features/social/bookmarks)                                      |
| `FavoriteRelays`, `SearchRelays`, `BlockedRelays`, `LookupRelayList` | [Relay Lists](/features/relays/relay-lists)                                  |
| `GroupsList`                                                         | [Groups](/features/social/groups)                                            |
| `Stream`, `StreamChatMessage`                                        | [Live Streams](/features/publishing/live-streams)                                |
| `GitRepository`, `GitIssue`, `GitPullRequest`, `GitPatch`            | [Git](/features/publishing/git)                                                  |
| `CodeSnippet`                                                        | [Code Snippets](/features/publishing/code-snippets)                              |
| `Torrent`                                                            | [Torrents](/features/files/torrents)                                        |
| `RelayMonitor`, `RelayDiscovery`                                     | [Relay Monitoring](/features/relays/relay-monitoring)                        |
| `Nsite`, `Napplet`                                                   | [Nostr Sites](/features/files/nostr-sites), [Napplets](/napplets/manifests) |
| `AppHandler`, `AppRecommendation`                                    | [App Handlers](/features/publishing/app-handlers)                                |

The full list of casts is in the [reference](https://applesauce.build/typedoc/modules/applesauce-common.Casts.html).

:::tip
All `$` suffixed properties return reactive observables that update when the underlying data changes. Use `use$` from `applesauce-react/hooks` to consume them in React components.
:::
