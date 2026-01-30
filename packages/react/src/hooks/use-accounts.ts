import { IAccount } from "applesauce-accounts";
import { useObservableEagerState } from "observable-hooks";

import { useAccountManager } from "./use-account-manager.js";

/** Gets the list of accounts from the {@link AccountManager} */
export function useAccounts(): IAccount[] {
  const manager = useAccountManager();
  return useObservableEagerState(manager.accounts$);
}
