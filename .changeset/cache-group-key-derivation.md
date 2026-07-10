---
"applesauce-concord": patch
---

Memoize group-key derivation on the community key material so a community's stream keys are derived once instead of on every folded-state change and twice per synced epoch.
