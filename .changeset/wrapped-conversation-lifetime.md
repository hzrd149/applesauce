---
"applesauce-extra": patch
---

Remove the wrapped conversation disposal lifecycle so callers own query subscriptions and cancellation while the client owns draft cleanup.
