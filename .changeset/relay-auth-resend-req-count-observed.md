---
"applesauce-relay": patch
---

A synchronous `onAuthRequired` handler resolving `req()` or `count()`'s auth phase now sends a real resend frame and observes its reply, instead of silently rejoining an already-terminated listen chain and completing with no results.
