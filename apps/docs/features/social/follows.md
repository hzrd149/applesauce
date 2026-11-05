---
description: Read a user's follows, follow and unfollow users, and manage follow sets
---

# Follows

A user's follows live in their contact list, a kind 3 replaceable event with one `p` tag per followed pubkey. Follow sets are separate named lists (kind 30000) for grouping people, like "devs" or "friends".

## Reading follows

`user.contacts$` returns the followed users as `User` casts, so you can chain straight into each contact's profile or relays.

```tsx
function ContactList({ user }: { user: User }) {
  const contacts = use$(user.contacts$);

  return contacts?.map((contact) => <ContactRow key={contact.pubkey} user={contact} />);
}

function ContactRow({ user }: { user: User }) {
  const name = use$(user.profile$.displayName);
  return <div>{name ?? user.npub}</div>;
}
```

`contacts$` waits for the user's outboxes and loads the contact list from them. It emits an empty array when the user has no contact list.

**Example:** [Contact Manager](https://applesauce.build/examples/#/example/contacts/manager)

## Subscribing without casts

`eventStore.contacts()` returns `ProfilePointer[]` instead of users. It is a shortcut for `ContactsModel` from `applesauce-core/models`.

```ts
eventStore.contacts(pubkey).subscribe((pointers) => console.log(pointers.length));
```

`PublicContactsModel` and `HiddenContactsModel` return only the public or only the encrypted contacts.

## Following and unfollowing

`FollowUser` and `UnfollowUser` add or remove a `p` tag on the current user's contact list and publish it to their outboxes. Both accept a pubkey or a `ProfilePointer`, and `FollowUser` creates the list if none exists.

```ts
await actions.run(FollowUser, pubkey);
await actions.run(UnfollowUser, { pubkey, relays: ["wss://relay.example.com"] });
```

`NewContacts` creates a contact list from an array of pubkeys and throws if one already exists. See [ActionRunner](/apps/actions/action-runner) for setup.

## Building contact lists

`ContactsFactory` from `applesauce-common/factories` builds kind 3 events. `addContact()` takes an optional petname, and `removeContact()` drops a pubkey.

```ts
const signed = await ContactsFactory.modify(event).addContact(friend, "alice").removeContact(spammer).sign(signer);
```

## Follow sets

Follow sets are addressable lists identified by their `d` tag. They can hold public and hidden (encrypted) users.

```ts
await actions.run(CreateFollowSet, "Devs", { description: "People building on nostr", public: [alice, bob] });
await actions.run(AddUserToFollowSet, carol, "devs-identifier", true); // hidden
await actions.run(RemoveUserFromFollowSet, bob, "devs-identifier");
await actions.run(UpdateFollowSetInformation, "devs-identifier", { title: "Builders" });
```

The set actions take either the `d` identifier or the set event itself. Use `FollowSetFactory` to build sets directly, and `getProfilePointersFromList(event)` from `applesauce-common/helpers` to read the users in one.

## Helpers

Helpers in `applesauce-core/helpers` work on raw contact list events:

- `getContacts(event)` returns public and unlocked hidden contacts merged
- `getPublicContacts(event)` and `getHiddenContacts(event)` return one group each
- `unlockHiddenContacts(event, signer)` decrypts hidden contacts
- `getRelaysFromContactsEvent(event)` reads the legacy relay map some clients store in the content

## Best Practices

- Use `FollowUser` and `UnfollowUser` instead of rebuilding the list, so follows added by other clients aren't lost
- Make sure the contact list has loaded before following, since a missing list is treated as empty
- Render contacts from `user.contacts$` so each row can subscribe to its own profile
- Use follow sets for grouping people instead of extra contact lists
