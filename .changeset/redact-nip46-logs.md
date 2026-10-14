---
"applesauce-signers": patch
---

Redact secret-bearing NIP-46 traffic from debug logs. The `connect` params (bunker pairing secret), `sign_event` drafts, and `nip04_encrypt`/`nip44_encrypt`/`nip04_decrypt`/`nip44_decrypt` params and results are logged as `[redacted]`, and the pairing ack no longer echoes the secret. Debug logging remains fully useful for the non-sensitive methods.
