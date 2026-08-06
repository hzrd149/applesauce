---
"applesauce-relay": minor
---

`req`, `request`, `subscription`, `count`, `publish`, `event`, `sync`, and negentropy sync now accept `onAuthRequired`, `authTimeout`, and `authRetries` and invoke the handler with operation-local context (relay, challenge, operation, requirement, `missingPubkeys`, reason) when that specific operation receives `auth-required:`.
