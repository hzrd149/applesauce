---
"applesauce-core": patch
---

Clamp `ExpirationManager`'s scheduled timer delay to Node's 32-bit `setTimeout` limit so far-future NIP-40 expirations re-arm in chunks instead of triggering a `TimeoutOverflowWarning` hot loop
