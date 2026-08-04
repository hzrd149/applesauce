---
"applesauce-core": minor
---

Return undefined from `getHiddenTags` when the hidden content is not valid JSON or not an array of tags, instead of throwing out of a getter that is read across whole timelines.
