---
"applesauce-core": minor
---

Genericize the event-store managers (`DeleteManager`, `AsyncDeleteManager`, `ExpirationManager`, `EventMemory`) over `StoreEvent` while keeping the `NostrEvent` default.
