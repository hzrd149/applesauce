---
"applesauce-core": patch
---

Remove the unused `EventFactory.kind()` method, whose returned promise never resolved and whose mid-chain kind change would have silently dropped preserved event symbols.
