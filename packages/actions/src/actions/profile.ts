import { ProfileFactory } from "applesauce-core/factories";
import { kinds } from "applesauce-core/helpers/event";
import { ProfileContent } from "applesauce-core/helpers/profile";
import { Action } from "../action-runner.js";

/** An action that creates a new kind 0 profile event for a user */
export function CreateProfile(content: ProfileContent): Action {
  return async ({ user, signer, publish }) => {
    const existing = await user.replaceable(kinds.Metadata).$first(1000, undefined);
    if (existing) throw new Error("Profile already exists");

    const signed = await ProfileFactory.create().override(content).sign(signer);
    // No outboxes to publish to since this is probably a new user
    await publish(signed);
  };
}

/** An action that updates a kind 0 profile event for a user */
export function UpdateProfile(content: Partial<ProfileContent>): Action {
  return async ({ user, signer, publish }) => {
    const [profile, outboxes] = await Promise.all([
      user.profile$.$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    if (!profile) throw new Error("Unable to find profile metadata");

    const signed = await ProfileFactory.modify(profile.event).update(content).sign(signer);
    await publish(signed, outboxes);
  };
}
