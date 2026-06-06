---
"applesauce-wallet": patch
---

Fix `WalletTokensModel` and `WalletBalanceModel` double counting and showing replaced token events by reconciling each token's `del` field independently of timeline order and across delete chains
