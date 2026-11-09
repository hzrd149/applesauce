import { getFileMessageMetadata, getMessageAttachments } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { EMPTY, of, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAttachment, uploadEncryptedFile, WrappedMessagesClient, type MessageFileUploader } from "../../index.js";

const aliceSigner = new PrivateKeySigner(new Uint8Array(32).fill(1));
const alice = await aliceSigner.getPublicKey();
const bob = await new PrivateKeySigner(new Uint8Array(32).fill(2)).getPublicKey();
const image = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], { type: "image/png" });

/** An uploader that keeps blobs in memory and serves them through a fake fetch */
function memoryServer() {
  const blobs = new Map<string, Blob>();
  const upload: MessageFileUploader = vi.fn(async (blob) => {
    const url = `https://files.test/${blobs.size}`;
    blobs.set(url, blob);
    return { url, fallback: [`https://mirror.test/${blobs.size - 1}`] };
  });
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const blob = blobs.get(String(url));
    return blob ? new Response(blob) : new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;

  return { blobs, upload, fetch };
}

const disposables: { dispose(): void }[] = [];
afterEach(() => {
  disposables.splice(0).forEach((client) => client.dispose());
});

describe("encrypted attachments", () => {
  it("uploads only ciphertext and loads the original file", async () => {
    const server = memoryServer();
    const file = await uploadEncryptedFile(image, server.upload, { metadata: { dimensions: "1x1" } });

    expect(file).toMatchObject({ url: "https://files.test/0", type: "image/png", dimensions: "1x1" });
    expect(file.decryptionKey).toBeDefined();

    const uploaded = server.blobs.get(file.url!)!;
    expect(uploaded.type).toBe("application/octet-stream");
    expect(new Uint8Array(await uploaded.arrayBuffer())).not.toEqual(new Uint8Array(await image.arrayBuffer()));

    const loaded = await loadAttachment(file, { fetch: server.fetch });
    expect(loaded.type).toBe("image/png");
    expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(new Uint8Array(await image.arrayBuffer()));
  });

  it("falls back to mirrors when the primary URL fails", async () => {
    const server = memoryServer();
    const file = await uploadEncryptedFile(image, server.upload);
    server.blobs.set(file.fallback![0], server.blobs.get(file.url!)!);
    server.blobs.delete(file.url!);

    const loaded = await loadAttachment(file, { fetch: server.fetch });
    expect(loaded.size).toBe(image.size);
  });

  it("throws when every source fails", async () => {
    const server = memoryServer();
    await expect(loadAttachment({ url: "https://files.test/missing" }, { fetch: server.fetch })).rejects.toThrow("404");
    await expect(loadAttachment({})).rejects.toThrow("no URL");
  });
});

