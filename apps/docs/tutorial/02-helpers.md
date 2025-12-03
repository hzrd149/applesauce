# 2. Using Helper Methods

Helper methods are the Swiss Army knife of applesauce. They extract useful information from raw Nostr events, making it easy to display user profiles, parse content, and work with different event types.

## What are Helpers?

Helpers are utility functions that:

- **Parse event content** - Extract structured data from JSON or text
- **Handle different event types** - Kind 0 profiles, kind 1 notes, kind 3 contacts, etc.
- **Provide fallbacks** - Return sensible defaults when data is missing
- **Validate data** - Ensure the extracted data is properly formatted

## Essential Profile Helpers

Let's start with the most commonly used helpers for working with user profiles.

### Getting Profile Content

The `getProfileContent` helper extracts and parses a user's profile from a kind 0 event:

```typescript
import { getProfileContent } from "applesauce-core/helpers";

// A raw kind 0 profile event
const profileEvent = {
  content:
    '{"name":"fiatjaf","about":"~","picture":"https://fiatjaf.com/static/favicon.jpg","nip05":"_@fiatjaf.com","lud16":"fiatjaf@zbd.gg","website":"https://nostr.technology"}',
  created_at: 1738588530,
  id: "c43be8b4634298e97dde3020a5e6aeec37d7f5a4b0259705f496e81a550c8f8b",
  kind: 0,
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  relays: [""],
  sig: "202a1bf6a58943d660c1891662dbdda142aa8e5bca9d4a3cb03cde816ad3bdda6f4ec3b880671506c2820285b32218a0afdec2d172de9694d83972190ab4f9da",
  tags: [],
};

// Extract the profile content
const profile = getProfileContent(profileEvent);

console.log(profile);
// Output:
// {
//   name: "fiatjaf",
//   about: "~",
//   picture: "https://fiatjaf.com/static/favicon.jpg",
//   nip05: "_@fiatjaf.com",
//   lud16: "fiatjaf@zbd.gg",
//   website: "https://nostr.technology",
// }
```

If the profile content is invalid JSON or missing, `getProfileContent` returns `undefined` rather than throwing an error.

### Getting Display Names

The `getDisplayName` helper provides a user-friendly name with intelligent fallbacks:

```typescript
import { getDisplayName } from "applesauce-core/helpers";

// Profile with a name
const profile1 = { name: "Alice", display_name: "Alice in Nostrland" };
console.log(getDisplayName(profile1)); // "Alice in Nostrland"

// Profile with only a name
const profile2 = { name: "Bob" };
console.log(getDisplayName(profile2)); // "Bob"

// Profile with no name
const profile3 = { about: "Just a user" };
console.log(getDisplayName(profile3)); // "Unknown"

// Can also pass a pubkey as fallback
console.log(getDisplayName(profile3, "npub1...")); // "npub1..."
```

The helper checks for names in this order:

1. `display_name` field
2. `name` field
3. Provided fallback
4. "Unknown"

### Getting Profile Pictures

Similar to display names, `getProfilePicture` provides intelligent fallbacks for profile images:

```typescript
import { getProfilePicture } from "applesauce-core/helpers";

// Profile with picture
const profile1 = { picture: "https://example.com/alice.jpg" };
console.log(getProfilePicture(profile1)); // "https://example.com/alice.jpg"

// Profile without picture - provide fallback
const profile2 = { name: "Bob" };
const fallbackUrl = "https://robohash.org/bob.png";
console.log(getProfilePicture(profile2, fallbackUrl)); // "https://robohash.org/bob.png"
```

## Putting It Together: Profile Component

Let's create a React component that uses these helpers:

```tsx
import React from "react";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";

function ProfileCard({ profile }: { profile: NostrEvent }) {
  // Get the profile content
  const content = getProfileContent(profile);

  // Get display name with pubkey fallback
  const displayName = getDisplayName(content, profile.pubkey.slice(0, 8) + "...");

  // Get profile picture with robohash fallback
  const profilePicture = getProfilePicture(content, `https://robohash.org/${profile.pubkey}.png`);

  return (
    <div className="profile-card">
      <img src={profilePicture} alt={displayName} className="profile-avatar" />
      <h3>{displayName}</h3>
      {content?.about && <p>{content.about}</p>}
    </div>
  );
}
```

## Other Useful Helpers

There are many more helpers available. Checkout the [typedocs](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-core.Helpers.html#addrelayhintstopointer) to see all the helpers.

Here are some commonly used ones:

### Content Helpers

```typescript
import { getArticleTitle, getArticleSummary, getHashtags, getMentions } from "applesauce-core/helpers";

// Extract article title from long-form content (kind 30023)
const title = getArticleTitle(articleEvent);

// Get the users in a NIP-51 user list
const people = getEventPointersFromList(listEvent); // [{pubkey: "pubkey1"}, {pubkey: "pubkey2"}]

// Get outbox relays from a kind 10002 relay list event
const outboxes = getOutboxes(relayListEvent);
// ["wss://relay1.com", "wss://relay2.com"]

// Get inbox relays
const inboxes = getInboxes(relayListEvent);
// ["wss://inbox1.com", "wss://inbox2.com"]
```

## Key Concepts

- **Helpers parse raw events** into usable data
- **Fallbacks** prevent your UI from breaking
- **Composable** - combine helpers with EventStore subscriptions
- **Type-safe** - TypeScript definitions help catch errors

## Real-World Example

Here's a complete example showing helpers in action:

```typescript
import { EventStore } from "applesauce-core";
import { getProfileContent, getDisplayName, getProfilePicture } from "applesauce-core/helpers";

const eventStore = new EventStore();

function displayUserInfo(pubkey: string) {
  // Get the user's profile from the store
  const profileEvent = eventStore.getReplaceable(0, pubkey);

  if (profileEvent) {
    const profile = getProfileContent(profileEvent);
    const name = getDisplayName(profile, pubkey.slice(0, 8) + "...");
    const picture = getProfilePicture(profile, `https://robohash.org/${pubkey}.png`);

    console.log(`Name: ${name}`);
    console.log(`Picture: ${picture}`);
    console.log(`About: ${profile?.about || "No bio available"}`);
  } else {
    console.log("Profile not found in store");
  }
}
```
