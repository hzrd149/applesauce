---
description: Build, modify, stamp, and sign Nostr events with EventFactory, typed factories, and operations
---

# Factory

Applesauce has a two-layer factory system.

- `applesauce-core` provides the low-level `EventFactory` class and the shared operations used to build drafts, modify tags, stamp events, and sign them.
- `applesauce-common` provides typed factory classes for common Nostr event types like notes, comments, profiles, lists, gift wraps, and direct messages.

## What It Is

Use the core layer when you need a generic builder:

```ts
import { EventFactory } from "applesauce-core";

const event = await EventFactory.fromKind(1).content("Hello").sign(signer);
```

Use the common layer when you want an event-specific API:

```ts
import { NoteFactory } from "applesauce-common/factories";

const note = await NoteFactory.create("Hello #world").sign(signer);
```

## How To Use It

Pick the layer that matches your job:

- [`Event Factory`](./event-factory.md) covers the low-level builder in `applesauce-core`
- [`Common Factories`](./common-factories.md) covers typed factories in `applesauce-common/factories`
- [`Extending Factories`](./extending-factories.md) shows how to build your own subclasses
- [`Event Operations`](./event-operations.md) covers reusable event transforms
- [`Tag Operations`](./tag-operations.md) covers public and hidden tag transforms

## Integration

Factories fit into the rest of Applesauce in a few predictable places:

- Actions create and sign events with typed factories, then publish them
- Account managers supply the signer used by `.sign()` or `.as(signer)`
- Event operations and tag operations stay reusable across both core and common factories

```ts
import { CommentFactory } from "applesauce-common/factories";

const comment = await CommentFactory.create(parent, "Nice post").sign(signer);
```

## Best Practices

- Reach for `applesauce-common/factories` first when a typed factory already exists
- Use `EventFactory` directly for custom kinds or shared low-level flows
- Keep reusable logic in operations, not inline event mutation
- Use `.stamp()` when you need an unsigned event with a pubkey

## Installation

Install `applesauce-core` for the base builder:

:::code-group

```sh [npm]
npm install applesauce-core
```

```sh [yarn]
yarn add applesauce-core
```

```sh [pnpm]
pnpm add applesauce-core
```

:::

Install `applesauce-common` when you want the typed factory layer:

:::code-group

```sh [npm]
npm install applesauce-common
```

```sh [yarn]
yarn add applesauce-common
```

```sh [pnpm]
pnpm add applesauce-common
```

:::
