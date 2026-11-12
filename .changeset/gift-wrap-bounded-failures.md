---
"applesauce-extra": patch
---

Bound the `GiftWrapReceiver` failure set to the most recent 1000 envelopes with tracked failures. Any relay can deliver envelopes addressed to the user whose contents fail to process, so the failure state no longer grows with hostile traffic; re-delivery of an evicted envelope re-fails and re-tracks it.
