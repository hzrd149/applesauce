import { describe, expect, it } from "vitest";
import { setStreamingUrl, setRecordingUrl, addRelay, removeRelay } from "../stream.js";
import { addReferenceLink, removeReferenceLink } from "../calendar-event.js";
import { addGitRepositoryRelay, removeGitRepositoryRelay, setGitRepositoryRelays } from "../git-repository.js";

describe("URL operation serialization", () => {
  it.each(["wss://EXAMPLE.com:443/a//b?q=//#x", "https://bücher.example/a//b", "custom://host/a//b"])(
    "preserves native serialization and removal matching for %s",
    async (input) => {
      const draft = { kind: 1, content: "", tags: [] as string[][], created_at: 0 };
      const expected = new URL(input).href;
      expect((await setStreamingUrl(input)(draft)).tags).toEqual([["streaming", expected]]);
      expect((await setRecordingUrl(input)(draft)).tags).toEqual([["recording", expected]]);
      for (const [add, remove, tag] of [
        [addRelay, removeRelay, "relays"],
        [addReferenceLink, removeReferenceLink, "r"],
        [addGitRepositoryRelay, removeGitRepositoryRelay, "relays"],
      ] as const) {
        const added = await add(input)(draft);
        expect(added.tags).toEqual([[tag, expected]]);
        expect((await remove(input)(added)).tags).toEqual([]);
      }
      expect((await setGitRepositoryRelays([input])(draft)).tags).toEqual([["relays", expected]]);
    },
  );
});
