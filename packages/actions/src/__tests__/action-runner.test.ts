import { EventFactory, EventStore } from "applesauce-core";
import { kinds } from "applesauce-core/helpers/event";
import { from } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Action, ActionRunner } from "../action-runner.js";
import { CreateProfile } from "../actions/profile.js";
import { FakeUser } from "./fake-user.js";

const user = new FakeUser();
let events = new EventStore();
let factory = new EventFactory({ signer: user });

beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: user });
});

describe("ActionRunner", () => {
  describe("constructor", () => {
    it("should create an ActionRunner with events and factory", () => {
      const hub = new ActionRunner(events, factory);
      expect(hub.events).toBe(events);
      expect(hub.factory).toBe(factory);
      expect(hub.saveToStore).toBe(true);
    });

    it("should create an ActionRunner with publish method", () => {
      const publish = vi.fn();
      const hub = new ActionRunner(events, factory, publish);
      expect(hub.events).toBe(events);
      expect(hub.factory).toBe(factory);
    });

    it("should create an ActionRunner with publish object", () => {
      const publish = vi.fn();
      const hub = new ActionRunner(events, factory, { publish });
      expect(hub.events).toBe(events);
      expect(hub.factory).toBe(factory);
    });
  });

  describe("run", () => {
    it("should throw if publish method is not set", async () => {
      const hub = new ActionRunner(events, factory);
      await expect(hub.run(CreateProfile, { name: "fiatjaf" })).rejects.toThrow("Missing publish method");
    });

    it("should run action and publish events using function publish method", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);

      const hub = new ActionRunner(events, factory, publish);
      await hub.run(CreateProfile, { name: "fiatjaf" });

      expect(publish).toHaveBeenCalled();
      // First call is with array of events, then individual events
      const publishedEvent = Array.isArray(publish.mock.calls[0][0])
        ? publish.mock.calls[0][0][0]
        : publish.mock.calls[0][0];
      expect(publishedEvent).toMatchObject({
        kind: kinds.Metadata,
        content: JSON.stringify({ name: "fiatjaf" }),
      });
    });

    it("should run action and publish events using object publish method", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);

      const hub = new ActionRunner(events, factory, { publish });
      await hub.run(CreateProfile, { name: "fiatjaf" });

      expect(publish).toHaveBeenCalled();
      // First call is with array of events, then individual events
      const publishedEvent = Array.isArray(publish.mock.calls[0][0])
        ? publish.mock.calls[0][0][0]
        : publish.mock.calls[0][0];
      expect(publishedEvent).toMatchObject({
        kind: kinds.Metadata,
        content: JSON.stringify({ name: "fiatjaf" }),
      });
    });

    it("should save events to store by default", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const addSpy = vi.spyOn(events, "add");

      const hub = new ActionRunner(events, factory, publish);
      await hub.run(CreateProfile, { name: "fiatjaf" });

      expect(addSpy).toHaveBeenCalled();
      const savedEvent = addSpy.mock.calls[0][0];
      expect(savedEvent).toMatchObject({
        kind: kinds.Metadata,
        content: JSON.stringify({ name: "fiatjaf" }),
      });
    });

    it("should not save events to store when saveToStore is false", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const addSpy = vi.spyOn(events, "add");

      const hub = new ActionRunner(events, factory, publish);
      hub.saveToStore = false;
      await hub.run(CreateProfile, { name: "fiatjaf" });

      expect(addSpy).not.toHaveBeenCalled();
    });

    it("should handle publish method returning Observable", async () => {
      const publish = vi.fn().mockReturnValue(from([undefined]));

      const hub = new ActionRunner(events, factory, publish);
      await hub.run(CreateProfile, { name: "fiatjaf" });

      expect(publish).toHaveBeenCalled();
    });

    it("should handle publish method returning Promise", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);

      const hub = new ActionRunner(events, factory, publish);
      await hub.run(CreateProfile, { name: "fiatjaf" });

      expect(publish).toHaveBeenCalled();
    });
  });

  describe("context", () => {
    it("should create context with correct properties", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const hub = new ActionRunner(events, factory, publish);
      const actionBuilder = () => {
        const action: Action = async function* (ctx) {
          expect(ctx.events).toBe(events);
          expect(ctx.factory).toBe(factory);
          expect(ctx.self).toBe(await user.getPublicKey());
          expect(ctx.user).toBeDefined();
          expect(ctx.signer).toBe(user);
          expect(typeof ctx.sign).toBe("function");
          expect(typeof ctx.publish).toBe("function");
          expect(typeof ctx.exec).toBe("function");
          expect(typeof ctx.run).toBe("function");
          // Yield something to complete the stream
          yield user.note("test");
        };
        return action;
      };

      await hub.run(actionBuilder);
    });

    it("should reuse context across multiple calls", async () => {
      const publish = vi.fn().mockResolvedValue(undefined);
      const hub = new ActionRunner(events, factory, publish);
      let firstContext: any;
      let secondContext: any;

      const actionBuilder1 = () => {
        const action: Action = async function* (ctx) {
          firstContext = ctx;
          yield user.note("test1");
        };
        return action;
      };

      const actionBuilder2 = () => {
        const action: Action = async function* (ctx) {
          secondContext = ctx;
          yield user.note("test2");
        };
        return action;
      };

      await hub.run(actionBuilder1);
      await hub.run(actionBuilder2);

      expect(firstContext).toBe(secondContext);
    });
  });
});
