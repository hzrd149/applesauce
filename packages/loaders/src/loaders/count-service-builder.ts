import type { CountRuntimeOptions } from "./count-runtime.js";
import { createCountService, type CountService, type CountServiceOptions } from "./count-service.js";
import { nip85CountSource, type Nip85CountSourceOptions } from "./count-sources/nip85.js";
import { relayCountSource } from "./count-sources/relay.js";
import { routingCountSource, type CountRoutingOptions } from "./count-sources/routing.js";
import type { CountPool, CountSource } from "./count-sources/types.js";

/** A relay URL or existing count source */
export type CountRoute = string | CountSource;
/** A list of routing children or a callback constructing nested routes */
export type CountRoutes = readonly CountRoute[] | ((route: CountRouteFactory) => readonly CountRoute[]);

/** Pool-bound constructors for count routing trees */
export interface CountRouteFactory {
  /**
   * Creates a single-relay COUNT source
   * @throws if the bound pool lacks COUNT support
   */
  relay(url: string): CountSource;
  /**
   * Creates a verified assertion source using the bound pool
   * @throws if assertion transport or batching configuration is invalid
   */
  nip85(options: Omit<Nip85CountSourceOptions, "pool">): CountSource;
  /**
   * Creates a group that tries children in preference order
   * @throws if a branch budget or child transport configuration is invalid
   */
  fallback(routes: CountRoutes, options?: CountRoutingOptions): CountSource;
  /**
   * Creates a group that rotates its first candidate across resolutions
   * @throws if a branch budget or child transport configuration is invalid
   */
  roundRobin(routes: CountRoutes, options?: CountRoutingOptions): CountSource;
  /**
   * Creates a group that selects available candidates without queueing behind busy peers
   * @throws if a branch budget or child transport configuration is invalid
   */
  availability(routes: CountRoutes, options?: CountRoutingOptions): CountSource;
}

/** Service lifecycle options independent of legacy transport limits */
export type CountBuilderOptions = Omit<
  CountServiceOptions,
  | "source"
  | "sources"
  | "pool"
  | "count"
  | "request"
  | "providers"
  | "relays"
  | "runtime"
  | "capacity"
  | "concurrency"
  | "perRelay"
  | "perProvider"
  | "queueCapacity"
  | "admissionWindow"
>;

/** An immutable configuration builder that starts work only through built service subscriptions */
export interface CountServiceBuilder {
  /** Selects an existing routing tree as the root */
  source(source: CountSource): CountServiceBuilder;
  /**
   * Selects an ordered fallback root
   * @throws if a branch budget or child transport configuration is invalid
   */
  fallback(routes: CountRoutes, options?: CountRoutingOptions): CountServiceBuilder;
  /**
   * Selects a round-robin root
   * @throws if a branch budget or child transport configuration is invalid
   */
  roundRobin(routes: CountRoutes, options?: CountRoutingOptions): CountServiceBuilder;
  /**
   * Selects an availability root
   * @throws if a branch budget or child transport configuration is invalid
   */
  availability(routes: CountRoutes, options?: CountRoutingOptions): CountServiceBuilder;
  /** Merges count lifecycle and cache configuration */
  configure(options: CountBuilderOptions): CountServiceBuilder;
  /** Configures optional transport capacity for each built service */
  capacity(options: Omit<CountRuntimeOptions, "scheduler">): CountServiceBuilder;
  /** Supplies an app-owned runtime shared across services */
  runtime(runtime: NonNullable<CountServiceOptions["runtime"]>): CountServiceBuilder;
  /**
   * Creates a demand-driven count service
   * @throws if service options or runtime capacity settings are invalid
   */
  build(): CountService;
}

/** Creates a pool-bound builder for preference-driven count retrieval */
export function countService(pool: CountPool): CountServiceBuilder {
  const route: CountRouteFactory = {
    relay: (url) => relayCountSource({ pool, relays: [url] }),
    nip85: (options) => nip85CountSource({ ...options, pool }),
    fallback: (children, options) => routingCountSource("fallback", resolve(children), options),
    roundRobin: (children, options) => routingCountSource("round-robin", resolve(children), options),
    availability: (children, options) => routingCountSource("availability", resolve(children), options),
  };
  const resolve = (children: CountRoutes) =>
    (typeof children === "function" ? children(route) : children).map((child) =>
      typeof child === "string" ? route.relay(child) : child,
    );
  const builder = (
    root?: CountSource,
    configuration: CountBuilderOptions = {},
    capacity: Omit<CountRuntimeOptions, "scheduler"> = {},
    shared?: NonNullable<CountServiceOptions["runtime"]>,
  ): CountServiceBuilder => ({
    source: (source) => builder(source, configuration, capacity, shared),
    fallback: (children, options) => builder(route.fallback(children, options), configuration, capacity, shared),
    roundRobin: (children, options) => builder(route.roundRobin(children, options), configuration, capacity, shared),
    availability: (children, options) =>
      builder(route.availability(children, options), configuration, capacity, shared),
    configure: (options) => builder(root, { ...configuration, ...options }, capacity, shared),
    capacity: (options) => builder(root, configuration, { ...capacity, ...options }, undefined),
    runtime: (runtime) => builder(root, configuration, capacity, runtime),
    build: () =>
      createCountService({
        ...configuration,
        source: root ?? route.fallback([]),
        runtime: shared,
        capacity,
      }),
  });
  return builder();
}
