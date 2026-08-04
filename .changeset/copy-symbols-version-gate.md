---
"applesauce-core": patch
---

`copySymbolsToDuplicateEvent` now copies `verifiedSymbol` and `EncryptedContentSymbol` only when source and destination share an id, so a losing version of a replaceable event can no longer leak its plaintext or its signature verdict onto a different version.
