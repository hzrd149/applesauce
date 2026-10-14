---
"applesauce-core": patch
---

Fix `EventStore.add` emitting `insert$` again when the same event instance is added twice.
