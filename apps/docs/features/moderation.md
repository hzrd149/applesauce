---
description: Mute users, threads, words, and hashtags, and read reports
---

# Mutes & Reports

A mute list (kind 10000) holds the users, threads, words, and hashtags a user doesn't want to see. Entries can be public or hidden, where hidden entries are encrypted to the user. Reports (kind 1984) flag a user or event to others with a reason like spam or impersonation.

## Reading mutes

`user.mutes$` loads the user's mute list from their outboxes and casts it to `Mutes`. The public entries are `Set`s.

```ts
const mutes = use$(user.mutes$);

mutes?.pubkeys.has(pubkey);
mutes?.threads; // muted root event ids
mutes?.hashtags; // lowercase
mutes?.words; // lowercase
```

**Example:** [Mutes Manager](https://applesauce.build/examples/#/example/mutes/manager)

## Unlocking hidden mutes

Hidden mutes stay encrypted until the user's signer decrypts them. `hidden$` emits once they are unlocked, and every subscriber updates automatically.

```ts
if (mutes.hasHidden && !mutes.unlocked) await mutes.unlock(signer);

const hidden = use$(mutes.hidden$); // MutedThings, same shape as the public sets
```

Use [encrypted content caching](/apps/encryption/caching) to keep the decrypted entries across reloads so the user isn't prompted every time.

## Filtering muted content

`eventStore.mutes()` returns the public and unlocked hidden mutes merged into one `MutedThings` object. Pass it to `matchMutes(mutes, event)`, which returns `true` when an event should be hidden.

```ts
const notes$ = combineLatest([eventStore.timeline({ kinds: [1] }), eventStore.mutes(pubkey)]).pipe(
  map(([notes, mutes]) => (mutes ? notes.filter((e) => !matchMutes(mutes, e)) : notes)),
);
```

`eventStore.mutes()` is added by `applesauce-common`, so import that package before calling it. The same data is available as `MuteModel`, with `PublicMuteModel` and `HiddenMuteModel` for each half.

## Muting and unmuting

Mute actions update the current user's mute list and publish it to their outboxes. Pass `true` as the last argument to add or remove a hidden entry.

```ts
await actions.run(MuteUser, pubkey);
await actions.run(MuteThread, rootEvent, true);
await actions.run(MuteWord, "spoiler");
await actions.run(UnmuteHashtag, "nsfw");
```

The full set is `MuteUser`/`UnmuteUser`, `MuteThread`/`UnmuteThread`, `MuteWord`/`UnmuteWord`, and `MuteHashtag`/`UnmuteHashtag`. Use `MuteListFactory` from `applesauce-common/factories` to build mute lists directly.

## Reading reports

The `Report` cast reads a report as either a user report or an event report.

```ts
const reports = use$(
  () => eventStore.timeline({ kinds: [1984], "#p": [pubkey] }).pipe(castTimelineStream(Report, eventStore)),
  [pubkey],
);

report.reason; // ReportReason, e.g. "spam"
report.comment;
report.reportedUser; // User
const reported = use$(report.reportedEvent$); // only for event reports
```

`isUserReport` and `isEventReport` tell the two apart, and `blobs` and `servers` list reported media. The `getReported(event)` helper returns the same data from a raw event.

## Best Practices

- Filter with `eventStore.mutes()` so hidden mutes apply as soon as they are unlocked
- Offer hidden mutes for words and users the user doesn't want to reveal publicly
- Treat reports as signals from the reporter, and only act on reports from users the viewer trusts
- Unlock hidden mutes only after a user action, since it may prompt the signer
