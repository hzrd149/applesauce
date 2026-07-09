---
"applesauce-concord": patch
---

Replace the `RekeyFactory`/`buildRekeyFactories` factory with a `buildRekeyRumors` helper so CORD-06 rekey events are built as plain rumor templates rather than an exposed factory.
