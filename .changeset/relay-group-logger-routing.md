---
"applesauce-relay": patch
---

`RelayGroup` now routes its debug diagnostics through the package's shared debug logger instead of writing directly to the console, so a consumer can silence them like every other class in the package.
