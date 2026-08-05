---
"applesauce-common": patch
---

The hidden content `is...Unlocked` guards now only report unlocked once the hidden values have actually been decrypted, so the matching `unlock...` helpers no longer resolve undefined.
