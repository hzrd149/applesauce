---
description: Find, serve, and publish static websites and napplets stored as Nostr manifests
---

# Sites & Napplets

An **nsite** is a static website whose manifest event maps each path to the sha256 of a file stored on Blossom servers (NIP-5A). A **napplet** is a sandboxed app published the same way as a single `index.html` artifact (NIP-5D). Both come in three forms: a root site per user, named sites, and immutable snapshots of either.

## Finding a user's sites

Importing `applesauce-common/casts` adds site observables to user casts. Profile casts expose `nsite$` and `nsites$` for their author.

```ts
const root = use$(user.nsite$); // RootNsite | undefined
const sites = use$(user.nsites$); // root and named sites
const snapshots = use$(user.nsiteSnapshots$);
```

The same lookups are available as models: `RootNsiteModel`, `UserNsitesModel`, `UserNsiteSnapshotsModel`, and `NsiteModel` for a single pointer.

## Serving a site

The `Nsite` cast resolves request paths to files and builds the site's URL on an nsite host. `resolvePath()` falls back to `index.html` for directories and `/404.html` for missing files.

```ts
const site = castEvent(event, NamedNsite, store);
const file = site.resolvePath("/blog/"); // { path: "/blog/index.html", sha256 }
const url = site.url("nsite.run");
const servers = use$(site.servers$);
```

`servers$` lists the manifest's server hints followed by the author's Blossom servers. Check `verifyNsiteAggregateHash(event)` before trusting the advertised aggregate hash; the cast also exposes `aggregateHash` and `computedAggregateHash`.

## Versions and copies

Snapshots freeze a site's files, and copies are new sites that start from an existing one. Root and named casts list both, and every cast can walk back to its source.

```ts
const versions = use$(site.snapshots$);
const copies = use$(site.copies$);
const lineage = use$(site.lineage$); // copies and snapshots that originate here
const parent = use$(snapshot.parent$);
```

`root$` resolves the site a lineage started from. The matching models are `NsiteSnapshotsModel`, `NsiteCopiesModel`, and `NsiteLineageModel`, and `NsitesByHashModel` finds manifests advertising an aggregate hash.

## Publishing a site

`RootNsiteFactory`, `NamedNsiteFactory`, and `NsiteSnapshotFactory` each target one kind. Editing files with `.file()` and `.removeFile()` refreshes the aggregate hash.

```ts
const files = [{ path: "/index.html", sha256: indexHash }];
const site = await NamedNsiteFactory.create("blog", files).title("Blog").sign(signer);
const updated = await NamedNsiteFactory.modify(site).file("/about.html", aboutHash).sign(signer);
const snapshot = await NsiteSnapshotFactory.create(updated).sign(signer);
```

Use `RootNsiteFactory.create(files)` for a root site. Copy a site with `RootNsiteFactory.copy(site)` or `NamedNsiteFactory.copy(site, identifier)`. Named identifiers are 1–13 lowercase letters, digits, or hyphens and cannot end in a hyphen. Snapshots require an aggregate hash on the source and keep it unchanged.

## Napplets

Napplet casts expose the manifest's `artifactHash`, `title`, `description`, `icon`, `archetypes`, `intents`, and required and optional domains. User casts gain `napplet$` and `napplets$`, root and named casts list `snapshots$` and `lineage$`, and snapshots resolve `parent$` and `root$`.

```ts
const root = await RootNappletFactory.create(artifactHash, "A feed viewer").sign(signer);
const named = await NamedNappletFactory.create("feed", artifactHash, "A feed viewer").sign(signer);
const snapshot = await NappletSnapshotFactory.create(named).sign(signer);
```

Use the matching factory's `modify(event)` to update a manifest. Unlike nsites, a napplet snapshot can be made from another snapshot and keeps its parent and root lineage.

**Examples:** [Nsite Feed](https://applesauce.build/examples/#/example/nsite/feed), [Napplet Browser](https://applesauce.build/examples/#/example/napplet/browser)

## Integration

Use the [napplet host](./napplet-hosting.md) to resolve verified manifests and run multiple napplets with a shared applesauce context.

## Best Practices

- Use `.file()` and `.removeFile()` instead of editing tags so the aggregate hash stays current
- Keep at least one file in a manifest, since manifests without files are invalid
- Call `verifyNsiteAggregateHash(event)` before trusting an advertised site version
- Snapshot a site before sharing a link that should not change
- Load files from `servers$` so manifests without server hints still resolve
