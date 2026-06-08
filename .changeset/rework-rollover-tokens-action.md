---
"applesauce-wallet": major
---

Rework the `RolloverTokens` action to automatically swap every mint's unlocked tokens for fresh proofs and publish a single batched delete event across all mints (used by `NutWallet.rollover`), replacing the previous caller-supplied primitive
