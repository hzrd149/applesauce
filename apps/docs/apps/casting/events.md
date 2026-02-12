---
description: Cast Nostr events into observable models with reactive properties
---

# Casting Events

Event casts wrap Nostr events into observable models with reactive properties. Each cast provides type-safe access to event data and related content through observables.

Import casts from `applesauce-common/casts`:

```typescript
import {
  castEvent,
  Note,
  Article,
  Profile,
  Zap,
  Reaction,
  Comment,
  Mutes,
  BookmarksList,
} from "applesauce-common/casts";
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

**Example:** [Thread Viewer](https://applesauce.hzrd149.com/examples#thread)

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

## Note

Cast for a short text note (kind 1). Provides NIP-10 thread references and access to replies, comments, zaps, reactions, and shares.

[**Note** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Note.html)

```typescript
const note = use$(() => eventStore.event(eventPointer).pipe(castEventStream(Note, eventStore)), [eventPointer.id]);

// Access note metadata
const isReply = note.isReply;
const isRoot = note.isRoot;
const references = note.references; // NIP-10 references
const quotePointers = note.quotePointers; // Quoted events

// Get thread information
const threadRoot = use$(note.threadRoot$);
const replyingTo = use$(note.replyingTo$);

// Get engagement
const replies = use$(note.replies$);
const comments = use$(note.comments$);
const zaps = use$(note.zaps$);
const reactions = use$(note.reactions$);
const shares = use$(note.shares$);
```

**Example:** [Event Deletion](https://applesauce.hzrd149.com/examples#event-deletion)

## Article

Cast for long-form content (kind 30023). Provides article metadata, addressable pointer, and reactions.

[**Article** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Article.html)

```typescript
const article = use$(
  () => eventStore.replaceable(addressPointer).pipe(castEventStream(Article, eventStore)),
  [addressPointer.kind, addressPointer.pubkey, addressPointer.identifier],
);

// Access article metadata
const title = article.title;
const image = article.image;
const summary = article.summary;
const published = article.published; // Unix timestamp
const publishedDate = article.publishedDate; // Date object

// Get addressable identifiers
const pointer = article.pointer; // AddressPointer
const address = article.address; // naddr string
const addressWithHints = use$(article.address$); // Observable with relay hints

// Get reactions
const reactions = use$(article.reactions$);
```

**Example:** [Articles](https://applesauce.hzrd149.com/examples#articles)

## Profile

Cast for user metadata (kind 0). Provides access to all profile fields.

[**Profile** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Profile.html)

```typescript
const profile = use$(user.profile$);

if (profile) {
  const displayName = profile.displayName;
  const name = profile.name;
  const about = profile.about;
  const picture = profile.picture;
  const banner = profile.banner;
  const website = profile.website;
  const nip05 = profile.dnsIdentity;
  const lud16 = profile.lud16;
  const lud06 = profile.lud06;
  const lightningAddress = profile.lightningAddress; // lud16 or lud06
  const bot = profile.bot;
  const birthday = profile.birthday;
  const languages = profile.languages;
}
```

**Example:** [Profile Editor](https://applesauce.hzrd149.com/examples#profile-editor)

## Zap

Cast for a zap event (kind 9735). Provides sender, recipient, amount, and the zapped event.

[**Zap** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Zap.html)

```typescript
const zaps = use$(note.zaps$);

zaps.forEach((zap) => {
  const sender = zap.sender; // User who sent the zap
  const recipient = zap.recipient; // User who received the zap
  const amount = zap.amount; // Amount in millisatoshis
  const payment = zap.payment; // Bolt11 invoice
  const preimage = zap.preimage; // Payment preimage
  const request = zap.request; // Zap request event
  const eventPointer = zap.eventPointer; // Event that was zapped
  const addressPointer = zap.addressPointer; // Address that was zapped
});

// Get the zapped event
const zappedEvent = use$(zap.event$);
```

**Example:** [Zap Timeline](https://applesauce.hzrd149.com/examples#zap-timeline)

## Reaction

Cast for a reaction (kind 7). Provides emoji content and the reacted event.

[**Reaction** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Reaction.html)

```typescript
const reactions = use$(note.reactions$);

reactions.forEach((reaction) => {
  const content = reaction.content; // Emoji (defaults to "+")
  const emoji = reaction.emoji; // Custom emoji if used
  const eventPointer = reaction.eventPointer; // Event pointer
  const addressPointer = reaction.addressPointer; // Address pointer (for replaceable)
  const pointer = reaction.pointer; // Either event or address pointer
});

