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
});
