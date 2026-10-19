---
"applesauce-core": patch
---

Speed up `TimelineModel` and `FiltersModel` updates by compiling their filters once instead of re-reading them for every new event
