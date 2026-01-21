import { getProfilePicture } from "applesauce-core/helpers";
import type { User } from "applesauce-common/casts/user";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "../services/event-store";

interface UserAvatarProps {
  /** User object with profile$ observable (primary use case) */
  user?: User;
  /** Public key string (fallback when User not available) */
  pubkey?: string;
  /** Optional relay hints for profile loading */
  relays?: string[];
  /** Avatar size */
  size?: "xs" | "sm" | "md" | "lg";
  /** Additional CSS classes */
  className?: string;
  /** Custom fallback image URL (default: robohash) */
  fallback?: string;
}

const sizeClasses = {
  xs: "w-6 h-6",
  sm: "w-8 h-8 sm:w-10 sm:h-10",
  md: "w-12 h-12",
  lg: "w-12 h-12",
};

export default function UserAvatar({
  user,
  pubkey,
  relays,
  size = "md",
  className = "",
  fallback,
}: UserAvatarProps) {
  // Determine which pubkey to use
  const targetPubkey = user?.pubkey || pubkey;

  // Load profile - prefer user.profile$ if User provided, otherwise use eventStore.profile
  const profile = use$(
    () => {
      if (user) {
        return user.profile$;
      }
      if (targetPubkey) {
        return eventStore.profile({ pubkey: targetPubkey, relays });
      }
      return undefined;
    },
    [user, targetPubkey, relays?.join("|")],
  );

  // Generate fallback URL if not provided
  const fallbackUrl = fallback || (targetPubkey ? `https://robohash.org/${targetPubkey}` : undefined);

  // Get profile picture with fallback
  const pictureUrl = getProfilePicture(profile || undefined, fallbackUrl || "");

  if (!targetPubkey) {
    return null;
  }

  return (
    <div className={`avatar shrink-0 ${className}`}>
      <div className={`${sizeClasses[size]} rounded-full`}>
        <img src={pictureUrl} alt="" className="rounded-full" />
      </div>
    </div>
  );
}
