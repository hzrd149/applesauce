import type { IAccount } from "applesauce-accounts";
import { castUser } from "applesauce-common/casts/user";
import { use$ } from "applesauce-react/hooks";
import { useMemo } from "react";
import { accounts } from "../services/accounts";
import { eventStore } from "../services/event-store";
import { user$ } from "../services/user";
import UserAvatar from "./UserAvatar";
import UserName from "./UserName";

interface AccountDisplayProps {
  onNavigateToSignin: () => void;
}

function AccountItem({ account }: { account: IAccount }) {
  const user = useMemo(() => castUser(account.pubkey, eventStore), [account.pubkey]);

  return (
    <li key={account.id}>
      <button onClick={() => accounts.setActive(account)} className="text-primary flex items-center gap-2">
        <UserAvatar user={user} size="sm" />
        <UserName user={user} fallback={account.pubkey.slice(0, 12) + "..."} />
      </button>
    </li>
  );
}

export default function AccountDisplay({ onNavigateToSignin }: AccountDisplayProps) {
  const activeAccount = use$(() => accounts.active$, []);
  const user = use$(user$);
  const allAccounts = use$(accounts.accounts$);

  if (!activeAccount || !user) {
    return (
      <button onClick={onNavigateToSignin} className="btn btn-primary">
        Sign In
      </button>
    );
  }

  const handleSignOut = () => {
    accounts.clearActive();
  };

  return (
    <div className="dropdown dropdown-end">
      <label tabIndex={0} className="btn btn-ghost btn-circle avatar">
        <UserAvatar user={user} size="sm" />
      </label>
      <ul tabIndex={0} className="dropdown-content menu bg-base-100 rounded-box z-10 min-w-xs p-2 shadow">
        {activeAccount && <AccountItem key={activeAccount.id} account={activeAccount} />}
        {allAccounts
          .filter((account) => account.id !== activeAccount?.id)
          .map((account) => (
            <AccountItem key={account.id} account={account} />
          ))}
        <li>
          <button onClick={handleSignOut} className="text-error">
            Sign Out
          </button>
        </li>
      </ul>
    </div>
  );
}
