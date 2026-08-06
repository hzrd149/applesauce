---
"applesauce-loaders": patch
---

`SyncLoader`'s stall guard is now suspended for the full duration of a relay's auth phase even when the caller supplies no `onAuthRequired` handler.
