---
"applesauce-relay": patch
---

`req()`, `request()`, and `subscription()` auth-required retries are now correctly bounded by `authRetries` instead of being silently reset by the synthetic `OPEN` message emitted on every resubscribe.
