// Concord protocol — first-class helpers, operations, relay-auth, and client for
// Discord-style end-to-end-encrypted communities over Nostr (CORD-01…06).
//
// Extraction in progress — see .planning/concord-extraction/PLAN.md.

import "./helpers/register.js";

export * as Helpers from "./helpers/index.js";
export * as Operations from "./operations/index.js";
export * as Factories from "./factories/index.js";
export * as Casts from "./casts/index.js";
export * as Models from "./models/index.js";

export * from "./types.js";
export * from "./client/index.js";
// The `applesauce:concord` namespace root (D-01) — mirrors applesauce-core's own
// `export * from "./logger.js"`, so a consumer can `logger.extend("myapp")` and
// pass the result as `ConcordClientOptions.logger` without hand-constructing the
// namespace string.
export * from "./logger.js";
