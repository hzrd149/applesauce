import { createHttpUploader, type UploadServiceOptions } from "@kehto/services";
import { signForNapplet } from "../foundation/signer.js";
import type { KehtoState } from "../foundation/state.js";
import { settle } from "../helpers.js";

/** Blossom servers used when the user has no NIP-B7 server list */
export const DEFAULT_KEHTO_BLOSSOM_SERVERS = ["https://blossom.primal.net/"];

/** Creates {@link UploadServiceOptions} that upload napplet files to the user's Blossom servers */
export function createUploadOptions(
  state: KehtoState,
  fallbackServers = DEFAULT_KEHTO_BLOSSOM_SERVERS,
): UploadServiceOptions {
  return {
    uploadInfo: { rails: [{ rail: "blossom", enabled: true }] },
    uploader: {
      upload: async (request, ctx) => {
        const user = state.getUser();
        if (!user) throw new Error("no signer configured");
        const servers = (await settle(user.blossomServers$, [] as URL[], state.timeout)).map(String);
        // Blossom auth events go through the napplet's signing approval
        const uploader = createHttpUploader({
          rails: { blossom: { servers: servers.length ? servers : fallbackServers } },
          signEvent: (template) => signForNapplet(state, template, ctx.windowId),
        });
        return uploader.upload({ ...request, rail: "blossom" }, ctx);
      },
    },
  };
}
