---
"applesauce-signers": patch
---

Redact key material from `SerialPortSigner` debug logs. `/restore` sends the raw private key in hex and `/shared-secret` returns raw ECDH conversation keys — both were previously logged verbatim along with every other command and response. Only `/ping` and `/public-key` now log their params and data; all other methods log as `[redacted]`.
