---
description: Compose reusable tag transforms for public tags, hidden tags, lists, pointers, and metadata
---

# Tag Operations

Tag operations only work on arrays of tags.

They plug into `modifyPublicTags(...)`, `modifyHiddenTags(...)`, and the factory helpers built on top of them.

## What It Is

The current type is simple:

```ts
type TagOperation = (tags: string[][]) => string[][] | Promise<string[][]>;
```

Use a tag operation when you want to add, remove, or replace tags without touching the rest of the event draft.

## How To Use It

### Modify public tags

```ts
import { EventFactory } from "applesauce-core";
import { addProfilePointerTag, setSingletonTag } from "applesauce-core/operations/tag/common";

const signed = await EventFactory.fromKind(3)
  .modifyPublicTags(setSingletonTag(["title", "Friends"]), addProfilePointerTag(friend))
  .sign(signer);
```

### Modify hidden tags

```ts
import { addProfilePointerTag } from "applesauce-core/operations/tag/common";

const signed = await EventFactory.fromKind(30000)
  .as(signer)
  .modifyHiddenTags(addProfilePointerTag(secretFriend))
  .sign();
```

### Compose tag operations

```ts
import { tagPipe } from "applesauce-core/helpers/pipeline";
import { addProfilePointerTag, setSingletonTag } from "applesauce-core/operations/tag/common";

const setupList = tagPipe(setSingletonTag(["title", "Friends"]), addProfilePointerTag(friend));
```

## Common Tag Operations

The most common helpers come from `applesauce-core/operations/tag/common`:

- `addProfilePointerTag()` and `removeProfilePointerTag()`
- `addEventPointerTag()` and `removeEventPointerTag()`
- `addAddressPointerTag()` and `removeAddressPointerTag()`
- `addNameValueTag()` and `removeNameValueTag()`
- `setSingletonTag()` and `removeSingletonTag()`

```ts
import { addEventPointerTag, addNameValueTag } from "applesauce-core/operations/tag/common";

const signed = await EventFactory.fromKind(1)
  .modifyPublicTags(addEventPointerTag(parent), addNameValueTag(["subject", "Reply"]))
  .sign(signer);
```

## Integration

Tag operations are the main building blocks for list-style factories in `applesauce-common/factories/list.ts` and `applesauce-common/factories/relay-lists.ts`.

That keeps methods like `addUser`, `addRelay`, and `addEventItem` short while still reusing the same core helpers.

## Best Practices

- Keep each tag operation focused on a single tag rule
- Return a new array instead of mutating `tags`
- Use `tagPipe()` to share bundles of tag logic
- Call `.as(signer)` before `modifyHiddenTags(...)` when the chain needs encrypted hidden tags
