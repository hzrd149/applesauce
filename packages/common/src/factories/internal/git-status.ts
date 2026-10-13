import { EventFactory } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { GitStatusKind } from "../../helpers/git-status.js";
import { setGitStatusRoot } from "../../operations/git-status.js";

/** A shared implementation of status target operations */
export class GitStatusTargetFactory<K extends GitStatusKind> extends EventFactory<K> {
  /**
   * Sets the original issue, pull request or root patch
   * @throws if the event is not a supported original root
   */
  root(root: NostrEvent, relay?: string) {
    return this.chain(setGitStatusRoot(root, relay));
  }
}
