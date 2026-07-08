---
"applesauce-core": minor
---

Genericize the cast subsystem (`EventCast`, `castEvent`, `CastConstructor`, and the cast stream operators) over a new structural `StoreEvent` type so a cast can wrap an unsigned `Rumor` as well as a signed event.
