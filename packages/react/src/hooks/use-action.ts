import { ActionBuilder } from "applesauce-actions";
import { NostrEvent } from "applesauce-core/helpers/event";
import { useCallback, useRef, useState } from "react";
import { finalize, Observable } from "rxjs";
import { useActionRunner } from "./use-action-runner.js";

export type UseActionResult<Args extends Array<any>> = {
  loading: boolean;
  run: (...args: Args) => Promise<void>;
  exec: (...args: Args) => Observable<NostrEvent>;
};

/** A hook to run an action inside the {@link ActionsProvider} */
export function useAction<Args extends Array<any>>(Action: ActionBuilder<Args>): UseActionResult<Args>;
export function useAction<Args extends Array<any>>(
  Action: ActionBuilder<Args>,
  args: Args | undefined,
): UseActionResult<Args>;
export function useAction<Args extends Array<any>>(
  Action: ActionBuilder<Args>,
  args?: Args | undefined,
): UseActionResult<Args> {
  const [loading, setLoading] = useState(false);
  const staticArgs = useRef(args);
  staticArgs.current = args;

  const hub = useActionRunner();
  const run = useCallback(
    async (...args: Args) => {
      setLoading(true);
      try {
        await hub.run(Action, ...(staticArgs.current ?? args));
        setLoading(false);
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [Action],
  );

  const exec = useCallback(
    (...args: Args) => {
      setLoading(true);
      try {
        return hub.exec(Action, ...(staticArgs.current ?? args)).pipe(
          finalize(() => {
            setLoading(false);
          }),
        );
      } catch (error) {
        setLoading(false);
        throw error;
      }
    },
    [Action],
  );

  return { loading, run, exec };
}
