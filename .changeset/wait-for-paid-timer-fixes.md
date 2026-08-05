---
"applesauce-wallet-connect": patch
---

Fix `waitForPaid()` no longer rejecting almost immediately for invoices with no expiry and clamp its expiry timer to Node's 32-bit `setTimeout` limit
