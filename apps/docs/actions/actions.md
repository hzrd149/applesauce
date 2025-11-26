# Actions

Actions are the core building blocks for creating and modifying Nostr events in a structured way. An [Action](https://hzrd149.github.io/applesauce/typedoc/types/applesauce-actions.Action.html) is an [AsyncIterator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AsyncIterator) that reads from the `EventStore` and yields signed Nostr events ready for publishing.

## What is an Action?

An action is a function that returns an async generator. The generator has access to:

- `events` - The event store for reading existing events
- `factory` - The event factory for creating and signing new events
- `self` - The current user's public key

Actions follow this basic pattern:

```ts
import { Action } from "applesauce-actions";

function MyAction(param1: string, param2?: boolean): Action {
  return async function* ({ events, factory, self }) {
    // Read existing events from the store
    const existingEvent = events.getReplaceable(kind, self);

    // Create or modify events using the factory
    const draft = await factory.modify(existingEvent, ...operations);

    // Sign and yield the event for publishing
    yield await factory.sign(draft);
  };
}
```

:::warning
To avoid overriding replaceable events, actions should throw if an existing replaceable event can't be found when expected.
:::

## Pre-built Actions

The `applesauce-actions` package comes with many pre-built actions for common social client operations. You can find the complete list in the [reference](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-actions.Actions.html).

Some examples include:

- `CreateProfile` / `UpdateProfile` - Managing user profiles
- `FollowUser` / `UnfollowUser` - Managing contact lists
- `BookmarkEvent` / `UnbookmarkEvent` - Managing bookmarks
- `MuteUser` / `UnmuteUser` - Managing mute lists
- `PinNote` / `UnpinNote` - Managing pinned notes

## Action Patterns

### Creating New Events

When creating a new replaceable event, actions typically check if one already exists:

```ts
export function CreateProfile(content: ProfileContent): Action {
  return async function* ({ events, factory, self }) {
    const metadata = events.getReplaceable(kinds.Metadata, self);
    if (metadata) throw new Error("Profile already exists");

    const draft = await factory.build({ kind: kinds.Metadata }, setProfileContent(content));
    yield await factory.sign(draft);
  };
}
```

### Updating Existing Events

When updating events, actions verify the event exists before modifying:

```ts
export function UpdateProfile(content: Partial<ProfileContent>): Action {
  return async function* ({ events, factory, self }) {
    const metadata = events.getReplaceable(kinds.Metadata, self);
    if (!metadata) throw new Error("Profile does not exist");

    const draft = await factory.modify(metadata, updateProfileContent(content));
    yield await factory.sign(draft);
  };
}
```

### Modifying Tags

Many actions work by adding or removing tags from existing events:

```ts
export function FollowUser(pubkey: string, relay?: string, hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const contacts = events.getReplaceable(kinds.Contacts, self);
    if (!contacts) throw new Error("Missing contacts event");

    const pointer = { pubkey, relays: relay ? [relay] : undefined };
    const operation = addPubkeyTag(pointer);
    const draft = await factory.modifyTags(contacts, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}
```

### Complex Operations

Some actions perform multiple operations or create multiple events:

```ts
export function CreateBookmarkSet(
  title: string,
  description: string,
  additional: { image?: string; hidden?: NostrEvent[]; public?: NostrEvent[] },
): Action {
  return async function* ({ events, factory, self }) {
    const existing = getBookmarkEvent(events, self);
    if (existing) throw new Error("Bookmark list already exists");

    const draft = await factory.build(
      { kind: kinds.BookmarkList },
      setListTitle(title),
      setListDescription(description),
      additional.image ? setListImage(additional.image) : undefined,
      additional.public ? modifyPublicTags(...additional.public.map(addEventBookmarkTag)) : undefined,
      additional.hidden ? modifyHiddenTags(...additional.hidden.map(addEventBookmarkTag)) : undefined,
    );
    yield await factory.sign(draft);
  };
}
```

## Creating Custom Actions

To create your own action, define a function that returns an async generator that yields signed events:

```ts
import { Action } from "applesauce-actions";
import { kinds } from "nostr-tools";

function SetDisplayName(displayName: string): Action {
  return async function* ({ events, factory, self }) {
    // Get the current profile
    const profile = events.getReplaceable(kinds.Metadata, self);
    if (!profile) throw new Error("Profile not found");

    // Parse existing content
    const content = JSON.parse(profile.content || "{}");

    // Update the display name
    content.display_name = displayName;

    // Create a new profile event with updated content
    const draft = await factory.modify(profile, (event) => {
      event.content = JSON.stringify(content);
      return event;
    });

    // Sign and yield the event
    yield await factory.sign(draft);
  };
}
```

### Multi-Event Actions

Actions can yield multiple events if needed:

```ts
function CreateUserSetup(profile: ProfileContent, initialFollows: string[]): Action {
  return async function* ({ events, factory, self }) {
    // Create profile
    const profileDraft = await factory.build({ kind: kinds.Metadata }, setProfileContent(profile));
    yield await factory.sign(profileDraft);

    // Create contacts list
    const contactsDraft = await factory.build({
      kind: kinds.Contacts,
      tags: initialFollows.map((pubkey) => ["p", pubkey]),
    });
    yield await factory.sign(contactsDraft);
  };
}
```

## Best Practices

1. **Validate inputs** - Check that required events exist before attempting modifications
2. **Use factory operations** - Leverage the event factory's built-in operations for common tasks
3. **Handle errors gracefully** - Throw descriptive errors when preconditions aren't met
4. **Keep actions focused** - Each action should have a single, clear responsibility
5. **Document parameters** - Use JSDoc comments to describe action parameters and behavior

The async generator pattern allows actions to be composable, testable, and easy to reason about while providing a clean interface for event creation and modification.
