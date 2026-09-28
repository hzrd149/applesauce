---
"applesauce-relay": patch
---

Advance reconnect backoff for WebSocket errors and constructor failures that do not emit a close event by counting each pending recovery once, skipping clean closes, and marking the relay not ready before notifying error observers.
