---
"applesauce-relay": patch
---

Re-request missing event ids in `Relay.sync()` until a round makes no progress so relays that cap REQ results no longer drop events.
