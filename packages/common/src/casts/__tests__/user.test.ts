import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures";
import { FAVORITE_EMOJI_PACKS_KIND } from "../../helpers/emoji-pack";
import { GIT_GRASP_LIST_KIND } from "../../helpers/git-grasp-list";
import { FAVORITE_GIT_REPOS_KIND, GIT_AUTHORS_KIND } from "../../helpers/git-lists";
import { LOOKUP_RELAY_LIST_KIND } from "../../helpers/relay-list";
import { castUser } from "../user";

describe("user", () => {
  describe("references", () => {
    it("should support sync observable properties", async () => {
      const signer = new FakeUser();
      const profile = signer.profile({ name: "John Doe" });
      const eventStore = new EventStore();
      eventStore.add(profile);

      const user = castUser(profile, eventStore);

      // Subscribe once to load the circular dependency
      await firstValueFrom(user.profile$.name);

      const chain = user.profile$.name;

      let name: string | undefined = "";
      chain.subscribe((n) => (name = n));

      expect(name).toBe("John Doe");
    });

    it("should resolve favorite emoji packs", async () => {
      const signer = new FakeUser();
      const profile = signer.profile({ name: "John Doe" });
      const favorites = signer.event({
        kind: FAVORITE_EMOJI_PACKS_KIND,
        tags: [["a", `30030:${signer.pubkey}:animals`]],
      });
      const eventStore = new EventStore();
      eventStore.add(profile);
      eventStore.add(favorites);

      const user = castUser(profile, eventStore);
      const favoriteEmojiPacks = await firstValueFrom(user.favoriteEmojis$);

      expect(favoriteEmojiPacks?.packPointers).toEqual([
        expect.objectContaining({ kind: 30030, pubkey: signer.pubkey, identifier: "animals" }),
      ]);
    });

    it("should resolve favorite git lists", async () => {
      const signer = new FakeUser();
      const profile = signer.profile({ name: "John Doe" });
      const author = "a".repeat(64);
      const authors = signer.event({
        kind: GIT_AUTHORS_KIND,
        tags: [["p", author]],
      });
      const repositories = signer.event({
        kind: FAVORITE_GIT_REPOS_KIND,
        tags: [["a", `30617:${signer.pubkey}:applesauce`]],
      });
      const eventStore = new EventStore();
      eventStore.add(profile);
      eventStore.add(authors);
      eventStore.add(repositories);

      const user = castUser(profile, eventStore);
      const gitAuthors = await firstValueFrom(user.gitAuthors$);
      const gitRepositories = await firstValueFrom(user.favoriteGitRepos$);

      expect(gitAuthors?.pubkeys).toEqual([author]);
      expect(gitRepositories?.repositoryPointers).toEqual([
        expect.objectContaining({ kind: 30617, pubkey: signer.pubkey, identifier: "applesauce" }),
      ]);
    });

    it("should resolve git grasp lists", async () => {
      const signer = new FakeUser();
      const profile = signer.profile({ name: "John Doe" });
      const graspList = signer.event({
        kind: GIT_GRASP_LIST_KIND,
        tags: [["g", "wss://grasp.example"]],
      });
      const eventStore = new EventStore();
      eventStore.add(profile);
      eventStore.add(graspList);

      const user = castUser(profile, eventStore);
      const gitGraspList = await firstValueFrom(user.graspServers$);

      expect(gitGraspList?.servers).toEqual(["wss://grasp.example/"]);
    });

    it("should resolve lookup relay lists", async () => {
      const signer = new FakeUser();
      const profile = signer.profile({ name: "John Doe" });
      const lookupList = signer.event({
        kind: LOOKUP_RELAY_LIST_KIND,
        tags: [["relay", "wss://indexer.example"]],
      });
      const eventStore = new EventStore();
      eventStore.add(profile);
      eventStore.add(lookupList);

      const user = castUser(profile, eventStore);
      const list = await firstValueFrom(user.lookupRelayList$);

      expect(list?.relays).toEqual(["wss://indexer.example/"]);
    });
  });
});
