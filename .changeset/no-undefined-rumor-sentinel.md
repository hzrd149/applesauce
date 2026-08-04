---
"applesauce-common": patch
---

Stop caching an `undefined` rumor sentinel on a seal whose content fails to parse, so the seal is no longer permanently reported as unlocked and `unlockSeal` no longer returns `undefined` typed as a `Rumor`.
