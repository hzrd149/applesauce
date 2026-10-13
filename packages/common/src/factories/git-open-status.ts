import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { GIT_STATUS_OPEN_KIND, isValidGitStatus } from "../helpers/git-status.js";
import { GitStatusTargetFactory } from "./internal/git-status.js";

/** An event template for a NIP-34 open status */
export type GitOpenStatusTemplate = KnownEventTemplate<typeof GIT_STATUS_OPEN_KIND>;

/** A factory for NIP-34 open statuses (kind 1630) */
export class GitOpenStatusFactory extends GitStatusTargetFactory<typeof GIT_STATUS_OPEN_KIND> {
  /**
   * Creates a open status for an original thread root
   * @throws if the target is not a supported original root
   */
  static create(root: NostrEvent, content = ""): GitOpenStatusFactory {
    return new GitOpenStatusFactory((res) => res(blankEventTemplate(GIT_STATUS_OPEN_KIND))).root(root).content(content);
  }
  /**
   * Creates a factory for modifying a open status draft
   * @throws if the event is not a valid open status
   */
  static modify(event: NostrEvent): GitOpenStatusFactory {
    if (!isValidGitStatus(event) || event.kind !== GIT_STATUS_OPEN_KIND) throw new Error("Expected a open status");
    return new GitOpenStatusFactory((res) => res(toEventTemplate({ ...event, kind: GIT_STATUS_OPEN_KIND })));
  }
}
