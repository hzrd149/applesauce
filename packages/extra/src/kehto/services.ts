import type { ServiceHandler } from "@kehto/runtime";
import {
  createCommonService,
  createCountService,
  createDmService,
  createIdentityService,
  createListsService,
  createOutboxService,
  createResourceService,
  createUploadService,
} from "@kehto/services";
import { map } from "rxjs";
import { kehtoAccount$ } from "./foundation/account.js";
import { createCommonOptions, type KehtoCommonOptions } from "./services/common.js";
import { createCountOptions } from "./services/count.js";
import {
  createDmOptions,
  createWrappedMessageProtocol,
  createLegacyMessageProtocol,
  type KehtoDmOptions,
} from "./services/dm.js";
import { createIdentityOptions, type KehtoIdentityOptions } from "./services/identity.js";
import { createListsOptions, type KehtoListsOptions } from "./services/lists.js";
import { createOutboxRouter } from "./services/outbox.js";
import { createResourceOptions, type KehtoResourceOptions } from "./services/resource.js";
import { createUploadOptions } from "./services/upload.js";
import type { KehtoContext } from "./types.js";

/**
 * Creates an applesauce-backed Kehto DM service
 * @throws if protocol ids are empty or duplicated
 */
export function createKehtoDmService(context: KehtoContext, options?: Partial<KehtoDmOptions>): ServiceHandler {
  const account$ = kehtoAccount$(context);
  const { eventStore, pool, timeout, fallbackRelays, approve } = context;

  let sendingWindow: string | undefined;
  const dm = createDmService(
    createDmOptions({
      ...options,
      protocols: options?.protocols ?? [
        createWrappedMessageProtocol({ eventStore, pool, account$, timeout, fallbackRelays, approve }),
        createLegacyMessageProtocol({ eventStore, pool, account$, timeout, fallbackRelays, approve }),
      ],
      routingTimeout: options?.routingTimeout ?? timeout,
      getWindowId: () => sendingWindow,
    }),
  );

  return {
    ...dm,
    handleMessage: (windowId, message, send) => {
      sendingWindow = windowId;
      dm.handleMessage(windowId, message, send);
    },
  };
}

/** Creates an applesauce-backed Kehto identity service */
export function createKehtoIdentityService(
  context: KehtoContext,
  options?: Pick<KehtoIdentityOptions, "getBlocked" | "useMutesForBlocks">,
): ServiceHandler {
  const account$ = kehtoAccount$(context);
  const { eventStore, pool, timeout, fallbackRelays, relaySelection } = context;

  return createIdentityService(
    createIdentityOptions({
      eventStore,
      pool,
      account$,
      timeout,
      fallbackRelays,
      relaySelection,
      ...options,
    }),
  );
}

/** Creates an applesauce-backed Kehto count service */
export function createKehtoCountService(context: KehtoContext): ServiceHandler {
  const account$ = kehtoAccount$(context);
  const pubkey = account$.pipe(map((account) => account?.pubkey));
  const { eventStore, pool, timeout, fallbackRelays, relaySelection } = context;

  return createCountService(createCountOptions({ eventStore, pool, pubkey, timeout, fallbackRelays, relaySelection }));
}

/** Creates an applesauce-backed Kehto common service */
export function createKehtoCommonService(
  context: KehtoContext,
  options?: Pick<KehtoCommonOptions, "actionTimeout">,
): ServiceHandler {
  const account$ = kehtoAccount$(context);
  const { eventStore, pool, timeout, fallbackRelays, approve } = context;

  return createCommonService(
    createCommonOptions({ eventStore, pool, account$, timeout, fallbackRelays, approve, ...options }),
  );
}

/** Creates an applesauce-backed Kehto upload service */
export function createKehtoUploadService(context: KehtoContext): ServiceHandler {
  const account$ = kehtoAccount$(context);
  const { eventStore, timeout, approve } = context;

  return createUploadService(
    createUploadOptions({ eventStore, account$, timeout, approve, fallbackServers: context.fallbackBlossomServers }),
  );
}

/** Creates an applesauce-backed Kehto lists service */
export function createKehtoListsService(
  context: KehtoContext,
  options?: Pick<KehtoListsOptions, "lists">,
): ServiceHandler {
  const account$ = kehtoAccount$(context);
  const { eventStore, pool, timeout, fallbackRelays, approve } = context;

  return createListsService(
    createListsOptions({ eventStore, pool, account$, timeout, fallbackRelays, approve, ...options }),
  );
}

/** Creates an applesauce-backed Kehto resource service */
export function createKehtoResourceService(
  context: KehtoContext,
  options?: Omit<KehtoResourceOptions, "eventStore" | "pubkey">,
): ServiceHandler {
  const account$ = kehtoAccount$(context);
  const pubkey = account$.pipe(map((account) => account?.pubkey));
  const { eventStore, timeout } = context;

  return createResourceService(
    createResourceOptions({
      eventStore,
      pubkey,
      timeout,
      fallbackServers: context.fallbackBlossomServers,
      ...options,
    }),
  );
}

/** Creates an applesauce-backed Kehto outbox service */
export function createKehtoOutboxService(context: KehtoContext): ServiceHandler {
  const account$ = kehtoAccount$(context);
  const { eventStore, pool, timeout, fallbackRelays, relaySelection, approve } = context;

  // outbox.publish carries no window id, so remember the sender for the signing approval
  let publishingWindow: string | undefined;
  const outbox = createOutboxService({
    router: createOutboxRouter({
      eventStore,
      pool,
      account$,
      timeout,
      fallbackRelays,
      relaySelection,
      approve,
      decrypt: context.decrypt,
      decryptionCache: context.decryptionCache,
      getWindowId: () => publishingWindow,
    }),
  });

  return {
    ...outbox,
    handleMessage: (windowId, message, send) => {
      // The router reads this synchronously inside handleMessage, before any await
      publishingWindow = windowId;
      outbox.handleMessage(windowId, message, send);
    },
  };
}
