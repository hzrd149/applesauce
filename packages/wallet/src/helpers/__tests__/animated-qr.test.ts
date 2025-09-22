import { describe, expect, it } from "vitest";
import { getDecodedToken } from "@cashu/cashu-ts";
import { lastValueFrom, map, take, timer } from "rxjs";
import { subscribeSpyTo } from "@hirez_io/observer-spy";

import { receiveAnimated, sendAnimated } from "../animated-qr.js";

const tokenStr =
  "cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAJofKTJT5B5hcIOkYWEQYXN4QDA2M2VlYjgwZDZjODM4NWU4NzYwODVhN2E4NzdkOTkyY2U4N2QwNTRmY2RjYzNiODMwMzhjOWY3MmNmMDY1ZGVhY1ghAynsxZ-OuZfZDcqYTLPYfCqHO7jkGjn97aolgtSYhYykYWSjYWVYIGbp_9B9aztSlZxz7g6Tqx5M_1PuFzJCVEMOVd8XAF8wYXNYINTOU77ODcj28v04pq7ektdf6sq2XuxvMjVE0wK6jFolYXJYIM_gZnUGT5jDOyZiQ-2vG9zYnuWaY8vPoWGe_3sXvrvbpGFhBGFzeEA0MWMwZDk1YTU5ZjkxNTdlYTc5NTJlNGFlMzYzYTI3NTMxNTllNmQ1NGJiNzExMTg5ZDk5YjU1MmYzYjIzZTJiYWNYIQM-49gen_1nPchxbaAiKprVr78VmMRVpHH_Tu9P8TO5mGFko2FlWCB9j7rlpdBH_m7tNYnLpzPhn-nGmS1CcbUfnPzjxy6G92FzWCDdsby7fGM5324T5UEoV858YWzZ9MCY59KgKP362fJDfmFyWCDL73v4FRo7iMe83bfMuEy3RJPtC1Vr1jdOpw2-x-7EAaRhYQFhc3hANjRhZDI3NmExOGNmNDhiMDZmYjdiMGYwOWFiMTU4ZTA0ZmM0NmIxYzA4YzMyNjJlODUxNzZkYTMzMTgyYzQ3YWFjWCECMDpCbNbrgA9FcQEIYxobU7ik_pTl8sByPqHDmkY4azxhZKNhZVggqHGaff9M270EU8LGxRpG_G4rn2bMgjyk3hFFg78ZXRVhc1ggP6DsNsWykwKE94yZF23gpCyapcoqh6DDZdVu0lKn2Z5hclggmPKig-lObsuxi_1XCm7_Y_tqaCcqEDz8eCwVhJ8gq9M";
const token = getDecodedToken(tokenStr);

describe("sendAnimated", () => {
  it("should loop", async () => {
    const qr$ = sendAnimated(token, { interval: 0 });

    const spy = subscribeSpyTo(qr$);

    // wait 100ms
    await lastValueFrom(timer(100));

    // should not have competed
    expect(spy.receivedComplete()).toBeFalsy();

    spy.unsubscribe();
  });

  it("should emit parts", async () => {
    const qr$ = sendAnimated(token, { interval: 0 }).pipe(take(6));

    const spy = subscribeSpyTo(qr$);

    // wait 100ms
    await lastValueFrom(qr$);

    // should not have competed
    expect(spy.getValues()).toEqual(
      Array(6)
        .fill(0)
        .map((_, i) => expect.stringContaining(`ur:bytes/${i + 1}-10/`)),
    );
  });
});

describe("receiveAnimated", () => {
  it("should decode animated qr", async () => {
    const qr$ = sendAnimated(token, { interval: 0 }).pipe(
      receiveAnimated,
      map((part) => (typeof part === "string" ? getDecodedToken(part) : part)),
    );
    const spy = subscribeSpyTo(qr$);

    await lastValueFrom(qr$);
    expect(spy.getValues()).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      token,
    ]);
  });
});
