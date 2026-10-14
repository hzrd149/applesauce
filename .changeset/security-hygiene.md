---
"applesauce-core": patch
---

Deprecate `fakeVerifyEvent` and `setVerifyWrappedEventMethod`. Swapping the wrapped-event verifier or marking events verified without checks silently defeats signature verification for every seal, gift wrap, and zap in the process. Both now warn at runtime and will be removed in a future major version.
