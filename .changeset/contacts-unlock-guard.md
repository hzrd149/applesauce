---
"applesauce-core": patch
---

`isHiddenContactsUnlocked` now confirms hidden contacts were actually parsed before asserting them present, so `unlockHiddenContacts` can no longer resolve `undefined` typed as `ProfilePointer[]`.
