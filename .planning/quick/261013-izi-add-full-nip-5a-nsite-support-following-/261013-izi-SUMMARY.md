---
status: complete
quick_id: 261013-izi
---
# NIP-5A nsite support

Implemented against https://github.com/nostr-protocol/nips/blob/master/5A.md, following the NIP-5D napplet APIs. Executed inline under the skill's spawn restriction.

- Added root, named and snapshot event types and guards, cached file/server/app parsing, lineage pointers, aggregate hashing and verification, canonical DNS labels and URLs, and path resolution.
- Added composable metadata/file/app/server/lineage operations and NsiteFactory creation, modification, copy and snapshot flows.
- Added reactive lookup, user, snapshot, copy, lineage, app and hash models; Nsite, RootNsite, NamedNsite and NsiteSnapshot casts; User/Profile accessors and reverse app relationships on existing EventCast classes.
- App discovery filters locally because NIP-01 indexes only single-letter tags.
- Added 52 focused tests, updated export snapshots, existing factory documentation and the supported NIP list, and a single-sentence minor changeset.

Implementation commit: `9624cdeb`.

Validation: `pnpm --filter applesauce-common test` passed 641 tests; `pnpm test` built all 13 packages and passed 2,397 tests, with two skipped tests. `git diff --check` passed. Documentation updates use an existing navigable page, so no navigation changes or new documentation files were needed.

The unrelated edit to `apps/examples/src/components/relay-picker.tsx` was left untouched and excluded from commits.
