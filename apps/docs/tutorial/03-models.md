# 3. Building Reactive UI with Models

Models are pre-built subscriptions that combine the EventStore with helpers to provide computed state. Instead of manually subscribing to events and parsing them, models give you clean, reactive data that automatically updates when relevant events change.

## What are Models?

Models are functions that:

- **Combine EventStore subscriptions with helpers** - No manual parsing needed
- **Provide computed state** - Transform raw events into useful data structures
- **Cache results** - Same model with same parameters reuses the same observable
- **Handle complex logic** - Like loading missing data or combining multiple event types
- **Return RxJS observables** - Can be subscribed to or used with operators

## Using Models with EventStore

The `eventStore.model()` method is how you create and subscribe to models:

```typescript
import { ProfileModel } from "applesauce-core/models";

// Create a model subscription
const profileSubscription = eventStore
  .model(ProfileModel, "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")
  .subscribe((profile) => {
    if (profile) {
      console.log("Profile:", profile);
      // Profile is already parsed and ready to use
      console.log("Name:", profile.name);
      console.log("About:", profile.about);
    } else {
      console.log("Profile not found");
    }
  });

// Don't forget to unsubscribe when done
// profileSubscription.unsubscribe();
```

## ProfileModel Example

The `ProfileModel` automatically handles profile events (kind 0) and parses their content:

```typescript
import { EventStore } from "applesauce-core";
import { ProfileModel } from "applesauce-core/models";

const eventStore = new EventStore();
const pubkey = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

// Subscribe to profile updates
eventStore.model(ProfileModel, pubkey).subscribe((profile) => {
  if (profile) {
    console.log("User profile updated:");
    console.log("- Name:", profile.name || "No name");
    console.log("- About:", profile.about || "No bio");
    console.log("- Picture:", profile.picture || "No picture");
    console.log("- Website:", profile.website || "No website");
  }
});

// Add a profile event to see the model in action
eventStore.add({
  content:
    '{"name":"fiatjaf","about":"~","picture":"https://fiatjaf.com/static/favicon.jpg","nip05":"_@fiatjaf.com","lud16":"fiatjaf@zbd.gg","website":"https://nostr.technology"}',
  created_at: 1738588530,
  id: "c43be8b4634298e97dde3020a5e6aeec37d7f5a4b0259705f496e81a550c8f8b",
  kind: 0,
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  relays: [""],
  sig: "202a1bf6a58943d660c1891662dbdda142aa8e5bca9d4a3cb03cde816ad3bdda6f4ec3b880671506c2820285b32218a0afdec2d172de9694d83972190ab4f9da",
  tags: [],
});

// The subscription will fire with the parsed profile data
```

## TimelineModel Example

The `TimelineModel` provides a sorted, reactive timeline of events:

```typescript
import { TimelineModel } from "applesauce-core/models";

// Subscribe to all text notes (kind 1)
eventStore.model(TimelineModel, { kinds: [1] }).subscribe((timeline) => {
  console.log(`Timeline updated: ${timeline.length} notes`);

  timeline.forEach((note, index) => {
    console.log(`${index + 1}. ${note.content.slice(0, 50)}...`);
    console.log(`   By: ${note.pubkey.slice(0, 8)}`);
    console.log(`   At: ${new Date(note.created_at * 1000).toLocaleString()}`);
  });
});

// Add some notes to see the timeline update
eventStore.add({
  content: 'I just wish LLMs would stop saying their solutions are "comprehensive" or "powerful"',
  created_at: 1749596768,
  id: "77941979d4c04283fd9b2f0a280749248cbd41babe3a0731c1597a6d54ae7874",
  kind: 1,
  pubkey: "97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322",
  sig: "a0884549f09ef805d3ffa917c3d9e189882295f1b819c038e5d28ea1a668f4455f66ada40749dbdb6dfd48c323f507889330a2a4742b0cb66d8997afb31ff47e",
  tags: [["client", "Coracle", "31990:97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322:1685968093690"]],
});

eventStore.add({
  content: "These numbers are so kind.",
  created_at: 1745847253,
  id: "621233a1ad1b91620f0b4a308c2113243a98925909cdb7b26284cbb4d835a18c",
  kind: 1,
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  sig: "eb8f30f7c44d031bfe315d476165f5cf29c21f1eaf07128f5a673cdb3b69ebf7902dacc06987f8d764b17225aefecdbc91992165e03372e40f57639a41203a1c",
  tags: [],
});

// Timeline will update twice, showing 1 note then 2 notes
```

## Model Caching

Models with the same parameters are cached and reused:

```typescript
// These two subscriptions share the same underlying model
const subscription1 = eventStore
  .model(ProfileModel, "621233a1ad1b91620f0b4a308c2113243a98925909cdb7b26284cbb4d835a18c")
  .subscribe(console.log);
const subscription2 = eventStore
  .model(ProfileModel, "621233a1ad1b91620f0b4a308c2113243a98925909cdb7b26284cbb4d835a18c")
  .subscribe(console.log);

// Both subscriptions will receive the same data
// Only one actual subscription is created internally

// Always unsubscribe when done
subscription1.unsubscribe();
subscription2.unsubscribe();
```

