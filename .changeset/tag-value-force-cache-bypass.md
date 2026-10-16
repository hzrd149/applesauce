---
"applesauce-loaders": patch
---

Honor `TagValuePointer.force` in `cacheTagValueLoader` and `createTagValueLoader` by excluding forced pointers from cache queries and delivering only relay arrivals to forced callers in mixed batches.
