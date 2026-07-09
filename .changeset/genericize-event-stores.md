---
"applesauce-core": minor
---

`EventStore` and `AsyncEventStore` are now generic over `StoreEvent` while defaulting to a signed `NostrEvent` store.
