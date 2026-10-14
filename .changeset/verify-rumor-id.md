---
"applesauce-common": patch
"applesauce-concord": patch
---

Verify a rumor's `id` against its contents before returning it from `getSealRumor` / `decodeWrap`. The rumor is unsigned (NIP-59), so recomputing the event hash is the only integrity check on the innermost layer — without it a sealed payload could claim another rumor's `id`, which is used as an identity and dedupe key downstream.
