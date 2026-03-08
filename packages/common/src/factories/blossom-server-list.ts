import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { addBlossomServer, removeBlossomServer } from "../operations/blossom.js";
import { BLOSSOM_SERVER_LIST_KIND } from "../helpers/blossom.js";

export type BlossomServerListTemplate = KnownEventTemplate<typeof BLOSSOM_SERVER_LIST_KIND>;

/** A factory class for building kind 10063 Blossom server list events */
export class BlossomServerListFactory extends EventFactory<typeof BLOSSOM_SERVER_LIST_KIND, BlossomServerListTemplate> {
  /** Creates a new Blossom server list factory */
  static create(): BlossomServerListFactory {
    return new BlossomServerListFactory((res) =>
      res(blankEventTemplate(BLOSSOM_SERVER_LIST_KIND) as BlossomServerListTemplate),
    );
  }

  /** Creates a new Blossom server list factory from an existing Blossom server list event */
  static modify(event: NostrEvent | KnownEvent<typeof BLOSSOM_SERVER_LIST_KIND>): BlossomServerListFactory {
    if (event.kind !== BLOSSOM_SERVER_LIST_KIND) throw new Error("Event is not a Blossom server list event");
    return new BlossomServerListFactory((res) => res(toEventTemplate(event) as BlossomServerListTemplate));
  }

  /** Adds a Blossom server to the list */
  addServer(url: string | URL) {
    return this.chain(addBlossomServer(url));
  }

  /** Removes a Blossom server from the list */
  removeServer(url: string | URL) {
    return this.chain(removeBlossomServer(url));
  }

  /** Moves a server to the top of the list, making it the default */
  setDefaultServer(url: string | URL) {
    return this.removeServer(url).modifyPublicTags((tags) => [["server", String(url)], ...tags]);
  }

  /** Replaces all servers with the given list */
  servers(urls: (string | URL)[]) {
    return this.modifyPublicTags((tags) => {
      const filtered = tags.filter((t) => t[0] !== "server");
      const serverTags = urls.map((url) => ["server", String(url)] as [string, string]);
      return [...filtered, ...serverTags];
    });
  }
}
