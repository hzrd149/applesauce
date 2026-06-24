---
description: Create and verify Nostr Web Tokens for client and server session authentication
---

# Nostr Web Tokens

Nostr Web Tokens are signed Nostr events used as bearer tokens for web authentication and authorization. See the [Nostr Web Token specification](https://github.com/Open-Ranking/nostr-web-tokens) for claim definitions, validation rules, and transport encoding.

They use event kind `27519`. Claims are encoded as tags, and HTTP transport uses the `Authorization` header with the `Nostr` scheme.

```http
Authorization: Nostr <base64url-event>
```

## Creating Tokens On The Client

Use `NostrWebTokenFactory` to create a token with audiences, expiration, and application-defined claims.

```ts
import { NostrWebTokenFactory } from "applesauce-common/factories";

const token = await NostrWebTokenFactory.create()
  .audiences(["api.example.com"])
  .expiration(Math.floor(Date.now() / 1000) + 300)
  .addClaim("scope", "upload")
  .message("Authorize upload session")
  .sign(signer);
```

Send the signed event with the helper from `applesauce-common/helpers`.

```ts
import { createNostrWebTokenAuthorizationHeader } from "applesauce-common/helpers";

await fetch("https://api.example.com/upload", {
  headers: { Authorization: createNostrWebTokenAuthorizationHeader(token) },
});
```

## Verifying Tokens On The Server

Decode the header, check the token structure, verify the event with your crypto library, then enforce time and audience claims.

```ts
import {
  hasNostrWebTokenAudience,
  isNostrWebTokenActive,
  isValidNostrWebToken,
  parseNostrWebTokenAuthorizationHeader,
} from "applesauce-common/helpers";

const token = parseNostrWebTokenAuthorizationHeader(req.headers.authorization);
if (!token || !isValidNostrWebToken(token)) throw new Error("Invalid token");
if (!verifyEvent(token)) throw new Error("Bad signature");
if (!isNostrWebTokenActive(token)) throw new Error("Expired token");
if (!hasNostrWebTokenAudience(token, "api.example.com")) throw new Error("Wrong audience");
```

`isValidNostrWebToken` only validates token structure. Verify the event id and signature with the crypto library used by your server before trusting claims.

## Session Authentication

A Nostr Web Token can act as a short-lived session token without storing server-side login state.

```ts
import { getNostrWebTokenSubject } from "applesauce-common/helpers";

const pubkey = getNostrWebTokenSubject(token);
const user = await getUserByPubkey(pubkey);
```

The client signs a token once after login or before a protected request. The server accepts it until `exp`, rejects it before `nbf`, and maps `sub` or the signer `pubkey` to a local user record.

Use the event `id` if you need replay detection, revocation, or one-time token semantics.

## Custom Claims

Applications can add their own claims with tags. Repeated tags represent multi-value claims.

```ts
const token = await NostrWebTokenFactory.create()
  .addClaim("role", "admin")
  .addClaim("scope", "upload")
  .addClaim("scope", "delete", false)
  .sign(signer);
```

The server defines what custom claims mean and enforces them after verification.

## Best Practices

- Use short expirations for bearer tokens
- Always set an audience for session tokens
- Verify event id and signature before trusting claims
- Enforce `exp`, `nbf`, and `aud` server-side
- Do not publish bearer tokens to relays
- Avoid long-lived tokens in localStorage
