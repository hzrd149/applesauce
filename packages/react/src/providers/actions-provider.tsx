import { createContext, PropsWithChildren } from "react";
import { ActionRunner } from "applesauce-actions";

export const ActionsContext = createContext<ActionRunner | undefined>(undefined);

/** Provides an ActionRunner to the component tree */
export function ActionsProvider({ runner, children }: PropsWithChildren<{ runner?: ActionRunner }>) {
  return <ActionsContext.Provider value={runner}>{children}</ActionsContext.Provider>;
}
