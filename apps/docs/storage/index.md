# Storing Events

AppleSauce provides two distinct approaches for persisting Nostr events: [Event Databases](./databases/index) and [Event Caching](./caching/index). Understanding the differences between these approaches is crucial for choosing the right solution for your application.

## Event Databases

Event databases are persistent storage backends designed for the [`AsyncEventStore`](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-core.AsyncEventStore.html). They implement the [`IAsyncEventDatabase`](https://hzrd149.github.io/applesauce/typedoc/interfaces/applesauce-core.IAsyncEventDatabase.html) interface and serve as the primary persistence layer for applications that need to store large volumes of events.

**Key Characteristics:**

- **Async Interface**: All operations are asynchronous, requiring `await` for database interactions
- **Complete Persistence**: Automatically persists **all events** added to the store, not just selected ones
- **Designed for Scale**: Optimized for storing and querying large numbers of events with efficient indexing
- **Backend Focus**: Ideal for backend services, relay implementations, and server applications

**When to Use:**

- Building backend services or relays that need to store all events automatically
- Server applications that process and store large volumes of events
- Applications that need async database operations
- Services that require remote database support or distributed storage

## Event Caching

Event caching is designed to work alongside the synchronous [`EventStore`](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-core.EventStore.html). It leverages the in-memory nature of the sync event store while providing persistent storage for frequently accessed events through a non-blocking caching layer.

**Key Characteristics:**

- **In-Memory Event Store**: Works with the synchronous `EventStore` which keeps events in memory for fast, synchronous access
- **Selective Caching**: Allows you to cache only the events you need (profiles, contacts, frequently accessed events)
- **Non-Blocking**: Cache operations happen asynchronously and don't block the fast, synchronous event store
- **Event Loader Integration**: Cache loading happens through event loaders, not directly through the event store
- **Web App Focus**: Designed for web applications that need instant event access without async overhead

**How It Works:**

1. **Cache Loading**: Event loaders check the cache first when loading events, falling back to relays if not found
2. **Non-Blocking Persistence**: New events are saved to the cache **after** they're added to the store, preserving the event store's synchronous performance
3. **Selective Storage**: You control which events are cached, typically focusing on profiles, contacts, and other replaceable events

**When to Use:**

- Building web applications that need fast, synchronous event access
- Want to take advantage of the in-memory nature of the sync `EventStore`
- Need to cache frequently accessed events (profiles, contacts)
- Need non-blocking cache operations that don't slow down the event store
- Don't need to store large volumes of events
- Want selective caching control

## Quick Comparison

| Feature           | Event Databases                        | Event Caching                               |
| ----------------- | -------------------------------------- | ------------------------------------------- |
| **Event Store**   | `AsyncEventStore`                      | `EventStore` (sync)                         |
| **Interface**     | Async (all operations require `await`) | Sync (fast, in-memory access)               |
| **Persistence**   | All events automatically               | All or selected events                      |
| **Use Case**      | Backends, servers, relays              | Web applications                            |
| **Scale**         | Large volumes of events                | Small, frequently accessed events           |
| **Blocking**      | Blocks event store operations          | Cache does not block event store operations |
| **Event Loading** | Through the event store                | Through event loaders                       |
| **Best For**      | Complete event history, server-side    | Fast access, client-side caching            |
