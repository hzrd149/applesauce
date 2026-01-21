import { getDisplayName } from "applesauce-core/helpers";
import type { User } from "applesauce-common/casts/user";
import { use$ } from "applesauce-react/hooks";
import { eventStore } from "../services/event-store";

interface UserNameProps {
  /** User object with profile$ observable (primary use case) */
  user?: User;
  /** Public key string (fallback when User not available) */
  pubkey?: string;
  /** Optional relay hints for profile loading */
  relays?: string[];
  /** Custom fallback text (default: "Anonymous") */
  fallback?: string;
  /** Additional CSS classes */
  className?: string;
  /** Whether to truncate long names */
  truncate?: boolean;
}

export default function UserName({
  user,
  pubkey,
  relays,
  fallback = "Anonymous",
  className = "",
  truncate = false,
}: UserNameProps) {
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

  // Get display name with fallback
  const displayName = getDisplayName(profile || undefined, fallback);

  if (!targetPubkey) {
    return null;
  }

  return (
    <span className={truncate ? `truncate ${className}` : className} title={displayName}>
      {displayName}
    </span>
  );
}
