---
"applesauce-extra": minor
---

Add Concord channel thread support: `ConcordClient.sendThread`/`replyToThread` and a `getThreads$` observable that folds NIP-7D kind 11 threads and their kind 1111 replies riding a channel.
