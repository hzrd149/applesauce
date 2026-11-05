---
description: Read and edit the list of relay-based groups a user has joined
---

# Groups

Relay-based groups live on a single relay and are identified by a group id on that relay. Users keep track of the groups they've joined in a groups list (kind 10009), which can hold public and hidden entries.

## Reading a user's groups

`user.groups$` loads the user's groups list from their outboxes and casts it to `GroupsList`. `groups` returns a `GroupPointer` for each public entry.

```ts
const list = use$(user.groups$);

list?.groups.map((group) => group.id); // { id, relay, name? }
```

**Example:** [Groups](https://applesauce.build/examples/#/example/group/groups)

## Unlocking hidden groups

Hidden groups stay encrypted until the user's signer decrypts them. `hidden$` emits `undefined` while locked and updates once unlocked.

```ts
if (list.hasHidden && !list.unlocked) await list.unlock(signer);

const hiddenGroups = use$(list.hidden$);
```

## Editing the groups list

There are no built-in actions for the groups list yet. Write a small [custom action](/apps/actions/actions) that modifies the list's `group` tags with `ListFactory`.

```ts
function AddGroupToList(group: GroupPointer): Action {
  return async ({ user, signer, publish }) => {
    const [list, outboxes] = await Promise.all([
      user.replaceable(GROUPS_LIST_KIND).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);
    const isSame = (t: string[]) => t[0] === "group" && t[1] === group.id && t[2] === group.relay;
    const draft = list ? ListFactory.modify(list) : EventFactory.fromKind(GROUPS_LIST_KIND);
    const signed = await draft
      .modifyPublicTags((tags) => [...tags.filter((t) => !isSame(t)), ["group", group.id, group.relay]])
      .sign(signer);

    await publish(signed, outboxes);
  };
}
```

## Group pointers

`GroupPointer` holds a group's `id`, `relay`, and optional `name`. `encodeGroupPointer` and `decodeGroupPointer` from `applesauce-common/helpers` convert it to and from the `relay'id` string many clients use.

```ts
const pointer = decodeGroupPointer("groups.example.com'abc123"); // null when invalid
if (pointer) encodeGroupPointer(pointer); // "groups.example.com'abc123"
```

## Helpers

- `getPublicGroups(event)` returns the public group pointers
- `getHiddenGroups(event)` returns the hidden group pointers, or `undefined` while locked
- `unlockHiddenGroups(event, signer)` decrypts hidden groups and notifies the store
- `getGroupPointerFromGroupTag(tag)` parses one `group` tag

## Best Practices

- Match groups on both `id` and `relay`, since the same id can exist on different relays
- Store groups the user wants to keep private as hidden entries
- Load the existing list before writing so groups added by other clients aren't lost
