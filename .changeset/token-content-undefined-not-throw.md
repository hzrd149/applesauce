---
"applesauce-wallet": minor
---

Return undefined from `getTokenContent` when the token content is unparseable, not an object, or missing `mint`/`proofs`, instead of throwing out of a getter that is read inside RxJS pipes.
