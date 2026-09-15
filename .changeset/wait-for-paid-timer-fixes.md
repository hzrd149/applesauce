---
"applesauce-wallet-connect": patch
---

Fix `waitForPaid()` timer handling so invoices without an expiry do not reject immediately and far-future expiry delays stay within Node's 32-bit limit.
