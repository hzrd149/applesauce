---
"applesauce-wallet-connect": patch
---

Return undefined from `getWalletNotification` when the notification content is not valid JSON, instead of throwing on malformed input from the remote wallet service.
