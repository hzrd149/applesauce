---
"applesauce-loaders": patch
---

Fix the sync loader stopping early on relays that cap results by clamping pages to NIP-11 `max_limit` and paging until an empty page when the cap is unknown.
