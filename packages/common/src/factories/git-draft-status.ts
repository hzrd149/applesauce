import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { GIT_STATUS_DRAFT_KIND, isValidGitStatus } from "../helpers/git-status.js";
import { GitStatusTargetFactory } from "./internal/git-status.js";

/** An event template for a NIP-34 draft status */
export type GitDraftStatusTemplate = KnownEventTemplate<typeof GIT_STATUS_DRAFT_KIND>;

/** A factory for NIP-34 draft statuses (kind 1633) */
export class GitDraftStatusFactory extends GitStatusTargetFactory<typeof GIT_STATUS_DRAFT_KIND> {
  /**
   * Creates a draft status for an original thread root
   * @throws if the target is not a supported original root
   */
  static create(root: NostrEvent, content = ""): GitDraftStatusFactory {
    return new GitDraftStatusFactory((res) => res(blankEventTemplate(GIT_STATUS_DRAFT_KIND)))
      .root(root)
      .content(content);
  }
  /**
   * Creates a factory for modifying a draft status draft
   * @throws if the event is not a valid draft status
   */
  static modify(event: NostrEvent): GitDraftStatusFactory {
    if (!isValidGitStatus(event) || event.kind !== GIT_STATUS_DRAFT_KIND) throw new Error("Expected a draft status");
    return new GitDraftStatusFactory((res) => res(toEventTemplate({ ...event, kind: GIT_STATUS_DRAFT_KIND })));
  }
}
