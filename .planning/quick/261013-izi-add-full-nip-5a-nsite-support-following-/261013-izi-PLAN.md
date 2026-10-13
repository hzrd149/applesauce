---
mode: quick
---
# Add full NIP-5A nsite support

Execute inline under the skill's spawn restriction. Use the current NIP-5A specification and NIP-5D napplet APIs as the design reference.

1. Add `packages/common/src/helpers/nsite.ts`, `operations/nsite.ts`, and `factories/nsite.ts` with root/named/snapshot guards, cached manifest parsing, aggregate hashing, path and host resolution, app pointers, and copy/snapshot lineage; export the modules and add a minor changeset.
2. Add `packages/common/src/models/nsite.ts` and `casts/nsite.ts` with reactive user sites, snapshots, copies, lineage, app manifests, Blossom servers, and social relationships; augment User and Profile casts and export the modules.
3. Add focused suites under each layer's `__tests__`, update export snapshots, run `pnpm --filter applesauce-common test` and the common package build, and commit the implementation atomically before recording completion in STATE.md.
