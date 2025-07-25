import { ProfileContent } from "applesauce-core/helpers";
import { Action } from "../action-hub.js";
import { kinds } from "nostr-tools";
import { Profile } from "applesauce-factory/operations";

/** An action that creates a new kind 0 profile event for a user */
export function CreateProfile(content: ProfileContent): Action {
  return async function* ({ events, factory, self }) {
    const metadata = events.getReplaceable(kinds.Metadata, self);
    if (metadata) throw new Error("Profile already exists");

    const draft = await factory.build({ kind: kinds.Metadata }, Profile.setProfile(content));
    yield await factory.sign(draft);
  };
}

/** An action that updates a kind 0 profile evnet for a user */
export function UpdateProfile(content: Partial<ProfileContent>): Action {
  return async function* ({ events, factory, self }) {
    const metadata = events.getReplaceable(kinds.Metadata, self);
    if (!metadata) throw new Error("Profile does not exists");

    const draft = await factory.modify(metadata, Profile.updateProfile(content));
    yield await factory.sign(draft);
  };
}
