---
"applesauce-wallet": minor
---

Add a `useDeleteEvents` option to `NutWallet` (with `setUseDeleteEvents`) and a `createDeleteEvents` option to the token actions to control whether the wallet loads, subscribes to and publishes NIP-09 delete events, letting a wallet completely ignore all kind 5 delete events with a single flag
