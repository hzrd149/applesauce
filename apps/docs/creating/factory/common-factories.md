---
description: Use typed factory classes from applesauce-common to create and modify common Nostr event types
---

# Common Factories

`applesauce-common/factories` is the high-level layer on top of `EventFactory`.

Each class targets a specific event type and exposes methods that match that event's shape. Instead of starting with a generic builder and composing everything yourself, you start with `NoteFactory`, `CommentFactory`, `ContactsFactory`, `LegacyMessageFactory`, or another typed class.

## What It Is

Most common factories follow the same pattern:

- `create(...)` starts a new event
- `reply(...)` exists when the event type has reply semantics
- `modify(event)` starts from an existing event
- instance methods apply event-specific operations

```ts
import { NoteFactory } from "applesauce-common/factories";

const note = await NoteFactory.create("Hello #nostr").subject("Intro").addHashtag("applesauce").sign(signer);
```

## How To Use It

### Create new events

```ts
import { CommentFactory } from "applesauce-common/factories";

const comment = await CommentFactory.create(parent, "Great post", {
  alt: "Comment on a note",
}).sign(signer);
```

### Modify existing events

```ts
import { ProfileFactory } from "applesauce-core/factories";

const updated = await ProfileFactory.modify(profileEvent).displayName("Alice").about("Building on Nostr").sign(signer);
```

### Work with replaceable and list events

```ts
import { ContactsFactory } from "applesauce-common/factories";

const contacts = await ContactsFactory.create().addContact(friend).addContact(otherFriend, "teammate").sign(signer);
```

## Integration

Typed factories are the main event creation API used by `applesauce-actions`.

```ts
import { CommentFactory } from "applesauce-common/factories";

const event = await CommentFactory.create(parent, content, options).sign(signer);
await publish(event, relays);
```

They also compose cleanly with low-level helpers from `applesauce-core`:

```ts
import { NoteFactory } from "applesauce-common/factories";

const draft = NoteFactory.create("Hello").alt("Short text note");
const signed = await draft.sign(signer);
```

## Best Practices

- Use typed factories when the package already exposes the event type you need
- Prefer `modify(event)` over rebuilding replaceable events from scratch
- Keep event-specific behavior in the factory and reusable transforms in operations
- Treat `GiftWrapFactory.create(...)` as a special case because it returns a signed event directly
