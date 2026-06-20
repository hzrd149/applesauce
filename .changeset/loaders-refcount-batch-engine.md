---
"applesauce-loaders": patch
---

Fix the event, address, and tag-value loaders keeping a `bufferTime` interval alive forever (hanging the process on exit) by reference counting the batch engine so it only runs while a loader observable is subscribed
