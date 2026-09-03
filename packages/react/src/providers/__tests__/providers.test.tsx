// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";
import type { AccountManager } from "applesauce-accounts";
import type { ActionRunner } from "applesauce-actions";
import type { IEventStore } from "applesauce-core";
import { useAccountManager } from "../../hooks/use-account-manager.js";
import { useActionRunner } from "../../hooks/use-action-runner.js";
import { useEventStore } from "../../hooks/use-event-store.js";
import { AccountsProvider } from "../accounts-provider.js";
import { ActionsProvider } from "../actions-provider.js";
import { EventStoreProvider } from "../store-provider.js";

const store = (name: string) => ({ name }) as unknown as IEventStore;
const manager = (name: string) => ({ name }) as unknown as AccountManager;
const runner = (name: string) => ({ name }) as unknown as ActionRunner;

describe("provider hooks", () => {
  it("preserves the exact missing-provider contracts", () => {
    expect(() => renderHook(() => useEventStore())).toThrow("Missing EventStoreProvider");
    expect(() => renderHook(() => useActionRunner())).toThrow("Missing ActionsProvider");
    expect(() => renderHook(() => useAccountManager())).toThrow("Missing AccountsProvider");
    expect(renderHook(() => useAccountManager(false)).result.current).toBeUndefined();
  });

  it("adopts replacement provider identities through public hooks", () => {
    const firstStore = store("first");
    const secondStore = store("second");
    const firstManager = manager("first");
    const secondManager = manager("second");
    const firstRunner = runner("first");
    const secondRunner = runner("second");
    let values: [IEventStore, AccountManager, ActionRunner] = [firstStore, firstManager, firstRunner];
    const wrapper = ({ children }: PropsWithChildren) => (
      <EventStoreProvider eventStore={values[0]}>
        <AccountsProvider manager={values[1]}>
          <ActionsProvider runner={values[2]}>{children}</ActionsProvider>
        </AccountsProvider>
      </EventStoreProvider>
    );
    const { result, rerender } = renderHook(() => [useEventStore(), useAccountManager(), useActionRunner()] as const, {
      wrapper,
    });

    expect(result.current).toEqual([firstStore, firstManager, firstRunner]);
    values = [secondStore, secondManager, secondRunner];
    rerender();
    expect(result.current).toEqual([secondStore, secondManager, secondRunner]);
  });

  it("resolves nearest providers and reveals outer providers when nesting is removed", () => {
    const outer = [store("outer"), manager("outer"), runner("outer")] as const;
    const inner = [store("inner"), manager("inner"), runner("inner")] as const;
    let nested = true;
    const wrapper = ({ children }: PropsWithChildren) => (
      <EventStoreProvider eventStore={outer[0]}>
        <AccountsProvider manager={outer[1]}>
          <ActionsProvider runner={outer[2]}>
            {nested ? (
              <EventStoreProvider eventStore={inner[0]}>
                <AccountsProvider manager={inner[1]}>
                  <ActionsProvider runner={inner[2]}>{children}</ActionsProvider>
                </AccountsProvider>
              </EventStoreProvider>
            ) : (
              children
            )}
          </ActionsProvider>
        </AccountsProvider>
      </EventStoreProvider>
    );
    const { result, rerender } = renderHook(() => [useEventStore(), useAccountManager(), useActionRunner()] as const, {
      wrapper,
    });

    expect(result.current).toEqual(inner);
    nested = false;
    rerender();
    expect(result.current).toEqual(outer);
  });
});
