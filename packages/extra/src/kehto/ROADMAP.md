# Kehto follow-ups

The applesauce service integrations and optional browser host are implemented. See [Hosting napplets](../../../../../apps/docs/napplets/hosting.md) for setup, extension points, and lifecycle ownership, and the [loader example](../../../../../apps/examples/src/examples/napplet/loader.tsx) for a complete host.

The browser host and lower-level shell adapter live in `host/`; the service registry lives in `services.ts`. Scoped relays and UI/device services remain application extensions.

## Remaining integration work

- Remove the host's explicit `intent.deliver` recipient checks once the supported Kehto dependency provides recipient-gated delivery ([kehto/web#415](https://github.com/kehto/web/issues/415)), retaining tests for denied delivery.
- Extend browser tests for intent delivery denied by a revoked `intent:read` capability, an unavailable `intent` domain, or an unregistered session; blocked-recipient coverage already exists.
