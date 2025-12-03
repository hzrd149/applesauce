import Prism from "prismjs";
import "prismjs/themes/prism.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import SideNav from "./components/Nav";
import { ErrorBoundary } from "react-error-boundary";
import "@xterm/xterm/css/xterm.css";

import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";

Prism.manual = true;

import examples, { Example } from "./examples";
import { CodeIcon, ExternalLinkIcon } from "./components/items";
import { BrowserTerminalInterface, setTerminalInterface, TerminalInterface } from "./cli/terminal-interface";
import { useMount, useUnmount } from "react-use";

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

/** Browser terminal container */
function CliExample({ app }: { app: () => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const term = useRef<TerminalInterface | null>(null);

  // Create the terminal when component mounts
  useMount(() => {
    if (!ref.current) throw new Error("Container element not found");

    term.current = new BrowserTerminalInterface(ref.current);
    setTerminalInterface(term.current);
  });

  // Start the app
  useEffect(() => {
    if (app) {
      // Wait for the terminal to be initialized
      setTimeout(() => {
        console.log("Starting app", app);

        app();
      }, 100);
    }
  }, [app]);

  // Dispose the terminal when component unmounts
  useUnmount(() => {
    if (term.current) term.current.dispose();
  });

  return <div className="w-full h-full" ref={ref}></div>;
}

function ExampleView({ example }: { example?: Example }) {
  const [path, setPath] = useState("");
  const [source, setSource] = useState("");
  const [Component, setComponent] = useState<(() => JSX.Element) | null>();
  const [CliApp, setCliApp] = useState<(() => Promise<void>) | null>();
  const [mode, setMode] = useState<"code" | "preview">("preview");

  // set mode to preview when example changes
  useEffect(() => setMode("preview"), [example]);

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
            <span className="font-bold text-lg">{example?.name ?? "Examples"}</span>
          </div>
          <div className="flex-none">
            <button
              className={`btn btn-sm ${mode === "code" ? "btn-primary" : "btn-ghost"}`}
              onClick={() => setMode(mode === "code" ? "preview" : "code")}
            >
              <CodeIcon /> Source
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
                <a href="https://hzrd149.github.io/applesauce/typedoc/">Reference</a>
              </li>
            </ul>
          </div>
        </div>

        {/* Page content */}
        {mode === "preview" ? (
          CliApp ? (
            <ErrorBoundary fallbackRender={({ error }) => <div className="text-red-500">{error.message}</div>}>
              <CliExample app={CliApp} />
            </ErrorBoundary>
          ) : Component ? (
            <ErrorBoundary fallbackRender={({ error }) => <div className="text-red-500">{error.message}</div>}>
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
