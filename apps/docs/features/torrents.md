---
description: Index and discover BitTorrent content with magnet links and categories
---

# Torrents

Torrent events are kind 2003 events that index a BitTorrent info hash with its files, trackers, and categories (NIP-35). The content is a free-form description, and discussion happens in kind 1111 [comments](/features/comments).

## Reading a torrent

The `Torrent` cast throws without a 40-character hex info hash, so `castTimelineStream` drops invalid events.

```ts
const torrents = use$(() => store.timeline({ kinds: [2003] }).pipe(castTimelineStream(Torrent, store)), []);

torrent.title;
torrent.magnetLink; // magnet:?xt=urn:btih:... with trackers and name
torrent.files; // [{ name: "dune.mkv", size: 4200000000 }]
torrent.categoryPathParts; // ["video", "movie", "4k"]
torrent.externalIdentifiers; // [{ prefix: "tmdb", mediaType: "movie", id: "693134", ... }]
```

`infoHash`, `trackers`, `category` (a newznab id), `categoryPath`, and `searchTags` read the remaining tags. `torrent.comments$`, `reactions$`, and `zaps$` return its engagement.

## Publishing a torrent

`TorrentFactory.create(infoHash, description)` starts a torrent. The plural builder methods add to the existing tags, and `modify()` edits a published torrent.

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

## Commenting on a torrent

Torrent comments use kind 1111 instead of the kind 2004 comments in the original spec. Publish them with `CreateComment` and read them with `torrent.comments$`.

```ts
await actions.run(CreateComment, torrent.event, "Great release");
const comments = use$(torrent.comments$);
```

## Helpers

- `isValidTorrent(event)` and `isTorrentInfoHash(hash)` validate torrents and info hashes
- `getTorrentInfoHash`, `getTorrentFiles`, `getTorrentTrackers`, and `getTorrentExternalIdentifiers` read the tags
- `buildTorrentMagnetLink(infoHash, trackers, name)` builds a magnet link without an event
- `createTorrentExternalIdentifier(prefix, id, mediaType)` builds a `tmdb`, `ttvdb`, `imdb`, `mal`, or `anilist` identifier

**Examples:** [Feed](https://applesauce.build/examples/#/example/torrent/feed) · [Publisher](https://applesauce.build/examples/#/example/torrent/publisher) · [Search](https://applesauce.build/examples/#/example/torrent/search) · [Manager](https://applesauce.build/examples/#/example/torrent/manager)

## Best Practices

- Filter relays by `#t` search tags or `#i` identifiers like `tcat:video,movie` rather than titles, since relays only index tags
- Use `magnetLink` instead of building links by hand so trackers and names are encoded
- Validate an info hash with `isTorrentInfoHash()` before passing user input to `TorrentFactory.create()`
