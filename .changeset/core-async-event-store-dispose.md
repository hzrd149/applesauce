---
"applesauce-core": minor
---

Add `AsyncEventStore.dispose()` (with `Symbol.dispose` support) that completes the event streams, releases model keep-warm timers, unsubscribes internal manager listeners, and disposes the attached event loader for a clean shutdown
