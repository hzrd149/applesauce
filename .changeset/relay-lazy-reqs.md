---
"applesauce-relay": patch
---

Make opening and closing relay subscriptions constant time by only rebuilding the `reqs$` record when it is observed or read
