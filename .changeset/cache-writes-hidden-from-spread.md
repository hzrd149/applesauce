---
"applesauce-core": patch
---

Cached values are no longer copied by an object spread, so a duplicated event can no longer carry a stale cached value forward.
