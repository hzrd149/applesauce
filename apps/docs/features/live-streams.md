---
description: Show live streams, their chat, and publish your own streams
---

# Live Streams

Live streams are addressable kind 30311 events that describe a stream's URLs, status, and participants (NIP-53). Viewers chat with kind 1311 messages that tag the stream's address.

## Finding streams

Cast kind 30311 events with `Stream`. To find a user's streams, query both the streams they published and the ones that tag them as a participant.

```ts
const streams = use$(
  () =>
    store
      .timeline([
        { kinds: [30311], authors: [pubkey] },
        { kinds: [30311], "#p": [pubkey] },
      ])
      .pipe(castTimelineStream(Stream, store)),
  [pubkey],
);
const live = streams?.filter((s) => s.status === "live");
```

## Reading a stream

`status` is `"live"`, `"planned"`, or `"ended"`, and streams older than two weeks always read as `"ended"`.

```ts
stream.title;
stream.host; // User from the "host" p tag, or the author
stream.participants; // User[]
stream.streamingVideos; // video or HLS URLs
stream.recording; // URL after the stream ends
stream.viewers; // current participant count
```

`stream.zaps$` and `stream.shares$` return the stream's [zaps](/features/zaps) and [reposts](/features/reactions-and-reposts). `stream.goal$` loads its [zap goal](/features/zaps#zap-goals) when `goalPointer` is set.

## Live chat

`stream.chat$` returns the chat messages in the store as `StreamChatMessage` casts, backed by `StreamChatMessagesModel`. Each message links back with `stream` and `stream$`, and exposes `zaps$` and `reactions$`.

```ts
const chat = use$(stream.chat$);

const message = await StreamChatMessageFactory.create(stream.event, "gm").sign(signer);
```

Subscribe to `{ kinds: [1311], "#a": [address] }` on the stream's relays to receive new messages.

## Publishing a stream

`LiveStreamFactory.create(title)` generates the `d` identifier. Update the stream with `modify()` as its status changes, since clients only keep the latest version.

```ts
const event = await LiveStreamFactory.create("Building with applesauce")
  .streamingUrl("https://example.com/live.m3u8")
  .status("live")
  .startTime(new Date())
  .addParticipant({ pubkey }, "speaker")
  .sign(signer);

const ended = await LiveStreamFactory.modify(event).status("ended").recordingUrl(vod).sign(signer);
```

## Helpers

- `getStreamTitle`, `getStreamStatus`, `getStreamHost`, `getStreamParticipants`, and `getStreamStreamingURLs` read a stream; `getStreamParticipants` keeps each participant's role
- `getStreamRelays`, `getStreamGoalPointer`, `getStreamStartTime`, `getStreamEndTime`, and `getStreamViewers` read the rest of the tags
- `isValidStreamChatMessage(event)` and `getStreamChatMessageStream(event)` read chat messages

**Example:** [Stream viewer](https://applesauce.build/examples/#/example/stream/viewer)

## Best Practices

- Read chat from the relays in `stream.relays` when set, since streams pick where their chat lives
- Prefer `streamingVideos` over `streamingURLs` for a video player, and fall back to `recording` once ended
- Set the status to `"ended"` when a stream stops, since applesauce only treats streams as ended after two weeks
