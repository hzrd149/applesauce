---
"applesauce-signers": patch
---

Redact sensitive NIP-46 traffic from `NostrConnectSigner` debug logs. Only non-sensitive lifecycle methods (`get_public_key`, `ping`, `switch_relays`, `logout`) log params and results verbatim; `connect`, `create_account`, `sign_event`, `nip04_*`, `nip44_*`, and any future method log as `[redacted]`, and `auth_url` challenges are logged with the query and fragment (bearer capabilities) stripped.
