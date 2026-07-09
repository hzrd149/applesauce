---
"applesauce-core": minor
---

`EventModels`'s subscription methods (`event`, `replaceable`, `addressable`, `filters`, `timeline`) now return `E`-typed observables, so `EventStore<E>`/`AsyncEventStore<E>` expose their configured event type through those subscriptions instead of always resolving to `NostrEvent`.
