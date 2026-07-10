---
"applesauce-concord": patch
---

Stop the Concord community list (kind 13302) from being needlessly re-signed and republished at runtime by dirty-checking content against the relay copy and waiting for the remote list to reconcile before the startup flush.
