---
"applesauce-core": patch
"applesauce-common": patch
---

Move the gift-wrap, seal, and rumor symbols into `applesauce-core` and re-export them from `applesauce-common` so `PRESERVE_EVENT_SYMBOLS` can be a static, load-order-independent set.
