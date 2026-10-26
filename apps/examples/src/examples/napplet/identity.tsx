/**
 * Run a built-in napplet that reads your identity and performs common social actions through the kehto host
 * @tags nip-5d, napplet, identity, kehto, contacts, reactions, reports
 * @related napplet/loader, napplet/browser
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { castUser, User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { finalizeEvent, generateSecretKey, npubEncode, type EventTemplate } from "applesauce-core/helpers";
import { createKehtoIdentityService, createKehtoCommonService, type KehtoContext } from "applesauce-extra/kehto";
import { createKehtoHost, type KehtoNappletInstance } from "applesauce-extra/kehto/host";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { ArrowDownLeft, ArrowUpRight, LogIn, LogOut } from "lucide-react";
import { useRef } from "react";
import { BehaviorSubject, distinctUntilChanged, map, Observable, skip } from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";
// The built-in napplet is bundled into one HTML string by the vite config
import NAPPLET_HTML from "../../napplets/identity/index.html?napplet";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const MAX_LOG = 100;

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);

type Prompt = { template: EventTemplate; resolve: (ok: boolean) => void };
const prompts$ = new BehaviorSubject<Prompt[]>([]);

type LogEntry = { id: number; direction: "in" | "out"; type: string; error?: string };
const log$ = new BehaviorSubject<LogEntry[]>([]);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

let logId = 0;
function addLog(direction: LogEntry["direction"], type: string, error?: string) {
  log$.next([{ id: logId++, direction, type, error }, ...log$.value].slice(0, MAX_LOG));
}

/** Queues a signing prompt for the host UI and waits for the user to answer it */
function approve(template: EventTemplate) {
  return new Promise<boolean>((resolve) => prompts$.next([...prompts$.value, { template, resolve }]));
}

function answer(prompt: Prompt, ok: boolean) {
  prompts$.next(prompts$.value.filter((current) => current !== prompt));
  prompt.resolve(ok);
}

const kehtoContext: KehtoContext = {
  pool,
  eventStore,
  signer: signer$,
  fallbackRelays: FALLBACK_RELAYS,
  // Every request is prompted so each common action visibly passes through the host
  approve: ({ template }) => approve(template),
};

/** Wraps every applesauce service so the requests and results passing through the bridge are logged */
function loggedServices() {
  const services: Record<string, ReturnType<typeof createKehtoIdentityService>> = {
    identity: createKehtoIdentityService(kehtoContext),
    common: createKehtoCommonService(kehtoContext),
  };

  for (const [name, service] of Object.entries(services)) {
    services[name] = {
      ...service,
      handleMessage: (windowId, message, send) => {
        addLog("in", message.type);

        service.handleMessage(windowId, message, (result) => {
          const { ok, error } = result as { ok?: boolean; error?: unknown };
          const failed = ok === false || typeof error === "string";
          addLog("out", result.type, failed ? String(error ?? "failed") : undefined);
          send(result);
        });
      },
    };
  }

  return services;
}

// Register only the services this napplet uses
const host = createKehtoHost(kehtoContext, { services: loggedServices() });

// The host pushes identity.changed itself, outside the services
const identitySubscription = user$
  .pipe(
    map((user) => user?.pubkey ?? ""),
    distinctUntilChanged(),
    skip(1),
  )
  .subscribe(() => addLog("out", "identity.changed"));

import.meta.hot?.dispose(() => {
  identitySubscription.unsubscribe();
  host.destroy();
});

// The manifest is signed with a throwaway key; its x tag pins the sha256 of the HTML bytes
const nappletBytes = new TextEncoder().encode(NAPPLET_HTML);
const nappletManifest = finalizeEvent(
  {
    kind: 35129,
    content: "Identity demo",
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", "identity-demo"],
      ["x", bytesToHex(sha256(nappletBytes))],
    ],
  },
  generateSecretKey(),
);

