---
description: Powerful React hook combining useObservableState and useMemo for seamless RxJS observable integration with automatic subscription management
---

# use$ Hook

The `use$` hook is a powerful utility that combines `useObservableState` and `useMemo` to make working with RxJS observables in React components seamless. It automatically subscribes to observables and updates your component when values change, making it perfect for integrating with the EventStore, RelayPool, and other reactive data sources.

## Overview

The `use$` hook provides a simple way to subscribe to observables in React components. It handles subscription management, cleanup, and state updates automatically, so you can focus on building your UI.

## API

```typescript
// Direct observable (returns T for BehaviorSubject, T | undefined for Observable)
use$<T>(observable?: BehaviorSubject<T>): T;
use$<T>(observable?: Observable<T>): T | undefined;

// Factory function with dependencies (returns T | undefined)
use$<T>(factory: () => Observable<T> | undefined, deps: any[]): T | undefined;
```

## Usage Patterns

### 1. Direct Observable Subscription

The simplest usage is to pass an observable directly:

```tsx
import { use$ } from "applesauce-react/hooks";
import { BehaviorSubject } from "rxjs";

const user$ = new BehaviorSubject<User | null>(null);

function MyComponent() {
  const user = use$(user$);

  if (!user) return <div>Not logged in</div>;
  return <div>Welcome, {user.name}!</div>;
}
```

### 2. Factory Function with Dependencies

When you need to create observables based on props or other reactive values, use the factory pattern:

```tsx
function Profile({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.profile(pubkey), [pubkey]);

  return <div>{profile?.displayName || "Loading..."}</div>;
}
```

### 3. Conditional Observables

The factory pattern is especially useful when you need conditional observables:

```tsx
function Mailboxes({ pubkey }: { pubkey: string | null }) {
  const mailboxes = use$(() => (pubkey ? eventStore.mailboxes(pubkey) : undefined), [pubkey]);

  return <div>{mailboxes?.outboxes.length || 0} outboxes</div>;
}
```

## Common Use Cases

### Working with EventStore

The EventStore provides many observable methods that work perfectly with `use$`:

#### Profiles

```tsx
function UserProfile({ user }: { user: User }) {
  const profile = use$(user.profile$);

  return (
    <div>
      <img src={profile?.picture} alt={profile?.displayName} />
      <h2>{profile?.displayName || user.npub}</h2>
    </div>
  );
}
```

#### Models

```tsx
function Comments({ article }: { article: Article }) {
  const comments = use$(() => eventStore.model(CommentsModel, article.event), [article.id]);

  return (
    <div>
      {comments?.map((comment) => (
        <CommentItem key={comment.id} comment={comment} />
      ))}
    </div>
  );
}
```

#### Event Lookups

```tsx
function EventView({ pointer }: { pointer: EventPointer | null }) {
  const event = use$(() => (pointer ? eventStore.event(pointer.id) : undefined), [pointer?.id]);

  if (!event) return <div>Loading...</div>;
  return <div>{event.content}</div>;
}
```

#### Timelines

```tsx
function Timeline({ filters }: { filters: Filter }) {
  const events = use$(() => eventStore.timeline(filters), [JSON.stringify(filters)]);

  return (
    <div>
      {events?.map((event) => (
        <EventCard key={event.id} event={event} />
      ))}
    </div>
  );
}
```

### Working with RelayPool

The RelayPool provides observables for relay information and subscriptions:

```tsx
function RelayInfo({ relay }: { relay: string }) {
  const info = use$(() => pool.relay(relay).information$, [relay]);

  return (
    <div>
      <h3>{info?.name || relay}</h3>
      <img src={info?.icon} alt={relay} />
    </div>
  );
}
```

### Working with BehaviorSubjects

`use$` works seamlessly with BehaviorSubjects, which always have a current value:

```tsx
const signer$ = new BehaviorSubject<Signer | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);

function App() {
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);

  if (!signer || !pubkey) {
    return <LoginView />;
  }

  return <MainApp />;
}
```

### Complex Observable Chains

You can use `use$` with complex RxJS operator chains:

```tsx
function ArticleList({ relay }: { relay: string }) {
  const articles = use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [30023] })
        .pipe(
          onlyEvents(),
          mapEventsToStore(eventStore),
          mapEventsToTimeline(),
          castTimelineStream(Article, eventStore),
        ),
    [relay],
  );

  return (
    <div>
      {articles?.map((article) => (
        <ArticleCard key={article.id} article={article} />
      ))}
    </div>
  );
}
```

### Side Effects with use$

You can use `use$` for side effects by creating observables that don't return values:

```tsx
function ArticleViewer({ article }: { article: Article }) {
  // Subscribe to comments for side effects (loading them)
  use$(() => {
    if (!article) return;
    return pool
      .relay(relay)
      .subscription({
        kinds: [1111],
        "#a": [`30023:${article.pubkey}:${article.id}`],
      })
      .pipe(mapEventsToStore(eventStore));
  }, [article?.id, relay]);

  // Then use the model to display comments
  const comments = use$(() => eventStore.model(CommentsModel, article.event), [article.id]);

  return <CommentsList comments={comments} />;
}
```

## Best Practices

### 1. Use Factory Pattern for Dynamic Observables

When observables depend on props or state, always use the factory pattern with dependencies:

