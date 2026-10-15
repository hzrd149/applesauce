---
"applesauce-core": patch
---

Fix `selectOptimalRelays` ignoring `maxRelaysPerUser` above 1, which could use up the connection budget and leave some users uncovered.
