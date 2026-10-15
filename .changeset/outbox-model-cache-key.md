---
"applesauce-core": patch
---

Fix `OutboxModel` sharing one cached selection between subscriptions that use different `blacklist` or `score` options.
