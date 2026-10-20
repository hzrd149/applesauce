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

The `Report` cast exposes all explicitly reported targets through `targets`, preserving each target's reason. `reportedUsers`, `reportedEventPointers`, and `reportedEvents$` resolve multiple targets; event pointers also include the containing events of blob reports.

```ts
const reports = use$(() => castUser(pubkey, eventStore).reports$, [pubkey]);
const sent = use$(() => castUser(pubkey, eventStore).reportsSent$, [pubkey]);

report.targets; // { type: "user" | "event" | "blob", value, reason }[]
report.isBlobReport;
report.comment;
report.servers; // Supplied media server or direct file URLs
const events = use$(report.reportedEvents$);
```

`Note.reports$` returns reports referencing that note. These streams query the store; load kind 1984 events separately and add incoming events to the same store. User reports include reports of the user's events, since NIP-56 requires the author's `p` tag.

The existing `reported`, `reason`, `reportedUser`, and `reportedEvent$` getters retain their single-target view. Use `targets` for reports with multiple reasons. `getReportTargets(event)` parses raw events, and `isValidReport(event)` checks the kind, identities, standard reasons, and required context before casting. Invalid reports are excluded from the user and note relationships.

## Creating reports

`ReportFactory` creates kind 1984 events and automatically includes the author when reporting an event or blob. Report reasons occupy the third tag entry; relay hints must not be placed there.

```ts
const factory = ReportFactory.create(pubkey, ReportReason.spam).content("Repeated spam");
const eventReport = ReportFactory.create(note, ReportReason.illegal);
const blobReport = ReportFactory.blob(hash, note, ReportReason.malware).server(
  "https://media.example.com/path/file.jpg",
);

const signed = await factory.sign(signer);
```

Use `reportUser`, `reportEvent`, or `reportBlob` to add targets or update their reasons. `ReportFactory.modify(report)` preserves existing content and unrelated tags. `removeTarget(type, value)` removes matching tags, so preserve the required author and event context when removing targets. Reports are regular events; signing a modified report creates a new event rather than replacing the original.

The corresponding `addReportUser`, `addReportEvent`, `addReportBlob`, `removeReportTarget`, `addReportServer`, and `removeReportServer` operations are exported from `applesauce-common/operations` for custom pipelines.

## Integration

The report actions sign and publish through the existing `ActionRunner`:

```ts
await actions.run(ReportUser, pubkey, ReportReason.spam, "Repeated spam");
await actions.run(ReportEvent, note, ReportReason.illegal);
await actions.run(ReportBlob, hash, note, ReportReason.malware, "Unsafe file", [mediaUrl]);
```

Import the actions from `applesauce-actions/actions`, `ReportFactory` from `applesauce-common/factories`, and `ReportReason` from `applesauce-common/helpers`. Actions publish to the reporter's NIP-65 outboxes and leave relay selection to the publisher when no outboxes are available. They do not send reports to the reported user's inboxes. The runner adds signed reports to its store, updating cast relationships.

## Best Practices

- Filter with `eventStore.mutes()` so hidden mutes apply as soon as they are unlocked
- Offer hidden mutes for words and users the user doesn't want to reveal publicly
- Treat reports as signals from the reporter, and only act on reports from users the viewer trusts
- Unlock hidden mutes only after a user action, since it may prompt the signer
