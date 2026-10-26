# Examples Teach Best Practices

These examples are reference implementations for developers and other agents. Working functionality is necessary, but each example must also demonstrate idiomatic applesauce APIs and reactive patterns that readers can reuse.

## Example Shell

- Build example pages, not standalone applications. The example shell app provides the surrounding layout and navigation.
- Do not add app headers or footers to examples. Keep page content focused on the feature being demonstrated; feature-specific controls and section headings are appropriate.
- Fill the available space with flexbox instead of viewport math. The example root is a child of a bounded flex column, so full-height layouts use `flex min-h-0 grow` and nested scroll areas use `min-h-0 flex-1 overflow-y-auto`; avoid `h-screen`, `min-h-screen`, and `h-[calc(100vh-...)]`.
- Use the full width. Managers and browsers use a sidebar plus main pane: an `aside` (`w-72 shrink-0 border-e`) holding scrollable filters or a selection list with the account row pinned at the bottom, and a `main` (`min-w-0 flex-1 overflow-y-auto`) for the content. Avoid narrow centered `max-w-2xl` columns for list-heavy pages.
- Separate list rows with `border-b border-base-300` instead of wrapping each item in a bordered box.
- Keep explanatory prose out of the UI: no intro paragraphs, page titles, or "this happens when…" notes. Show state with badges and counts, and put details in `title` tooltips, such as an "8 relays" badge whose tooltip lists the relays.
- Avoid emojis as icons; they add noise without meaning. Prefer short text labels, and use `lucide-react` icons sparingly for well-known actions such as remove, close, or locked state.
- Give filters visible counts and make them toggles: single-choice segments for exclusive options, and multi-select toggles (stored as a `Set` in `useState`) for facets such as authors or media types.

## File Structure

- Examples are discovered automatically from `src/examples/<category>/<name>.tsx`; the default export is the page, and the route is `#/example/<category>/<name>`.
- Model new examples on the most recently modified examples (`ls -t src/examples/*/*.tsx`), not the nearest older sibling in the same folder.
- Start with a JSDoc header of one descriptive sentence, then `@tags` and `@related`. The header is parsed at build time for search and navigation, and `@related` takes `category/name` paths.
- Order the module as imports, constants, module-level subjects, store/pool/loaders/actions, stream and helper functions, components, and the default export.
- Keep each example self-contained. Inline its constants, helpers, and components instead of creating `src/helpers`, `src/components`, or `src/lib` modules. Shared imports are limited to basics such as `LoginView`, `PubkeyPicker`, `NoteContent`, `lookupRelays$`, and `extra/verifier`. If inlining makes a multi-mode example too large, split it into separate examples instead of lazy-loading local modules.
- Built-in napplets for the `napplet/*` examples are the one exception: their sources live in `src/napplets/<name>/` and are imported as `index.html?napplet`.
- Write data flow as module-level stream functions named with a `$` suffix that take casts or plain inputs, such as `bookmarks$(user, list)`, and subscribe to them with `use$(() => bookmarks$(user, list), [user, list])`.

## React and RxJS

- Demonstrate the simplicity and reactivity of RxJS by expressing data flow as chains of observables and using `use$` to connect their results to React components.
- Use `use$` to consume observables and let the hook manage subscription lifetimes. Do not use `useEffect` plus `.subscribe()` plus `useState` to mirror observable values into React state; this is an anti-pattern.
- Use the factory form with dependencies for streams that depend on props or changing inputs: `use$(() => castUser(pubkey, eventStore).profile$, [pubkey])`. Stable observable properties can be passed directly to `use$`.
- Use `useState` for component-local UI state such as form text, busy and error flags, selections, filters, and page limits. Do not wrap local state in `useMemo(() => new BehaviorSubject(...))` plus `use$`; the RxJS focus is for demonstrating applesauce's reactive streams, not for replacing React state.
- Use a `BehaviorSubject` only when the value feeds an observable pipeline that outlives a single render input, or is shared across components; shared state belongs in a module-level subject. When a local value only parameterizes a stream, keep it in `useState` and pass it to the `use$` factory dependencies.
- Derive values from their source instead of maintaining duplicate state or synchronizing it with effects. Use RxJS operators for stream composition; pure render calculations and `useMemo` are appropriate for presentation.
- Keep loading, filtering, transformation, and related-data resolution in observable chains instead of coordinating them through effects and state setters. Subscribe to the resulting streams with `use$` at the component boundary.
- Prefer `switchMap` for changing observable inputs so obsolete requests are unsubscribed. When using the `use$` factory form, include every input that should replace the subscription in its dependency array.
- Compose loading, completion, and error status into streams. Handle errors per relay when one failed relay should not terminate the other subscriptions, and provide an initial loading value.
- Keep accumulators inside `defer` or the subscription pipeline so each subscription starts with fresh state. Share streams with reference-counted sharing when multiple consumers need the same work.
- Aim for examples without `useEffect`. Never use `useState` to mirror an observable or duplicate derived data. Use a ref callback for simple DOM setup such as opening a native dialog.
- Call hooks unconditionally at the top level of components. Extract child components for subscriptions per list item; never call `use$` inside loops or conditional branches.
- When the parent needs loaded items for filtering, counting, or sorting, load the list in one stream instead: `combineLatest` the per-item streams, start each with `startWith(item)` so unloaded items still render, batch re-renders with `auditTime`, and pass the results to rows as props. `combineLatest([])` never emits, so return `of([])` for empty lists.
- Store every incoming event before throttling or debouncing UI emissions. Applying those operators to raw event arrivals can discard events.
- Compose asynchronous work with operators such as `concatMap` or `mergeMap` when stream completion must await it. Async callbacks passed to `.subscribe()` or `.forEach()` are not awaited by RxJS.

