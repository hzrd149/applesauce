// The Concord client engine: a single-community reactive wrapper
// (`ConcordCommunity`), a thin multi-community manager (`ConcordClient`), and the
// epoch-atomic sync primitives that connect them to relays.

export * from "./relay-auth.js";
// Named (not `export *`) re-export: `createUserAuthHandler`, `lookupRelayStatus`,
// and `connectedRelays$` stay internal to the package; only `StreamSigners` and
// its options type are public.
export { StreamSigners, type StreamSignersOptions } from "./auth.js";
export * as Storage from "./storage.js";
export * from "./sync.js";
export * from "./channel-sync.js";
export * from "./invite-watcher.js";
export * from "./invite-manager.js";
export * from "./private-channel.js";
export * from "./admin.js";
export * from "./community.js";
export * from "./client.js";
