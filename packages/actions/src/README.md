# Applesauce Actions

`applesauce-actions` is a package that contains common "actions" that a nostr app might take

## Install

```sh
npm install applesauce-actions
```

## Example

```js
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core";
import { PrivateKeySigner } from "applesauce-signers";
import { ActionHub, Actions } from "applesauce-actions";

const user = new PrivateKeySigner();
const events = new EventStore();
const factory = new EventFactory({ signer: user });

const publish = async (event) => {
  // manually handle publishing
  await customRelayPool.publish(event);
};

// create a new action hub that combines the event store, factory, and publish
const hub = new ActionHub(events, factory, publish);

// load events into event store
const contacts = await loadUserContactEvent(user);

// add the kind 3 event to the store
// The following FollowUser action will fail if it cant find the contacts event
events.add(contacts);

// modify the contacts event by running an action
await hub.run(
  Actions.FollowUser,
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  "wss://pyramid.fiatjaf.com/",
);

// This will update the contacts event, and call publish with the new signed event
```
