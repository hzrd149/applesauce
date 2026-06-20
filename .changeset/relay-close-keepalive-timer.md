---
"applesauce-relay": patch
---

Cancel the watchTower's `keepAlive` reset timer in `Relay.close()` so closing a relay no longer leaves a pending timer holding the event loop open for `keepAlive` milliseconds