describe("attachment download limits", () => {
  /** A fetch that streams `chunks` 1 KiB chunks and counts how many were read */
  function streamingSource(chunks: number, headers?: HeadersInit) {
    let pulled = 0;
    const fetch = vi.fn(async () => {
      const body = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (pulled >= chunks) return controller.close();
            pulled++;
            controller.enqueue(new Uint8Array(1024));
          },
        },
        // No read-ahead, so `pulled` counts only chunks the reader asked for
        { highWaterMark: 0 },
      );
      return new Response(body, { headers });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, pulled: () => pulled };
  }

  it("stops downloading a source that serves more than the declared size", async () => {
    const source = streamingSource(64);
    await expect(
      loadAttachment({ url: "https://files.test/x", type: "image/png", size: 10 }, { fetch: source.fetch }),
    ).rejects.toThrow("limit");
    expect(source.pulled()).toBeLessThan(64);
  });

  it("stops downloading at maxSize when no size is declared", async () => {
    const source = streamingSource(64);
    await expect(
      loadAttachment({ url: "https://files.test/x", type: "image/png" }, { fetch: source.fetch, maxSize: 4096 }),
    ).rejects.toThrow("limit");
    expect(source.pulled()).toBeLessThan(64);
  });

  it("rejects a declared size over maxSize without fetching", async () => {
    const source = streamingSource(1);
    await expect(
      loadAttachment({ url: "https://files.test/x", size: 1_000_000 }, { fetch: source.fetch, maxSize: 1000 }),
    ).rejects.toThrow("limit");
    expect(source.fetch).not.toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const source = streamingSource(64, { "content-length": String(64 * 1024) });
    await expect(
      loadAttachment({ url: "https://files.test/x" }, { fetch: source.fetch, maxSize: 4096 }),
    ).rejects.toThrow("limit");
    expect(source.pulled()).toBe(0);
  });

  it("ignores a malformed declared size instead of disabling the limit", async () => {
    const source = streamingSource(64);
    await expect(
      loadAttachment({ url: "https://files.test/x", size: Number.NaN }, { fetch: source.fetch, maxSize: 4096 }),
    ).rejects.toThrow("limit");
  });

  it("falls back to a mirror when the primary serves the wrong size", async () => {
    const server = memoryServer();
    const file = await uploadEncryptedFile(image, server.upload);
    server.blobs.set(file.fallback![0], server.blobs.get(file.url!)!);
    server.blobs.set(file.url!, new Blob([new Uint8Array(1024 * 1024)]));

    const loaded = await loadAttachment(file, { fetch: server.fetch });
    expect(new Uint8Array(await loaded.arrayBuffer())).toEqual(new Uint8Array(await image.arrayBuffer()));
  });
});

describe("WrappedMessagesClient files", () => {
  function setup(upload?: MessageFileUploader) {
    const eventStore = new EventStore();
    for (const key of [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)]) {
      const relays = {
        kind: kinds.DirectMessageRelaysList,
        created_at: unixNow(),
        tags: [["relay", "wss://dm.test/"]],
        content: "",
      };
      eventStore.add(finalizeEvent(relays, key));
    }
    const pool = {
      req: vi.fn(() => of({ type: "EOSE", from: "wss://dm.test/" })),
      subscription: vi.fn(() => new Subject<NostrEvent>()),
      relay: vi.fn(() => ({ getSupported: async () => [], getLimitations: async () => ({}), request: () => EMPTY })),
      publish: vi.fn(async (_relays: string[], _event: NostrEvent) => [{ from: "wss://dm.test/", ok: true }]),
    };
    const client = new WrappedMessagesClient({
      pubkey: alice,
      signer: aliceSigner,
      eventStore,
      pool: pool as unknown as RelayPool,
      timeout: 5,
      upload,
    });
    disposables.push(client);
    return { client, eventStore, pool };
  }

  it("throws when no uploader is configured", async () => {
    const { client } = setup();
    await expect(client.uploadFile(image)).rejects.toThrow("No file uploader configured");
  });

  it("sends an uploaded file as a kind 15 file message and reads it back", async () => {
    const server = memoryServer();
    const { client, eventStore, pool } = setup(server.upload);
    const conversation = client.conversation(bob);

    const file = await conversation.uploadFile(image);
    const rumor = await conversation.send({ content: "", file });

    expect(rumor.kind).toBe(kinds.FileMessage);
    expect(rumor.content).toBe(file.url);
    expect(getFileMessageMetadata(rumor)).toMatchObject({ type: "image/png", decryptionKey: file.decryptionKey });

    // The sender's own envelope decrypts back to the file message.
    const ownEnvelope = pool.publish.mock.calls
      .map(([, event]) => event)
      .find((event) => event.tags.some((tag) => tag[0] === "p" && tag[1] === alice))!;
    eventStore.add(ownEnvelope);

    const restored = await client.receiver.unlock(ownEnvelope);
    expect(restored).toEqual(rumor);

    const messages = await conversation.getMessages({ limit: 10 });
    expect(getMessageAttachments(messages[0])).toEqual([expect.objectContaining({ url: file.url })]);
  });
});
