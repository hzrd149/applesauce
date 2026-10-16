---
description: Read and publish with users' inbox and outbox relays
---

# Mailboxes & Outbox

Every user publishes a relay list (NIP-65, kind 10002) naming their **outboxes**, where they write their own events, and their **inboxes**, where they read events that mention them. The outbox model uses these lists to fetch a user's posts from their outboxes and deliver replies and mentions to the recipient's inboxes.

## Reading a user's mailboxes

User casts from `applesauce-common/casts` expose the relay list directly. Each observable is `undefined` until the list loads.

```ts
const outboxes = use$(user.outboxes$);
const inboxes = use$(user.inboxes$);
const mailboxes = use$(user.mailboxes$); // { inboxes, outboxes } | undefined
```

Without casts, use `eventStore.mailboxes(pubkey)` or `store.model(MailboxesModel, pubkey)`, which return the same `{ inboxes, outboxes }` object. `getInboxes(event)` and `getOutboxes(event)` parse a relay list event directly and normalize and deduplicate the URLs.

Relay lists are fetched like any replaceable event. Give the [event loader](/loading/loaders/event-loader) `lookupRelays` so lists can be found for users the app has never seen.

## Publishing with mailboxes

Fetch a user's events from their outboxes, publish your own events to yours, and deliver an event to the inboxes of the people it mentions.

```ts
const outboxes = await user.outboxes$.$first(1000, undefined);
await pool.publish(relaySet(outboxes, fallbackRelays), event);
```

[Actions](/apps/actions/actions) follow this rule for you: most publish to the current user's outboxes, `CreateComment` adds the parent author's inboxes, and `SendLegacyMessage` uses the recipient's inboxes. Pass a fallback relay list to the [ActionRunner](/apps/actions/action-runner) publish method for users without a relay list.

## Editing the relay list

`MailboxesFactory` builds the relay list, and the mailbox actions update the current user's list and publish it.

```ts
await actions.run(AddOutboxRelay, "wss://relay.example.com");
await actions.run(RemoveInboxRelay, "wss://old.example.com");
const list = await MailboxesFactory.create({ inboxes, outboxes }).sign(signer);
```

The actions are `CreateMailboxes`, `AddInboxRelay`, `RemoveInboxRelay`, `AddOutboxRelay`, and `RemoveOutboxRelay`. Adding an outbox publishes to both the old and new outboxes so the change reaches every relay that held the old list.

## Selecting relays for many users

Reading from many users at once means choosing a small set of relays that covers them. These operators work on arrays of `ProfilePointer`s and add, filter, or trim each pointer's `relays`.

```ts
const selection$ = contacts$.pipe(
  includeMailboxes(eventStore), // add each user's outboxes
  ignoreUnhealthyRelaysOnPointers(liveness), // drop failing relays
  includeFallbackRelays(fallbacks), // users with no relays
  filterOptimalRelays(maxConnections, maxRelaysPerUser),
);
const outboxMap$ = selection$.pipe(map(createOutboxMap));
```

`includeMailboxes(store, "inbox")` adds inboxes instead. `selectOptimalRelays(users, { maxConnections, maxRelaysPerUser })` is the plain function behind `filterOptimalRelays`, and `createOutboxMap` (an alias of `groupPubkeysByRelay`) groups the selected users by relay. See [Relay Liveness](/loading/relays/liveness) for setting up the tracker, and `ignoreUnhealthyMailboxes(liveness)` to filter a single `{ inboxes, outboxes }` object.

## Loading from outboxes

An outbox map drives both live subscriptions and paged history. The relay pool adds each relay's `authors` to the filter.

```ts
pool
  .outboxSubscription(outboxMap$, { kinds: [1] })
  .pipe(mapEventsToStore(eventStore))
  .subscribe();

const loader = createOutboxTimelineLoader(pool, outboxMap$, { kinds: [1] }, { eventStore, liveness });
loader(windows$).subscribe();
```

Both accept a changing map, so relays that stay in the selection keep their requests. `outboxSubscription` takes the same options as the pool's [`subscriptionMap`](/loading/relays/pool#subscription-map-method), and the [timeline loader](/loading/loaders/timeline-loader#outbox-maps) page covers the loader options.

**Examples:** [Social Feed](https://applesauce.build/examples/#/example/outbox/social-feed), [Relay Selection](https://applesauce.build/examples/#/example/outbox/relay-selection)

## Best Practices

- Read a user's own posts from their outboxes, not their inboxes
- Deliver replies and mentions to the recipient's inboxes as well as your outboxes
- Filter relays through a liveness tracker before selecting, so dead relays don't take a slot
- Cap `maxRelaysPerUser` to keep one well-connected user from pulling in many relays
- Add fallback relays only after mailboxes load, so they cover just the users without a list
- Share the selection with `shareReplay` so the subscription and loader reuse one computation
