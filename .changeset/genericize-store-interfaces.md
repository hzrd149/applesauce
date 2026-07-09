---
"applesauce-core": minor
---

Genericize the event-store interfaces (`IEventStore`, `IAsyncEventStore`, and their component database/manager/claims/subscription/loader interfaces) over `StoreEvent` with a `NostrEvent` default.
