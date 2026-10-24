import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { multiServerUpload } from "blossom-client-sdk/actions/multi-server";
import { EventStore } from "applesauce-core";
import { finalizeEvent } from "applesauce-core/helpers";
import type { KehtoUploadOptions } from "../kehto/services/upload.js";
import { createUploadOptions } from "../kehto/services/upload.js";

vi.mock("blossom-client-sdk/actions/multi-server", () => ({ multiServerUpload: vi.fn() }));

const descriptor = { url: "https://one.test/hash", sha256: "a".repeat(64), size: 1, uploaded: 1 };
const ctx = { uploadId: "1", windowId: "window", onStatus: vi.fn() };

function state(servers: BehaviorSubject<string[]>, preferred: URL[] = []) {
  const signer = new PrivateKeySigner(new Uint8Array(32).fill(1));
  const eventStore = new EventStore();
  eventStore.add(
    finalizeEvent(
      { kind: 10063, created_at: 1, content: "", tags: preferred.map((url) => ["server", String(url)]) },
      signer.key,
    ),
  );
  return { signer, eventStore, fallbackServers: servers, timeout: 10 } satisfies KehtoUploadOptions;
}

describe("Kehto Blossom uploads", () => {
  it("uses current app defaults and returns mirror URLs", async () => {
    const servers = new BehaviorSubject(["https://one.test/"]);
    const uploader = createUploadOptions(state(servers)).uploader!;
    vi.mocked(multiServerUpload).mockResolvedValue(
      new Map([
        ["https://one.test/", descriptor],
        ["https://two.test/", { ...descriptor, url: "https://two.test/hash" }],
      ]),
    );
    const result = await uploader.upload({ data: new Blob(["x"]) }, ctx);
    expect(result.fallbackUrls).toEqual(["https://two.test/hash"]);
    servers.next(["https://new.test/"]);
    await uploader.upload({ data: new Blob(["x"]) }, ctx);
    expect(vi.mocked(multiServerUpload).mock.lastCall?.[0]).toEqual(servers.value);
  });

  it("prefers the user's servers", async () => {
    const uploader = createUploadOptions(
      state(new BehaviorSubject(["https://default.test/"]), [new URL("https://user.test/")]),
    ).uploader!;
    await uploader.upload({ data: new Blob(["x"]) }, ctx);
    expect(vi.mocked(multiServerUpload).mock.lastCall?.[0]).toEqual(["https://user.test/"]);
  });

  it("fails without configured servers", async () => {
    const uploader = createUploadOptions({ ...state(new BehaviorSubject<string[]>([])), fallbackServers: undefined }).uploader!;
    expect(await uploader.upload({ data: new Blob(["x"]) }, ctx)).toMatchObject({
      ok: false,
      error: "No Blossom servers configured",
    });
  });
});
