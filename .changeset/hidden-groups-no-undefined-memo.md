---
"applesauce-common": patch
---

`getHiddenGroups` no longer permanently memoizes `undefined` when the hidden tags are locked, so `unlockHiddenGroups` returns real groups or throws instead of silently resolving `undefined`.
