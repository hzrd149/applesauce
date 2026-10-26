import type { NappletArtifactCache, ResolvedNapplet } from "@kehto/nip/5d";
import type { NappletMessage, ShellBridge, ShellEnvironment } from "@kehto/shell";
import type { NostrEvent } from "applesauce-core/helpers";
import type { KehtoServicesOptions } from "../services.js";
import type { KehtoShellOverrides } from "./adapter.js";

/** Options for an applesauce-backed browser napplet host */
export interface KehtoHostOptions extends KehtoServicesOptions {
  /** Partial shell hooks that extend the applesauce defaults */
  shell?: KehtoShellOverrides;
  /** The application-owned verified artifact cache */
  cache?: NappletArtifactCache;
  /** The artifact fetch implementation (default global fetch) */
  fetch?: typeof fetch;
  /** The maximum time from mounting to document load and shell initialization (default 10000ms) */
  readyTimeout?: number;
}

/** Options for resolving one napplet artifact */
export interface KehtoResolveOptions {
  /** The cache to use instead of the host cache */
  cache?: NappletArtifactCache;
  /** The custom blob fetcher, whose bytes kehto still verifies */
  fetchBlob?: (hash: string, servers: readonly string[]) => Promise<Uint8Array>;
}

/** A verified napplet instance with an independent iframe lifecycle */
export interface KehtoNappletInstance {
  /** The unique runtime window identifier */
  readonly windowId: string;
  /** Whether resolution used cached artifact bytes or invoked a blob fetcher */
  readonly source: "cache" | "fetch";
  /** The verified artifact and manifest */
  readonly resolved: ResolvedNapplet;
  /** The environment granted at mount time, or undefined before mounting */
  readonly environment: ShellEnvironment | undefined;
  /** The mounted iframe window, or undefined before mounting and after destruction */
  readonly window: Window | undefined;
  /** Whether this instance has been destroyed */
  readonly destroyed: boolean;
  /**
   * Mounts the verified document into a connected, application-owned iframe
   * @throws if the host or instance is destroyed, or the iframe is already in use
   */
  mount(iframe: HTMLIFrameElement): void;
  /**
   * Waits for document load and kehto to accept shell.ready and queue shell.init
   * @throws if initialization times out or the instance is destroyed
   */
  whenReady(): Promise<void>;
  /** Sends a host message using current recipient permissions, returning false when unavailable or denied */
  send<Message extends NappletMessage>(message: Message): boolean;
  /**
   * Releases this instance's runtime resources without removing the iframe element
   * @throws an AggregateError if custom cleanup hooks fail after releasing remaining resources
   */
  destroy(): void;
}

/** A browser host sharing one applesauce context across running napplets */
export interface KehtoHost {
  /** The kehto bridge for consent, ACL configuration, and advanced runtime integration */
  readonly bridge: ShellBridge;
  /**
   * Resolves and verifies an artifact without creating an iframe
   * @throws if resolution fails or the host is destroyed
   */
  resolve(event: NostrEvent, options?: KehtoResolveOptions): Promise<KehtoNappletInstance>;
  /**
   * Destroys every owned instance and service without closing application infrastructure
   * @throws an AggregateError if cleanup hooks fail after releasing remaining resources
   */
  destroy(): void;
}
