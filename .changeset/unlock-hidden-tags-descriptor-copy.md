---
"applesauce-core": patch
---

Fix `modifyHiddenTags`'s `unlockHiddenTags` temp object silently dropping non-enumerable cached symbols via a plain spread, which would force a redundant signer decrypt.
