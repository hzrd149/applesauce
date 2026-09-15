---
"applesauce-core": patch
---

Clamp NIP-40 expiration timer delays to Node's 32-bit limit so far-future events do not trigger a `TimeoutOverflowWarning` hot loop.
