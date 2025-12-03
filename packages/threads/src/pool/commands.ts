import type { NostrEvent } from "applesauce-core/helpers/event";
import type { Filter } from "applesauce-core/helpers/filter";
import type { FilterMap, OutboxMap } from "applesauce-core/helpers/relay-selection";
import type { GroupNegentropySyncOptions, GroupRequestOptions, GroupSubscriptionOptions } from "applesauce-relay/group";
import type { NegentropySyncOptions, ReconcileFunction } from "applesauce-relay/negentropy";
import type { SyncDirection } from "applesauce-relay/relay";
import type {
  AuthSigner,
  CountResponse,
  FilterInput,
  NegentropyReadStore,
  NegentropySyncStore,
  PublishOptions,
  PublishResponse,
  RelayInformation,
  RequestOptions,
  SubscriptionOptions,
  SubscriptionResponse,
} from "applesauce-relay/types";
import type { RPCCommandDirectory } from "../common/interface.js";

/**
 * RPC Commands for RelayPool operations
 * Payloads are const arrays (tuples) for better serialization
 */
export interface RelayPoolCommands extends RPCCommandDirectory {
  // Observable properties - exposed as streaming commands
  poolRelays$: {
    payload: [];
    result: Array<[string, unknown]>; // Serialized Map entries
  };
  poolAdd$: {
    payload: [];
    result: { url: string }; // Serialized IRelay info
  };
  poolRemove$: {
    payload: [];
    result: { url: string }; // Serialized IRelay info
  };

  // Basic pool methods
  poolRelay: {
    payload: [url: string];
    result: { url: string }; // Return relay URL as identifier
  };
  poolRemove: {
    payload: [relay: string, close?: boolean];
    result: void;
  };

  // Methods that return Observables
  poolReq: {
    payload: [relays: string[], filters: FilterInput, id?: string];
    result: SubscriptionResponse;
  };
  poolEvent: {
    payload: [relays: string[], event: NostrEvent];
    result: PublishResponse;
  };
  poolRequest: {
    payload: [relays: string[], filters: FilterInput, opts?: GroupRequestOptions];
    result: NostrEvent;
  };
  poolSubscription: {
    payload: [relays: string[], filters: FilterInput, options?: GroupSubscriptionOptions];
    result: SubscriptionResponse;
  };
  poolCount: {
    payload: [relays: string[], filters: Filter | Filter[], id?: string];
    result: Record<string, CountResponse>;
  };
  poolSync: {
    payload: [relays: string[], store: NegentropySyncStore | NostrEvent[], filter: Filter, direction?: SyncDirection];
    result: NostrEvent;
  };

  // Methods that return Promises
  poolNegentropy: {
    payload: [
      relays: string[],
      store: NegentropyReadStore,
      filter: Filter,
      reconcile: ReconcileFunction,
      opts?: GroupNegentropySyncOptions,
    ];
    result: boolean;
  };
  poolPublish: {
    payload: [
      relays: string[],
      event: NostrEvent,
      opts?: Parameters<import("applesauce-relay/types").IGroup["publish"]>[1],
    ];
    result: PublishResponse[];
  };

  // Advanced subscription methods
  poolSubscriptionMap: {
    payload: [relays: FilterMap, options?: GroupSubscriptionOptions];
    result: SubscriptionResponse;
  };
  poolOutboxSubscription: {
    payload: [outboxes: OutboxMap, filter: Omit<Filter, "authors">, options?: GroupSubscriptionOptions];
    result: SubscriptionResponse;
  };
}

/**
 * RPC Commands for single Relay operations
 * Payloads are const arrays (tuples) for better serialization
 */
export interface RelayCommands extends RPCCommandDirectory {
  // Observable properties
  relayMessage$: {
    payload: [url: string];
    result: unknown;
  };
  relayNotice$: {
    payload: [url: string];
    result: string;
  };
  relayConnected$: {
    payload: [url: string];
    result: boolean;
  };
  relayChallenge$: {
    payload: [url: string];
    result: string | null;
  };
  relayAuthenticated$: {
    payload: [url: string];
    result: boolean;
  };
  relayNotices$: {
    payload: [url: string];
    result: string[];
  };
  relayOpen$: {
    payload: [url: string];
    result: Event;
  };
  relayClose$: {
    payload: [url: string];
    result: CloseEvent;
  };
  relayClosing$: {
    payload: [url: string];
    result: void;
  };
  relayError$: {
    payload: [url: string];
    result: Error | null;
  };

  // Properties (read-only)
  relayConnected: {
    payload: [url: string];
    result: boolean;
  };
  relayAuthenticated: {
    payload: [url: string];
    result: boolean;
  };
  relayChallenge: {
    payload: [url: string];
    result: string | null;
  };
  relayNotices: {
    payload: [url: string];
    result: string[];
  };

  // Methods
  relayClose: {
    payload: [url: string];
    result: void;
  };
  relayReq: {
    payload: [url: string, filters: FilterInput, id?: string];
    result: SubscriptionResponse;
  };
  relayCount: {
    payload: [url: string, filters: Filter | Filter[], id?: string];
    result: CountResponse;
  };
  relayEvent: {
    payload: [url: string, event: NostrEvent];
    result: PublishResponse;
  };
  relayAuth: {
    payload: [url: string, event: NostrEvent];
    result: PublishResponse;
  };
  relayNegentropy: {
    payload: [
      url: string,
      store: NegentropyReadStore,
      filter: Filter,
      reconcile: ReconcileFunction,
      opts?: NegentropySyncOptions,
    ];
    result: boolean;
  };
  relayAuthenticate: {
    payload: [url: string, signer: AuthSigner];
    result: PublishResponse;
  };
  relayPublish: {
    payload: [url: string, event: NostrEvent, opts?: PublishOptions];
    result: PublishResponse;
  };
  relayRequest: {
    payload: [url: string, filters: FilterInput, opts?: RequestOptions];
    result: NostrEvent;
  };
  relaySubscription: {
    payload: [url: string, filters: FilterInput, opts?: SubscriptionOptions];
    result: SubscriptionResponse;
  };
  relaySync: {
    payload: [url: string, store: NegentropySyncStore, filter: Filter, direction?: SyncDirection];
    result: NostrEvent;
  };
  relayGetInformation: {
    payload: [url: string];
    result: RelayInformation | null;
  };
  relayGetLimitations: {
    payload: [url: string];
    result: RelayInformation["limitation"] | null;
  };
  relayGetSupported: {
    payload: [url: string];
    result: number[] | null;
  };
}

/**
 * Combined RPC Commands for both RelayPool and single Relay operations
 */
export type AllRelayCommands = RelayPoolCommands & RelayCommands;
