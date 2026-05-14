import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { GIT_GRASP_LIST_KIND, GitGraspListEvent } from "../helpers/git-grasp-list.js";
import { addGitGraspServer, removeGitGraspServer, setGitGraspServers } from "../operations/git-grasp-list.js";

export type GitGraspListTemplate = KnownEventTemplate<typeof GIT_GRASP_LIST_KIND>;

/** Factory for NIP-34 user grasp server lists. */
export class GitGraspListFactory extends EventFactory<typeof GIT_GRASP_LIST_KIND, GitGraspListTemplate> {
  /** Creates a grasp list factory. */
  static create(servers: string[] = []): GitGraspListFactory {
    return new GitGraspListFactory((res) => res(blankEventTemplate(GIT_GRASP_LIST_KIND))).setServers(servers);
  }

  /** Creates a factory configured to modify an existing grasp list. */
  static modify(event: NostrEvent): GitGraspListFactory {
    if (event.kind !== GIT_GRASP_LIST_KIND) throw new Error("Expected a git grasp list event");
    return new GitGraspListFactory((res) => res(toEventTemplate(event as GitGraspListEvent)));
  }

  setServers(servers: string[]) {
    return this.chain(setGitGraspServers(servers));
  }

  addServer(url: string) {
    return this.chain(addGitGraspServer(url));
  }

  removeServer(url: string) {
    return this.chain(removeGitGraspServer(url));
  }
}
