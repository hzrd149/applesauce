---
description: Read, display, and update user profile metadata
---

# Profiles

A profile is a user's public metadata: name, picture, bio, lightning address, and similar fields. It is stored as JSON in a kind 0 replaceable event, so only the newest one counts.

## Reading a profile

`user.profile$` loads the user's profile and casts it to a `Profile`. The cast reads fields from the parsed JSON and fills in common fallbacks.

```ts
const user = castUser(pubkey, eventStore);
const profile = use$(user.profile$);

profile?.displayName; // display_name, then name
profile?.picture; // picture, then the deprecated image field
profile?.lightningAddress; // lud16, then lud06
```

The cast also exposes `name`, `about`, `banner`, `website`, `dnsIdentity` (the NIP-05 identifier), `bot`, `birthday`, `languages`, `hashtags`, and the raw parsed `metadata`. `pictureMetadata` and `bannerMetadata` return the matching `imeta` attachment when the event has one.

Chain into the observable when you only need one field:

```ts
const name = use$(note.author.profile$.displayName);
const name = await user.profile$.displayName.$first(3000, "Anonymous");
```

**Example:** [Profile Editor](https://applesauce.build/examples/#/example/simple/profile-editor)

## Subscribing without casts

`eventStore.profile()` returns the parsed `ProfileContent` object instead of a cast. It is a shortcut for `ProfileModel`, and both accept a pubkey or a `ProfilePointer`.

```ts
eventStore.profile(pubkey).subscribe((content) => console.log(content?.name));
eventStore.model(ProfileModel, { pubkey, relays }).subscribe(render);
```

Profiles missing from the store are requested through the store's event loader, so wire an [address loader](/loading/loaders/address-loader) or the [unified loader](/loading/loaders/unified-loader) to load them from relays.

## Updating a profile

The `UpdateProfile` action merges the given fields into the current user's profile and publishes it to their outboxes. `CreateProfile` publishes a new profile and throws if one already exists.

```ts
await actions.run(UpdateProfile, { name: "alice", about: "nostr dev" });
await actions.run(CreateProfile, { name: "alice", picture: "https://..." });
```

`UpdateProfile` throws when no profile can be found, so it never overwrites a profile that hasn't loaded yet. See [ActionRunner](/apps/actions/action-runner) for setup.

## Building profile events

`ProfileFactory` from `applesauce-core/factories` builds kind 0 events directly. `update()` merges fields, `override()` replaces the whole object, and setters like `name()`, `about()`, `picture()`, `nip05()`, and `lightningAddress()` set single fields.

```ts
const draft = await ProfileFactory.modify(profile.event).about("new bio").picture(url).sign(signer);
const fresh = await ProfileFactory.create().override({ name: "bob" }).sign(signer);
```

## Helpers

Helpers in `applesauce-core/helpers` work on raw events:

- `getProfileContent(event)` parses and caches the JSON content, returning `undefined` for invalid JSON
- `isValidProfile(event)` checks that the event is a kind 0 with valid JSON content
- `getDisplayName(profile, fallback?)` returns `display_name`, `name`, or the fallback; passing an event falls back to a shortened npub
- `getProfilePicture(profile, fallback?)` returns `picture` or `image`, or the fallback

```ts
if (isValidProfile(event)) {
  const name = getDisplayName(event);
  const avatar = getProfilePicture(event, `https://robohash.org/${event.pubkey}`);
}
```

## Best Practices

- Use `profile.displayName` or `getDisplayName` rather than reading `name` directly, since many profiles only set one of the fields
- Always pass a fallback picture, since many profiles have none
- Use `UpdateProfile` for edits so fields you don't change are preserved
- Use `user.profile$` in UI and `eventStore.profile()` when you only need the plain JSON
