import { kinds } from "applesauce-core/helpers/event";
import { ProfileContent } from "applesauce-core/helpers/profile";
import * as Profile from "applesauce-core/operations/profile";
import { Action } from "../action-hub.js";

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
