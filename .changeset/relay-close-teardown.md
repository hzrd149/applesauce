---
"applesauce-relay": patch
---

Fix `Relay.close()` to cancel the pending reconnect timer and tear down internal state subscriptions so it no longer leaves timers running that keep the process alive
