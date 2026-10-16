---
"applesauce-loaders": minor
---

Limit cache and relay source lifetimes in `cacheTagValueLoader`, `relaysTagValueLoader`, and `createTagValueLoader` to a configurable `requestTimeout` of ten seconds by default, reporting timeouts through `onError` while preserving partial results.
