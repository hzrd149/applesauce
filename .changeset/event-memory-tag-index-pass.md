---
"applesauce-core": patch
---

Speed up in-memory tag queries with many values by building missing tag indexes in a single pass, and cap the tag index cache at 10,000 values
