---
description: Compose reusable event transforms for content, metadata, stamping, signing, and tag changes
---

# Event Operations

Event operations are the reusable building blocks underneath the factory system.

An event operation takes a draft, returns a new draft, and can be synchronous or async.

## What It Is

The current type is context-free:

```ts
type EventOperation<Input = EventTemplate, Result = EventTemplate> = (value: Input) => Result | Promise<Result>;
```

Use operations when you want logic that can be shared across multiple factory classes.

## How To Use It

Apply a single operation with `this.chain(...)` inside a factory method:

```ts
import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { includeAltTag } from "applesauce-core/operations/event";

alt(text: string) {
  return this.chain(includeAltTag(text));
}
```

Compose several operations with `eventPipe(...)`:

```ts
import { eventPipe, skip } from "applesauce-core/helpers/pipeline";
import { includeAltTag, setMetaTags } from "applesauce-core/operations/event";

const withMeta = (alt?: string) =>
  eventPipe(skip(), alt ? includeAltTag(alt) : skip(), setMetaTags({ protected: true }));
```

Use them from a subclass:

```ts
class CustomFactory extends EventFactory<1> {
  withMeta(alt?: string) {
    return this.chain(withMeta(alt));
  }
}

const signed = await new CustomFactory((resolve) => resolve(blankEventTemplate(1)))
  .withMeta("Short text note")
  .content("Hello")
  .sign(signer);
```

## Common Operations

Some low-level operations you will use often:

- `includeAltTag()`
- `setExpirationTimestamp()`
- `setMetaTags()`
- `setProtected()`
- `stamp()`
- `sign()`
- `modifyPublicTags()`
- `modifyHiddenTags()`

```ts
import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { setMetaTags } from "applesauce-core/operations/event";

class NoteLikeFactory extends EventFactory<1> {
  metaTags() {
    return this.chain(setMetaTags({ alt: "Short text note", protected: true }));
  }
}

const signed = await new NoteLikeFactory((resolve) => resolve(blankEventTemplate(1)))
  .metaTags()
  .content("Hello")
  .sign(signer);
```

## Integration

Operations are what make typed factories concise.

`ProfileFactory`, `NoteFactory`, and `CommentFactory` all expose small fluent methods, but most of the real work lives in reusable operations.

## Best Practices

- Keep each operation focused on one transformation
- Return new objects instead of mutating the input draft
- Compose shared behavior with `eventPipe()`
- Put signer-dependent behavior in methods that already have access to `.as(signer)` or `.sign(signer)`
