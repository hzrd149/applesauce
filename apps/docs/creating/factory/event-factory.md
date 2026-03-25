---
description: Build, modify, stamp, and sign Nostr events with the low-level EventFactory API
---

# EventFactory

`EventFactory` is the low-level builder in `applesauce-core`.

It is an awaitable chain of event transforms. Each method returns another factory instance, and the whole chain resolves to an event draft. Finish the chain with `.stamp()` or `.sign()` when you need a pubkey or a full signed event.

## What It Is

You can start from a kind number or an existing event:

```ts
import { EventFactory } from "applesauce-core";

const draft = EventFactory.fromKind(1).content("Hello");
const signed = await draft.sign(signer);
```

```ts
import { EventFactory } from "applesauce-core";

const edited = await EventFactory.fromEvent(existingEvent).content("Updated").sign(signer);
```

## How To Use It

### Start a blank draft

```ts
const draft = EventFactory.fromKind(30023)
  .content("Article body")
  .alt("Long-form article")
  .modifyPublicTags((tags) => [...tags, ["title", "Hello"]]);
```

### Reuse a signer across the chain

```ts
const signed = await EventFactory.fromKind(1).as(signer).content("Hello").sign();
```

### Modify tags

```ts
import { addProfilePointerTag } from "applesauce-core/operations/tag/common";

const signed = await EventFactory.fromKind(3).modifyPublicTags(addProfilePointerTag(friend)).sign(signer);
```

## Stamp And Sign

Use `.stamp()` when you need an unsigned event with a pubkey:

```ts
const unsigned = await EventFactory.fromKind(1).content("Hello").stamp(signer);
```

Use `.sign()` when you need a full `NostrEvent`:

```ts
const signed = await EventFactory.fromKind(1).content("Hello").sign(signer);
```

`.sign()` checks that the signer does not change the event kind or stamped pubkey.

## Integration

`EventFactory` is the base layer used by typed factories in `applesauce-common/factories`.

```ts
import { NoteFactory } from "applesauce-common/factories";

const note = await NoteFactory.create("Hello #world").sign(signer);
```

If a built-in typed factory does not exist, use `EventFactory` directly and compose low-level operations.

## Best Practices

- Use `fromKind()` for new events and `fromEvent()` for edits
- Call `.as(signer)` when multiple later steps need the signer
- Keep repeated logic in operations instead of inline tag mutation
- Prefer typed factories for notes, comments, lists, profiles, messages, and other event kinds defined in NIPs
