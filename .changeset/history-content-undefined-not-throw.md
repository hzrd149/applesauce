---
"applesauce-wallet": patch
---

Return undefined from `getHistoryContent` when a history event is missing its direction or amount tag, or its amount does not parse, instead of throwing.
