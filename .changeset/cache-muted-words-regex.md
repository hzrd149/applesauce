---
"applesauce-common": patch
---

Cache the compiled muted-words regex for the last word list instead of recompiling it for every tested event. Mute lists change rarely but `matchMutes` runs against every timeline event, so a large mute list previously paid the full regex-compile cost per event. `lastIndex` is reset on each re-acquisition so the shared `g`-flagged instance never skips matches.
