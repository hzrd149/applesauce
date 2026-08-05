---
"applesauce-core": patch
---

Clear `ExpirationManager`'s timer bookkeeping whenever no expirations remain so a newly tracked event is still scheduled after the last one is forgotten and its timer fires