## Combining Models with RxJS Operators

Since models return RxJS observables, you can use operators to transform the data:

```typescript
import { map, filter } from "rxjs/operators";

// Only get profiles that have names
eventStore
  .model(ProfileModel, pubkey)
  .pipe(
    filter((profile) => profile && profile.name),
    map((profile) => profile.name.toUpperCase()),
  )
  .subscribe((name) => {
    console.log("Profile name in caps:", name);
  });

// Get timeline length
eventStore
  .model(TimelineModel, { kinds: [1] })
  .pipe(map((timeline) => timeline.length))
  .subscribe((count) => {
    console.log("Timeline has", count, "notes");
  });
```

## Other Useful Models

### MailboxesModel

Gets a user's inbox and outbox relays from their relay list (kind 10002):

```typescript
import { MailboxesModel } from "applesauce-core/models";

eventStore.model(MailboxesModel, pubkey).subscribe((mailboxes) => {
  if (mailboxes) {
    console.log("Outbox relays:", mailboxes.outboxes);
    console.log("Inbox relays:", mailboxes.inboxes);
  }
});
```

### RepliesModel

Gets all replies to a specific event:

```typescript
import { RepliesModel } from "applesauce-core/models";

const noteId = "abc123...";

eventStore.model(RepliesModel, noteId).subscribe((replies) => {
  console.log(`Found ${replies.length} replies to note ${noteId}`);

  replies.forEach((reply) => {
    console.log(`- ${reply.content.slice(0, 50)}...`);
  });
});
```

### ContactsModel

Gets a user's contact list (kind 3):

```typescript
import { ContactsModel } from "applesauce-core/models";

eventStore.model(ContactsModel, pubkey).subscribe((contacts) => {
  if (contacts) {
    console.log("Following", contacts.length, "people:");
    contacts.forEach((contact) => {
      console.log(`- ${contact.pubkey.slice(0, 8)}`);
    });
  }
});
```

## Working with Multiple Models

You can combine multiple models using the `combineLatest` operator from RxJS to build complex views:

```typescript
import { combineLatest } from "rxjs";

const pubkey = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";

// Combine profile and timeline data
combineLatest([
  eventStore.model(ProfileModel, pubkey),
  eventStore.model(TimelineModel, { kinds: [1], authors: [pubkey] }),
]).subscribe(([profile, timeline]) => {
  const name = profile?.name || "Unknown";
  const noteCount = timeline.length;

  console.log(`${name} has posted ${noteCount} notes`);
});
```

## Missing Event Handling

Models handle missing events gracefully and typically return `undefined` when events aren't available:

```typescript
eventStore.model(ProfileModel, "nonexistent-pubkey").subscribe((profile) => {
  if (profile === undefined) {
    console.log("Profile not found or still loading");
  } else {
    console.log("Profile loaded:", profile);
  }
});
```

## Model Performance

Models are designed for performance:

- **Cached** - Models with the same parameters are reused
- **Lazy** - Only created when subscribed to
- **Efficient** - Use internal EventStore subscriptions
- **Memory-safe** - Automatically cleaned up when no subscribers

```typescript
// This is efficient - only one ProfileModel created
const model = eventStore.model(ProfileModel, pubkey);

const sub1 = model.subscribe(handleProfile1);
const sub2 = model.subscribe(handleProfile2);
const sub3 = model.subscribe(handleProfile3);

// Clean up all subscriptions
sub1.unsubscribe();
sub2.unsubscribe();
sub3.unsubscribe();
```

## Key Concepts

- **Models transform raw events** into useful data structures
- **Use `eventStore.model()`** to create model subscriptions
- **Models return observables** - can be used with RxJS operators
- **Models handle parsing** - no need to use helper methods manually
- **Models are reactive** - automatically update when events change

## Example: React user profile

For React applications, you can use the `useObservableMemo` hook from `applesauce-react` to easily integrate models:

```tsx
import React from "react";
import { useObservableMemo } from "applesauce-react/hooks";
import { ProfileModel, TimelineModel } from "applesauce-core/models";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";

function UserProfile({ pubkey }: { pubkey: string }) {
  // Create a new model for the user's profile and subscribe to it
  const profile = useObservableMemo(() => eventStore.model(ProfileModel, pubkey), [pubkey]);

  // Create a new model for the user's notes and subscribe to it
  const timeline = useObservableMemo(
    () => eventStore.model(TimelineModel, { kinds: [1], authors: [pubkey] }),
    [pubkey],
  );

  const displayName = getDisplayName(profile, pubkey.slice(0, 8) + "...");
  const avatar = getProfilePicture(profile, `https://robohash.org/${pubkey}.png`);

  return (
    <div className="user-profile">
      <header>
        <img src={avatar} alt={displayName} />
        <h1>{displayName}</h1>
        {profile?.about && <p>{profile.about}</p>}
      </header>

      <main>
        <h2>Notes ({timeline?.length || 0})</h2>
        {timeline?.map((note) => (
          <article key={note.id}>
            <p>{note.content}</p>
            <time>{new Date(note.created_at * 1000).toLocaleString()}</time>
          </article>
        ))}
      </main>
    </div>
  );
}
```
