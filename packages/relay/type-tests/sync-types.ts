import { Relay } from "../src/relay.js";

declare const relay: Relay;

// RED tracer: sync lifetime is caller-owned and must reject a built-in timeout.
relay.sync([], {}, undefined, { timeout: 1_000 });
