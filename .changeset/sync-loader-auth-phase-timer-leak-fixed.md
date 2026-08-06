---
"applesauce-loaders": patch
---

`SyncLoader` no longer leaves an auth-phase timer pending after a load is torn down or after a handler settles once its auth phase was already force-closed.
