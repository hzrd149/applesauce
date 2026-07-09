---
"applesauce-core": minor
---

Genericize the core structural event helpers (`getEventUID`, `getReplaceableAddress`, `getReplaceableIdentifier`, `getIndexableTags`, `matchFilter`, `matchFilters`, `getExpirationTimestamp`, `eventMatchesPointer`, `addSeenRelay`, `getSeenRelays`, `isFromRelay`) over `StoreEvent` while keeping the `NostrEvent` default.
