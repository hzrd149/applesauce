---
"applesauce-core": minor
"applesauce-common": patch
---

Move `castEvent`, `castPubkey`, `EventCast`, `PubkeyCast`, `User`, `castUser`, and `ChainableObservable` to `applesauce-core/casts`; `applesauce-common` re-exports all of them and augments `User` with Nostr-specific observable getters via prototype
