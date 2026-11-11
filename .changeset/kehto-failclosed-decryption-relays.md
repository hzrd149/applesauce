---
"applesauce-extra": minor
---

Make Kehto napplet reads fail closed: encrypted content is only decrypted when the host sets `decrypt: true` (the DM service requires it, since its handlers expose message content), and napplets can no longer direct reads or publishes to relays of their choice unless the host sets `allowRelayHints: true`.
