---
"applesauce-extra": minor
---

Update `nostr-double-ratchet` to 0.0.185. Encrypted message events (kind 1060) no longer name the recipient device in a `p` tag, so relays can no longer link deliveries or group fanout bursts to devices; receivers find messages through the sender ratchet keys they already subscribe to. Those author subscriptions are now split into chunks that fit relay filter limits, and group messages are no longer dropped after roster changes. Envelopes from older clients that still carry the tag are read as before; a tagged kind 1060 left in the persistent outbox by an older version is kept but not republished.
