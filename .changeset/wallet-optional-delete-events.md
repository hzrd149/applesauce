---
"applesauce-wallet": minor
---

Add a `deleteOldTokens` option to the token actions and `NutWallet` (with `setDeleteOldTokens`) to skip publishing NIP-09 delete events for spent token events and rely on each new token event's `del` field instead
