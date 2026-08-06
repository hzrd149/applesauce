---
"applesauce-relay": patch
---

A synchronously-throwing `onAuthRequired` handler now maps to `AuthHandlerError` identically to a rejected promise, instead of escaping as a raw, unmapped `Error`.
