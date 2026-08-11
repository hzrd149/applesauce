---
"applesauce-relay": minor
---

`req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, and negentropy sync now accept `onAuthRequired`, `authTimeout`, and `authRetries` and invoke the handler with operation-local context (relay, challenge, the exact NIP-01/NIP-77 request that was refused, requirement, `missingPubkeys`, reason) when that specific operation receives `auth-required:`.
