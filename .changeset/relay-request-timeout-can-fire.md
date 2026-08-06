---
"applesauce-relay": patch
---

`request()`'s own operation timeout can now actually fire against an unresponsive relay, instead of being permanently cancelled by the synthetic `OPEN` message it previously treated as first progress.
