---
description: Publish, clear, and display live user statuses
---

# User Statuses

User statuses are short live messages like "Working" or the song someone is listening to. Each user has one status per type (`general`, `music`, or custom), and a status can link to a URL, profile, or event and can expire. Publishing an empty status clears it.

## Publishing

```ts
import { SetUserStatus, ClearUserStatus } from "applesauce-actions/actions";

await actions.run(SetUserStatus, "Working", { link: "https://my.app", expiration: unixNow() + 3600 });
await actions.run(SetUserStatus, "Intergalatic - Beastie Boys", { type: "music", expiration: trackEnd });
await actions.run(ClearUserStatus, "music");
```

To build the event yourself, use `UserStatusFactory`.

```ts
const event = await UserStatusFactory.create("general", "Hiking").link("https://nostr.world").sign(signer);
```

## Displaying

`user.status$` returns the `general` status, and `user.statuses$` returns every type. Both skip cleared and expired statuses.

```tsx
const status = use$(user.status$);
return status && <span>{status.content}</span>;
```

The `UserStatus` cast exposes `type`, `content`, `expiration`, `url`, `user`, and `linkedEvent$`.

Without casts, use `UserStatusModel(pubkey, type)` or `UserStatusesModel(pubkey)`.

## Best Practices

- Always set an `expiration` on `music` statuses
- Clear a status with `ClearUserStatus`, not a delete request
