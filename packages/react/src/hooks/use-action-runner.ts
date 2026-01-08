import { useContext } from "react";
import { ActionsContext } from "../providers/actions-provider.js";

/** Gets the {@link ActionRunner} from the {@link ActionsProvider} */
export function useActionRunner() {
  const hub = useContext(ActionsContext);
  if (!hub) throw new Error("Missing ActionsProvider");
  return hub;
}
