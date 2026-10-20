/**
 * A tabbed, GitHub-style settings page for managing every field of your NIP-34 git repositories
 * @tags nip-34, git, repository, settings, editing, publishing, deletion
 * @related git/grasp-server-manager, git/favorite-repos-feed
 */
import { castUser, GitRepository, type User } from "applesauce-common/casts";
import { GitRepositoryFactory } from "applesauce-common/factories";
import { GIT_REPOSITORY_KIND, type GitRepositoryPointer } from "applesauce-common/helpers";
import { defined, DeleteFactory, EventStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  naddrEncode,
  normalizeURL,
  npubEncode,
  relaySet,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { useCallback, useMemo, useState } from "react";
import { Controller, useForm, useWatch, type Control, type UseFormSetValue } from "react-hook-form";
import { BehaviorSubject, EMPTY, map, of } from "rxjs";
import LoginView from "../../components/login-view";
import PubkeyPicker from "../../components/pubkey-picker";
import { publishEvent } from "../../extra/publish";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  extraRelays: ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/", "wss://relay.nostr.band/"],
});

// NIP-34 marks personal forks with a special hashtag
const PERSONAL_FORK_TAG = "personal-fork";
const HEX_PUBKEY = /^[0-9a-f]{64}$/i;

const TABS = [
  { id: "general", label: "General" },
  { id: "collaborators", label: "Collaborators" },
  { id: "hosting", label: "Clone & hosting" },
  { id: "relays", label: "Relays" },
  { id: "topics", label: "Topics" },
  { id: "fork", label: "Fork" },
  { id: "danger", label: "Danger zone" },
] as const;
type TabId = (typeof TABS)[number]["id"];

type RepoSettings = {
  name: string;
  description: string;
  earliestUniqueCommit: string;
  personalFork: boolean;
  webUrls: string[];
  cloneUrls: string[];
  relays: string[];
  maintainers: string[];
  hashtags: string[];
  upstreamEnabled: boolean;
  upstreamPubkey: string;
  upstreamIdentifier: string;
  upstreamRelay: string;
};

type SettingsProps = { control: Control<RepoSettings>; setValue: UseFormSetValue<RepoSettings> };

/** Reads the form values from the repository cast */
function toSettings(repo: GitRepository): RepoSettings {
  return {
    name: repo.name ?? "",
    description: repo.description ?? "",
    earliestUniqueCommit: repo.earliestUniqueCommit ?? "",
    personalFork: repo.hashtags.includes(PERSONAL_FORK_TAG),
    webUrls: repo.webUrls,
    cloneUrls: repo.cloneUrls,
    relays: repo.relays,
    maintainers: repo.maintainerPubkeys,
    hashtags: repo.hashtags.filter((t) => t !== PERSONAL_FORK_TAG),
    upstreamEnabled: !!repo.upstream,
    upstreamPubkey: repo.upstream?.pubkey ?? "",
    upstreamIdentifier: repo.upstream?.identifier ?? "",
    upstreamRelay: repo.upstream?.relays?.[0] ?? "",
  };
}

/** Builds the upstream pointer, or null when forking is disabled or incomplete */
function getUpstreamPointer(values: RepoSettings): GitRepositoryPointer | null {
  const pubkey = values.upstreamPubkey.trim().toLowerCase();
  const identifier = values.upstreamIdentifier.trim();
  if (!values.upstreamEnabled || !HEX_PUBKEY.test(pubkey) || !identifier) return null;
  const relay = values.upstreamRelay.trim();
  return { kind: GIT_REPOSITORY_KIND, pubkey, identifier, ...(relay ? { relays: [relay] } : {}) };
}

/** GRASP servers host both the git data and a relay for the repository */
function getGraspUrls(server: string, pubkey: string, identifier: string) {
  const relay = normalizeURL(server);
  const host = new URL(relay).host;
  return { relay, clone: `https://${host}/${npubEncode(pubkey)}/${identifier}.git` };
}

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

