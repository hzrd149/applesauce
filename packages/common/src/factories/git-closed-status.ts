import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { GIT_STATUS_CLOSED_KIND, isValidGitStatus } from "../helpers/git-status.js";
import { GitStatusTargetFactory } from "./internal/git-status.js";

/** An event template for a NIP-34 closed status */
export type GitClosedStatusTemplate = KnownEventTemplate<typeof GIT_STATUS_CLOSED_KIND>;

/** A factory for NIP-34 closed statuses (kind 1632) */
export class GitClosedStatusFactory extends GitStatusTargetFactory<typeof GIT_STATUS_CLOSED_KIND> {
  /**
   * Creates a closed status for an original thread root
   * @throws if the target is not a supported original root
   */
  static create(root: NostrEvent, content = ""): GitClosedStatusFactory {
    return new GitClosedStatusFactory((res) => res(blankEventTemplate(GIT_STATUS_CLOSED_KIND)))
      .root(root)
      .content(content);
  }
  /**
   * Creates a factory for modifying a closed status draft
   * @throws if the event is not a valid closed status
   */
  static modify(event: NostrEvent): GitClosedStatusFactory {
    if (!isValidGitStatus(event) || event.kind !== GIT_STATUS_CLOSED_KIND) throw new Error("Expected a closed status");
    return new GitClosedStatusFactory((res) => res(toEventTemplate({ ...event, kind: GIT_STATUS_CLOSED_KIND })));
  }
}
