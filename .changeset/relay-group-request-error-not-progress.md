---
"applesauce-relay": patch
---

`RelayGroup.request()`'s operation clock no longer treats a relay's connection error as progress, so a group whose relays all fail or fall silent now errors on its declared timeout instead of hanging forever.
