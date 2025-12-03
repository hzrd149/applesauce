import { blueprint } from "applesauce-core/event-factory";
import { ProfileContent } from "applesauce-core/helpers/profile";
import { kinds } from "applesauce-core/helpers/event";
import { setProfile } from "applesauce-core/operations/profile";

/** User Profile (kind 0) blueprint */
export function ProfileBlueprint(content: ProfileContent) {
  return blueprint(kinds.Metadata, setProfile(content));
}
