---
"applesauce-relay": patch
---

Complete the internal `_ready$` source when `Relay.close()` is called so the watchTower cannot re-arm the reconnect timer after a terminal close.
