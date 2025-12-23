import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "ComponentMap",
        "use$",
        "useAccountManager",
        "useAccounts",
        "useAction",
        "useActionRunner",
        "useActiveAccount",
        "useEventFactory",
        "useEventModel",
        "useEventStore",
        "useForceUpdate",
        "useObservableCallback",
        "useObservableEagerMemo",
        "useObservableEagerState",
        "useObservableGetState",
        "useObservableMemo",
        "useObservablePickState",
        "useObservableState",
        "useObservableSuspense",
        "useRenderNast",
        "useRenderedContent",
        "useSubscription",
      ]
    `);
  });
});
