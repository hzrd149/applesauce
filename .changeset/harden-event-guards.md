---
"applesauce-core": patch
---

Harden the `isEvent` and `isRumor` type guards: `id` and `pubkey` must be 64-char lowercase hex and `sig` must be 128-char lowercase hex, instead of accepting any 64-char string. An event that could never hash or verify correctly is now rejected at the guard instead of by every consumer downstream.
