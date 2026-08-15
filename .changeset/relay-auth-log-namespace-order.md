---
"applesauce-relay": patch
---

Move the relay auth debug namespace from `applesauce:Relay:<url>:auth` to `applesauce:Relay:auth:<url>` so `applesauce:Relay:auth:*` filters every relay's auth trace at once.
