---
"applesauce-extra": patch
---

Skip and report invalid processing checkpoint rows in `GiftWrapReceiver` instead of failing every restore, so one damaged or newer-schema row no longer stops the inbox.
