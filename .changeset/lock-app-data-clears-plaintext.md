---
"applesauce-common": patch
---

`lockAppData` now clears the decrypted content so `getAppDataContent` returns undefined after locking.
