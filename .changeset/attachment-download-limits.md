---
"applesauce-extra": minor
---

Limit `loadAttachment` downloads: read sources as a stream and stop at the declared size (plus the AES-GCM tag for encrypted files) or `maxSize`, which defaults to `DEFAULT_MAX_ATTACHMENT_SIZE` (100 MiB). An oversized source fails over to the next mirror.
