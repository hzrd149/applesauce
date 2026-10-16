---
description: Publish and read NIP-35 torrent events
---

# NIP-35 Torrents

[NIP-35](https://github.com/nostr-protocol/nips/blob/master/35.md) torrents are kind 2003 events that index a BitTorrent info hash, its files, trackers and categories. `applesauce-common` provides helpers, operations, `TorrentFactory` and the `Torrent` cast.

## Publishing

```ts
const torrent = await TorrentFactory.create(infoHash, "Release notes")
  .title("Dune: Part Two")
  .files([{ name: "dune.mkv", size: 4_200_000_000 }])
  .trackers(["udp://tracker.example.com:1337"])
  .categoryPath("video,movie,4k")
  .addExternalId(createTorrentExternalIdentifier("tmdb", "693134", "movie"))
  .sign(signer);

const updated = await TorrentFactory.modify(torrent).removeTracker("udp://tracker.example.com:1337").sign(signer);
```

## Reading

```ts
const torrent = castEvent(event, Torrent, eventStore); // Throws without a 40 char hex info hash

torrent.magnetLink; // magnet:?xt=urn:btih:...
torrent.categoryPathParts; // ["video", "movie", "4k"]
torrent.externalIdentifiers; // [{ prefix: "tmdb", mediaType: "movie", id: "693134", ... }]
```

## Comments

Torrent comments use NIP-22 (kind 1111) instead of kind 2004. Create them with `CommentFactory` and read them with `torrent.comments$`.

```ts
await CommentFactory.create(torrent.event, "Great release").sign(signer);
const comments = use$(torrent.comments$);
```

**Examples:** [Feed](https://applesauce.build/examples/#/example/torrent/feed) · [Publisher](https://applesauce.build/examples/#/example/torrent/publisher) · [Search](https://applesauce.build/examples/#/example/torrent/search) · [Manager](https://applesauce.build/examples/#/example/torrent/manager)