```tsx
const [query, setQuery] = useState("");
const results = use$(() => search(query), [query]);

return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
```

## Applesauce Integration

- Create the `EventStore`, `RelayPool`, loaders and other foundational classes at the top of the module. Do not create them in `useMemo`, in `useState` or in a factory function passed to a hook.
- Examples are not only about React. Creating RxJS classes and subjects outside React is acceptable, and often expected, because it keeps examples simpler and more reactive.
- Pass the shared optimistic verifier to every store, `new EventStore({ verifyEvent })` with `verifyEvent` from `extra/verifier`, unless the example is about signature verification.
- Reuse one `EventStore` and `RelayPool` for related data within an example, and keep infrastructure ownership and cleanup explicit.
- Route incoming events into the example's shared `EventStore`, then render reactive store queries and casts.
- Let the EventStore handle replaceable-event revisions and deduplication rather than maintaining a second event collection in React state.
- Use stable event addresses for selections that should survive replaceable-event revisions.
- Wire `createEventLoaderForStore` before rendering ordinary examples so store subscriptions and cast relationships can load referenced profiles and events on demand. Explicitly load collections and pagination; a store timeline alone does not fetch network events.
- Subscribe to cold loaders through `use$` or a composed stream; merely creating a loader observable does not fetch events.
- Use `request()` for finite queries and `subscription()` for live updates. Reserve raw `req()` for examples that demonstrate protocol messages or custom lifecycle control.
- Keep relay subscriptions scoped to their consumers and ensure changing inputs or unmounting tears them down.
- Preserve pointer relay hints. User-focused examples should demonstrate NIP-65 routing: author outboxes for reading their published events and publishing their events, recipient inboxes for delivery, and fallback relays when needed. Relay-focused examples should use the selected relay.
- Build relay sets as relay lists are discovered: `combineLatest` the pointer hints and the relevant `outboxes$`/`inboxes$` (mapping `undefined` to `[]`), merge them with `mergeRelaySets`, drop repeats with `distinctUntilChanged`, and `switchMap` into the load so new outboxes re-request from the larger set. When a pointer has no author, such as an `e` tag, search the current user's inboxes and outboxes.
- Wait for at least one relay before loading, and keep any give-up `timeout` generous. Relay lists often arrive after the content that depends on them, and a short timeout drops the later update. Leave popular relays to the loader's `extraRelays` as a last resort instead of mixing them into the hints.
- Define fallback relays once as a module-level `FALLBACK_RELAYS` constant.
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
- For examples that need a signer, keep `signer$` and `user$` (a `castUser` cast) as module-level `BehaviorSubject`s, render `LoginView` while either is empty, and create the `ActionRunner` with `new ProxySigner(signer$)`. Key the main component by `user.pubkey` so account switches reset local state.
- Provide a logout button in the account row. Logout calls `forgetActiveAccount()` so `LoginView` does not restore the account, then clears the subjects.
- When signing is optional, such as browsing public data and signing in only to act, keep the page usable and open `LoginView` in a `<dialog className="modal">` from a sign-in button.
- Read-only examples about another user take a `PubkeyPicker` with a sensible default pubkey instead of requiring login.
- Publish with `pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event)` and throw unless `responses.some((r) => r.ok)`. Do not use the `extra/publish` helper.
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

## Stress-Test Examples

- Some examples double as permanent live-relay stress tests for loaders: `loader/timeline-scrubber`, `loader/social-graph`, `outbox/photo-gallery`, `relay-discovery/relay-directory`, and `threading/thread-loading`. Keep them during cleanups and use them for live checks after loader changes.
- Default to the load an average client would create, and make heavier loads opt-in, such as selecting a few preset monitors instead of all of them.
- Run benchmarks and stress scripts locally for numbers, report the results in the commit message, and delete them before committing.

## Review and Verification

- Review examples for instructional clarity as well as functionality. Keep the reactive data flow easy to follow and avoid unnecessary abstractions or boilerplate.
- Verify APIs against current package exports and types before copying documentation snippets. Historical migration examples and older snippets are not the default patterns for new examples.
- Distinguish initial loading, missing data, successful empty results, and failures in the UI; do not turn every error into an empty result.
- Check initial loading, empty results, errors, input changes, incoming event revisions, and subscription cleanup when those behaviors apply.
- Run `pnpm --filter applesauce-examples exec tsc -b` and the examples build for changes that affect code or integration.
- Check changed examples in a browser at `http://localhost:5173/#/example/<category>/<name>` (the `#` is required). For headless checks, import Playwright from `node_modules/.pnpm/playwright@*/node_modules/playwright` in a script outside the repo, inject a read-only `window.nostr` to log in as a real pubkey without signing, and re-run after edits settle because HMR reloads the page mid-check.
- Keep the UI simple, with borders instead of cards or drop shadows. DaisyUI has no `.form-control` class.
- Avoid small text. Use `text-sm` as the smallest size and skip `text-xs`, `btn-xs`, `badge-sm`, and tiny uppercase labels.
