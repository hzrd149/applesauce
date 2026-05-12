---
"applesauce-relay": patch
---

Default `RelayPool.ignoreOffline` to `false` and deprecate the property. When the opt-in `ignoreOffline=true` path is used, `RelayPool.group` now waits for non-ready relays to become ready instead of dropping them.
