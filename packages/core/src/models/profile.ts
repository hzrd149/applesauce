import { kinds } from "nostr-tools";
import { filter, map } from "rxjs/operators";

import { Model } from "../event-store/interface.js";
import { getProfileContent, isValidProfile, ProfileContent } from "../helpers/profile.js";
import { withImmediateValueOrDefault } from "../observable/with-immediate-value.js";
import { ProfilePointer } from "nostr-tools/nip19";

/** A model that gets and parses the kind 0 metadata for a pubkey */
export function ProfileModel(user: string | ProfilePointer): Model<ProfileContent | undefined> {
  if (typeof user === "string") user = { pubkey: user };

  return (events) =>
    events.replaceable({ kind: kinds.Metadata, pubkey: user.pubkey, relays: user.relays }).pipe(
      // Filter out invalid profile events
      filter(isValidProfile),
      // Parse the profile event into a ProfileContent
      map((event) => event && getProfileContent(event)),
      // Ensure the model is synchronous
      withImmediateValueOrDefault(undefined),
    );
}
