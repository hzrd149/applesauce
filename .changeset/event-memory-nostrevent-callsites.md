---
"applesauce-loaders": patch
"applesauce-relay": patch
---

Explicitly instantiate `new EventMemory<NostrEvent>()` at the `filterDuplicateEvents` call sites so they compile against the now-generic `EventMemory`.
