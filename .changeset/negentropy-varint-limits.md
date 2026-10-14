---
"applesauce-relay": patch
---

Harden the negentropy varint codec against malformed relay responses. `decodeVarInt` accumulated with a 32-bit shift, so a varint longer than four bytes silently wrapped into a small or negative value; it now accumulates exactly, rejects values above `Number.MAX_SAFE_INTEGER`, and rejects varints longer than eight bytes. `encodeVarInt` likewise switched from 32-bit ops to exact arithmetic and rejects non-safe-integer inputs.
