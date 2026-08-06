---
"applesauce-relay": minor
---

An operation that previously waited indefinitely against an auth-required relay now fails with a timeout after 30 seconds by default, since `waitForAuth` no longer pre-blocks the operation on the relay-wide auth-required flags and the wait is instead bounded by the new `authTimeout` option — pass `authTimeout: false` to restore the previous indefinite wait for out-of-band authentication.
