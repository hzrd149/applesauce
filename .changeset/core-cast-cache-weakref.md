---
"applesauce-core": patch
---

Hold pubkey/user cast instances weakly so unused casts can be garbage collected instead of accumulating one instance per pubkey for the lifetime of the process
