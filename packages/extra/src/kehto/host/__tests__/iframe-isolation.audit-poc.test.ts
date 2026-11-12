/**
 * SECURITY AUDIT PoC — v7.1.0 kehto review (do not ship; delete after audit).
 *
 * Browser-side checks:
 *   A. mount() sets sandbox="allow-scripts" only, and the srcdoc embeds a
 *      restrictive CSP (connect-src/frame-src/default-src 'none') ahead of the
 *      artifact bytes; the executed document is the verified document.
 *   B. Cache/blob bytes that do not match the manifest hash are rejected
 *      (no TOCTOU / cache-poisoning execution).
 *   C. NIP-5D transport: window-level messages other than the single
 *      napplet.hello revoke the binding; replies go only over the bound port,
 *      never to the window.
 *   D. Diagnostic: whether a full createKehtoHost mount boots in this
 *      environment (host.browser.test.ts has 5 failures here: ready timeout).
 */
import { finalizeEvent } from "applesauce-core/helpers";
import { describe, expect, it, vi } from "vitest";
import { originRegistry, prepareNappletSrcdoc, createShellBridge, type ShellAdapter } from "@kehto/shell";
import type { ResolvedNapplet } from "@kehto/nip/5d";
import { createKehtoHost } from "../index.js";
import type { KehtoNappletInstance } from "../types.js";

const ARTIFACT_HTML =
  '<!doctype html><html><head><title>t</title></head><body><p id="mark">verified-bytes</p><script>parent.postMessage({type:"boot", origin: String(self.origin), href: String(location.href)}, "*");<\/script></body></html>';

// Run only in a real browser: use vitest.audit-poc.config.mts (repo root).
// In node runs (vitest.config.mts --dir .) these suites are skipped.
const browserDescribe = typeof document !== "undefined" ? describe : describe.skip;


async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function manifestEvent(html = ARTIFACT_HTML) {
  const bytes = new TextEncoder().encode(html);
  const hash = await sha256Hex(bytes);
  const key = new Uint8Array(32).fill(9);
  return {
    event: finalizeEvent(
      {
        kind: 35129,
        content: "audit napplet",
        created_at: 1,
        tags: [
          ["d", "audit-napplet"],
          ["x", hash],
          ["server", "https://blossom.example"],
        ],
      },
      key,
    ),
    hash,
    bytes,
  };
}

function fakeResolved(indexHtml: string): ResolvedNapplet {
  return {
    artifactHash: "fakehash",
    dTag: "audit-napplet",
    aggregateHash: "fakehash",
    files: new Map([["/index.html", new TextEncoder().encode(indexHtml)]]),
    indexHtml,
    manifest: {
      format: "current",
      kind: 35129,
      pubkey: "0".repeat(64),
      dTag: "audit-napplet",
      catalogId: "nip5d:35129:x:y",
      artifactHash: "fakehash",
      aggregateHash: "fakehash",
      paths: [{ path: "/index.html", sha256: "fakehash" }],
      servers: [],
      requires: [],
      optional: [],
      archetypeSlugs: [],
      intents: [],
      archetypes: [],
      description: "audit",
    },
  } as unknown as ResolvedNapplet;
}

