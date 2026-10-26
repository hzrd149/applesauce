---
description: Match napplet intents, save handler preferences, and route requests to a Kehto host
---

# Handlers and intents

Handler preferences let users choose which napplet opens an action. Applesauce provides convention matching, preference casts, actions, and recommendation models; your application chooses and launches the handler.

## Matching conventions

An **archetype** groups apps by purpose. An **intent** names an action and its payload convention, such as `napplet:<archetype>/<intent>`. A compatible manifest must advertise both the archetype in a `z` tag and the full convention identity in an `i` tag. Convention identities contain no query or fragment; keep invocation data in the delivery payload. Advertised parameter names are ordered text hints, not a type schema or required-field validation. See Kehto's [archetype manifest contracts](https://kehto.github.io/web/docs/packages/nip#nip-5d-archetype-manifest-contracts) for the underlying declaration format.

```ts
import { createNappletConvention, nappletSupportsConvention } from "applesauce-common/helpers/napplet";

const convention = createNappletConvention(archetype, action);
const compatible = nappletSupportsConvention(napplet.event, convention);
```

## Handler preferences

Kind `31129` stores one user's ordered preferences per archetype. Root and named references follow updates; snapshot references stay pinned. Public entries also serve as recommendations to other users. Private entries are NIP-44 encrypted to their author.

Read preferences through a user cast. Configure your store's [event loader](../loading/loaders/unified-loader.md) so referenced manifests and addressable preferences can load when subscribed:

```ts
import { castUser } from "applesauce-core/casts";
import "applesauce-common/casts";

const user = castUser(pubkey, eventStore);
const preferences$ = user.nappletHandlers(archetype);
```

A `NappletHandlers` cast exposes `publicEntries`, `hiddenEntries$`, `candidates(intent)`, and `candidates$(intent)`. Call `await preferences.unlock(signer)` to include private entries. Candidate resolution tries private intent handlers, public intent handlers, private archetype handlers, then public archetype handlers, removing duplicates in that order. Unresolved manifests appear as `undefined` in `candidates$`; the application must still check compatibility and availability.

### Saving choices

Use an [ActionRunner](../apps/actions/index.md) configured with your active signer and publish method. Load the user's existing preferences before enabling edits so a delayed relay response cannot be mistaken for empty preferences.

```ts
import { SetNappletHandler, SetNappletIntentHandler } from "applesauce-actions/actions";

await actions.run(SetNappletHandler, archetype, napplet.pointer);
await actions.run(SetNappletIntentHandler, convention, napplet.pointer, true);
```

The final `true` saves privately; the default is public. `SetNappletHandler` and `SetNappletIntentHandler` move a handler to the front of its group. `AddNappletHandler` and `AddNappletIntentHandler` append fallbacks. Matching `Remove` actions remove from both public and private groups; `ClearNappletHandlers` empties the archetype's preferences.

### Recommendations

`RecommendedNappletHandlersModel` ranks public recommendations by distinct recommender count. Pass trusted authors and an optional convention identity:

```ts
import { RecommendedNappletHandlersModel } from "applesauce-common/models";

const recommendations$ = eventStore.model(RecommendedNappletHandlersModel, archetype, follows, convention);
```

Results contain `{ napplet, ref, recommenders }`. Load preference events with `getNappletHandlersFilter(archetype, follows)` from `applesauce-common/helpers/napplet-handlers`; the model reads those events from the store and resolves referenced manifests. Recommendations inform a picker; they do not select or launch an app automatically.

## Integration

### Routing an intent

The host does not choose handlers. Your application reads preferences, skips unavailable or incompatible candidates, and asks the user to choose when no saved choice works. Resolve and mount the chosen manifest with `createKehtoHost`, wait for readiness, then [deliver the intent](./hosting.md#permissions-and-host-messages) with `instance.send()`.

Keep the convention identity separate from its payload: use `createNappletConvention(archetype, action)` for matching and pass the convention's expected data as the delivery payload. Required domains describe an app's needs; runtime permissions and signing approval are configured by your host.

Use the [manifest guide](./manifests.md) to build your catalog and the [hosting guide](./hosting.md) to run the selected napplet.

## Best Practices

- Check `nappletSupportsConvention` before offering or launching an intent handler
- Unlock private preferences before treating public entries as the user's first choice
- Load existing preferences before enabling edits
- Show unresolved handlers separately from an empty preference list

See the [Handler Preferences](https://applesauce.build/examples/#/example/napplet/handlers) example for a settings UI.
