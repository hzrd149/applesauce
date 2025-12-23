import { createContext, PropsWithChildren } from "react";
import { ActionRunner } from "applesauce-actions";

export const ActionsContext = createContext<ActionRunner | undefined>(undefined);

/** Provides an ActionRunner to the component tree */
export function ActionsProvider({ actionHub, children }: PropsWithChildren<{ actionHub?: ActionRunner }>) {
  return <ActionsContext.Provider value={actionHub}>{children}</ActionsContext.Provider>;
}
