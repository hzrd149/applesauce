---
"applesauce-relay": patch
---

`RelayGroup.request()`'s operation timeout is now suspended for the duration of a relay's auth phase instead of racing it.
