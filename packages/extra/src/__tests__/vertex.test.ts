import { afterEach, describe, expect, it, vi } from "vitest";

import { Vertex } from "../vertex.js";

afterEach(() => vi.restoreAllMocks());

describe("Vertex authentication integration", () => {
  it("forwards a relay challenge to the high-level signer-first authenticate call once", async () => {
    const signer = { signEvent: vi.fn(), getPublicKey: vi.fn() } as any;
    const authenticate = vi.spyOn(Vertex.prototype, "authenticate").mockResolvedValue({
      ok: true,
      from: "wss://vertex.test",
    });
    const vertex = new Vertex(signer, "wss://vertex.test");

    vertex.challenge$.next("challenge");
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
    expect(authenticate).toHaveBeenCalledWith(signer);

    vertex.close();
  });

  it("consumes automatic authentication rejection and resets the in-flight guard", async () => {
    const signer = { signEvent: vi.fn(), getPublicKey: vi.fn() } as any;
    const failure = new Error("relay unavailable");
    const authenticate = vi.spyOn(Vertex.prototype, "authenticate").mockRejectedValue(failure);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const vertex = new Vertex(signer, "wss://vertex.test");

    vertex.challenge$.next("first challenge");
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith("[VERTEX] Failed to authenticate to relay", failure));
    vertex.challenge$.next("second challenge");
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(2));

    vertex.close();
  });
});
