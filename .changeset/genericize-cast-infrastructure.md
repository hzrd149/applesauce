---
"applesauce-core": minor
---

The cast infrastructure (`CastRefEventStore`, `castEvent`, `castEventStream`, `castTimelineStream`) is now generic over `StoreEvent` while defaulting to `NostrEvent`.
