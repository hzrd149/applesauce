import { describe, expect, it } from "vitest";
import * as kehto from "../index.js";
import * as host from "../host/index.js";
import * as cvm from "../services/cvm.js";
import * as ndr from "../services/dm/ndr.js";
import * as cordn from "../services/dm/cordn.js";

describe("exports", () => {
  it("exports the Cordn coordinator separately", () => {
    expect(Object.keys(cordn)).toEqual(["createCordnCoordinator"]);
  });
  it("exports the NDR transport separately", () => {
    expect(Object.keys(ndr).sort()).toMatchInlineSnapshot(`
      [
        "createNdrTransport",
      ]
    `);
  });
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
