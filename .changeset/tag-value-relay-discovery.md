---
"applesauce-loaders": patch
---

Start explicit relay hints immediately in `relaysTagValueLoader` and `createTagValueLoader` while resolving observable `extraRelays` independently within `requestTimeout` and the shared relay concurrency limit.
