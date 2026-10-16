---
"applesauce-loaders": patch
---

Reject invalid concurrency and timeout options in `cacheTagValueLoader`, `relaysTagValueLoader`, and `createTagValueLoader` to prevent stalled queues and timer overflow.
