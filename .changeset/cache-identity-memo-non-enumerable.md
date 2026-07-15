---
"applesauce-core": patch
---

Cached values written by `setCachedValue`/`getOrComputeCachedValue` are now non-enumerable so an object spread no longer carries a stale memo forward.
