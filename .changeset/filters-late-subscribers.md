---
"applesauce-core": patch
---

Fix `eventStore.filters()` only replaying the last matching event to subscribers that join after another subscriber.
