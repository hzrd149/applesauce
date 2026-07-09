---
"applesauce-concord": minor
---

Add independent private-channel key rotation (CORD-06 channel-scoped rekey) with a per-channel `ConcordPrivateChannel` sub-engine that syncs and rotates each private channel on its own epoch lifecycle, lifted out of the community epoch walk.
