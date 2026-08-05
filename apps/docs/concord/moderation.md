# Moderation

Concord has a role-based permission model backed by cryptographic enforcement. This page covers roles, permissions, and the moderation actions on the [community engine](/concord/community).

## `community.admin`

Every action that needs authority lives on `community.admin` — metadata, channels, roles, members, invites, refounding, dissolution.

It's grouped by what you're trying to do, not by how the protocol stores it. Removing someone is `admin.kick` and `admin.ban` sitting next to each other; that one writes the guestbook and the other the control plane isn't something you need to know.

```ts
await community.admin.ban(memberPubkey);
await community.admin.createRole("Moderator", 10, PERM.KICK);
await community.admin.refound({ keep, exclude });
```

Reading is separate and stays on the community itself (`roles$`, `members$`, `banlist$`, `canDo`) — every member needs those, not just admins.

Some actions have flat community aliases for convenience, but `community.admin` is the surface to reach for in app code.

## The permission model

Every member has a **standing** derived from the owner flag plus the roles granted to them. Permissions are bit flags exposed as `PERM`:

```ts
import { PERM } from "applesauce-concord";

PERM.MANAGE_ROLES;
PERM.MANAGE_CHANNELS;
PERM.MANAGE_METADATA;
PERM.KICK;
PERM.BAN;
PERM.MANAGE_MESSAGES;
PERM.CREATE_INVITE;
```

`ADMIN_PERMS` is the union of all management bits — a conventional "admin" role.

Roles also carry a **position** (rank). Acting _on another member_ — kicking, banning, excluding them from a channel — requires that you both hold the permission **and** strictly outrank the target. This is what stops a moderator from banning an admin.

## Checking permissions

Every check comes in a snapshot form and a reactive `$` form. Use the snapshot in an
event handler, where you want the answer at click-time; use the reactive form to gate
UI, so a role grant that changes the answer re-renders the button.

```ts
community.can$(PERM.CREATE_INVITE).subscribe((allowed) => toggleInviteButton(allowed));

if (community.canDo(PERM.CREATE_INVITE)) {
  await community.admin.invites.create({ base });
}
```

To act _on someone_, reach for `canModerate$` rather than pairing `canDo` with a
position you read yourself. It carries both halves of the rule — hold the bit **and**
strictly outrank the target — including the fact that you never outrank yourself:

```ts
community.canModerate$(memberPubkey, PERM.KICK).subscribe((allowed) => ...);
```

`standingOf` / `standing$` give a member's resolved authority (owner flag, position, permissions, roles).

## Roles

Create a role with a name, position, and permission bits:

```ts
const roleId = await community.admin.createRole("Moderator", 10, PERM.KICK | PERM.MANAGE_MESSAGES);
```

Grant roles to a member (this replaces their role set):

```ts
await community.admin.grantRoles(memberPubkey, [roleId]);
```

Roles can be **server-scoped** (community-wide, the default) or **channel-scoped**, which marks the intended readership of a private channel. A channel-scoped role records entitlement only — you still deliver and rotate keys via [Channels](/concord/channels).

Edit a role in place, patching only the fields you pass:

```ts
await community.admin.editRole(roleId, { position: 3, permissions: PERM.KICK });
```

Delete (retire) a role. It stays in `community.roles$` flagged `deleted` — so history and UI can still resolve it — but confers no permissions or rank, stripping its authority from every grant-holder. Existing grants are left untouched, so restoring the role with `editRole(roleId, { deleted: false })` re-grants it automatically:

```ts
await community.admin.deleteRole(roleId);
```

Read the live roles by filtering out the deleted ones:

```ts
community.roles$.pipe(map((roles) => roles.filter((r) => !r.deleted)));
```

## Kick

A kick removes a member's roles and records a Kick in the guestbook. They can rejoin from an invite.

```ts
await community.admin.kick(memberPubkey);
```

Requires `KICK` and outranking the target.

## Ban and unban

A ban adds the member to the banlist and strips their roles:

```ts
await community.admin.ban(memberPubkey);
await community.admin.unban(memberPubkey);
```

Requires `BAN`. A ban records intent — to actually cut a banned member off from future traffic you also **refound** (below), which rotates keys away from them.

## Refounding

Refounding rolls the whole community forward to a new epoch with fresh keys delivered only to the members you keep. It's how removals are cryptographically enforced.

```ts
await community.admin.refound({
  keep: [ownerPubkey, ...remainingMembers],
  exclude: [bannedPubkey],
});
```

To rotate private channels in the same operation, pass a per-channel keep list — and pass each channel's **actual** membership, never the community-wide keep set, or you'd grant its key to someone who was never in it:

```ts
await community.admin.refound({
  keep: remainingMembers,
  exclude: [bannedPubkey],
  channelRekeys: [{ channelId, keep: channelMembers }],
});
```

Requires `BAN` or ownership. Every remaining member's engine adopts the new epoch automatically; the excluded member's engine detects the removal and drops the community.
