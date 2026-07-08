---
"applesauce-extra": minor
---

Stop redeclaring standard Nostr kinds in Concord's `KIND` table (removed `MESSAGE`, `REACTION`, `DELETE`, `THREAD`, `COMMENT`) and reference the canonical `kinds`/`COMMENT_KIND` constants instead, so any common event kind can ride a Concord channel without Concord owning its number.
