---
"applesauce-core": patch
---

`copySymbolsToDuplicateEvent`'s replaceable guard now throws when either the pubkey or the replaceable identifier differs, instead of only when both differ, so verified/decrypted symbols can no longer merge onto a structurally unrelated event.
