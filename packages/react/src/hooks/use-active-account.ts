import { IAccount } from "applesauce-accounts";
import { useObservableEagerState } from "observable-hooks";

import { useAccountManager } from "./use-account-manager.js";

/** Gets the currently active account from the {@link AccountsProvider} */
export function useActiveAccount(): IAccount | undefined {
  const manager = useAccountManager();
  return useObservableEagerState(manager.active$);
}
