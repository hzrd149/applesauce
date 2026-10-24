import type { CommonServiceOptions } from "@kehto/services";
import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { KehtoAccount } from "../foundation/account.js";
import type { KehtoSignRequest } from "../types.js";
import { createCommonContext } from "./common/context.js";
import { createContactsService } from "./common/contacts.js";
import { createProfileService } from "./common/profile.js";
import { createReactionService } from "./common/reactions.js";
import { createReportService } from "./common/reports.js";

/** Options for {@link createCommonOptions} */
export interface KehtoCommonOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The relay pool used for napplet traffic */
  pool: RelayPool;
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream, overriding signer resolution when provided */
  account$?: Observable<KehtoAccount | undefined>;
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;
  /** The maximum duration of an action including approval and signing in milliseconds (default 60000) */
  actionTimeout?: number;
  /** The relays used when user relay lists are unavailable */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The host callback approving a napplet signing request */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
}

/** Creates {@link CommonServiceOptions} for store-backed NAP-COMMON lookups and social actions */
export function createCommonOptions(config: KehtoCommonOptions): CommonServiceOptions {
  const context = createCommonContext(config);

  return {
    ...createProfileService(context),
    ...createContactsService(context),
    ...createReactionService(context),
    ...createReportService(context),
  };
}