// Get the reacted event
const reactedEvent = use$(reaction.reactedTo$);
```

**Example:** [Reactions Timeline](https://applesauce.hzrd149.com/examples#reactions-timeline)

## Comment

Cast for a NIP-22 comment (kind 1111). Provides root/reply pointers and nested comment threads.

[**Comment** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Comment.html)

```typescript
const comments = use$(article.comments$);

comments.forEach((comment) => {
  const rootPointer = comment.rootPointer; // Event/address at thread root
  const replyPointer = comment.replyPointer; // Event/address being replied to
});

// Get related events
const root = use$(comment.root$);
const parent = use$(comment.parent$);

// Get engagement
const replies = use$(comment.replies$);
const zaps = use$(comment.zaps$);
const reactions = use$(comment.reactions$);
```

**Example:** [Comment Feed](https://applesauce.hzrd149.com/examples#comment-feed)

## Mutes

Cast for a mute list (kind 10000). Provides public and hidden mutes for hashtags, words, users, and threads.

[**Mutes** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Mutes.html)

```typescript
const mutes = use$(user.mutes$);

if (mutes) {
  // Access public mutes
  const hashtags = mutes.hashtags; // Set<string>
  const words = mutes.words; // Set<string>
  const pubkeys = mutes.pubkeys; // Set<string>
  const threads = mutes.threads; // Set<string> (event IDs)

  // Check for hidden mutes
  const hasHidden = mutes.hasHidden;
  const unlocked = mutes.unlocked;

  // Unlock hidden mutes
  if (hasHidden && !unlocked) {
    await mutes.unlock(signer);
  }

  // Access hidden mutes (after unlocking)
  const hidden = use$(mutes.hidden$);
  if (hidden) {
    const hiddenHashtags = hidden.hashtags;
    const hiddenWords = hidden.words;
    const hiddenPubkeys = hidden.pubkeys;
    const hiddenThreads = hidden.threads;
  }
}
```

**Example:** [Mutes Manager](https://applesauce.hzrd149.com/examples#mutes)

## BookmarksList

Cast for a bookmarks list (kind 10003). Provides public and hidden bookmarks for notes and articles.

[**BookmarksList** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.BookmarksList.html)

```typescript
const bookmarks = use$(user.bookmarks$);

if (bookmarks) {
  // Get pointers
  const bookmarkPointers = bookmarks.bookmarks; // Array of EventPointer | AddressPointer
  const articlePointers = bookmarks.articles; // AddressPointer[]
  const notePointers = bookmarks.notes; // EventPointer[]

  // Get resolved events
  const notes = use$(bookmarks.notes$);
  const articles = use$(bookmarks.articles$);

  // Check for hidden bookmarks
  const hasHidden = bookmarks.hasHidden;

  // Unlock hidden bookmarks
  if (hasHidden && !bookmarks.unlocked) {
    await bookmarks.unlock(signer);
  }

  // Access hidden bookmarks
  const hiddenNotes = use$(bookmarks.hiddenNotes$);
  const hiddenArticles = use$(bookmarks.hiddenArticles$);
}
```

**Example:** [Bookmarks Manager](https://applesauce.hzrd149.com/examples#bookmarks)

## BookmarksSet

Cast for a bookmarks set (kind 30003). Same API as BookmarksList but for categorized bookmarks.

[**BookmarksSet** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.BookmarksSet.html)

```typescript
// Get a specific bookmark set by identifier
const bookmarkSet = use$(
  () =>
    eventStore.replaceable({ kind: 30003, pubkey, identifier: "tech" }).pipe(castEventStream(BookmarksSet, eventStore)),
  [pubkey, identifier],
);

// Same API as BookmarksList
const notes = use$(bookmarkSet?.notes$);
const articles = use$(bookmarkSet?.articles$);
```

## Relay Lists

Casts for favorite relays (kind 10012), search relays (kind 10007), and blocked relays (kind 10006).

[**FavoriteRelays** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.FavoriteRelays.html) | [**SearchRelays** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.SearchRelays.html) | [**BlockedRelays** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.BlockedRelays.html)

```typescript
const favoriteRelays = use$(user.favoriteRelays$);
const searchRelays = use$(user.searchRelays$);
const blockedRelays = use$(user.blockedRelays$);

if (favoriteRelays) {
  // Access public relays
  const relays = favoriteRelays.relays; // string[]

  // Check for hidden relays
  const hasHidden = favoriteRelays.hasHidden;

  // Unlock hidden relays
  if (hasHidden && !favoriteRelays.unlocked) {
    await favoriteRelays.unlock(signer);
  }

  // Access hidden relays
  const hiddenRelays = use$(favoriteRelays.hidden$);
}
```

## Stream

Cast for a live stream (kind 30311, NIP-53). Provides stream metadata, status, participants, and chat.

[**Stream** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Stream.html)

```typescript
const stream = use$(user.live$);

