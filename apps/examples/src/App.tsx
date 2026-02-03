import Prism from "prismjs";
import "prismjs/themes/prism.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ErrorBoundary } from "react-error-boundary";
import SideNav from "./components/nav";

import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";

Prism.manual = true;

import { CheckIcon, CodeIcon, CopyIcon, ExternalLinkIcon } from "./components/icons";
import examples, { Example } from "./examples";

function CodeBlock({ code, language }: { code: string; language: string }) {
  const ref = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (ref.current) Prism.highlightElement(ref.current);
  }, []);

  return (
    <pre className="p-4 my-0">
      <code ref={ref} className={`language-${language}`}>
        {code}
      </code>
    </pre>
  );
}

function ExampleView({ example }: { example?: Example }) {
  const [path, setPath] = useState("");
  const [source, setSource] = useState("");
  const [frontmatter, setFrontmatter] = useState(example?.frontmatter);
  const [Component, setComponent] = useState<(() => JSX.Element) | null>();
  const [CliApp, setCliApp] = useState<(() => Promise<void>) | null>();
  const [mode, setMode] = useState<"code" | "preview">("preview");
  const [copied, setCopied] = useState(false);

  // set mode to preview when example changes
  useEffect(() => setMode("preview"), [example]);

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

  // load selected example
  useEffect(() => {
    if (!example) return;

    setPath(example.path.replace(/^\.\//, ""));
    example.load().then((module: any) => {
      if (typeof module.default !== "function") throw new Error("Example must be a function");

      if (module.default.terminal) {
        console.log("Loaded CLI App", module.default);
        setCliApp(() => module.default);
        setComponent(null);
      } else {
        console.log("Loaded React App", module.default);
        setComponent(() => module.default);
        setCliApp(null);
      }
    });

    example.source().then((source: string) => {
      setSource(source);
      // Update frontmatter after source is loaded (it's parsed during source())
      setFrontmatter(example.frontmatter);
    });
  }, [example]);

  return (
    <div className="drawer lg:drawer-open h-full min-h-screen">
      <input id="drawer" type="checkbox" className="drawer-toggle" />

      {/* Main content */}
      <div className="drawer-content flex flex-col relative">
        {/* Navbar */}
        <div className="navbar bg-base-300 w-full">
          <div className="flex-none lg:hidden">
            <label htmlFor="drawer" aria-label="open sidebar" className="btn btn-square btn-ghost">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="inline-block h-6 w-6 stroke-current"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
              </svg>
            </label>
          </div>
          <div className="mx-2 flex-1 px-2">
            <div className="flex flex-col">
              <span className="font-bold text-lg">{frontmatter?.title || example?.name || "Examples"}</span>
              {frontmatter?.description && (
                <span className="text-xs text-base-content/70">{frontmatter.description}</span>
              )}
            </div>
          </div>
          <div className="flex-none">
            <button
              className={`btn btn-sm ${mode === "code" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setMode(mode === "code" ? "preview" : "code")}
            >
              <CodeIcon /> Source
            </button>

            <button
              className={`btn btn-sm ${copied ? "btn-success" : "btn-ghost"}`}
              onClick={handleCopy}
              disabled={!source}
              title="Copy code to clipboard"
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied!" : "Copy"}
            </button>

            <a
              target="_blank"
              className="btn btn-sm btn-ghost btn-square"
              href={`https://github.com/hzrd149/applesauce/tree/master/apps/examples/src/${path}`}
            >
              <ExternalLinkIcon />
            </a>
          </div>
          <div className="hidden flex-none lg:block">
            <ul className="menu menu-horizontal">
              <li>
                <a href="https://hzrd149.github.io/applesauce">Documentation</a>
              </li>
              <li>
                <a href="https://applesauce.build/typedoc/">Reference</a>
              </li>
            </ul>
          </div>
        </div>

        {/* Frontmatter metadata */}
        {frontmatter &&
          (frontmatter.tags?.length || frontmatter.dependencies?.length || frontmatter.related?.length) && (
            <div className="bg-base-200 px-4 py-2 border-b border-base-300">
              <div className="flex flex-wrap gap-2 items-center">
                {frontmatter.tags && frontmatter.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {frontmatter.tags.map((tag) => (
                      <span key={tag} className="badge badge-primary badge-sm">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {frontmatter.dependencies && frontmatter.dependencies.length > 0 && (
                  <details className="dropdown dropdown-end">
                    <summary className="btn btn-xs btn-ghost">Dependencies ({frontmatter.dependencies.length})</summary>
                    <ul className="dropdown-content menu bg-base-100 rounded-box z-1 w-52 p-2 shadow">
                      {frontmatter.dependencies.map((dep) => (
                        <li key={dep}>
                          <span className="text-xs">{dep}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {frontmatter.related && frontmatter.related.length > 0 && (
                  <div className="flex flex-wrap gap-2 items-center">
                    <span className="text-xs text-base-content/70">Related:</span>
                    {frontmatter.related.map((rel) => {
                      const relatedExample = examples.find((e) => e.id === rel);
                      if (!relatedExample) return null;
                      return (
                        <a key={rel} href={`#${rel}`} className="link link-primary text-xs">
                          {relatedExample.name}
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

        {/* Page content */}
        {mode === "preview" ? (
          Component ? (
            <ErrorBoundary
              fallbackRender={({ error }) => (
                <div className="text-red-500">{error instanceof Error ? error.message : String(error)}</div>
              )}
            >
              <Component />
            </ErrorBoundary>
          ) : (
            <div className="flex justify-center items-center h-full">
              <span className="loading loading-dots loading-xl"></span>
            </div>
          )
        ) : (
          <CodeBlock code={source} language="tsx" />
        )}
      </div>

      {/* Sidebar */}
      <SideNav />
    </div>
  );
}

function App() {
  const [example, setExample] = useState<Example | null>();

  // load selected example
  useEffect(() => {
    const listener = () => {
      const name = location.hash.replace(/^#/, "");
      const example = examples.find((e) => e.id === name);
      if (example) setExample(example);
      else setExample(examples[Math.floor(Math.random() * examples.length)]);
    };

    listener();
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);

  return <ExampleView example={example ?? undefined} />;
}

export default App;
