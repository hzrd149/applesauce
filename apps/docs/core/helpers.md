# Helpers

`applesauce-core` and other packages export helper methods for working with events.

> [!WARNING]
> Some helper methods may throw errors. make sure your app can handle errors correctly.

## Core helpers

The [`applesauce-core`](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-core.Helpers.html) package contains the majority of the helper methods

### Events

- [`isEvent`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isEvent.html) Checks if an object is a nostr event
- [`markFromCache`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.markFromCache.html) Marks an event as being from the cache
- [`isFromCache`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isFromCache.html) Checks if an event is marked from cache
- [`getTagValue`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getTagValue.html) Gets the value of the first tag matching the name
- [`getIndexableTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getIndexableTags.html) Get a `Set` of all indexable tags on the event

### Profiles

- [`getProfileContent`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getProfileContent.html) Returns the parsed profile content for a kind 0 event
- [`isValidProfile`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isValidProfile.html) Checks if the content of the kind 0 event is valid JSON

### Mailboxes

- [`getInboxes`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getInboxes.html) Gets the inbox relays from a `10002` event
- [`getOutboxes`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getOutboxes.html) Gets the outbox relays from a `10002` event

### Comments

- [`getCommentRootPointer`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getCommentRootPointer.html) Get the root pointer for a NIP-22 comment
- [`getCommentReplyPointer`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getCommentReplyPointer.html) Get the reply pointer for a NIP-22 comment

### Event relays

- [`addSeenRelay`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.addSeenRelay.html) Adds a relay to the list of relay the event was seen on
- [`getSeenRelays`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getSeenRelays.html) Get the list of relays this event was seen on

### Zaps

- [`isValidZap`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isValidZap.html) Checks if an event is a valid zap and can be parsed
- [`getZapSender`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getZapSender.html) Gets the senders pubkey
- [`getZapRecipient`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getZapRecipient.html) Gets the pubkey of the user who received the zap
- [`getZapPayment`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getZapPayment.html) Gets the parsed bolt11 invoice
- [`getZapAddressPointer`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getZapAddressPointer.html) Gets the address pointer of the zap
- [`getZapEventPointer`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getZapEventPointer.html) Gets the event pointer of the zap
- [`getZapRequest`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getZapRequest.html) Gets the zap request event inside the zap event

### Lightning

- [`parseBolt11`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.parseBolt11.html) Parses a bolt11 lightning invoice
- [`parseLNURLOrAddress`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.parseLNURLOrAddress.html) Parses a LNURL or lightning address into a LNURLp

### Pointers

- [`getEventPointerFromETag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getEventPointerFromETag.html) Creates an `EventPointer` from a standard "e" tag
- [`getEventPointerFromQTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getEventPointerFromQTag.html) Creates an `EventPointer` from a standard "q" tag
- [`getAddressPointerFromATag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getAddressPointerFromATag.html) Creates an `AddressPointer` from a standard "a" tag
- [`getProfilePointerFromPTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getProfilePointerFromPTag.html) Creates an `ProfilePointer` from a standard "p" tag
- [`getAddressPointerForEvent`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getAddressPointerForEvent.html) Returns an `AddressPointer` for a replaceable event

### Delete events

- [`getDeleteIds`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getDeleteIds.html) Gets a list of referenced event ids
- [`getDeleteCoordinates`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getDeleteCoordinates.html) Get the list of replaceable event coordinates the event is referencing

### Emojis

- [`getPackName`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getPackName.html) Gets the emoji pack name
- [`getEmojis`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getEmojis.html) Get all emojis in an emoji pack
- [`getEmojiTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getEmojiTag.html) CGets an "emoji" tag that matches an emoji code

### URLs

- [`getURLFilename`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getURLFilename.html) returns the filename part fo the path in a URL
- [`isAudioURL`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isAudioURL.html) Checks if the URL ends with a audio file extension
- [`isVideoURL`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isVideoURL.html) Checks if the URL ends with a video file extension
- [`isImageURL`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isImageURL.html) Checks if the URL ends with a image file extension
- [`isStreamURL`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isStreamURL.html) Checks if the URL ends with a stream file extension

### Tags

- [`isETag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isETag.html) Checks if tag is an "e" tag and has at least one value
- [`isATag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isATag.html) Checks if tag is an "a" tag and has at least one value
- [`isPTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isPTag.html) Checks if tag is an "p" tag and has at least one value
- [`isDTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isDTag.html) Checks if tag is an "d" tag and has at least one value
- [`isRTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isRTag.html) Checks if tag is an "r" tag and has at least one value
- [`isTTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isTTag.html) Checks if tag is an "t" tag and has at least one value

### Hidden Tags

Hidden tags are used in [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md) lists and [NIP-60](https://github.com/nostr-protocol/nips/blob/master/60.md) wallets

- [`canHaveHiddenTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.canHaveHiddenTags.html) Checks if a given event kind can have hidden tags
- [`hasHiddenTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.hasHiddenTags.html) Checks if an event has hidden tags
- [`getHiddenTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.getHiddenTags.html) Returns the hidden tags for an event if they are unlocked
- [`isHiddenTagsUnlocked`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isHiddenTagsUnlocked.html) Checks if the hidden tags are locked
- [`unlockHiddenTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.unlockHiddenTags.html) Unlocks the hidden tags using a `signer`
- [`modifyEventTags`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.modifyEventTags.html) Modifies an events public or hidden tags

### Filters

- [`isFilterEqual`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.isFilterEqual.html) Check if two filters are equal

### Time

- [`unixNow`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.unixNow.html) Returns the current unix timestamp

## Factory Helpers

The [`applesauce-core`](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-core.Helpers.html) package exports some helpers for building events and tags

Some of the most useful ones are

- [`fillAndTrimTag`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.fillAndTrimTag.html) Replaces `undefined` or `null` in tags with `""` and trims to tag down to a set length if it ends with `""`
- [`createQTagFromEventPointer`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.createQTagFromEventPointer.html) Creates a `"q"` tag for from an `EventPointer` to tag quoted events
- [`createPTagFromProfilePointer`](https://hzrd149.github.io/applesauce/typedoc/functions/applesauce-core.Helpers.createPTagFromProfilePointer.html) Creates a `"p"` tag for from a `ProfilePointer` to tag mentioned pubkeys
