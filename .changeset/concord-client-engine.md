---
"applesauce-concord": minor
---

Rewrite the Concord client into a `client/` engine — a single-community `ConcordCommunity` that exposes per-plane RumorStores (consumers fold with the standard timeline/models), folds state via models, and syncs epoch-atomically (fully decrypting each epoch before advancing) — plus a thin multi-community `ConcordClient` manager.
