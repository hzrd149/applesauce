---
"applesauce-relay": patch
---

A publish that times out locally now sets the response's `error` field, so callers can tell a client-side give-up from a relay rejection without inspecting the message.
