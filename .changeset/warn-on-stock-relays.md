---
"applesauce-concord": patch
---

Warn when `ConcordClient` or the community engine falls back to the built-in stock relays. Constructing either without `relays` silently routed all community traffic — including NIP-42 auth events carrying the user's pubkey — to hardcoded third-party relays; the fallback now prints a console warning pointing at the `relays` option.
