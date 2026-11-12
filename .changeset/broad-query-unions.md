---
"applesauce-core": patch
---

Speed up broad unbounded event queries by combining OR indexes when repeated membership checks cost more than constructing a temporary union.
