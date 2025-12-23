import { useCallback, useRef, useState } from "react";
import { finalize } from "rxjs";
import { ActionBuilder } from "applesauce-actions";

import { useActionRunner } from "./use-action-hub.js";

export function useAction<Args extends Array<any>>(Action: ActionBuilder<Args>, args: Args | undefined) {
  const [loading, setLoading] = useState(false);
  const ref = useRef(args);
  ref.current = args;

  const hub = useActionRunner();
  const run = useCallback(async () => {
    if (args === undefined) return;

    setLoading(true);
    try {
      await hub.run(Action, ...args);
      setLoading(false);
    } catch (error) {
      setLoading(false);
      throw error;
    }
  }, [Action]);

  const exec = useCallback(() => {
    if (args === undefined) return;

    setLoading(true);
    try {
      return hub.exec(Action, ...args).pipe(
        finalize(() => {
          setLoading(false);
        }),
      );
    } catch (error) {
      setLoading(false);
      throw error;
    }
  }, [Action]);

  return { loading, run, exec };
}
