---
"applesauce-loaders": patch
---

Fix `DnsIdentityLoader` never retrying failed lookups or refreshing expired identities, and add an `errorExpiration` option for how long failures are kept
