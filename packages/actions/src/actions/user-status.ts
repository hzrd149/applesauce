import { UserStatusFactory } from "applesauce-common/factories";
import type { Emoji } from "applesauce-common/helpers/emoji";
import type { UserStatusPointer, UserStatusType } from "applesauce-common/helpers/user-status";
import { Action } from "../action-runner.js";

/** Options for {@link SetUserStatus} */
export type SetUserStatusOptions = {
  /** The status type (default "general") */
  type?: UserStatusType;
  /** A URL, profile, event, or address the status links to */
  link?: string | UserStatusPointer;
  /** The unix timestamp when the status should expire */
  expiration?: number;
  /** NIP-30 custom emojis used in the status text */
  emojis?: Emoji[];
};

/** An action that publishes a NIP-38 user status, replacing any existing status of the same type */
export function SetUserStatus(content: string, options?: SetUserStatusOptions): Action {
  return async ({ user, signer, publish }) => {
    let factory = UserStatusFactory.create(options?.type).status(content, options?.emojis);
    if (options?.link) factory = factory.link(options.link);
    if (options?.expiration) factory = factory.expiration(options.expiration);

    const outboxes = await user.outboxes$.$first(1000, undefined);
    await publish(await factory.sign(signer), outboxes);
  };
}

/** An action that clears a NIP-38 user status by publishing an empty status */
export function ClearUserStatus(type: UserStatusType = "general"): Action {
  return async ({ user, signer, publish }) => {
    const outboxes = await user.outboxes$.$first(1000, undefined);
    await publish(await UserStatusFactory.create(type).sign(signer), outboxes);
  };
}
