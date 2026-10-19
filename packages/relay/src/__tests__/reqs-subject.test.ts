import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { map } from "rxjs";
import { describe, expect, it } from "vitest";
import { ReqsSubject } from "../lib/reqs-subject.js";

describe("ReqsSubject", () => {
  it("should return the current record when read while unobserved", () => {
    const reqs = new ReqsSubject();
    reqs.set("a", [{ kinds: [1] }]);
    reqs.set("b", [{ kinds: [0] }]);
    reqs.delete("a");

    expect(reqs.value).toEqual({ b: [{ kinds: [0] }] });
    expect(reqs.get("b")).toEqual([{ kinds: [0] }]);
  });

  it("should replay the current record to a new subscriber", () => {
    const reqs = new ReqsSubject();
    reqs.set("a", [{ kinds: [1] }]);

    expect(subscribeSpyTo(reqs.pipe(map((r) => Object.keys(r)))).getValues()).toEqual([["a"]]);
  });

  it("should emit a new record for every change while observed", () => {
    const reqs = new ReqsSubject();
    const spy = subscribeSpyTo(reqs);
    reqs.set("a", [{ kinds: [1] }]);
    reqs.delete("a");

    expect(spy.getValues()).toEqual([{}, { a: [{ kinds: [1] }] }, {}]);
  });

  it("should not change records that were already read", () => {
    const reqs = new ReqsSubject();
    reqs.set("a", [{ kinds: [1] }]);
    const before = reqs.value;
    reqs.set("b", [{ kinds: [0] }]);

    expect(before).toEqual({ a: [{ kinds: [1] }] });
    expect(reqs.value).not.toBe(before);
  });
});
