---
"applesauce-relay": minor
---

The auth-required handler context now carries the exact NIP-01/NIP-77 request that triggered it, discriminated by wire verb (`REQ`/`COUNT`/`EVENT`/`NEG-OPEN`), replacing the previous read/publish/sync category.
