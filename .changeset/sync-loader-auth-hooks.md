---
"applesauce-loaders": minor
---

`SyncLoader` now threads `onAuthRequired`, `authTimeout`, and `authRetries` identically into both its negentropy sync and paginated request paths, with its own stall guard suspended for the full auth phase and its negentropy fallback skipped on an auth-required failure.
