---
"applesauce-relay": patch
---

Advance reconnect backoff for WebSocket errors and constructor failures that do not emit a close event. Count each pending recovery once, avoid counting clean closes as failed attempts, and mark the relay not ready before notifying error observers.
