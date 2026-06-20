---
"applesauce-core": patch
---

Cancel the pending `ExpirationManager` timer when an event store is disposed so a far-future expiration no longer keeps the process alive
