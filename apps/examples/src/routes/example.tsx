import { ReactElement, useEffect, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Link, useParams } from "react-router";
import SideNav from "../components/nav";

import { Check, Copy, ExternalLink, Menu } from "lucide-react";
import examples from "../examples";

function ExampleMount({ Component, error }: { Component?: (() => ReactElement) | null; error: unknown }) {
  if (error !== null) throw error;
  if (Component) return <Component />;
  return (
    <div className="flex flex-1 justify-center items-center" role="status" aria-label="Loading example">
      <span className="loading loading-dots loading-xl"></span>
    </div>
  );
}

export default function ExamplePage() {
  const { "*": splat } = useParams();
  const exampleId = splat;
  const [path, setPath] = useState("");
  const [source, setSource] = useState("");
  const [Component, setComponent] = useState<(() => ReactElement) | null>();
  const [copied, setCopied] = useState(false);
  const [loadedId, setLoadedId] = useState<string>();
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const example = examples.find((e) => e.id === exampleId);

  // Handle copy to clipboard
  const handleCopy = async () => {
    if (!source) return;

    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy code:", err);
    }
  };

  // Load selected example
  useEffect(() => {
    if (!example) return;

    let active = true;
    setComponent(null);
    setLoadError(null);
    setSource("");
    setPath(example.path.replace(/^\.\//, ""));

    Promise.resolve()
      .then(() => example.load())
      .then((module: any) => {
        if (typeof module.default !== "function") throw new Error("Example must be a function");
        if (active) {
          setLoadedId(example.id);
          setComponent(() => module.default);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadedId(example.id);
          setLoadError(error ?? new Error("Failed to load example"));
        }
      });

    example
      .source()
      .then((source: string) => {
        if (!active) return;
        setSource(source);
      })
      .catch((error: unknown) => console.error("Failed to load example source:", error));

    return () => {
      active = false;
    };
  }, [example, attempt]);

  if (!example) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Example not found</h2>
          <p className="text-base-content/70">The example "{exampleId}" does not exist.</p>
        </div>
      </div>
    );
  }

  const metadata = example.metadata;

  return (
    <div className="drawer lg:drawer-open h-dvh min-w-0">
      <input
        id="drawer"
        type="checkbox"
        className="drawer-toggle"
        checked={drawerOpen}
        onChange={(event) => setDrawerOpen(event.target.checked)}
        aria-label="Toggle examples navigation"
      />

      {/* Main content */}
      <div className="drawer-content flex min-h-0 min-w-0 flex-col overflow-y-auto relative">
        {/* Navbar */}
        <header className="navbar bg-base-300 w-full shrink-0 gap-1">
          <Link to="/" className="btn btn-ghost btn-square shrink-0" aria-label="All examples">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2"
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
          </Link>
          <button
            type="button"
            className="btn btn-square btn-ghost shrink-0 lg:hidden"
            aria-label="Open examples navigation"
            aria-expanded={drawerOpen}
            aria-controls="examples-drawer"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu className="size-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate px-1 font-bold text-lg sm:px-2" title={example.name}>
            {example.name}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            <button
              className={`btn btn-sm ${copied ? "btn-success" : "btn-ghost"}`}
              onClick={handleCopy}
              disabled={!source}
              title="Copy code to clipboard"
              aria-label={copied ? "Code copied" : "Copy code to clipboard"}
            >
              {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
              <span className="hidden sm:inline">{copied ? "Copied!" : "Copy code"}</span>
            </button>
            <a
              target="_blank"
              className="btn btn-sm btn-ghost btn-square"
              href={`https://github.com/hzrd149/applesauce/tree/master/apps/examples/src/${path}`}
              aria-label="View source on GitHub"
              title="View source on GitHub"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-5" />
            </a>
          </div>
          <div className="hidden flex-none xl:block">
            <ul className="menu menu-horizontal">
              <li>
                <a href="https://hzrd149.github.io/applesauce">Documentation</a>
              </li>
              <li>
                <a href="https://applesauce.build/typedoc/">Reference</a>
              </li>
            </ul>
          </div>
        </header>

        {/* Metadata */}
        {Boolean(metadata.related?.length) && (
          <div className="hidden sm:block bg-base-200 shrink-0 px-4 py-2 border-b border-base-300">
            <div className="flex flex-wrap gap-2 items-center">
              {metadata.related && metadata.related.length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-sm text-base-content/70">Related:</span>
                  {metadata.related.map((rel) => {
                    const relatedExample = examples.find((e) => e.id === rel);
                    if (!relatedExample) return null;
                    return (
                      <Link key={rel} to={`/example/${rel}`} className="link link-primary text-sm">
                        {relatedExample.name}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Page content */}
        <ErrorBoundary
          key={example.id}
          onReset={() => {
            setComponent(null);
            setLoadError(null);
            setAttempt((value) => value + 1);
          }}
          fallbackRender={({ error, resetErrorBoundary }) => (
            <div className="flex flex-1 flex-col items-start justify-center gap-4 p-6" role="alert">
              <h2 className="text-xl font-semibold">This example encountered an error</h2>
              <p className="text-error whitespace-pre-wrap break-words max-w-full">
                {error instanceof Error ? error.message : String(error)}
              </p>
              <p>You can retry this example or choose another from the sidebar.</p>
              <button className="btn btn-primary" onClick={resetErrorBoundary}>
                Retry example
              </button>
            </div>
          )}
        >
          <ExampleMount
            Component={loadedId === example.id ? Component : null}
            error={loadedId === example.id ? loadError : null}
          />
        </ErrorBoundary>
      </div>

      {/* Sidebar */}
      <SideNav onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