if (stream) {
  // Stream metadata
  const title = stream.title;
  const summary = stream.summary;
  const image = stream.image;
  const status = stream.status; // "live" | "ended" | "planned"

  // Participants
  const host = stream.host; // User
  const participants = stream.participants; // User[]

  // Stream URLs
  const streamingURLs = stream.streamingURLs;
  const streamingVideos = stream.streamingVideos;
  const streamingAudio = stream.streamingAudio;
  const recording = stream.recording;

  // Timing
  const startTime = stream.startTime;
  const endTime = stream.endTime;
  const viewers = stream.viewers;
  const maxViewers = stream.maxViewers;

  // Other
  const relays = stream.relays;
  const hashtags = stream.hashtags;
  const goalPointer = stream.goalPointer;

  // Get engagement
  const chatMessages = use$(stream.chat$);
  const zaps = use$(stream.zaps$);
  const shares = use$(stream.shares$);
  const goal = use$(stream.goal$);
}
```

**Example:** [Stream Viewer](https://applesauce.hzrd149.com/examples#stream-viewer)

## StreamChatMessage

Cast for a stream chat message (kind 1311). Links back to the stream.

[**StreamChatMessage** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.StreamChatMessage.html)

```typescript
const chatMessages = use$(stream.chat$);

chatMessages.forEach((message) => {
  const streamPointer = message.stream; // AddressPointer
  const stream = use$(message.stream$); // Observable<Stream>
  const zaps = use$(message.zaps$);
  const reactions = use$(message.reactions$);
});
```

## Torrent

Cast for a torrent event (kind 2003). Provides BitTorrent metadata, files, trackers, and magnet link.

[**Torrent** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Torrent.html)

```typescript
const torrents = use$(() => eventStore.timeline({ kinds: [2003] }).pipe(castTimelineStream(Torrent, eventStore)), []);

torrents.forEach((torrent) => {
  // Torrent metadata
  const infoHash = torrent.infoHash; // BitTorrent info hash
  const title = torrent.title;
  const files = torrent.files; // File entries
  const trackers = torrent.trackers; // Tracker URLs
  const magnetLink = torrent.magnetLink; // magnet: URI

  // Categories and tags
  const category = torrent.category; // Newznab category ID
  const categoryPath = torrent.categoryPath; // Category path array
  const searchTags = torrent.searchTags; // Search tags
  const externalIds = torrent.externalIdentifiers; // IMDB, TMDB, etc.
});

// Get engagement
const comments = use$(torrent.comments$);
const zaps = use$(torrent.zaps$);
const reactions = use$(torrent.reactions$);
```

**Example:** [Torrent Feed](https://applesauce.hzrd149.com/examples#torrent-feed)

## RelayMonitor

Cast for a relay monitor announcement (kind 10166). Provides monitor metadata and relay status lookups.

[**RelayMonitor** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.RelayMonitor.html)

```typescript
const monitors = use$(
  () => eventStore.timeline({ kinds: [10166] }).pipe(castTimelineStream(RelayMonitor, eventStore)),
  [],
);

monitors.forEach((monitor) => {
  // Monitor metadata
  const frequency = monitor.frequency; // Publishing frequency in seconds
  const timeouts = monitor.timeouts; // Timeout values
  const checks = monitor.checks; // Types of checks conducted
  const geohash = monitor.geohash; // Geographic location

  // Get status for a specific relay
  const relayStatus = use$(monitor.relayStatus("wss://relay.damus.io"));
});
```

**Example:** [Monitor Feed](https://applesauce.hzrd149.com/examples#monitor-feed)

## RelayDiscovery

Cast for relay discovery events (kind 30166). Provides relay status information from monitors.

[**RelayDiscovery** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.RelayDiscovery.html)

```typescript
const relayStatus = use$(
  () =>
    eventStore
      .replaceable({ kind: 30166, pubkey: monitorPubkey, identifier: relayUrl })
      .pipe(castEventStream(RelayDiscovery, eventStore)),
  [monitorPubkey, relayUrl],
);

if (relayStatus) {
  const url = relayStatus.url; // Relay URL
  const networkType = relayStatus.networkType; // "clearnet" | "tor" | "i2p" | "loki"
  const geohash = relayStatus.geohash; // Geographic location

  // Round-trip times
  const rttOpen = relayStatus.rttOpen; // Open connection RTT (ms)
  const rttRead = relayStatus.rttRead; // Read RTT (ms)
  const rttWrite = relayStatus.rttWrite; // Write RTT (ms)

  // Relay capabilities
  const attributes = relayStatus.attributes; // Relay attributes
  const supportedNIPs = relayStatus.supportedNIPs; // Supported NIPs
  const requirements = relayStatus.requirements; // Requirements
  const topics = relayStatus.topics; // Topics
  const acceptedKinds = relayStatus.acceptedKinds; // Accepted/unaccepted kinds
}
```

**Example:** [Relay Discovery](https://applesauce.hzrd149.com/examples#relay-discovery)

## Share

Cast for a share event (kind 6 or kind 16). References the shared event and may embed it.

[**Share** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Share.html)

```typescript
const shares = use$(note.shares$);

