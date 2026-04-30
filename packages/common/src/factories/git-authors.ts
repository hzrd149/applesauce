import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { GIT_AUTHORS_KIND, GitAuthorsListEvent } from "../helpers/git-lists.js";
import { NIP51UserListFactory } from "./list.js";

export type GitAuthorsTemplate = KnownEventTemplate<typeof GIT_AUTHORS_KIND>;

/** A factory class for building kind 10017 git authors list events */
export class GitAuthorsFactory extends NIP51UserListFactory<typeof GIT_AUTHORS_KIND, GitAuthorsTemplate> {
  /** Creates a new git authors list factory */
  static create(): GitAuthorsFactory {
    return new GitAuthorsFactory((res) => res(blankEventTemplate(GIT_AUTHORS_KIND)));
  }

  /** Creates a new git authors list factory from an existing list event */
  static modify(event: NostrEvent | KnownEvent<typeof GIT_AUTHORS_KIND>): GitAuthorsFactory {
    if (event.kind !== GIT_AUTHORS_KIND) throw new Error("Event is not a git authors list event");
    return new GitAuthorsFactory((res) => res(toEventTemplate(event as GitAuthorsListEvent)));
  }

  /** Adds one or more git authors to the list */
  addAuthor(author: string | ProfilePointer | (string | ProfilePointer)[], hidden = false) {
    return this.addUser(author, hidden);
  }

  /** Removes one or more git authors from the list */
  removeAuthor(author: string | ProfilePointer | (string | ProfilePointer)[], hidden = false) {
    return this.removeUser(author, hidden);
  }
}

export type { GitAuthorsListEvent };
