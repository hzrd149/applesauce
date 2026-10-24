import type { EventStore } from "applesauce-core";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { KehtoAccount } from "../foundation/account.js";
import type { KehtoSignRequest } from "../types.js";
import type { UploadResult, UploadServiceOptions } from "@kehto/services";
import { castUser } from "applesauce-common/casts";
import { createUploadAuth } from "blossom-client-sdk";
import { multiServerUpload } from "blossom-client-sdk/actions/multi-server";
import { firstValueFrom } from "rxjs";
import { kehtoAccount$ } from "../foundation/account.js";
import { signForNapplet } from "../foundation/signer.js";
import { configured$, errorMessage, settle } from "../helpers.js";

/** Options for {@link createUploadOptions} */
export interface KehtoUploadOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream, overriding signer resolution when provided */
  account$?: Observable<KehtoAccount | undefined>;
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;
  /** The Blossom servers used after user server discovery */
  fallbackServers?: string[] | Observable<string[]>;
  /** The host callback approving a napplet signing request */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
}

/** Creates upload options that upload and mirror napplet files to the user's Blossom servers */
export function createUploadOptions(config: KehtoUploadOptions): UploadServiceOptions {
  const pendingUploads = new Map<string, AbortController>();

  return {
    uploadInfo: { rails: [{ rail: "blossom", enabled: true }] },
    uploader: {
      cancel: (uploadId) => {
        pendingUploads.get(uploadId)?.abort();
      },
      upload: async (request, ctx) => {
        const controller = new AbortController();
        pendingUploads.set(ctx.uploadId, controller);

        const uploadIdentity = { uploadId: ctx.uploadId, rail: "blossom" };
        const reportStatus = (result: UploadResult) => {
          ctx.onStatus({ ...result, updatedAt: Date.now() });
        };

        try {
          const account = await firstValueFrom(kehtoAccount$(config));
          if (!account) throw new Error("No signer configured");

          const { signer, pubkey } = account;
          const user = castUser(pubkey, config.eventStore);

          const userServers = await settle(user.blossomServers$, [] as URL[], config.timeout ?? 4000);
          const servers = userServers.length
            ? userServers.map(String)
            : await firstValueFrom(configured$(config.fallbackServers, []));
          if (!servers.length) throw new Error("No Blossom servers configured");

          const originalMimeType = request.data instanceof Blob ? request.data.type : "";
          const mimeType = request.mimeType || originalMimeType;
          const blob = new Blob([request.data], { type: mimeType });

          reportStatus({ ...uploadIdentity, ok: true, status: "uploading" });

          const results = await multiServerUpload(servers, blob, {
            signal: controller.signal,
            onAuth: (_server, hash) =>
              createUploadAuth(
                (template) => signForNapplet(signer, template, { approve: config.approve, windowId: ctx.windowId }),
                hash,
              ),
          });

          controller.signal.throwIfAborted();

          const [primary, ...mirrors] = results.values();
          if (!primary) throw new Error("No Blossom server accepted the upload");

          const result: UploadResult = {
            ...uploadIdentity,
            ok: true,
            status: "complete",
            url: primary.url,
            fallbackUrls: mirrors.map((mirror) => mirror.url),
            sha256: primary.sha256,
            size: primary.size,
            mimeType: primary.type || blob.type,
          };

          reportStatus(result);
          return result;
        } catch (err) {
          const result: UploadResult = {
            ...uploadIdentity,
            ok: false,
            status: controller.signal.aborted ? "cancelled" : "failed",
            error: errorMessage(err, "Upload failed"),
          };

          reportStatus(result);
          return result;
        } finally {
          pendingUploads.delete(ctx.uploadId);
        }
      },
    },
  };
}
