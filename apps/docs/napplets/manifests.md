---
description: Read, discover, and publish napplet manifests with Applesauce
---

# Manifests and discovery

A napplet manifest points to a single `index.html` artifact on Blossom and describes the app's title, supported intents, and required domains. Use `applesauce-common` to read and publish manifests without running a Kehto host.

## Reading manifests

These APIs use the current single-artifact schema: `x` contains the HTML artifact's SHA-256 hash, `content` is its plain-text description, and `R` / `O` declare required / optional domains. See Kehto's [event schema migration](https://kehto.github.io/web/docs/migrations/NIP-5D-EVENT-SCHEMA#normalization-boundary) for the format and legacy compatibility boundary.

| Manifest      | Kind    | Reference behavior                                           |
| ------------- | ------- | ------------------------------------------------------------ |
| Root napplet  | `15129` | Follows the author's latest root manifest                    |
| Named napplet | `35129` | Follows the latest manifest for an author and `d` identifier |
| Snapshot      | `5129`  | Pins one immutable event                                     |

Use `isValidNapplet` before casting untrusted catalog entries:

```ts
import { castEvent } from "applesauce-core/casts";
import { Napplet } from "applesauce-common/casts";
import { isValidNapplet } from "applesauce-common/helpers/napplet";

if (!isValidNapplet(event)) throw new Error("Invalid napplet manifest");
const napplet = castEvent(event, Napplet, eventStore);
const { title, description, artifactHash, archetypes, intents } = napplet;
```

The cast also exposes `icon`, `servers`, `requiredDomains`, `optionalDomains`, and a `pointer` suitable for saving a handler preference. `RootNapplet` and `NamedNapplet` add `snapshots$` and `lineage$`; `NappletSnapshot` adds `parent$` and `root$`.

The Applesauce cast's `archetypes` is a `string[]`; `intents` contains `{ intent, params }` entries. Kehto's resolved manifest uses a different normalized shape; see the [`@kehto/nip` manifest contracts](https://kehto.github.io/web/docs/packages/nip#nip-5d-archetype-manifest-contracts) when working directly with its resolver.

`isValidNapplet` checks manifest structure. It does not verify the event signature or downloaded bytes; the [host resolver](./hosting.md#basic-usage) verifies both before mounting.

## Discovering napplets

Importing `applesauce-common/casts` adds `user.napplet$` for a user's root manifest and `user.napplets$` for their root and named manifests. Timeline-based lists read the store: load catalog events from your chosen relays first.

For a catalog, request root and named manifests and write them into your application's store:

```ts
import { NAPPLET_KIND, NAPPLET_ROOT_KIND } from "applesauce-common/helpers/napplet";
import { onlyEvents, storeEvents } from "applesauce-relay";

const catalogSubscription = pool
  .subscription(catalogRelays, { kinds: [NAPPLET_ROOT_KIND, NAPPLET_KIND] })
  .pipe(onlyEvents(), storeEvents(eventStore))
  .subscribe();

// When the catalog owner ends:
catalogSubscription.unsubscribe();
```

## Publishing manifests

Build a self-contained HTML artifact and upload it to Blossom before publishing a manifest that references its SHA-256 hash. The hash must cover the final uploaded bytes; Kehto injects its runtime and CSP after verification. See [Gateway Artifacts](https://kehto.github.io/web/docs/concepts/gateway-artifacts) for the verification sequence.

```ts
import { NamedNappletFactory, NappletSnapshotFactory } from "applesauce-common/factories";

const manifest = await NamedNappletFactory.create("viewer", artifactHash, "A content viewer")
  .title("Viewer")
  .archetype(archetype)
  .intent(convention)
  .server(blossomServer)
  .sign(signer);
const snapshot = await NappletSnapshotFactory.create(manifest).sign(signer);
```

Use `RootNappletFactory.create(artifactHash, description)` for a root manifest and the matching factory's `modify(event)` to update one. Factories create signed events; publish them through your application's normal relay flow. Snapshots preserve lineage, including when created from another snapshot.

## Integration

Pass a signed manifest event to the [browser host](./hosting.md) to verify and run its artifact. Use the cast's `pointer` when saving [handler preferences](./handlers.md); its `archetypes` and `intents` describe which conventions the app supports.

## Best Practices

- Reuse the application's store and loader for catalog entries and referenced manifests
- Save a root or named pointer for updates, or a snapshot pointer to pin a version
- Show loading and failure states separately from an empty catalog
- Upload the artifact before publishing its manifest

See the [Napplet Browser](https://applesauce.build/examples/#/example/napplet/browser) example for a catalog UI.
