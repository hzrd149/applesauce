---
"applesauce-relay": patch
---

Convert WebSocket error events into a `RelayConnectionError` with the relay URL instead of surfacing `[object ErrorEvent]`
