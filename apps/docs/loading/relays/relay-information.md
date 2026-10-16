---
description: Read relay information documents for names, icons, supported NIPs and limitations, and cache them across pools
---

# Relay Information

Every `Relay` fetches the relay's [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md) information document and exposes it as observables. Use it to show a relay's name and icon, check which NIPs it supports, and respect its limits.

## Reading relay information

```typescript
relay.information$.subscribe((info) => {
  if (!info) return;
  console.log(info.name, info.software, info.supported_nips);
});

// Name and icon fall back to the URL and favicon until the document loads
relay.name$.subscribe((name) => console.log("Name:", name));
relay.icon$.subscribe((icon) => console.log("Icon:", icon));
```

For one-off checks, `getInformation()`, `getSupported()` and `getLimitations()` return promises.

```typescript
const supported = await relay.getSupported();
if (supported?.includes(77)) console.log("Relay supports negentropy");
```

## Checking supported NIPs and limits

```typescript
relay.supported$.subscribe((nips) => console.log("Supported NIPs:", nips));

relay.limitations$.subscribe((limits) => {
  if (!limits) return;
  console.log("Max subscriptions:", limits.max_subscriptions);
  console.log("Max message size:", limits.max_message_length);
});
```

## Caching information documents

Pass a `RelayInformationCache` to `Relay` or `RelayPool` to reuse documents across relay instances, pools and app restarts. The cache has `get(key)` and `set(key, document, ttl)` methods, where `ttl` is a lifetime in milliseconds, so a Keyv instance works as-is.

```typescript
import Keyv from "keyv";
import { RelayPool } from "applesauce-relay";

const informationCache = new Keyv();
const pool = new RelayPool({ informationCache, informationCacheMs: 60 * 60 * 1000 });
```

Documents are cached for 24 hours unless `informationCacheMs` overrides it. Cache keys are normalized relay URLs. Failed fetches are never stored, and cache read or write errors fall back to the fetched document.

## Integration

`Relay.negentropy()` and `sync()` read `getSupported()` and fail early when a relay does not list NIP-77. See [Negentropy Sync](./negentropy).

## Best Practices

- Share one cache instance between pools so each document is fetched once.
- Use persistent storage for the cache in apps that reconnect to the same relays across sessions.
- Treat a `null` document as unknown, not as "supports nothing". Many relays don't publish one.
- An existing `Relay` replays its first result, so create a new instance if you need a refreshed document.
