---
"applesauce-core": patch
---

Writing a cached value onto a frozen or otherwise non-extensible event now throws where it previously failed silently.
