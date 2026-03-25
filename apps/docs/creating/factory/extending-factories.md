---
description: Extend EventFactory with your own typed factory classes and reusable fluent methods
---

# Extending Factories

Custom factories are regular subclasses of `EventFactory`.

The usual shape is simple:

- add a static constructor like `create()` or `modify()`
- start from `blankEventTemplate(kind)` or `toEventTemplate(event)`
- expose fluent instance methods that call `this.chain(...)`

## What It Is

This is the pattern used throughout `applesauce-core/factories` and `applesauce-common/factories`.

```ts
import { blankEventTemplate, EventFactory } from "applesauce-core/factories";

class StatusFactory extends EventFactory<30315> {
  static create() {
    return new StatusFactory((resolve) => resolve(blankEventTemplate(30315)));
  }

  status(text: string) {
    return this.content(text);
  }
}
```

## How To Use It

### Start a new event

```ts
class StatusFactory extends EventFactory<30315> {
  static create() {
    return new StatusFactory((resolve) => resolve(blankEventTemplate(30315))).status("online");
  }

  status(text: string) {
    return this.content(text);
  }
}

const event = await StatusFactory.create().sign(signer);
```

When you add a static `create()` method, it should return a factory that already represents a valid event for that kind. Extra options are fine, but the base result should include the required fields and tags. The factories in `packages/common/src/factories/comment.ts` and `packages/common/src/factories/live-stream.ts` follow this pattern.

### Modify an existing event

```ts
import { toEventTemplate } from "applesauce-core/factories";

static modify(event: KnownEvent<30315>) {
  return new StatusFactory((resolve) => resolve(toEventTemplate(event)));
}
```

### Add reusable methods

```ts
import { addNameValueTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";

priority(level: "low" | "high") {
  return this.chain(modifyPublicTags(addNameValueTag(["priority", level])));
}
```

`this.chain(...)` takes event operations. If you want to reuse a tag operation, wrap it with `modifyPublicTags(...)` or `modifyHiddenTags(...)` first. For simple cases, you can also call `this.modifyPublicTags(...)`, `this.modifyHiddenTags(...)`, or `this.modifyTags(...)` directly from the factory method.

## Integration

Custom factories use the same signer and chain model as built-in factories.

```ts
const draft = StatusFactory.create().priority("high").as(signer);
const signed = await draft.sign();
```

You can also build small inheritance layers for families of events. The list factories in `applesauce-common/factories/list.ts` are a good example: `ListFactory` adds shared metadata methods, then specialized subclasses add relay, user, or item helpers.

## Best Practices

- Keep constructors small and fluent methods focused on one change
- Use `blankEventTemplate()` for new events and `toEventTemplate()` for edits
- Make `create()` return a valid event shape for that kind before optional customization
- Put shared logic in operations when more than one factory needs it
- Validate kinds in `modify(event)` before creating a subclass instance
