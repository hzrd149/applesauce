import { kinds } from "applesauce-core/helpers/event";
import { ProfileContent } from "applesauce-core/helpers/profile";
import * as Profile from "applesauce-core/operations/profile";
import { Action } from "../action-hub.js";

/** An action that creates a new kind 0 profile event for a user */
export function CreateProfile(content: ProfileContent): Action {
  return async ({ events, factory, self, publish, sign }) => {
    const metadata = events.getReplaceable(kinds.Metadata, self);
    if (metadata) throw new Error("Profile already exists");

    const signed = await factory.build({ kind: kinds.Metadata }, Profile.setProfile(content)).then(sign);
    // No outboxes to publish to since this is probably a new user
    await publish(signed);
  };
}

/** An action that updates a kind 0 profile evnet for a user */
export function UpdateProfile(content: Partial<ProfileContent>): Action {
  return async ({ factory, user, publish, sign }) => {
    // Load the profile and outboxes in parallel
    const [profile, outboxes] = await Promise.all([
      user.profile$.$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    if (!profile) throw new Error("Unable to find profile metadata");

    const signed = await factory.modify(profile.event, Profile.updateProfile(content)).then(sign);
    await publish(signed, outboxes);
  };
}
