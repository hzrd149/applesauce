---
"applesauce-wallet": minor
---

Return undefined from `getNutzapP2PKPubkey` when a proof is not P2PK locked or proofs are locked to different pubkeys, instead of throwing on a nutzap that arrived from a stranger.
