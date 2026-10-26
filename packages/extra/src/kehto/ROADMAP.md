# Kehto follow-ups

The applesauce service integrations and optional browser host are implemented. See [Hosting napplets](../../../../../apps/docs/napplets/hosting.md) for setup, extension points, and lifecycle ownership, and the [loader example](../../../../../apps/examples/src/examples/napplet/loader.tsx) for a complete host.

The browser host and lower-level shell adapter live in `host/`; the service registry lives in `services.ts`. Scoped relays and UI/device services remain application extensions.

## Remaining integration work

- Remove the host's explicit `intent.deliver` recipient checks when Kehto provides the missing recipient mapping, retaining tests for denied delivery.

## Performance verification

Automated tests cover concurrent iframe instances, per-window routing and teardown, account changes, artifact verification and caching, and recipient permissions. Broader real-relay measurements remain:

- Subscription fan-out across many napplet windows sharing one pool
- Open relay subscriptions after individual windows close
- Store hit rate and relay round-trips for repeated identity and outbox reads
- Publish latency and failure reporting through runtime-mediated signing
