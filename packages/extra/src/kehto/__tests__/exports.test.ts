import { describe, expect, it } from "vitest";
import * as kehto from "../index.js";
import * as host from "../host/index.js";
import * as cvm from "../services/cvm.js";

describe("exports", () => {
  it("exports the expected Kehto functions and constants", () => {
    expect(Object.keys(kehto).sort()).toMatchInlineSnapshot(`
      [
        "DmPublicationError",
        "KEHTO_IDENTITY_LIST_KINDS",
        "KEHTO_LISTS",
        "createApprovingSigner",
        "createCommonOptions",
        "createCountOptions",
        "createDmAdapterProtocol",
        "createDmOptions",
        "createIdentityOptions",
        "createKehtoAccount$",
        "createKehtoCommonService",
        "createKehtoCountService",
        "createKehtoDmService",
        "createKehtoIdentityService",
        "createKehtoListsService",
        "createKehtoOutboxService",
        "createKehtoRelayPool",
        "createKehtoResourceService",
        "createKehtoShellAdapter",
        "createKehtoSigner",
        "createKehtoUploadService",
        "createLegacyMessageProtocol",
        "createListsOptions",
        "createMultiProtocolDmAdapter",
        "createOutboxRouter",
        "createResourceOptions",
        "createUploadOptions",
        "createWrappedMessageProtocol",
        "defaultDmRouter",
        "firstMatchingRoute",
        "getStoredInboxes",
        "getStoredOutboxes",
        "kehtoAccount$",
        "planOutboxRelays",
        "publishThroughStore",
        "queryThroughStore",
        "relaySelection$",
        "selectReadRelays",
        "selectRelayTier",
        "selectWriteRelays",
        "signForNapplet",
        "subscribeThroughStore",
        "toNapProfile",
        "toRelayEventResult",
        "useLastMessageProtocol",
        "useLegacyWhenInboxAdvertised",
        "useProtocol",
        "useProtocolWhenSupported",
        "useWrappedFallback",
        "useWrappedWhenAdvertised",
      ]
    `);
  });

  it("exports the browser host separately", () => {
    expect(Object.keys(host).sort()).toMatchInlineSnapshot(`
      [
        "createKehtoHost",
      ]
    `);
  });

  it("exports the CVM service separately", () => {
    expect(Object.keys(cvm).sort()).toMatchInlineSnapshot(`
      [
        "createCvmOptions",
        "createCvmTransport",
        "createKehtoCvmService",
      ]
    `);
  });
});
