---
"applesauce-concord": patch
---

Recover control-plane plaintext seals from the wrap store during a Refounding so state compaction still works after the RumorStore fold strips seal metadata from folded heads.
