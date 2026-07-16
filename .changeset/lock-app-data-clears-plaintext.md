---
"applesauce-common": patch
---

`lockAppData` now also clears the decrypted plaintext cached on `AppDataContentSymbol`, so `getAppDataContent` correctly returns `undefined` after a lock instead of the stale decrypted data.
