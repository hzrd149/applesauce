import { getLoggerSink, setLoggerSink, enableLoggerNamespaces } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import { NEVER } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NostrConnectSigner } from "../nostr-connect-signer.js";
import { PrivateKeySigner } from "../private-key-signer.js";

// Regression suite for the debug-log redaction: an enabled "applesauce*" namespace must never
// capture bunker pairing secrets, event drafts, DM plaintexts, account emails, or auth-URL
// bearer tokens — while non-sensitive lifecycle methods keep full detail.

const SECRET_DRAFT_CONTENT = "secret draft text body";
const SECRET_PLAINTEXT = "secret dm plaintext body";
const BUNKER_SECRET = "hunter2-bunker-pairing-secret";
const ACCOUNT_EMAIL = "owner@example.com";
const AUTH_URL = "https://bunker.example/approve?token=eyJbearer-token-value&x=1#fragment-secret";

let logs: string[] = [];
let restoreSink: () => void = () => {};

beforeEach(() => {
  logs = [];
  const original = getLoggerSink();
  enableLoggerNamespaces("applesauce*");
  setLoggerSink((message, record) => {
    logs.push(message, record?.message ?? "");
  });
  restoreSink = () => {
    setLoggerSink(original);
    enableLoggerNamespaces("");
  };
});
afterEach(() => restoreSink());

const allLogs = () => logs.join("\n");

/**
 * Builds a client paired with a remote signer whose publish mock decrypts each outgoing
 * request and answers it through `handleEvent`, so real request/response logging runs.
 */
async function createPairedClient(handler: (request: { id: string; method: string; params: string[] }) => object) {
  const remote = new PrivateKeySigner();
  let handleEvent: ((event: any) => Promise<void>) | undefined;

  const client = new NostrConnectSigner({
    relays: ["wss://relay.example"],
    remote: await remote.getPublicKey(),
    bunkerSecret: BUNKER_SECRET,
    connectSecret: "pairing-secret",
    subscriptionMethod: () => NEVER,
    publishMethod: vi.fn(async (_relays: string[], event: any) => {
      const request = JSON.parse(await remote.nip44.decrypt(event.pubkey, event.content));
      const response = await handler(request);
      await handleEvent?.(
        await remote.signEvent({
          kind: kinds.NostrConnect,
          created_at: unixNow(),
          tags: [["p", clientClientPubkey]],
          content: await remote.nip44.encrypt(
            clientClientPubkey,
            JSON.stringify({ id: request.id, ...response }),
          ),
        }),
      );
    }),
  });
  const clientClientPubkey = client.clientPubkey;
  handleEvent = (event) => client.handleEvent(event);
  return { client, remote };
}

describe("NIP-46 debug log redaction", () => {
  it("redacts sign_event drafts", async () => {
    const { client, remote } = await createPairedClient(async (request) => {
      if (request.method === "connect") return { result: "ack" };
      if (request.method === "sign_event") {
        const draft = JSON.parse(request.params[0]);
        return { result: JSON.stringify(await remote.signEvent(draft)) };
      }
      return { result: "" };
    });

    await client.signEvent({ kind: 1, content: SECRET_DRAFT_CONTENT, created_at: unixNow(), tags: [] });

    const logged = allLogs();
    expect(logged).toContain("(sign_event) [redacted]");
    expect(logged).not.toContain(SECRET_DRAFT_CONTENT);
  });

  it("redacts nip44 encryption plaintexts and decrypted results", async () => {
    const { client, remote } = await createPairedClient((request) => {
      if (request.method === "connect") return { result: "ack" };
      if (request.method === "nip44_encrypt") return { result: "ciphertext-string" };
      if (request.method === "nip44_decrypt") return { result: SECRET_PLAINTEXT };
      return { result: "" };
    });

    await client.nip44Encrypt("b".repeat(64), SECRET_PLAINTEXT);
    await client.nip44Decrypt("b".repeat(64), "ciphertext-string");

    const logged = allLogs();
    expect(logged).toContain("(nip44_encrypt) [redacted]");
    expect(logged).toContain("(nip44_decrypt) [redacted]");
    expect(logged).not.toContain(SECRET_PLAINTEXT);
  });

  it("redacts the bunker pairing secret in connect params", async () => {
    const { client, remote } = await createPairedClient((request) => {
      if (request.method === "connect") return { result: "ack" };
      return { result: "b".repeat(64) };
    });

    await client.connect();

    const logged = allLogs();
    expect(logged).toContain("(connect) [redacted]");
    expect(logged).not.toContain(BUNKER_SECRET);
  });

  it("redacts create_account emails", async () => {
    const { client, remote } = await createPairedClient((request) => {
      if (request.method === "connect") return { result: "ack" };
      if (request.method === "create_account") return { result: "c".repeat(64) };
      return { result: "" };
    });

    await client.createAccount("testuser", "example.com", ACCOUNT_EMAIL);

    const logged = allLogs();
    expect(logged).toContain("(create_account) [redacted]");
    expect(logged).not.toContain(ACCOUNT_EMAIL);
  });

  it("scrubs auth_url query and fragment bearer tokens", async () => {
    const { client, remote } = await createPairedClient((request) => {
      if (request.method === "connect") return { result: "ack" };
      if (request.method === "get_public_key") return { error: AUTH_URL, result: "auth_url" };
      return { result: "" };
    });
    const onAuth = vi.fn(async () => {});
    client.onAuth = onAuth;

    client.open();
    const pending = client.getPublicKey();
    await vi.waitFor(() => expect(onAuth).toHaveBeenCalled());
    expect(allLogs()).toContain("https://bunker.example/approve?[redacted]");
    expect(allLogs()).not.toContain("eyJbearer-token-value");
    expect(allLogs()).not.toContain("fragment-secret");

    client.close();
    await expect(pending).rejects.toThrow();
  });

  it("keeps non-sensitive methods verbatim", async () => {
    const { client, remote } = await createPairedClient((request) => {
      if (request.method === "connect") return { result: "ack" };
      if (request.method === "get_public_key") return { result: "d".repeat(64) };
      if (request.method === "switch_relays") return { result: JSON.stringify(["wss://one.example"]) };
      return { result: "" };
    });

    await client.getPublicKey();
    await client.switchRelays();

    const logged = allLogs();
    expect(logged).toContain("(get_public_key) []");
    expect(logged).toContain("d".repeat(64));
    expect(logged).toContain('"wss://one.example"');
  });
});
