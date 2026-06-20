---
"applesauce-core": patch
---

Drop empty index entries from `EventMemory` when the last event for an author, kind, kind+author, tag, or replaceable address is removed so the indexes no longer accumulate empty containers forever
