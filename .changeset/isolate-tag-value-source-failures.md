---
"applesauce-loaders": minor
---

Isolate cache and individual relay failures in `cacheTagValueLoader`, `relaysTagValueLoader`, and `createTagValueLoader`, reporting skipped failures through the optional `onError` callback.
