---
"applesauce-core": patch
"applesauce-wallet-connect": patch
---

Clamp `setTimeout` delays to Node's 32-bit limit so far-future NIP-40 expirations no longer trigger a `TimeoutOverflowWarning` hot loop, and fix `waitForPaid()` rejecting immediately on invoices with no expiry
