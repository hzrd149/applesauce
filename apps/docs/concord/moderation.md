# Moderation

Concord has a role-based permission model backed by cryptographic enforcement. This page covers roles, permissions, and the moderation actions on the [community engine](/concord/community).

## The permission model

Every member has a **standing** derived from the owner flag plus the roles granted to them. Permissions are bit flags exposed as `PERM`:

```ts
import { PERM } from "applesauce-concord";

PERM.MANAGE_ROLES
PERM.MANAGE_CHANNELS
PERM.MANAGE_METADATA
PERM.KICK
PERM.BAN
PERM.MANAGE_MESSAGES
PERM.CREATE_INVITE
```

`ADMIN_PERMS` is the union of all management bits — a conventional "admin" role.

Roles also carry a **position** (rank). Acting *on another member* — kicking, banning, excluding them from a channel — requires that you both hold the permission **and** strictly outrank the target. This is what stops a moderator from banning an admin.

## Checking permissions

Gate your UI with `canDo`, and compare members with `standingOf`:

```ts
if (community.canDo(PERM.KICK)) showKickButton();

const target = community.standingOf(memberPubkey);
```

## Roles

Create a role with a name, position, and permission bits:

```ts
const roleId = await community.createRole("Moderator", 10, PERM.KICK | PERM.MANAGE_MESSAGES);
```

Grant roles to a member (this replaces their role set):

```ts
await community.grantRoles(memberPubkey, [roleId]);
```

Roles can be **server-scoped** (community-wide, the default) or **channel-scoped**, which marks the intended readership of a private channel. A channel-scoped role records entitlement only — you still deliver and rotate keys via [Channels](/concord/channels).

Edit a role in place, patching only the fields you pass:

```ts
await community.editRole(roleId, { position: 3, permissions: PERM.KICK });
```

Delete (retire) a role. It stays in `community.state$` flagged `deleted` — so history and UI can still resolve it — but confers no permissions or rank, stripping its authority from every grant-holder. Existing grants are left untouched, so restoring the role with `editRole(roleId, { deleted: false })` re-grants it automatically:

```ts
await community.deleteRole(roleId);
```

Read the live roles by filtering out the deleted ones:

```ts
const liveRoles = community.state$.value.roles.filter((r) => !r.deleted);
```

## Kick

A kick removes a member's roles and records a Kick in the guestbook. They can rejoin from an invite.

```ts
await community.kick(memberPubkey);
```

Requires `KICK` and outranking the target.

## Ban and unban

A ban adds the member to the banlist and strips their roles:

```ts
await community.ban(memberPubkey);
await community.unban(memberPubkey);
```

Requires `BAN`. A ban records intent — to actually cut a banned member off from future traffic you also **refound** (below), which rotates keys away from them.

## Refounding

Refounding rolls the whole community forward to a new epoch with fresh keys delivered only to the members you keep. It's how removals are cryptographically enforced.

```ts
await community.refound({
  keep: [ownerPubkey, ...remainingMembers],
  exclude: [bannedPubkey],
});
```

To rotate private channels in the same operation, pass a per-channel keep list — and pass each channel's **actual** membership, never the community-wide keep set, or you'd grant its key to someone who was never in it:

```ts
await community.refound({
  keep: remainingMembers,
  exclude: [bannedPubkey],
  channelRekeys: [{ channelId, keep: channelMembers }],
});
```

Requires `BAN` or ownership. Every remaining member's engine adopts the new epoch automatically; the excluded member's engine detects the removal and drops the community.