/** Resolves a fresh napplet instance on subscribe and destroys it on unsubscribe */
function nappletInstance$() {
  return new Observable<KehtoNappletInstance>((subscriber) => {
    let closed = false;
    let instance: KehtoNappletInstance | undefined;

    host.resolve(nappletManifest, { fetchBlob: async () => nappletBytes }).then(
      (resolved) => {
        if (closed) return resolved.destroy();
        instance = resolved;
        subscriber.next(resolved);
      },
      (error) => subscriber.error(error),
    );

    return () => {
      closed = true;
      instance?.destroy();
    };
  });
}

// ---- UI

function Toolbar({ onLogin }: { onLogin: () => void }) {
  const user = use$(user$);
  const profile = use$(() => user?.profile$, [user]);
  // Keep the relay and contact lists loaded so actions route and modify them without waiting
  use$(() => user?.outboxes$, [user]);
  use$(() => user?.contacts$, [user]);

  const logout = () => {
    forgetActiveAccount();
    signer$.next(undefined);
    user$.next(undefined);
  };

  return (
    <div className="flex items-center gap-2 p-2 border-b border-base-300">
      <span className="flex-1" />
      {user ? (
        <>
          <img
            className="w-6 h-6 rounded-full"
            src={profile?.picture || `https://robohash.org/${user.pubkey}.png`}
            alt=""
          />
          <span className="truncate" title={npubEncode(user.pubkey)}>
            {profile?.displayName || user.npub.slice(0, 12)}
          </span>
          <button aria-label="Logout" title="Logout" className="btn btn-sm btn-ghost btn-square" onClick={logout}>
            <LogOut className="w-4 h-4" />
          </button>
        </>
      ) : (
        <button className="btn btn-sm" onClick={onLogin}>
          <LogIn className="w-4 h-4" /> Login
        </button>
      )}
    </div>
  );
}

function NappletFrame() {
  const instance = use$(() => nappletInstance$(), []);
  const prompts = use$(prompts$);

  return (
    <div className="flex flex-col flex-1 min-w-0">
      {prompts.map((prompt, index) => (
        <div key={index} className="flex items-center gap-2 p-2 border-b border-warning bg-warning/10">
          <span className="badge badge-warning">kind {prompt.template.kind}</span>
          <span className="flex-1" />
          <button className="btn btn-sm" onClick={() => answer(prompt, false)}>
            Deny
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => answer(prompt, true)}>
            Allow
          </button>
        </div>
      ))}
      {instance ? (
        <iframe
          key={instance.windowId}
          ref={(iframe) => {
            if (iframe) instance.mount(iframe);
          }}
          sandbox="allow-scripts"
          className="flex-1"
          title="Identity demo napplet"
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <span className="loading loading-spinner" />
        </div>
      )}
    </div>
  );
}

function MessageLog() {
  const entries = use$(log$);

  return (
    <div className="w-80 shrink-0 border-l border-base-300 overflow-y-auto font-mono text-sm">
      {entries.length === 0 && <div className="p-2 text-base-content/60">No messages yet</div>}
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-center gap-2 px-2 py-1 border-b border-base-300" title={entry.error}>
          {entry.direction === "in" ? (
            <ArrowUpRight className="w-4 h-4 shrink-0 text-info" />
          ) : (
            <ArrowDownLeft className="w-4 h-4 shrink-0 text-success" />
          )}
          <span className="flex-1 truncate">{entry.type}</span>
          {entry.error && <span>❌</span>}
        </div>
      ))}
    </div>
  );
}

export default function NappletIdentity() {
  const login = useRef<HTMLDialogElement>(null);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
    login.current?.close();
  };

  return (
    <div className="flex flex-col min-h-0 grow">
      <Toolbar onLogin={() => login.current?.showModal()} />
      <div className="flex min-h-0 flex-1">
        <NappletFrame />
        <MessageLog />
      </div>

      <dialog className="modal" ref={login}>
        <div className="modal-box max-w-sm overflow-hidden border border-base-300 bg-base-200 p-0 shadow-none">
          <LoginView onLogin={handleLogin} />
        </div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}
