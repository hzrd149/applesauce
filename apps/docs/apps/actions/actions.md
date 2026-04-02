# Actions

Actions are the core building blocks for creating and modifying Nostr events in a structured way. An [Action](https://applesauce.build/typedoc/types/applesauce-actions.Action.html) is an async function that receives an `ActionContext` and publishes events directly.

## What is an Action?

An action is a function that takes parameters and returns an `Action` function. The action function receives a context with:

- `events` - The event store for reading existing events
- `user` - The current user's cast (provides convenient access to user data)
- `self` - The current user's public key
- `signer` - The active signer
- `sign` - A helper function to sign events
- `publish` - A function to publish events (optionally to specific relays)
- `run` - A function to run sub-actions

Actions follow this basic pattern:

```ts
import { Action } from "applesauce-actions";
import { ProfileFactory } from "applesauce-core/factories";

function SetAbout(about: string): Action {
  return async ({ events, user, publish, signer }) => {
    // Read existing events from the store
    const existingEvent = events.getReplaceable(0, user.pubkey);
    if (!existingEvent) throw new Error("Profile not found");

    // Create or modify events with a typed factory
    const signed = await ProfileFactory.modify(existingEvent).about(about).sign(signer);

    // Publish the event (optionally to specific relays)
    await publish(signed);
  };
}
```

:::warning
To avoid overriding replaceable events, actions should throw if an existing replaceable event can't be found when expected.
:::

## How Actions Publish Events

Actions are responsible for publishing their own events using the `publish` function from the context. This means:

1. **Actions handle their own publishing** - Unlike the old async generator pattern, actions directly call `publish()` to send events to relays
2. **Relay selection** - Actions can specify which relays to publish to by passing a `relays` array as the second argument to `publish()`
3. **Outbox support** - Most actions publish to the user's outboxes (from `user.outboxes$`) when available, ensuring events reach the correct relays according to NIP-65

When using `ActionRunner.run()`, the publish method provided during ActionRunner creation is used. When using `ActionRunner.exec()`, the publish function in the context emits events to the returned Observable instead.

## Pre-built Actions

The `applesauce-actions` package comes with many pre-built actions for common social client operations. You can find the complete list in the [reference](https://applesauce.build/typedoc/modules/applesauce-actions.Actions.html).

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
import { kinds } from "applesauce-core/helpers";
import { ProfileFactory } from "applesauce-core/factories";

export function CreateProfile(content: ProfileContent): Action {
  return async ({ events, self, publish, signer }) => {
    const metadata = events.getReplaceable(kinds.Metadata, self);
    if (metadata) throw new Error("Profile already exists");

    const signed = await ProfileFactory.create().override(content).sign(signer);
    await publish(signed);
  };
}
```

### Updating Existing Events

When updating events, actions verify the event exists before modifying:

```ts
import { ProfileFactory } from "applesauce-core/factories";

export function UpdateProfile(content: Partial<ProfileContent>): Action {
  return async ({ user, publish, signer }) => {
    // Load the profile and outboxes in parallel
    const [profile, outboxes] = await Promise.all([
      user.profile$.$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    if (!profile) throw new Error("Profile does not exist");

    const signed = await ProfileFactory.modify(profile.event).update(content).sign(signer);
    await publish(signed, outboxes);
  };
}
```

### Modifying Tags

Many actions work by adding or removing tags from existing events:

```ts
import { firstValueFrom, of, timeout } from "rxjs";
import { ContactsFactory } from "applesauce-common/factories";
import { kinds } from "applesauce-core/helpers";
import { TagOperation } from "applesauce-core/factories";
import { addProfilePointerTag } from "applesauce-core/operations/tag/common";

function ModifyContactsEvent(operations: TagOperation[]): Action {
  return async ({ events, user, publish, signer }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events.replaceable(kinds.Contacts, user.pubkey).pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const draft = event ? ContactsFactory.modify(event) : ContactsFactory.create();
    const signed = await draft.modifyPublicTags(...operations).sign(signer);

    await publish(signed, outboxes);
  };
}

export function FollowUser(user: string | ProfilePointer): Action {
  return ModifyContactsEvent([addProfilePointerTag(user)]);
}
```

### Complex Operations

Some actions perform multiple operations or create multiple events:

```ts
import { BookmarkListFactory } from "applesauce-common/factories";

export function CreateBookmarkSet(
  title: string,
  description: string,
  additional: { image?: string; hidden?: NostrEvent[]; public?: NostrEvent[] },
): Action {
  return async ({ user, publish, signer }) => {
    let draft = BookmarkListFactory.create()
      .title(title)
      .description(description)
      .image(additional.image ?? null);

    for (const event of additional.public ?? []) draft = draft.bookmarkEvent(event);
    for (const event of additional.hidden ?? []) draft = draft.bookmarkEvent(event, true);

    const signed = await draft.as(signer).sign();

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
```

## Creating Custom Actions

To create your own action, define a function that takes parameters and returns an `Action` function:

```ts
import { Action } from "applesauce-actions";
import { ProfileFactory } from "applesauce-core/factories";

function SetDisplayName(displayName: string): Action {
  return async ({ user, publish, signer }) => {
    // Get the current profile
    const profile = await user.profile$.$first(1000, undefined);
    if (!profile) throw new Error("Profile not found");

    const signed = await ProfileFactory.modify(profile.event).displayName(displayName).sign(signer);

    // Publish the event
    const outboxes = await user.outboxes$.$first(1000, undefined);
    await publish(signed, outboxes);
  };
}
```

### Multi-Event Actions

Actions can publish multiple events if needed:

```ts
import { ContactsFactory } from "applesauce-common/factories";
import { addProfilePointerTag } from "applesauce-core/operations/tag/common";

function CreateUserSetup(profile: ProfileContent, initialFollows: string[]): Action {
  return async ({ user, publish, signer }) => {
    // Create profile
    const profileSigned = await ProfileFactory.create().override(profile).sign(signer);
    await publish(profileSigned);

    // Create contacts list
    const contactsSigned = await ContactsFactory.create()
      .modifyPublicTags(...initialFollows.map((pubkey) => addProfilePointerTag(pubkey)))
      .sign(signer);

    const outboxes = await user.outboxes$.$first(1000, undefined);
    await publish(contactsSigned, outboxes);
  };
}
```

### Running Sub-Actions

Actions can run other actions using the `run` function from the context:

```ts
function SetupNewUser(profile: ProfileContent, initialFollows: string[]): Action {
  return async ({ run, publish }) => {
    // Run CreateProfile action
    await run(CreateProfile, profile);

    // Run NewContacts action
    await run(NewContacts, initialFollows);
  };
}
```

## Best Practices

1. **Validate inputs** - Check that required events exist before attempting modifications
2. **Use typed factories** - Prefer `ProfileFactory`, `ContactsFactory`, and other typed builders when they exist
3. **Handle errors gracefully** - Throw descriptive errors when preconditions aren't met
4. **Keep actions focused** - Each action should have a single, clear responsibility
5. **Document parameters** - Use JSDoc comments to describe action parameters and behavior
6. **Publish to outboxes** - When available, use the user's outboxes (from `user.outboxes$`) for publishing to ensure events reach the right relays
7. **Use Promise.all for parallel operations** - Load events and outboxes in parallel when possible for better performance

The action pattern allows actions to be composable, testable, and easy to reason about while providing a clean interface for event creation and modification. Actions handle their own publishing, making them self-contained units of work.