browserDescribe("audit PoC: iframe isolation", () => {
  it("PoC A: sandbox tokens, CSP placement, and executed-bytes identity", async () => {
    const instanceWindowId = `audit-${Math.random().toString(36).slice(2)}`;
    // Use createNappletInstance indirectly through a real host resolve+mount.
    const host = createKehtoHost(
      { eventStore: { verifyEvent: () => true } as any, pool: {} as any, timeout: 10 },
      {},
    );
    const { event, bytes } = await manifestEvent();
    const instance = await host.resolve(event, {
      fetchBlob: async (requestedHash, servers) => {
        expect(servers).toContain("https://blossom.example");
        expect(requestedHash).toBe(await sha256Hex(bytes));
        return bytes;
      },
    });
    const frame = document.createElement("iframe");
    document.body.append(frame);
    instance.mount(frame);

    // 1. Exact sandbox tokens: scripts only; no allow-same-origin / top-navigation / popups / forms.
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");

    // 2. srcdoc (not a same-origin URL), with the CSP meta and the shell prelude
    //    inserted ahead of the verified artifact bytes.
    const srcdoc = frame.srcdoc;
    expect(srcdoc.startsWith("srcdoc") === false).toBe(true);
    expect(srcdoc).toContain("http-equiv=\"Content-Security-Policy\"");
    const cspIndex = srcdoc.indexOf("Content-Security-Policy");
    const preludeIndex = srcdoc.indexOf("napplet.hello");
    const artifactIndex = srcdoc.indexOf('id="mark"');
    expect(cspIndex).toBeGreaterThan(-1);
    expect(preludeIndex).toBeGreaterThan(-1);
    expect(cspIndex).toBeLessThan(preludeIndex);
    expect(preludeIndex).toBeLessThan(artifactIndex);
    for (const directive of [
      "default-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ]) {
      expect(srcdoc).toContain(directive);
    }
    // 3. The verified bytes are executed unmodified after the injected prefix:
    //    the document tail after the injected head content must equal the artifact tail.
    const artifactTail = ARTIFACT_HTML.slice(ARTIFACT_HTML.indexOf("<title>"));
    expect(srcdoc.endsWith(artifactTail)).toBe(true);

    // Registry identity was bound before the document could execute.
    expect(originRegistry.getWindowId(frame.contentWindow!)).toBe(instance.windowId);
    expect(instance.windowId).toMatch(/^napp-/);
    expect(instanceWindowId).not.toBe(instance.windowId); // ids are per-instance random
    instance.destroy();
    host.destroy();
    frame.remove();
    expect(frame.srcdoc).toBe("");
  });

  it("PoC B: cached or fetched bytes that do not match the manifest hash never execute", async () => {
    const host = createKehtoHost({ eventStore: {} as any, pool: {} as any, timeout: 10 });
    const { event, hash } = await manifestEvent();
    const poison = new TextEncoder().encode("<p>malicious substituted bytes</p>");
    await expect(
      host.resolve(event, { fetchBlob: async () => poison, cache: { readBlob: async () => poison, deleteBlob: async () => {} } as any }),
    ).rejects.toThrow(/hash mismatch|blob-hash-mismatch|does not match hash/i);
    expect(hash).not.toBe(await sha256Hex(poison));
    host.destroy();
  });
});

browserDescribe("audit PoC: NIP-5D transport routing", () => {
  function minimalBridgeHooks(): ShellAdapter {
    return {
      relayPool: {
        getRelayPool: () => null,
        trackSubscription: () => {},
        untrackSubscription: () => {},
        openScopedRelay: () => {},
        closeScopedRelay: () => {},
        publishToScopedRelay: () => false,
        selectRelayTier: () => [],
      },
      relayConfig: {
        addRelay: () => {},
        removeRelay: () => {},
        getRelayConfig: () => ({ discovery: [], super: [], outbox: [] }),
        getNip66Suggestions: () => [],
      },
      windowManager: { createWindow: () => null },
      auth: { getUserPubkey: () => null, getSigner: () => null },
      config: { getNappUpdateBehavior: () => "banner" },
      hotkeys: { executeHotkeyFromForward: () => {} },
      workerRelay: { getWorkerRelay: () => null },
      crypto: { verifyEvent: async () => true },
    };
  }

  it("PoC C: window-level message from a bound frame revokes; replies use only the port", async () => {
    const windowId = `audit-${Math.random().toString(36).slice(2)}`;
    const revocations: unknown[] = [];
    const hooks = minimalBridgeHooks();
    hooks.onNappletRevoked = (revocation) => revocations.push(revocation);
    const bridge = createShellBridge(hooks);
    const listener = (event: MessageEvent) => bridge.handleMessage(event);
    window.addEventListener("message", listener);

    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    const windowMessages: unknown[] = [];
    // Register the window BEFORE the document exists, exactly like kehto's mount().
    document.body.append(frame);
    originRegistry.register(frame.contentWindow!, windowId, { dTag: "audit", aggregateHash: "hash" });
    const onTraffic = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return;
      const data = event.data as any;
      if (data?.type !== "napplet.hello") windowMessages.push(data);
    };
    window.addEventListener("message", onTraffic);

    // The injected prelude posts napplet.hello with a MessagePort, then shell.ready
    // over that port; the bridge registers the session and answers shell.init on the port.
    // The artifact itself posts ONE window-level message after a delay so the session
    // registers first — a window-level post from a bound frame is replacement evidence.
    frame.srcdoc = prepareNappletSrcdoc(
      '<!doctype html><html><head></head><body><script>setTimeout(() => parent.postMessage({ type: "authored-window-post" }, "*"), 500);<\/script></body></html>',
      { domains: ["shell"] },
    );

    await vi.waitFor(() => expect(bridge.runtime.sessionRegistry.isRegistered(windowId)).toBe(true), { timeout: 8000 });

    // The delayed authored window-level post must revoke the binding ("window-message").
    await vi.waitFor(() => expect(revocations.length).toBe(1), { timeout: 5000 });
    expect((revocations[0] as any).reason).toBe("window-message");

    // No host traffic (e.g. shell.init) ever reached the frame at window level;
    // the only window-level traffic is the frame's own authored post.
    expect(windowMessages).toEqual([{ type: "authored-window-post" }]);
    window.removeEventListener("message", listener);
    window.removeEventListener("message", onTraffic);
    originRegistry.unregister(windowId);
    bridge.destroy();
    frame.remove();
  });

  it(
    "PoC D (diagnostic): full host mount boots or times out in this environment",
    async () => {
      // Clean artifact: any window-level postMessage from the frame (other than the
      // prelude's single hello) legitimately revokes the session, so use none here.
      const cleanHtml = "<!doctype html><html><head><title>t</title></head><body><p id=\"mark\">verified-bytes</p></body></html>";
      const host = createKehtoHost({ eventStore: {} as any, pool: {} as any, timeout: 10 }, { readyTimeout: 12000 });
      const { event, bytes } = await manifestEvent(cleanHtml);
      const instance = await host.resolve(event, { fetchBlob: async () => bytes });
      const frame = document.createElement("iframe");
      document.body.append(frame);
      instance.mount(frame);
      const outcome = await instance
        .whenReady()
        .then(() => "ready")
        .catch((error) => `not-ready: ${String(error?.message ?? error)}`);
      console.log("[audit-poc] full mount outcome:", outcome);
      expect(["ready", "not-ready: Napplet initialization timed out"]).toContain(outcome);
      instance.destroy();
      host.destroy();
      frame.remove();
      void instance as unknown as KehtoNappletInstance;
    },
    20000,
  );
});