shares.forEach((share) => {
  // Get shared event references
  const sharedKind = share.sharedKind; // Kind of shared event
  const sharedEventPointer = share.sharedEventPointer; // EventPointer
  const sharedAddressPointer = share.sharedAddressPointer; // AddressPointer
  const sharedPointer = share.sharedPointer; // Either event or address pointer

  // Check for embedded event (kind 6)
  const embedded = share.embedded; // Embedded NostrEvent if present
});

// Get the shared event
const sharedEvent = use$(share.shared$);

// Get reactions to the share
const reactions = use$(share.reactions$);
```

## Report

Cast for a report event (kind 1984). Provides report type and reported content.

[**Report** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.Report.html)

```typescript
const reports = use$(
  () => eventStore.timeline({ kinds: [1984], "#p": [pubkey] }).pipe(castTimelineStream(Report, eventStore)),
  [pubkey],
);

reports.forEach((report) => {
  // Check report type
  const isUserReport = report.isUserReport; // Boolean
  const isEventReport = report.isEventReport; // Boolean

  // Get report details
  const reason = report.reason; // ReportReason
  const comment = report.comment; // Report comment/content

  // For user reports
  const reportedPubkey = report.reportedPubkey;
  const reportedUser = report.reportedUser; // User cast

  // For event reports
  const reportedEventId = report.reportedEventId;
  const blobs = report.blobs; // Blob hashes being reported
  const servers = report.servers; // Server URLs for blob reports
});

// Get the reported event
const reportedEvent = use$(report.reportedEvent$);
```

## ZapGoal

Cast for a zap goal event (kind 9041). Tracks fundraising goals with progress.

[**ZapGoal** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.ZapGoal.html)

```typescript
const goal = use$(() => eventStore.event(goalPointer).pipe(castEventStream(ZapGoal, eventStore)), [goalPointer.id]);

if (goal) {
  const amount = goal.amount; // Goal amount in millisatoshis
  const relays = goal.relays; // Relays to find zaps
  const closedAt = goal.closedAt; // Timestamp when goal was closed
  const image = goal.image; // Goal image URL
  const summary = goal.summary; // Goal summary
  const description = goal.description; // Goal description (event content)
  const beneficiaries = goal.beneficiaries; // Beneficiary splits

  // Get zaps toward this goal
  const zaps = use$(goal.zaps$);

  // Get goal progress (amount raised, percentage, etc.)
  const progress = use$(goal.progress$);
  if (progress) {
    const raised = progress.raised; // Amount raised so far
    const percentage = progress.percentage; // Percentage of goal reached
  }
}
```

## GroupsList

Cast for a user's NIP-29 group list (kind 10009). Provides public and hidden groups.

[**GroupsList** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.GroupsList.html)

```typescript
// Get user's group list
const groupsList = use$(user.groups$);

if (groupsList) {
  // Get public groups
  const groups = groupsList.groups; // GroupPointer[]

  // Check for hidden groups
  const hasHidden = groupsList.hasHidden;

  // Unlock hidden groups
  if (hasHidden && !groupsList.unlocked) {
    await groupsList.unlock(signer);
  }

  // Access hidden groups
  const hiddenGroups = use$(groupsList.hidden$);
}
```

**Example:** [Groups](https://applesauce.hzrd149.com/examples#groups)

## CodeSnippet

Cast for code snippet events (kind 30818 or kind 1). Provides language and snippet metadata.

[**CodeSnippet** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.CodeSnippet.html)

```typescript
const snippet = use$(
  () => eventStore.replaceable(addressPointer).pipe(castEventStream(CodeSnippet, eventStore)),
  [addressPointer],
);

if (snippet) {
  const language = snippet.language; // Programming language
  const name = snippet.name; // Snippet name
  const description = snippet.description; // Description
  const extension = snippet.extension; // File extension (defaults to "ts")
  const runtime = snippet.runtime; // Runtime environment
  const license = snippet.license; // License
  const repo = snippet.repo; // Repository URL
  const dependencies = snippet.dependencies; // Dependencies
}
```

:::tip
All `$` suffixed properties return reactive observables that update when the underlying data changes. Use `use$` from `applesauce-react/hooks` to consume them in React components.
:::
