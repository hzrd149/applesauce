import { getArticleImage, getArticlePublished, getArticleSummary, getArticleTitle } from "applesauce-common/helpers";
import { remarkNostrMentions } from "applesauce-content/markdown";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { NostrEvent, npubEncode } from "applesauce-core/helpers";
import { useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { map } from "rxjs/operators";

import RelayPicker from "../../components/relay-picker";

const eventStore = new EventStore();
const pool = new RelayPool();

// Component for a single article card in the list
function ArticleCard({ article, onClick }: { article: NostrEvent; onClick: () => void }) {
  return (
    <div className="card card-side bg-base-100 shadow-sm h-48">
      <figure className="w-48 min-w-48 h-full">
        <img src={getArticleImage(article)} alt={getArticleTitle(article)} className="w-full h-full object-cover" />
      </figure>
      <div className="card-body overflow-hidden">
        <h2 className="card-title text-lg truncate">{getArticleTitle(article)}</h2>
        <p className="text-sm opacity-70">
          By {npubEncode(article.pubkey).slice(0, 8)} •{" "}
          {new Date(getArticlePublished(article) * 1000).toLocaleDateString()}
        </p>
        <p className="line-clamp-2">{getArticleSummary(article)}</p>
        <div className="card-actions justify-end mt-auto">
          <button className="btn btn-primary" onClick={onClick}>
            Read
          </button>
        </div>
      </div>
    </div>
  );
}

// Component for the article list view
function ArticleList({
  articles,
  onArticleSelect,
}: {
  articles: NostrEvent[];
  onArticleSelect: (article: NostrEvent) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold mb-6">Recent Articles</h2>
      {articles.map((article, index) => (
        <ArticleCard key={index} article={article} onClick={() => onArticleSelect(article)} />
      ))}
    </div>
  );
}

// Component for the full article view
function ArticleView({ article, onBack }: { article: NostrEvent; onBack: () => void }) {
  return (
    <div className="container mx-auto my-8 max-w-4xl px-4">
      <div className="py-4">
        <button className="btn btn-ghost gap-2 mb-4" onClick={onBack}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Articles
        </button>

        {getArticleImage(article) && (
          <div className="w-full h-[300px] mb-6 rounded-lg overflow-hidden">
            <img src={getArticleImage(article)} alt={getArticleTitle(article)} className="w-full h-full object-cover" />
          </div>
        )}

        <h1 className="text-4xl font-bold mb-4">{getArticleTitle(article)}</h1>
        <p className="text-lg opacity-70 mb-8">By {npubEncode(article.pubkey).slice(0, 8)}</p>

        <div className="prose prose-lg max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkNostrMentions]}
            components={{
              // Custom styling for markdown elements
              h1: ({ node, ...props }) => <h1 className="text-3xl font-bold my-4" {...props} />,
              h2: ({ node, ...props }) => <h2 className="text-2xl font-bold my-3" {...props} />,
              p: ({ node, ...props }) => <p className="my-2" {...props} />,
              a: ({ node, ...props }) => <a className="link link-primary" target="_blank" {...props} />,
              ul: ({ node, ...props }) => <ul className="list-disc ml-4 my-2" {...props} />,
              ol: ({ node, ...props }) => <ol className="list-decimal ml-4 my-2" {...props} />,
              blockquote: ({ node, ...props }) => (
                <blockquote className="border-l-4 border-primary pl-4 my-2" {...props} />
              ),
              code: ({ node, ...props }) => <code className="bg-base-300 rounded px-1" {...props} />,
              pre: ({ node, ...props }) => <pre className="bg-base-300 rounded p-4 my-2 overflow-x-auto" {...props} />,
            }}
          >
            {article.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

// Main component that orchestrates the entire view
export default function ArticleViewer() {
  const [relay, setRelay] = useState<string>("wss://relay.primal.net/");
  const [selected, setSelected] = useState<NostrEvent | null>(null);

  // Create a timeline observable for articles
  const articles = useObservableMemo(
    () =>
      pool
        .relay(relay)
        .subscription({
          kinds: [30023],
          since: Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60, // Last 30 days
        })
        .pipe(
          // Only get events from relay (ignore EOSE)
          onlyEvents(),
          // deduplicate events using the event store
          mapEventsToStore(eventStore),
          // collect all events into a timeline
          mapEventsToTimeline(),
          // Duplicate the timeline array to make react happy
          map((t) => [...t]),
        ),
    [relay],
  );

  if (selected) {
    return <ArticleView article={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="container mx-auto max-w-6xl p-4">
      <div className="py-8">
        <h1 className="text-4xl font-bold mb-8">Articles</h1>
        <RelayPicker value={relay} onChange={setRelay} />

        {relay && articles && <ArticleList articles={articles} onArticleSelect={setSelected} />}
      </div>
    </div>
  );
}
