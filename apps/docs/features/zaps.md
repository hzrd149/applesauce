---
description: Read zap receipts, send zaps, and track zap goals
---

# Zaps

Zaps are lightning payments attached to Nostr events or profiles (NIP-57). The sender signs a kind 9734 zap request, the recipient's lightning service pays it out as an invoice, and once paid the service publishes a kind 9735 zap receipt. For ecash zaps, see [nutzaps](/money/wallet/package).

## Reading zaps

The `Zap` cast reads a zap receipt. `Note`, `Comment`, `Stream`, and `Torrent` casts expose an event's zaps as `zaps$`, and invalid receipts are dropped.

```ts
const zaps = use$(note.zaps$);

zap.sender; // User who paid
zap.recipient; // User who was paid
zap.amount; // millisats
zap.request; // the kind 9734 zap request, whose content is the message
const target = use$(zap.event$);
```

`zap.payment` is the parsed bolt11 invoice, and `zap.preimage` is the payment preimage when the service includes it.

## Loading zaps

`EventZapsModel(event)` returns the valid zaps for an event or pointer in the store. `SentZapsModel(pubkey)` and `ReceivedZapsModel(pubkey)` return a user's zaps.

```ts
const received = use$(() => store.model(ReceivedZapsModel, pubkey).pipe(castTimelineStream(Zap, store)), [pubkey]);
```

Fetch an event's zaps from relays with the [zaps loader](/loading/loaders/zaps-loader).

## Sending a zap

Build the zap request with `ZapRequestFactory`, then send it to the recipient's LNURL callback for an invoice. `parseLNURLOrAddress()` turns a lightning address or LNURL into the URL that returns the callback.

```ts
const lnurlp = await fetch(parseLNURLOrAddress(profile.lightningAddress)!).then((r) => r.json());
const request = await ZapRequestFactory.event(note.event, amount, relays).message("🔥").sign(signer);

const callback = new URL(lnurlp.callback);
callback.searchParams.set("amount", String(amount));
callback.searchParams.set("nostr", JSON.stringify(request));
const invoice = await getInvoice(callback); // throws if the amount doesn't match
```

Use `ZapRequestFactory.profile(pubkey, amount, relays)` to zap a profile instead of an event. Pay the invoice with any lightning wallet.

## Splitting zaps

`NoteFactory`, `ShareFactory`, `ZapGoalFactory`, and a few others have `.zapSplit()`, which asks zappers to divide a payment between pubkeys by weight. `getZapSplits(event)` reads them back with each pubkey's percentage.

```ts
const splits = [
  { pubkey: alice, weight: 1 },
  { pubkey: bob, weight: 2 },
];
const note = await NoteFactory.create("collab").zapSplit({ splits }).sign(signer);
```

## Zap goals

Zap goals are kind 9041 fundraising targets (NIP-75). The `ZapGoal` cast reads the target and tallies the zaps toward it.

```ts
const goal = use$(() => store.event(pointer).pipe(castEventStream(ZapGoal, store)), [pointer.id]);
const progress = use$(goal?.progress$); // { total, target, percentage, remaining }
```

`goal.amount` is the target in millisats, `goal.relays` lists where to find zaps, and `goal.closedAt` is when the goal stops counting. `goal.zaps$` returns raw zap events rather than `Zap` casts. `UserGoalsModel`, `GoalZapsModel`, and `GoalProgressModel` give the same data without a cast.

Create a goal with `ZapGoalFactory.create(description, amount, relays)`, then chain `.summary()`, `.image()`, `.closedAt()`, or `.beneficiaries()`.

## Helpers

- `isValidZap(event)` checks that a receipt has a valid request, sender, recipient, and invoice, but not who signed it
- `getZapSender`, `getZapRecipient`, `getZapAmount`, `getZapPayment`, `getZapRequest`, and `getZapPreimage` read a receipt
- `getZapEventPointer` and `getZapAddressPointer` return the zapped event or address
- `parseBolt11(invoice)` returns the amount, description, expiry, and payment hash of an invoice
- `parseLightningAddress`, `decodeLNURL`, and `parseLNURLOrAddress` return the LNURL pay URL

**Example:** [Zap modal](https://applesauce.build/examples/#/example/zap/zap-modal)

## Best Practices

- Check `allowsNostr` and `nostrPubkey` on the LNURL response before sending a zap request
- Read zap amounts from `zap.amount`, which comes from the paid invoice, not the request's `amount` tag
- Compare the receipt's author to the recipient's LNURL `nostrPubkey` when amounts matter, since anyone can publish a receipt
- Divide millisats by 1000 to display sats