```tsx
// ✅ Good - factory with dependencies
const profile = use$(() => eventStore.profile(pubkey), [pubkey]);

// ❌ Bad - creates new observable on every render
const profile = use$(eventStore.profile(pubkey));
```

### 2. Handle Undefined States

Remember that `use$` returns `undefined` until the observable emits a value:

```tsx
function Profile({ pubkey }: { pubkey: string }) {
  const profile = use$(() => eventStore.profile(pubkey), [pubkey]);

  // Handle loading state
  if (profile === undefined) {
    return <div>Loading profile...</div>;
  }

  // Handle missing profile
  if (!profile) {
    return <div>Profile not found</div>;
  }

  return <div>{profile.displayName}</div>;
}
```

### 3. Use BehaviorSubject for Always-Available Values

For values that should always be available (like current user), use `BehaviorSubject`:

```tsx
// BehaviorSubject always has a value
const user$ = new BehaviorSubject<User | null>(null);
const user = use$(user$); // user is User | null, never undefined

// Regular Observable might not have emitted yet
const user$ = new Subject<User>();
const user = use$(user$); // user is User | undefined
```

### 4. Memoize Complex Dependencies

For complex dependency arrays, consider using `useMemo` or stringifying objects:

```tsx
// ✅ Good - stringify complex objects
const events = use$(() => eventStore.timeline(filters), [JSON.stringify(filters)]);

// ✅ Also good - useMemo for complex dependencies
const filterKey = useMemo(() => JSON.stringify(filters), [filters]);
const events = use$(() => eventStore.timeline(filters), [filterKey]);
```

### 5. Chain Observable Properties

Many objects in applesauce expose observables as properties. You can chain them:

```tsx
function ContactCard({ contact }: { contact: User }) {
  const profile = use$(contact.profile$);
  const nutzapInfo = use$(contact.nutzap$);
  const contacts = use$(contact.contacts$);

  return (
    <div>
      <h3>{profile?.displayName}</h3>
      {nutzapInfo && <div>Can receive zaps</div>}
      <div>{contacts?.length || 0} contacts</div>
    </div>
  );
}
```

### 6. Avoid Creating Observables in Render

Don't create new observables during render - use the factory pattern:

```tsx
// ❌ Bad - creates new observable every render
function Profile({ pubkey }) {
  const profile = use$(eventStore.profile(pubkey));
  return <div>{profile?.name}</div>;
}

// ✅ Good - factory creates observable once, recreates on pubkey change
function Profile({ pubkey }) {
  const profile = use$(() => eventStore.profile(pubkey), [pubkey]);
  return <div>{profile?.name}</div>;
}
```

### 7. Clone Arrays for Timeline Updates

EventStore returns the same array reference. Clone it to trigger React updates:

```tsx
import { map } from "rxjs";

// ✅ Good - clone array
const notes = use$(() => eventStore.timeline({ kinds: [1] }).pipe(map((timeline) => [...timeline])), []);

// ❌ Bad - React may not detect updates
const notes = use$(() => eventStore.timeline({ kinds: [1] }), []);
```

### 8. Use Conditional Subscriptions

Return `undefined` or `EMPTY` to skip subscriptions:

```tsx
import { EMPTY } from "rxjs";

function Timeline({ relay, isLive }) {
  const events = use$(() => (isLive ? pool.relay(relay).subscription({ kinds: [1] }) : EMPTY), [relay, isLive]);

  return <div>{events?.length || 0} events</div>;
}
```

### 9. Debounce High-Frequency Updates

Use RxJS operators to control update frequency:

```tsx
import { debounceTime } from "rxjs";

function LiveFeed({ relay }) {
  const events = use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [1] })
        .pipe(
          onlyEvents(),
          debounceTime(500), // Update UI every 500ms max
          mapEventsToTimeline(),
        ),
    [relay],
  );

  return <div>{events?.length || 0} events</div>;
}
```

### 10. Memoize Loaders

Always memoize timeline loaders to prevent recreation:

```tsx
function Timeline({ relays }) {
  const loader = useMemo(() => createTimelineLoader(pool, relays, { kinds: [1] }, { limit: 50 }), [relays]);

  useEffect(() => {
    loader().subscribe();
  }, [loader]);

  const events = use$(() => eventStore.timeline({ kinds: [1] }), []);
  return <div>{events?.map(renderEvent)}</div>;
}
```

## How It Works

The `use$` hook:

1. **Memoizes the observable** using `useMemo` to prevent unnecessary re-subscriptions
2. **Subscribes synchronously** during the initial render to get immediate values when available
3. **Updates React state** when the observable emits new values
4. **Cleans up subscriptions** automatically when the component unmounts or dependencies change
5. **Handles errors** by throwing them to React error boundaries

This makes it safe to use with both hot and cold observables, and ensures your components always reflect the latest values from your reactive data sources.

## Type Safety

`use$` provides full TypeScript support:

- For `BehaviorSubject<T>`, it returns `T` (never undefined)
- For `Observable<T>`, it returns `T | undefined`
- The factory pattern preserves types from your observable

```tsx
// TypeScript knows profile is Profile | undefined
const profile = use$(() => eventStore.profile(pubkey), [pubkey]);

// TypeScript knows user is User | null (from BehaviorSubject)
const user = use$(user$);
```
