/**
 * Blossom Server Manager for managing Blossom servers for decentralized content hosting
 * @tags nip-96, blossom, server, management
 * @related feed/relay-timeline, file/publisher
 */
import { publishEvent } from "../../extra/publish";

import { ProxySigner } from "applesauce-accounts";
import { type Action, ActionRunner } from "applesauce-actions";
import { AddBlossomServer, RemoveBlossomServer, SetDefaultBlossomServer } from "applesauce-actions/actions/blossom";
import { castUser, type User } from "applesauce-common/casts";
import { BlossomServerListFactory } from "applesauce-common/factories";
import { BLOSSOM_SERVER_LIST_KIND } from "applesauce-common/helpers/blossom";
import { defined, EventStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { FormEvent, useMemo } from "react";
import { BehaviorSubject, map } from "rxjs";
import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const user$ = pubkey$.pipe(map((p) => (p ? castUser(p, eventStore) : undefined)));

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Actions publish the server list to the user's outboxes
const actions = new ActionRunner(eventStore, new ProxySigner(signer$.pipe(defined())), async (event, relays) => {
  await publishEvent(pool, relays?.length ? relays : ["wss://relay.damus.io/", "wss://nos.lol/"], event);
});

/** Replaces the whole server list, used for reordering */
function SetBlossomServers(servers: URL[]): Action {
  return async ({ user, signer, publish }) => {
    const event = await user.replaceable(BLOSSOM_SERVER_LIST_KIND).$first(1000, undefined);
    const factory = event ? BlossomServerListFactory.modify(event) : BlossomServerListFactory.create();
    await publish(await factory.servers(servers).sign(signer), await user.outboxes$.$first(1000, undefined));
  };
}

function ServerItem({
  server,
  isDefault,
  isLast,
  onMove,
  onSetDefault,
  onRemove,
}: {
  server: URL;
  isDefault: boolean;
  isLast: boolean;
  onMove: (offset: number) => void;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <div className="relative w-6 h-6 rounded bg-base-200 flex items-center justify-center overflow-hidden shrink-0">
        <span className="text-sm">🌸</span>
        <img
          src={new URL("/favicon.ico", server).toString()}
          alt=""
          className="absolute inset-0 w-full h-full"
          onError={(e) => e.currentTarget.remove()}
        />
      </div>

      <a href={server.toString()} target="_blank" className="flex-1 min-w-0 font-mono text-sm truncate link-hover">
        {server.host}
      </a>
      {isDefault && <span className="badge badge-primary ">Default</span>}

      <div className="flex gap-1">
        <button className="btn btn-sm btn-ghost" onClick={() => onMove(-1)} disabled={isDefault} title="Move up">
          ↑
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => onMove(1)} disabled={isLast} title="Move down">
          ↓
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onSetDefault} disabled={isDefault} title="Set as default">
          ⭐
        </button>
        <button className="btn btn-sm btn-ghost text-error" onClick={onRemove} title="Remove server">
          ✕
        </button>
      </div>
    </div>
  );
}

function ServerManager({ user }: { user: User }) {
  const servers = use$(() => user.blossomServers$, [user.pubkey]);
  const outboxes = use$(() => user.outboxes$, [user.pubkey]);

  const busy$ = useMemo(() => new BehaviorSubject(false), []);
  const busy = use$(busy$);

  const error$ = useMemo(() => new BehaviorSubject<string | null>(null), []);
  const error = use$(error$);

  const run = async <Args extends unknown[]>(action: (...args: Args) => Action, ...args: Args) => {
    busy$.next(true);
    error$.next(null);
    try {
      await actions.run(action, ...args);
      return true;
    } catch (err) {
      error$.next(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      busy$.next(false);
    }
  };

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const value = String(new FormData(form).get("url") ?? "").trim();
    if (!value) return;

    let url: URL;
    try {
      url = new URL(/^https?:\/\//.test(value) ? value : `https://${value}`);
    } catch {
      return error$.next("Invalid URL");
    }

    if (await run(AddBlossomServer, url)) form.reset();
  };

  const handleMove = (index: number, offset: number) => {
    if (!servers) return;
    const next = [...servers];
    const [server] = next.splice(index, 1);
    next.splice(index + offset, 0, server);
    run(SetBlossomServers, next);
  };

  return (
    <div className="container mx-auto p-4 max-w-2xl space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2">
        <input name="url" type="text" className="input input-bordered flex-1" placeholder="blossom.example.com" />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Add
        </button>
      </form>

      {error && <div className="alert alert-error">{error}</div>}
      {outboxes?.length === 0 && (
        <div className="alert alert-warning">No outbox relays found, publish a NIP-65 relay list first</div>
      )}

      {servers === undefined ? (
        <p role="status">Loading servers…</p>
      ) : !servers.length ? (
        <div className="text-center py-12 text-base-content/60 border border-base-300 rounded">
          No Blossom servers yet
        </div>
      ) : (
        <div className={`border border-base-300 rounded divide-y divide-base-300 ${busy ? "opacity-60" : ""}`}>
          {servers.map((server, index) => (
            <ServerItem
              key={server.toString()}
              server={server}
              isDefault={index === 0}
              isLast={index === servers.length - 1}
              onMove={(offset) => handleMove(index, offset)}
              onSetDefault={() => run(SetDefaultBlossomServer, server)}
              onRemove={() => run(RemoveBlossomServer, server)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BlossomServerManager() {
  const signer = use$(signer$);
  const user = use$(user$);

  if (!signer || !user)
    return (
      <LoginView
        onLogin={(nextSigner, pubkey) => {
          signer$.next(nextSigner);
          pubkey$.next(pubkey);
        }}
      />
    );

  return <ServerManager user={user} />;
}
