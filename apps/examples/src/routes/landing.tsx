import { Search, X } from "lucide-react";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import SettingsButton from "../components/settings-modal";
import examples, { categories, getCategoryLabel, searchExamples, type Example } from "../examples";

// Rows draw their own right and bottom borders so the list can switch to two columns on wide screens
const grid = "grid border-s border-t border-base-300 xl:grid-cols-2";

// The building blocks most social clients need, shown before the full category list
const FEATURED = [
  "outbox/client-startup",
  "outbox/social-feed",
  "notes/rendering",
  "notes/composing",
  "threading/note-thread",
  "loader/infinite-scroll",
  "signers/accounts",
  "simple/profile-editor",
  "contacts/manager",
  "messages/gift-wrap",
  "notifications/mentions",
  "zap/zap-modal",
];
const featured = FEATURED.map((id) => examples.find((e) => e.id === id)).filter((e) => e !== undefined);

function CategoryNav({
  counts,
  active,
  onSelect,
}: {
  counts: Map<string, number>;
  active: string;
  onSelect: (category: string) => void;
}) {
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const item = (id: string, label: string, count: number) => (
    <li key={id}>
      <button
        type="button"
        aria-current={active === id ? "page" : undefined}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-base-200 ${active === id ? "bg-base-200 font-semibold" : ""} ${count === 0 ? "text-base-content/40" : ""}`}
        onClick={() => onSelect(id)}
      >
        <span className="flex-1 truncate">{label}</span>
        <span className="text-sm text-base-content/60">{count}</span>
      </button>
    </li>
  );

  return (
    <aside className="hidden w-64 shrink-0 overflow-y-auto border-e border-base-300 py-2 md:block">
      <ul aria-label="Categories">
        {item("", "All examples", total)}
        {categories.map((c) => item(c.id, c.label, counts.get(c.id) ?? 0))}
      </ul>
    </aside>
  );
}

function ExampleRow({
  example,
  showCategory,
  onTag,
}: {
  example: Example;
  showCategory: boolean;
  onTag: (tag: string) => void;
}) {
  return (
    <li className="flex flex-col gap-2 border-e border-b border-base-300 p-3 hover:bg-base-200 sm:flex-row sm:items-start xl:flex-col xl:last:odd:col-span-2">
      <Link to={`/example/${example.id}`} className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-mono font-semibold">
          {showCategory && <span className="font-normal text-base-content/60">{example.category} / </span>}
          {example.title}
        </span>
        {example.metadata.description && (
          <span className="line-clamp-2 text-base-content/70">{example.metadata.description}</span>
        )}
      </Link>
      {example.metadata.tags && (
        <div className="flex flex-wrap gap-1 sm:max-w-72 sm:justify-end xl:max-w-none xl:justify-start">
          {example.metadata.tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="badge badge-lg cursor-pointer border-base-300 bg-base-100 hover:border-primary"
              onClick={() => onTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

export default function LandingPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const tag = params.get("tag") ?? "";

  const setParam = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: key === "q" },
    );

  // Search and tag filters narrow the category counts, the category picks which matches are shown
  const matches = useMemo(
    () => searchExamples(query).filter((e) => !tag || e.metadata.tags?.includes(tag)),
    [query, tag],
  );
  const counts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of matches) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
    return counts;
  }, [matches]);
  const results = category ? matches.filter((e) => e.category === category) : matches;

  const searching = query.trim().length > 0;
  const sections = categories
    .map((c) => ({ ...c, examples: results.filter((e) => e.category === c.id) }))
    .filter((c) => c.examples.length > 0);

  const row = (example: Example, showCategory = searching) => (
    <ExampleRow key={example.id} example={example} showCategory={showCategory} onTag={(t) => setParam("tag", t)} />
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-none items-center gap-3 border-b border-base-300 px-3 py-2">
        <a href="https://applesauce.build" className="flex-none">
          <img src="./icon.svg" alt="applesauce" className="size-10" />
        </a>
        <h1 className="flex-1 text-xl font-bold">
          Applesauce Examples <span className="font-normal text-base-content/60">{examples.length}</span>
        </h1>
        <a className="btn btn-ghost hidden sm:inline-flex" href="https://applesauce.build">
          Documentation
        </a>
        <a className="btn btn-ghost hidden sm:inline-flex" href="https://applesauce.build/typedoc/">
          Reference
        </a>
        <SettingsButton />
      </header>

      <div className="flex min-h-0 flex-1">
        <CategoryNav counts={counts} active={category} onSelect={(c) => setParam("category", c)} />

        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <label className="input input-lg w-full flex-none">
            <Search className="size-5 opacity-50" />
            <input
              type="search"
              autoFocus
              placeholder="Search examples by name, NIP, tag or description..."
              value={query}
              onChange={(e) => setParam("q", e.target.value)}
            />
          </label>

          <div className="flex flex-none flex-wrap items-center gap-2">
            <select
              className="select md:hidden"
              aria-label="Category"
              value={category}
              onChange={(e) => setParam("category", e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} ({counts.get(c.id) ?? 0})
                </option>
              ))}
            </select>
            <span className="text-base-content/60">
              {results.length} {results.length === 1 ? "example" : "examples"}
              {category && ` in ${getCategoryLabel(category)}`}
            </span>
            {tag && (
              <button type="button" className="btn btn-primary" onClick={() => setParam("tag", "")}>
                {tag} <X className="size-4" />
              </button>
            )}
            {(query || category || tag) && (
              <button type="button" className="btn btn-ghost" onClick={() => setParams({})}>
                Clear filters
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <p className="py-12 text-center text-lg text-base-content/60">No examples match the current filters</p>
          ) : searching ? (
            <ul className={grid}>{results.map((e) => row(e))}</ul>
          ) : (
            <>
              {!category && !tag && (
                <section className="flex flex-col gap-2">
                  <h2 className="text-lg font-semibold">Social client essentials</h2>
                  <p className="text-base-content/70">
                    Start here for feeds, threads, publishing, accounts, messages and zaps.
                  </p>
                  <ul className={grid}>{featured.map((e) => row(e, true))}</ul>
                </section>
              )}
              {sections.map((section) => (
                <section key={section.id} id={section.id} className="flex flex-col gap-2">
                  <h2 className="text-lg font-semibold">
                    {section.label} <span className="font-normal text-base-content/60">{section.examples.length}</span>
                  </h2>
                  <ul className={grid}>{section.examples.map((e) => row(e))}</ul>
                </section>
              ))}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