function Section({ title, description, children }: { title: string; description?: string; children: any }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-semibold">{title}</h3>
        {description ? <p className="text-sm text-base-content/60">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Editable list of strings with an add input and per-row remove buttons */
function StringListEditor({
  value,
  onChange,
  placeholder,
  normalize = (v) => v,
  empty,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  normalize?: (value: string) => string;
  empty: string;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const entry = draft.trim() && normalize(draft.trim());
    if (!entry || value.includes(entry)) return;
    onChange([...value, entry]);
    setDraft("");
  };

  return (
    <div className="border border-base-300 divide-y divide-base-300">
      {value.length === 0 ? <div className="p-3 text-sm text-base-content/60">{empty}</div> : null}
      {value.map((entry) => (
        <div key={entry} className="flex items-center gap-2 px-3 py-2">
          <code className="flex-1 truncate text-sm">{entry}</code>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => onChange(value.filter((v) => v !== entry))}
          >
            Remove
          </button>
        </div>
      ))}
      <div className="flex gap-2 p-2">
        <input
          className="input input-sm w-full font-mono"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
        />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

function MaintainerRow({ pubkey, onRemove }: { pubkey: string; onRemove?: () => void }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  const displayName = getDisplayName(profile, pubkey.slice(0, 8) + "...");
  const picture = getProfilePicture(profile, `https://robohash.org/${pubkey}.png`);

  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <img src={picture} alt={displayName} className="w-9 h-9 rounded-full border border-base-300" />
      <div className="min-w-0 flex-1">
        <div className="font-medium truncate">{displayName}</div>
        <div className="text-sm text-base-content/60 font-mono truncate">{pubkey}</div>
      </div>
      {onRemove ? (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRemove}>
          Remove
        </button>
      ) : (
        <span className="badge badge-outline">Owner</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function GeneralSettings({ repository, control }: SettingsProps & { repository: GitRepository }) {
  return (
    <div className="space-y-6">
      <Section
        title="Repository identifier"
        description="The d tag that addresses this repository. It cannot be changed."
      >
        <input className="input w-full font-mono" value={repository.identifier} disabled />
        <input className="input w-full font-mono text-sm" value={naddrEncode(repository.pointer)} readOnly />
      </Section>

      <Section title="Display name">
        <Controller
          name="name"
          control={control}
          render={({ field }) => <input className="input w-full" placeholder={repository.identifier} {...field} />}
        />
      </Section>

      <Section title="Description">
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <textarea className="textarea w-full min-h-24" placeholder="A short repository description" {...field} />
          )}
        />
      </Section>

      <Section
        title="Earliest unique commit"
        description="The root commit hash (r tag marked euc) that identifies forks and mirrors of the same project."
      >
        <Controller
          name="earliestUniqueCommit"
          control={control}
          render={({ field }) => (
            <input className="input w-full font-mono text-sm" placeholder="commit hash" {...field} />
          )}
        />
      </Section>

      <Section title="Features">
        <label className="flex items-start gap-3 cursor-pointer">
          <Controller
            name="personalFork"
            control={control}
            render={({ field }) => (
              <input
                type="checkbox"
                className="checkbox mt-1"
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
              />
            )}
          />
          <span>
            <span className="font-medium">Personal fork</span>
            <span className="block text-sm text-base-content/60">
              Tells clients this is a fork for submitting patches, not a project accepting contributions.
            </span>
          </span>
        </label>
      </Section>
    </div>
  );
}

function CollaboratorSettings({ user, control }: SettingsProps & { user: User }) {
  const [draft, setDraft] = useState("");

  return (
    <Controller
      name="maintainers"
      control={control}
      render={({ field }) => {
        const others = field.value.filter((pk) => pk !== user.pubkey);
        const canAdd = HEX_PUBKEY.test(draft) && draft !== user.pubkey && !field.value.includes(draft);

        return (
          <Section
            title="Maintainers"
            description="Other people who publish announcements for this repository and can merge patches."
          >
            <div className="border border-base-300 divide-y divide-base-300">
              <MaintainerRow pubkey={user.pubkey} />
              {others.map((pubkey) => (
                <MaintainerRow
                  key={pubkey}
                  pubkey={pubkey}
                  onRemove={() => field.onChange(field.value.filter((pk) => pk !== pubkey))}
                />
              ))}
            </div>
            <div className="flex gap-2 items-start">
              <PubkeyPicker
                value={draft}
                onChange={(pk) => setDraft(pk)}
                placeholder="Search or paste a maintainer pubkey"
                className="flex-1"
              />
              <button
                type="button"
                className="btn"
                disabled={!canAdd}
                onClick={() => {
                  field.onChange([...field.value, draft]);
                  setDraft("");
                }}
              >
                Add maintainer
              </button>
            </div>
          </Section>
        );
      }}
    />
  );
}

function GraspServerRow({
  server,
  repository,
  control,
  setValue,
}: SettingsProps & { server: string; repository: GitRepository }) {
  const [relays, cloneUrls] = useWatch({ control, name: ["relays", "cloneUrls"] });
  const urls = getGraspUrls(server, repository.event.pubkey, repository.identifier);
  const enabled = relays.includes(urls.relay) && cloneUrls.includes(urls.clone);

  // Toggling a GRASP server adds or removes both its relay and clone URL
  const toggle = (on: boolean) => {
    const opts = { shouldDirty: true };
    setValue("relays", on ? relaySet(relays, urls.relay) : relays.filter((r) => r !== urls.relay), opts);
    setValue(
      "cloneUrls",
      on ? [...new Set([...cloneUrls, urls.clone])] : cloneUrls.filter((c) => c !== urls.clone),
      opts,
    );
  };

  return (
    <label className="flex items-center gap-3 px-3 py-2 cursor-pointer">
      <input type="checkbox" className="toggle" checked={enabled} onChange={(e) => toggle(e.target.checked)} />
      <div className="min-w-0">
        <div className="font-mono text-sm truncate">{urls.relay}</div>
        <div className="font-mono text-sm text-base-content/60 truncate">{urls.clone}</div>
      </div>
    </label>
  );
}

function HostingSettings({
  repository,
  graspServers,
  control,
  setValue,
}: SettingsProps & { repository: GitRepository; graspServers?: string[] }) {
  return (
    <div className="space-y-6">
      <Section
        title="GRASP servers"
        description="Host the repository on your GRASP servers (adds a clone URL and relay)."
      >
        {graspServers?.length ? (
          <div className="border border-base-300 divide-y divide-base-300">
            {graspServers.map((server) => (
              <GraspServerRow
                key={server}
                server={server}
                repository={repository}
                control={control}
                setValue={setValue}
              />
            ))}
          </div>
        ) : (
          <div className="border border-base-300 p-3 text-sm text-base-content/60">
            You have no GRASP servers. Add some in the GRASP server manager example.
          </div>
        )}
      </Section>

      <Section title="Clone URLs" description="Git remotes people can clone or fetch from.">
        <Controller
          name="cloneUrls"
          control={control}
          render={({ field }) => (
            <StringListEditor
              value={field.value}
              onChange={field.onChange}
              placeholder="https://example.com/owner/repo.git"
              empty="No clone URLs."
            />
          )}
        />
      </Section>

      <Section title="Web URLs" description="Pages where people can browse the repository online.">
        <Controller
          name="webUrls"
          control={control}
          render={({ field }) => (
            <StringListEditor
              value={field.value}
              onChange={field.onChange}
              placeholder="https://example.com/owner/repo"
              empty="No web URLs."
            />
          )}
        />
      </Section>
    </div>
  );
}

function RelaySettings({ control }: SettingsProps) {
  return (
    <Section
      title="Repository relays"
      description="Relays where clients should send and look for patches, issues and other events for this repository."
    >
      <Controller
        name="relays"
        control={control}
        render={({ field }) => (
          <StringListEditor
            value={field.value}
            onChange={field.onChange}
            normalize={(url) => {
              try {
                return normalizeURL(url);
              } catch {
                return "";
              }
            }}
            placeholder="wss://relay.example.com"
            empty="No relays. Clients will fall back to your outboxes."
          />
        )}
      />
    </Section>
  );
}

function TopicSettings({ control }: SettingsProps) {
  const [draft, setDraft] = useState("");

  return (
    <Section title="Topics" description="Hashtags (t tags) that help people discover the repository.">
      <Controller
        name="hashtags"
        control={control}
        render={({ field }) => {
          const add = () => {
            const topic = draft.trim().replace(/^#/, "").toLowerCase();
            if (topic && topic !== PERSONAL_FORK_TAG && !field.value.includes(topic))
              field.onChange([...field.value, topic]);
            setDraft("");
          };

          return (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {field.value.length === 0 ? <span className="text-sm text-base-content/60">No topics.</span> : null}
                {field.value.map((topic) => (
                  <button
                    key={topic}
                    type="button"
                    className="badge badge-outline gap-1"
                    title="Remove topic"
                    onClick={() => field.onChange(field.value.filter((t) => t !== topic))}
                  >
                    #{topic} ✕
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input w-full"
                  placeholder="Add a topic"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== ",") return;
                    e.preventDefault();
                    add();
                  }}
                />
                <button type="button" className="btn" onClick={add} disabled={!draft.trim()}>
                  Add
                </button>
              </div>
            </div>
          );
        }}
      />
    </Section>
  );
}

function ForkSettings({
  repository,
  graspServers,
  control,
}: SettingsProps & { repository: GitRepository; graspServers?: string[] }) {
  const [enabled, upstreamPubkey, upstreamIdentifier] = useWatch({
    control,
    name: ["upstreamEnabled", "upstreamPubkey", "upstreamIdentifier"],
  });
  const pubkey = enabled && HEX_PUBKEY.test(upstreamPubkey.trim()) ? upstreamPubkey.trim().toLowerCase() : null;

  // Load the upstream author's repositories from their outboxes so we can suggest identifiers
  use$(() => {
    if (!pubkey) return EMPTY;
    return pool.subscription(
      castUser(pubkey, eventStore).outboxes$.pipe(defined()),
      { kinds: [GIT_REPOSITORY_KIND], authors: [pubkey] },
      { eventStore },
    );
  }, [pubkey]);

  const upstreamRepos = use$(
    () => (pubkey ? castUser(pubkey, eventStore).timeline$(GIT_REPOSITORY_KIND, GitRepository) : of([])),
    [pubkey],
  );
  const upstream = upstreamRepos?.find((repo) => repo.identifier === upstreamIdentifier.trim());

  return (
    <Section
      title="Upstream repository"
      description="Declare the Nostr repository this one was forked from (u tag pointing at the upstream announcement)."
    >
      <label className="flex items-center gap-3 cursor-pointer">
        <Controller
          name="upstreamEnabled"
          control={control}
          render={({ field }) => (
            <input
              type="checkbox"
              className="toggle"
              checked={field.value}
              onChange={(e) => field.onChange(e.target.checked)}
            />
          )}
        />
        <span>This repository is a fork</span>
      </label>

      {enabled ? (
        <div className="space-y-4 border border-base-300 p-4">
          <div>
            <label className="label">Upstream author</label>
            <Controller
              name="upstreamPubkey"
              control={control}
              render={({ field }) => (
                <PubkeyPicker
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Upstream author pubkey"
                  className="w-full"
                />
              )}
            />
            {upstreamPubkey && !pubkey ? <p className="text-sm text-error mt-1">Enter a valid hex pubkey.</p> : null}
          </div>

          <div>
            <label className="label">Upstream identifier</label>
            <Controller
              name="upstreamIdentifier"
              control={control}
              render={({ field }) => (
                <input
                  className="input w-full font-mono text-sm"
                  list={`upstream-${repository.uid}`}
                  placeholder="repo-name"
                  {...field}
                />
              )}
            />
            <datalist id={`upstream-${repository.uid}`}>
              {upstreamRepos?.map((repo) => (
                <option key={repo.uid} value={repo.identifier} label={repo.name} />
              ))}
            </datalist>
            {pubkey && upstreamIdentifier && !upstream ? (
              <p className="text-sm text-base-content/60 mt-1">Repository not found for this author (yet).</p>
            ) : null}
            {upstream ? (
              <p className="text-sm text-success mt-1">
                Forked from {upstream.name || upstream.identifier}
                {upstream.description ? ` — ${upstream.description}` : ""}
              </p>
            ) : null}
          </div>

          <div>
            <label className="label">Upstream relay hint (optional)</label>
            <Controller
              name="upstreamRelay"
              control={control}
              render={({ field }) => (
                <input
                  className="input w-full font-mono text-sm"
                  list={`upstream-relay-${repository.uid}`}
                  placeholder="wss://relay.example.com"
                  {...field}
                />
              )}
            />
            <datalist id={`upstream-relay-${repository.uid}`}>
              {relaySet(upstream?.relays, graspServers).map((url) => (
                <option key={url} value={url} />
              ))}
            </datalist>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

function DangerZone({
  repository,
  onDelete,
}: {
  repository: GitRepository;
  onDelete: (reason: string) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState("");
  const [reason, setReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(reason.trim());
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="border border-error">
      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold">Delete this repository</h3>
          <p className="text-sm text-base-content/60">
            Publishes a NIP-09 deletion request for the announcement. Relays and clients that honor deletions will stop
            showing it; the git data on clone servers is not removed.
          </p>
        </div>
        <input
          className="input w-full"
          placeholder="Reason (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div>
          <label className="label">
            Type <code className="font-mono">{repository.identifier}</code> to confirm
          </label>
          <input className="input w-full font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn btn-error btn-outline"
          disabled={confirm !== repository.identifier || deleting}
          onClick={handleDelete}
        >
          {deleting ? "Deleting..." : "Delete this repository"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

function RepositorySettings({
  repository,
  user,
  tab,
  onTabChange,
}: {
  repository: GitRepository;
  user: User;
  tab: TabId;
  onTabChange: (tab: TabId) => void;
}) {
  const signer = use$(signer$);
  const outboxes = use$(user.outboxes$);
  const graspServers = use$(user.graspServers$)?.servers;

  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Passing `values` resets the form whenever a new revision of the announcement arrives
  const settings = useMemo(() => toSettings(repository), [repository]);
  const {
    control,
    setValue,
    reset,
    handleSubmit,
    formState: { isDirty, isSubmitting },
  } = useForm<RepoSettings>({ values: settings });

  const values = useWatch({ control });
  const upstreamInvalid = !!values.upstreamEnabled && !getUpstreamPointer(values as RepoSettings);

  const publish = useCallback(
    async (event: Parameters<typeof publishEvent>[2], repoRelays: string[]) => {
      // Publish to our outboxes, the repository relays, and our GRASP servers
      await publishEvent(pool, relaySet(outboxes, repoRelays, graspServers), event);
    },
    [outboxes, graspServers],
  );

  const save = handleSubmit(async (values) => {
    if (!signer) return;
    try {
      setStatus(null);
      const signed = await GitRepositoryFactory.modify(repository.event)
        .name(values.name.trim() || null)
        .description(values.description.trim() || null)
        .earliestUniqueCommit(values.earliestUniqueCommit.trim() || null)
        .setWebUrls(values.webUrls)
        .setCloneUrls(values.cloneUrls)
        .setRelays(values.relays)
        .setMaintainers(values.maintainers)
        .setHashtags(values.personalFork ? [...values.hashtags, PERSONAL_FORK_TAG] : values.hashtags)
        .upstream(getUpstreamPointer(values))
        .sign(signer);

      await publish(signed, values.relays);
      eventStore.add(signed);
      setStatus({ type: "success", message: "Repository settings saved." });
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to save repository" });
    }
  });

  const deleteRepository = async (reason: string) => {
    if (!signer) return;
    try {
      setStatus(null);
      const signed = await DeleteFactory.fromEvents([repository.event], reason).sign(signer);
      await publish(signed, repository.relays);
      // The event store applies the deletion and removes the announcement from the timeline
      eventStore.add(signed);
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to delete repository" });
    }
  };

  const props = { control, setValue };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <ul className="menu w-full md:w-56 shrink-0 p-0">
        {TABS.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              className={`${tab === t.id ? "menu-active" : ""} ${t.id === "danger" ? "text-error" : ""}`}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      <form className="flex-1 min-w-0 space-y-6" onSubmit={save}>
        <h2 className="text-xl font-semibold border-b border-base-300 pb-2">{TABS.find((t) => t.id === tab)?.label}</h2>

        {status ? (
          <div className={`alert ${status.type === "error" ? "alert-error" : "alert-success"}`}>
            <span>{status.message}</span>
          </div>
        ) : null}

        {tab === "general" && <GeneralSettings repository={repository} {...props} />}
        {tab === "collaborators" && <CollaboratorSettings user={user} {...props} />}
        {tab === "hosting" && <HostingSettings repository={repository} graspServers={graspServers} {...props} />}
        {tab === "relays" && <RelaySettings {...props} />}
        {tab === "topics" && <TopicSettings {...props} />}
        {tab === "fork" && <ForkSettings repository={repository} graspServers={graspServers} {...props} />}
        {tab === "danger" && <DangerZone repository={repository} onDelete={deleteRepository} />}

        {tab !== "danger" ? (
          <div className="flex items-center gap-3 border-t border-base-300 pt-4">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!isDirty || isSubmitting || upstreamInvalid || !signer}
            >
              {isSubmitting ? "Saving..." : "Save changes"}
            </button>
            <button type="button" className="btn btn-ghost" disabled={!isDirty || isSubmitting} onClick={() => reset()}>
              Discard
            </button>
            {isDirty ? <span className="text-sm text-base-content/60">You have unsaved changes</span> : null}
            {upstreamInvalid ? <span className="text-sm text-error">Fork settings are incomplete</span> : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}

function RepositoryManagerView({ user }: { user: User }) {
  // Fetch the user's repositories from their outboxes into the store
  use$(
    () =>
      pool.subscription(
        user.outboxes$.pipe(defined()),
        { kinds: [GIT_REPOSITORY_KIND], authors: [user.pubkey] },
        { eventStore },
      ),
    [user.pubkey],
  );

  const repositories = use$(
    () =>
      user
        .timeline$(GIT_REPOSITORY_KIND, GitRepository)
        .pipe(map((repos) => [...repos].sort((a, b) => b.event.created_at - a.event.created_at))),
    [user.pubkey],
  );

  // Select by address (uid) so the selection survives new revisions
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("general");

  const selected = repositories?.find((repo) => repo.uid === selectedUid) ?? repositories?.[0];

  if (!repositories) return <div className="p-4">Loading your repositories...</div>;

  if (!selected)
    return (
      <div className="container mx-auto max-w-5xl p-4">
        <div className="border border-base-300 p-4">
          No repositories found. Publish a kind {GIT_REPOSITORY_KIND} repository announcement first, then return here.
        </div>
      </div>
    );

  return (
    <div className="container mx-auto max-w-5xl p-4 space-y-6">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-300 pb-4">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold truncate">{selected.name || selected.identifier}</h1>
          {selected.description ? <p className="text-base-content/60 truncate">{selected.description}</p> : null}
        </div>
        <select className="select w-full sm:w-72" value={selected.uid} onChange={(e) => setSelectedUid(e.target.value)}>
          {repositories.map((repo) => (
            <option key={repo.uid} value={repo.uid}>
              {repo.name || repo.identifier}
            </option>
          ))}
        </select>
      </div>

      <RepositorySettings
        key={selected.uid}
        repository={selected}
        user={user}
        tab={tab}
        onTabChange={(t) => setTab(t)}
      />
    </div>
  );
}

export default function GitRepositoryManager() {
  const user = use$(user$);

  const handleLogin = useCallback(async (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    pubkey$.next(pubkey);
  }, []);

  if (!user) return <LoginView onLogin={handleLogin} />;

  return <RepositoryManagerView user={user} />;
}
