/**
 * Browse a user's blog: pick a pubkey, see all their articles, and read them
 * @tags nip-23, content, articles, blog
 * @related articles/rendering
 */
import { relayTimeline } from "../../extra/relay-timeline";

import { useMemo } from "react";

import { Article } from "applesauce-common/casts";
import { castTimelineStream, castEventStream } from "applesauce-common/observable";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { EventStore } from "applesauce-core";
import { castUser } from "applesauce-core/casts";
import { getDisplayName, getProfilePicture, normalizeToPubkey, AddressPointer } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BehaviorSubject, map, switchMap, of } from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

const remarkPlugins = [remarkGfm, remarkNostrMentions];
const markdownComponents = {
  a: ({ ...props }: any) => <a target="_blank" rel="noopener noreferrer" {...props} />,
};

function AuthorHeader({ pubkey }: { pubkey: string }) {
  const user = castUser(pubkey, eventStore);
  const profile = use$(user.profile$);

  const displayName = getDisplayName(profile, pubkey.slice(0, 8));
  const picture = getProfilePicture(profile, `https://robohash.org/${pubkey}.png`);

  return (
    <div className="flex items-center gap-4 mb-8 pb-6 border-b border-base-300">
      <img src={picture} alt={displayName} className="w-16 h-16 rounded-full" />
      <div>
        <h2 className="text-2xl font-bold">{displayName}</h2>
        {profile?.about && <p className="text-sm opacity-70 line-clamp-2 max-w-lg">{profile.about}</p>}
      </div>
    </div>
  );
}

function ArticleCard({ article, onSelect }: { article: Article; onSelect: () => void }) {
  return (
    <div
      className="flex border border-base-300 rounded-lg overflow-hidden cursor-pointer hover:bg-base-200 transition-colors min-h-36"
      onClick={onSelect}
    >
      <div className="w-40 h-36 shrink-0 overflow-hidden bg-base-200">
        {article.image ? (
          <img src={article.image} alt="" className="size-full object-cover" />
        ) : (
          <div className="size-full flex items-center justify-center text-sm text-base-content/40">No image</div>
        )}
      </div>
      <div className="flex flex-col gap-1 p-4 overflow-hidden">
        <h3 className="text-lg font-semibold truncate">{article.title}</h3>
        <p className="text-sm opacity-60">{article.publishedDate.toLocaleDateString()}</p>
        {article.summary && <p className="line-clamp-2 text-sm opacity-80">{article.summary}</p>}
      </div>
    </div>
  );
}

function ArticleListView({ pubkey, onSelect }: { pubkey: string; onSelect: (article: Article) => void }) {
  const user = castUser(pubkey, eventStore);
  const feed = use$(
    () =>
      user.outboxes$.pipe(
        switchMap((outboxes) =>
          relayTimeline(eventStore, pool, outboxes?.length ? outboxes : ["wss://relay.damus.io/", "wss://nos.lol/"], {
            kinds: [30023],
            authors: [pubkey],
          }),
        ),
        switchMap((result) =>
          of(result.events).pipe(
            castTimelineStream(Article, eventStore),
            map((articles) => ({ ...result, articles })),
          ),
        ),
      ),
    [pubkey],
  );
  const articles = feed?.articles;

  return (
    <div>
      <AuthorHeader pubkey={pubkey} />
      {feed?.errors.map((error) => (
        <p role="alert" className="text-error" key={error}>
          {error}
        </p>
      ))}

      {feed?.status === "loading" && <div className="text-center py-8 opacity-60">Loading articles...</div>}

      {feed?.status !== "loading" && articles && articles.length === 0 && (
        <div className="text-center py-8 opacity-60">No articles found for this user.</div>
      )}

      {articles && articles.length > 0 && (
        <div className="space-y-3">
          {articles.map((article) => (
            <ArticleCard key={article.uid} article={article} onSelect={() => onSelect(article)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleReadView({ article, onBack }: { article: Article; onBack: () => void }) {
  const author = article.author;
  const profile = use$(author.profile$);

  return (
    <div className="container mx-auto my-8 max-w-3xl px-4">
      <button className="btn btn-ghost gap-2 mb-6" onClick={onBack}>
        ← Back to Blog
      </button>

      {article.image && (
        <img src={article.image} alt={article.title} className="w-full h-64 object-cover rounded-lg mb-8" />
      )}

      <article className="prose prose-lg dark:prose-invert max-w-none">
        <h1>{article.title}</h1>
        <p className="lead">By {profile?.displayName || author.npub.slice(0, 8)}</p>

        <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
          {article.event.content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

export default function Blog() {
  const state$ = useMemo(
    () =>
      new BehaviorSubject({
        pubkey: normalizeToPubkey("npub1klkk3vrzme455yh9rl2jshq7rc8dpegj3ndf82c3ks2sk40dxt7qulx3vt"),
        selected: undefined as AddressPointer | undefined,
      }),
    [],
  );
  const { pubkey, selected: pointer } = use$(state$);
  const update = (value: Partial<typeof state$.value>) => state$.next({ ...state$.value, ...value });
  const selected = use$(
    () => (pointer ? eventStore.replaceable(pointer).pipe(castEventStream(Article, eventStore)) : undefined),
    [pointer],
  );

  if (selected) {
    return <ArticleReadView article={selected} onBack={() => update({ selected: undefined })} />;
  }

  return (
    <div className="container mx-auto max-w-3xl p-4">
      <div className="py-8">
        <h1 className="text-4xl font-bold mb-8">Blog</h1>

        <div className="mb-8">
          <PubkeyPicker
            value={pubkey}
            onChange={(pubkey) => update({ pubkey, selected: undefined })}
            placeholder="Enter author pubkey or nostr identifier..."
          />
        </div>

        {pubkey && <ArticleListView pubkey={pubkey} onSelect={(article) => update({ selected: article.pointer })} />}
      </div>
    </div>
  );
}
