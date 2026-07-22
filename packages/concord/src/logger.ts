import { logger as coreLogger } from "applesauce-core";

/** The `applesauce:concord` namespace root every module and per-instance `??`
 *  fallback derives from (D-01). Extends the shared `applesauce-core` base
 *  logger rather than starting a new `debug` instance. */
export const logger = coreLogger.extend("concord");
