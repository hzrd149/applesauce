# Examples Teach Best Practices

These examples are reference implementations for developers and other agents. Working functionality is necessary, but each example must also demonstrate idiomatic applesauce APIs and reactive patterns that readers can reuse.

## Example Shell

- Build example pages, not standalone applications. The example shell app provides the surrounding layout and navigation.
- Do not add app headers or footers to examples. Keep page content focused on the feature being demonstrated; feature-specific controls and section headings are appropriate.
- Fill the available space with flexbox instead of viewport math. The example root is a child of a bounded flex column, so full-height layouts use `flex min-h-0 grow` and nested scroll areas use `min-h-0 flex-1 overflow-y-auto`; avoid `h-screen`, `min-h-screen`, and `h-[calc(100vh-...)]`.

## React and RxJS

- Demonstrate the simplicity and reactivity of RxJS by expressing data flow as chains of observables and using `use$` to connect their results to React components.
- Use `use$` to consume observables and let the hook manage subscription lifetimes. Do not use `useEffect` plus `.subscribe()` plus `useState` to mirror observable values into React state; this is an anti-pattern.
- Use the factory form with dependencies for streams that depend on props or changing inputs: `use$(() => castUser(pubkey, eventStore).profile$, [pubkey])`. Stable observable properties can be passed directly to `use$`.
- Keep interactive reactive state in component-local `BehaviorSubject`s, created once with `useMemo`, and read it with `use$`. Update related values together to avoid intermediate inconsistent states.
- Derive values from their source instead of maintaining duplicate state or synchronizing it with effects. Use RxJS operators for stream composition; pure render calculations and `useMemo` are appropriate for presentation.
- Keep loading, filtering, transformation, and related-data resolution in observable chains instead of coordinating them through effects and state setters. Subscribe to the resulting streams with `use$` at the component boundary.
- Prefer `switchMap` for changing observable inputs so obsolete requests are unsubscribed. When using the `use$` factory form, include every input that should replace the subscription in its dependency array.
- Compose loading, completion, and error status into streams. Handle errors per relay when one failed relay should not terminate the other subscriptions, and provide an initial loading value.
- Keep accumulators inside `defer` or the subscription pipeline so each subscription starts with fresh state. Share streams with reference-counted sharing when multiple consumers need the same work.
- Aim for examples without `useEffect` or `useState`. Use them only when React-specific behavior calls for them, not to replace an existing observable or duplicate derived data. Use a ref callback for simple DOM setup such as opening a native dialog.
- Call hooks unconditionally at the top level of components. Extract child components for subscriptions per list item; never call `use$` inside loops or conditional branches.
- Store every incoming event before throttling or debouncing UI emissions. Applying those operators to raw event arrivals can discard events.
- Compose asynchronous work with operators such as `concatMap` or `mergeMap` when stream completion must await it. Async callbacks passed to `.subscribe()` or `.forEach()` are not awaited by RxJS.

```tsx
const query$ = useMemo(() => new BehaviorSubject(""), []);
const query = use$(query$);
const results = use$(() => search(query), [query]);

return <input value={query} onChange={(e) => query$.next(e.target.value)} />;
```

## Applesauce Integration

- Reuse one `EventStore` and `RelayPool` for related data within an example, and create reusable loaders outside render. Keep infrastructure ownership and cleanup explicit.
- Route incoming events into the example's shared `EventStore`, then render reactive store queries and casts.
- Let the EventStore handle replaceable-event revisions and deduplication rather than maintaining a second event collection in React state.
- Use stable event addresses for selections that should survive replaceable-event revisions.
- Wire `createEventLoaderForStore` before rendering ordinary examples so store subscriptions and cast relationships can load referenced profiles and events on demand. Explicitly load collections and pagination; a store timeline alone does not fetch network events.
- Subscribe to cold loaders through `use$` or a composed stream; merely creating a loader observable does not fetch events.
- Use `request()` for finite queries and `subscription()` for live updates. Reserve raw `req()` for examples that demonstrate protocol messages or custom lifecycle control.
- Keep relay subscriptions scoped to their consumers and ensure changing inputs or unmounting tears them down.
- Preserve pointer relay hints. User-focused examples should demonstrate NIP-65 routing: author outboxes for reading their published events and publishing their events, recipient inboxes for delivery, and fallback relays when needed. Relay-focused examples should use the selected relay.
- Import public package APIs and use existing helpers, models, and operators before introducing custom implementations.

