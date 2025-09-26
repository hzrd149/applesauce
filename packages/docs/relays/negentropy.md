# Negentropy Sync

Negentropy sync is an efficient way to synchronize events between your local event store and Nostr relays using [NIP-77](https://github.com/nostr-protocol/nips/blob/master/77.md). Instead of downloading all events and checking for duplicates, negentropy compares event IDs and timestamps to identify which events need to be transferred, dramatically reducing bandwidth usage.

## Overview

The negentropy protocol works by:

1. **Comparing inventories**: Both client and relay share summaries of what events they have
2. **Identifying differences**: The protocol determines which events each side is missing
3. **Reconciling efficiently**: Only the missing events are transferred

This is particularly useful for:

- **Initial sync**: Getting up to date with a relay without downloading everything
- **Periodic updates**: Staying synchronized with minimal data transfer
- **Relay comparison**: Finding differences between relays without transferring events

## Requirements

- Relay must support **NIP-77** (Negentropy)
- Use `relay.getSupported()` to check if a relay supports NIP-77 before syncing

## Basic Usage

### Single Relay Sync

The `negentropy()` method provides low-level control over the sync process:

```typescript
// Define what to do with the sync results
const reconcile = async (have: string[], need: string[]) => {
  // 'have' = event IDs we have but relay doesn't
  // 'need' = event IDs relay has but we don't

  // Send our events to the relay
  for (const id of have) {
    const event = await eventStore.getEvent(id);
    if (event) await relay.publish(event);
  }

  // Fetch missing events from relay
  if (need.length > 0) {
    const events = await relay.request({ ids: need });
    // Process received events...
  }
};

// Sync reactions for a specific note
await relay.negentropy(eventStore, { kinds: [7], "#e": ["note_id_here"] }, reconcile);
```

### High-Level Sync with Observable

The `sync()` method provides a simpler interface that returns events as they're received:

```typescript
// Sync and receive events as an observable
relay
  .sync(eventStore, {
    kinds: [1], // Text notes
    authors: ["pubkey_here"],
    since: unixNow() - 60 * 60 * 24, // Last 24 hours
  })
  .subscribe((event) => {
    console.log("Received event:", event);
  });
```

## Pool and Multi-Relay Sync

### RelayPool Usage

Use `RelayPool` to sync with multiple relays simultaneously:

```typescript
const pool = new RelayPool();

// Sync mentions across multiple relays
const relays = ["wss://relay.damus.io", "wss://nos.lol"];
pool
  .sync(relays, eventStore, {
    kinds: [1],
    "#p": ["user_pubkey"],
    since: unixNow() - 60 * 60 * 24,
  })
  .subscribe((event) => {
    // Events from any of the relays
    eventStore.addEvent(event);
  });
```

### Parallel Sync

For maximum efficiency, sync multiple relays in parallel:

```typescript
// Sync reactions from user's outbox relays
const filter = { kinds: [7], "#e": ["note_id"] };

const syncPromises = outboxRelays.map((relay) => pool.relay(relay).sync(eventStore, filter));

// Wait for all syncs to complete
await Promise.allSettled(syncPromises);
```

## Real-World Examples

### 1. Sync User Mentions

Load mentions for a user from their inbox relays:

```typescript
// Get user's NIP-65 relay list
const mailboxes = await eventStore.mailboxes(pubkey);

if (mailboxes.inboxes.length > 0) {
  // Sync mentions from last 24 hours
  pool
    .sync(mailboxes.inboxes, eventStore, {
      kinds: [1],
      "#p": [pubkey],
      since: unixNow() - 86400,
    })
    .subscribe((mention) => {
      console.log("New mention:", mention.content);
    });
}
```

### 2. Compare Relay Differences

Find which events are missing from different relays:

```typescript
const syncResults = new Map();

// Sync each relay individually to compare
for (const relay of outboxRelays) {
  const eventIds: string[] = [];

  await pool.relay(relay).negentropy(
    [], // Empty store - just collect IDs
    { kinds: [1], authors: [pubkey], since: unixNow() - 86400 },
    async (_have, need) => {
      eventIds.push(...need); // Collect event IDs
    },
  );

  syncResults.set(relay, eventIds);
}

// Now compare which events are missing from each relay
```

### 3. Sync Note Reactions

Load all reactions for a specific note:

```typescript
const noteId = "event_id_here";

// Sync from multiple relays to get complete reaction set
pool
  .sync(relays, eventStore, {
    kinds: [7], // Reactions
    "#e": [noteId],
  })
  .subscribe((reaction) => {
    console.log(`${reaction.content} from ${reaction.pubkey}`);
  });
```

## API Reference

### Relay Methods

#### `negentropy(store, filter, reconcile, options?)`

Low-level negentropy sync with custom reconciliation logic.

**Parameters:**

- `store`: Event store, async event store, or array of events
- `filter`: Nostr filter to sync
- `reconcile`: Function called with (have, need) event ID arrays
- `options`: Optional sync options

**Returns:** `Promise<boolean>` - true if successful

#### `sync(store, filter, direction?)`

High-level sync that returns events as an observable.

**Parameters:**

- `store`: Event store or array of events
- `filter`: Nostr filter to sync
- `direction`: `SyncDirection.RECEIVE` (default), `SEND`, or `BOTH`

**Returns:** `Observable<NostrEvent>` - stream of synced events

### Pool Methods

#### `sync(relays, store, filter, direction?)`

Sync with multiple relays using the high-level interface.

#### `negentropy(relays, store, filter, reconcile, options?)`

Sync with multiple relays using custom reconciliation logic.

## Sync Directions

Control what happens during sync:

- **`SyncDirection.RECEIVE`** (default): Only fetch missing events from relay
- **`SyncDirection.SEND`**: Only send your events to relay
- **`SyncDirection.BOTH`**: Two-way sync - send and receive

```typescript
// Only send your events to relay
relay.sync(eventStore, filter, SyncDirection.SEND);

// Two-way sync
relay.sync(eventStore, filter, SyncDirection.BOTH);
```

## Error Handling

Always handle potential errors:

```typescript
try {
  await relay.negentropy(eventStore, filter, reconcile);
} catch (error) {
  if (error.message.includes("does not support NIP-77")) {
    console.log("Relay doesn't support negentropy");
    // Fall back to regular REQ/subscription
  } else {
    console.error("Sync failed:", error);
  }
}
```

## Performance Tips

1. **Check NIP-77 support** before attempting sync
2. **Use time filters** (`since`, `until`) to limit sync scope
3. **Sync in parallel** when working with multiple relays
4. **Use appropriate sync direction** to avoid unnecessary transfers
5. **Handle abort signals** for long-running syncs

```typescript
// Efficient multi-relay sync with timeout
const controller = new AbortController();
setTimeout(() => controller.abort(), 30000); // 30s timeout

const syncPromises = relays.map((relay) =>
  pool.relay(relay).negentropy(eventStore, filter, reconcile, { signal: controller.signal }),
);

await Promise.allSettled(syncPromises);
```

The negentropy sync feature makes it practical to keep your local event store synchronized with multiple relays efficiently, enabling rich offline-first Nostr applications.
