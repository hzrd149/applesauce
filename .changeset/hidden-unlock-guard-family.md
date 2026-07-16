---
"applesauce-common": patch
---

Fix `isHiddenFavoriteEmojiPacksUnlocked`, `isHiddenMutesUnlocked`, and `isHiddenProvidersUnlocked` so they only report unlocked once every hidden value their type asserts has actually been derived, instead of trusting the presence of a single symbol from an earlier partial read.
