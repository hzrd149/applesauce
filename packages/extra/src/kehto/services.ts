import type { ServiceRegistry } from "@kehto/runtime";
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
import { createListsOptions } from "./services/lists.js";
import { createOutboxRouter } from "./services/outbox.js";
import { createResourceOptions, type KehtoResourceOptions } from "./services/resource.js";
import { createUploadOptions } from "./services/upload.js";
import type { KehtoContext } from "./types.js";

/** The NAP services {@link createKehtoServices} can create */
export type KehtoServiceName = "identity" | "outbox" | "count" | "common" | "upload" | "lists" | "resource" | "dm";

/** Options for {@link createKehtoServices} */
export interface KehtoServicesOptions {
  /** Additional services and replacements for default services */
  services?: ServiceRegistry;
  /** Services to leave out of the registry */
  disable?: KehtoServiceName[];
  /** Application block-list provider and optional mapping from public mutes to blocks */
  identity?: Pick<KehtoIdentityOptions, "getBlocked" | "useMutesForBlocks">;
  /** Message protocol adapters and functional send routing */
  dm?: Partial<KehtoDmOptions>;
  /** Approval and signing deadline for common social actions */
  common?: Pick<KehtoCommonOptions, "actionTimeout">;
  /** Resource resolution options and application protocol handlers */
  resource?: Omit<KehtoResourceOptions, "eventStore" | "pubkey">;
}

/** Creates a kehto service registry for every NAP service applesauce can answer */
export function createKehtoServices(context: KehtoContext, options?: KehtoServicesOptions): ServiceRegistry {
  const isEnabled = (name: KehtoServiceName) => !options?.disable?.includes(name) && !options?.services?.[name];
  const services: ServiceRegistry = {};
  const account$ = kehtoAccount$(context);
  const pubkey = account$.pipe(map((account) => account?.pubkey));
  const { eventStore, pool, timeout, fallbackRelays, relaySelection, approve } = context;

  if (isEnabled("dm")) {
    let sendingWindow: string | undefined;
    const dm = createDmService(
      createDmOptions({
        ...options?.dm,
        protocols: options?.dm?.protocols ?? [
          createWrappedMessageProtocol({ eventStore, pool, account$, timeout, fallbackRelays, approve }),
          createLegacyMessageProtocol({ eventStore, pool, account$, timeout, fallbackRelays, approve }),
        ],
        routingTimeout: options?.dm?.routingTimeout ?? timeout,
        getWindowId: () => sendingWindow,
      }),
    );
    services.dm = {
      ...dm,
      handleMessage: (windowId, message, send) => {
        sendingWindow = windowId;
        dm.handleMessage(windowId, message, send);
      },
    };
  }

  if (isEnabled("identity"))
    services.identity = createIdentityService(
      createIdentityOptions({
        eventStore,
        pool,
        account$,
        timeout,
        fallbackRelays,
        relaySelection,
        ...options?.identity,
      }),
    );
  if (isEnabled("count"))
    services.count = createCountService(
      createCountOptions({ eventStore, pool, pubkey, timeout, fallbackRelays, relaySelection }),
    );
  if (isEnabled("common"))
    services.common = createCommonService(
      createCommonOptions({ eventStore, pool, account$, timeout, fallbackRelays, approve, ...options?.common }),
    );
  if (isEnabled("upload"))
    services.upload = createUploadService(
      createUploadOptions({ eventStore, account$, timeout, approve, fallbackServers: context.fallbackBlossomServers }),
    );
  if (isEnabled("lists"))
    services.lists = createListsService(
      createListsOptions({ eventStore, pool, account$, timeout, fallbackRelays, approve }),
    );
  if (isEnabled("resource"))
    services.resource = createResourceService(
      createResourceOptions({
        eventStore,
        pubkey,
        timeout,
        fallbackServers: context.fallbackBlossomServers,
        ...options?.resource,
      }),
    );

  if (isEnabled("outbox")) {
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
    services.outbox = {
      ...outbox,
      handleMessage: (windowId, message, send) => {
        // The router reads this synchronously inside handleMessage, before any await
        publishingWindow = windowId;
        outbox.handleMessage(windowId, message, send);
      },
    };
  }

  return { ...services, ...options?.services };
}
