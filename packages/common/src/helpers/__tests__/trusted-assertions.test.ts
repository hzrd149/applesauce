import { unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getHiddenProviders,
  isHiddenProvidersUnlocked,
  TrustedProvidersHiddenSymbol,
  TRUSTED_PROVIDER_LIST_KIND,
} from "../trusted-assertions.js";

const user = new FakeUser();

// CR-02 regression: isHiddenProvidersUnlocked used to be `TrustedProvidersHiddenSymbol in event ||
// isHiddenTagsUnlocked(event)` — the presence of unlocked hidden TAGS (a different, lower-level
// symbol) was enough to report the event as "unlocked" (asserting T & UnlockedTrustedProviderList),
// without ever deriving — or caching onto TrustedProvidersHiddenSymbol — the actual providers
// array. A consumer trusting the predicate and reading `event[TrustedProvidersHiddenSymbol]`
// directly would get `undefined` typed as TrustedProvider[]. This is the Wave 0 gap: this file
// previously had no behavior coverage, only the exports-snapshot test.
describe("isHiddenProvidersUnlocked", () => {
  it("reports locked for an event whose hidden tags have not been unlocked", async () => {
    const hiddenTags = [[`${30382}:rank`, user.pubkey]];
    const event = user.event({
      kind: TRUSTED_PROVIDER_LIST_KIND,
      tags: [],
      content: await user.nip44.encrypt(user.pubkey, JSON.stringify(hiddenTags)),
    });

    expect(isHiddenProvidersUnlocked(event)).toBe(false);
  });

  it("only reports unlocked once the providers value is actually derived, and caches it", async () => {
    const hiddenTags = [[`${30382}:rank`, user.pubkey]];
    const event = user.event({
      kind: TRUSTED_PROVIDER_LIST_KIND,
      tags: [],
      content: await user.nip44.encrypt(user.pubkey, JSON.stringify(hiddenTags)),
    });

    // Unlock hidden tags directly (not through unlockHiddenProviders / getHiddenProviders) —
    // the exact first-call short-circuit shape: hidden tags are unlocked, but
    // TrustedProvidersHiddenSymbol has never been derived or cached.
    await unlockHiddenTags(event, user);
    expect(Reflect.has(event, TrustedProvidersHiddenSymbol)).toBe(false);

    // The guard must derive (and cache) the providers value as a side effect of reporting
    // "unlocked" — not just infer it from the lower-level hidden-tags symbol.
    expect(isHiddenProvidersUnlocked(event)).toBe(true);
    expect(Reflect.has(event, TrustedProvidersHiddenSymbol)).toBe(true);

    // Hand-derived expected value from the fixture's hidden provider tag (NIP-85 semantics).
    const expected = [{ kind: 30382, tag: "rank", servicePubkey: user.pubkey, relay: undefined }];
    expect(getHiddenProviders(event)).toEqual(expected);
  });
});
