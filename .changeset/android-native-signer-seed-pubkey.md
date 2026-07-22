---
"applesauce-signers": patch
"applesauce-accounts": patch
---

Seed `AndroidNativeSigner` with the persisted pubkey so relaunching an app does not re-prompt the signer app for `getPublicKey`.