## User and Event Casts

- Require built-in user and event casts whenever a suitable cast exists. Use `castUser` for users and the appropriate event cast for event presentation instead of manually parsing tags, rebuilding profiles, or reconstructing relationships.
- Cast observable results with `castEventStream` or `castTimelineStream`, and pass typed casts to child components.
- Consume relationships through cast properties, such as `note.author.profile$`, `note.replies$`, and `user.outboxes$`, with `use$`. Use synchronous cast getters for immutable event metadata.
- Helpers and models are appropriate for unsupported cast features or examples explicitly teaching those APIs. Keep these exceptions focused and explain their purpose briefly.

## Actions, Factories, and Accounts

- Require built-in actions for supported follow, mute, bookmark, and other read-modify-publish workflows. Use custom actions only for missing functionality or examples teaching custom actions.
- Require typed factories for supported event creation and modification. Use `.modify(existing)` to preserve existing event data; reserve generic factories and manual operations for unsupported kinds or examples teaching those APIs.
- Keep event and tag transformations composable and return new drafts or tag arrays instead of mutating existing events.
- Reuse stable `AccountManager` and `ActionRunner` instances within their intended scope. Pass `manager.signer` to actions and factories so account changes propagate automatically.
- Preserve relay lists supplied by actions to the publish function; apply fallback relays when no usable list is supplied.
- Await signing and publishing, inspect relay verdicts, and distinguish rejected publishes from transport errors before reporting success. Treat sync completion as the end of work, not proof that every transfer succeeded.
- Trigger signing prompts and encrypted-content unlocking from intentional user operations, never during render.

## Content, Persistence, and Wallets

- Render note content with the content package's React hooks and render articles with its markdown/Nostr transformers instead of ad hoc parsing. Define static renderer maps at module scope and memoize dynamic maps.
- Use stable cache Symbols for custom parsing and transformations so cached results can be reused.
- Add caching, encrypted storage, and wallet recovery when relevant to the example's subject; keep supporting features from obscuring the API being demonstrated.
- When demonstrating event caching, centralize persistence with `persistEventsToCache` and connect caches through loader `cacheRequest` rather than scattering writes and manual cache/relay fallback logic.
- Encrypt persisted decrypted private content and wallet proofs using the existing secure-storage utilities.
- Prefer `NutWallet` for complete wallet workflows and consume its status, balance, busy, and error observables through `use$`. Use wallet casts and built-in actions for lower-level workflows.
- When handling spendable Cashu tokens, provide persistent recovery for multi-step spends and follow each action's recovery requirements. Keep sats and millisats explicit and check wallet capabilities before offering optional operations.
- Stop wallets, caches, and services and close databases when their owner ends. Integrate cleanup into observable teardown or the owning lifecycle; do not dispose shared infrastructure from individual consumers.

## Review and Verification

- Review examples for instructional clarity as well as functionality. Keep the reactive data flow easy to follow and avoid unnecessary abstractions or boilerplate.
- Verify APIs against current package exports and types before copying documentation snippets. Historical migration examples and older snippets are not the default patterns for new examples.
- Distinguish initial loading, missing data, successful empty results, and failures in the UI; do not turn every error into an empty result.
- Check initial loading, empty results, errors, input changes, incoming event revisions, and subscription cleanup when those behaviors apply.
- Run `pnpm --filter applesauce-examples exec tsc -b` and the examples build for changes that affect code or integration.
- Keep the UI simple, with borders instead of cards or drop shadows. DaisyUI has no `.form-control` class.
