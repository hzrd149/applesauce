import Prism from "prismjs";
import "prismjs/themes/prism.css";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import SideNav from "./components/Nav";

import "prismjs/components/prism-javascript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";

Prism.manual = true;

import examples, { Example } from "./examples";
import { CodeIcon, ExternalLinkIcon } from "./components/items";

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
  const [Component, setComponent] = useState<(() => JSX.Element) | null>();
  const [mode, setMode] = useState<"code" | "preview">("preview");

  // set mode to preview when example changes
  useEffect(() => setMode("preview"), [example]);

  // load selected example
  useEffect(() => {
    if (!example) return;

    setPath(example.path.replace(/^\.\//, ""));
    example.load().then((module: any) => {
      console.log("loaded", module.default);
      setComponent(() => module.default);
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
        {mode === "preview" ? (
          Component ? (
            <Component />
          ) : (
            <div className="flex justify-center items-center h-full">
              <span className="loading loading-dots loading-xl"></span>
            </div>
          )
        ) : (
          <CodeBlock code={source} language="tsx" />
        )}

        {/* Floating button group */}
        <div className="join fixed top-4 right-4 shadow-md">
          <div className="join-item font-bold m-2">{example?.name ?? "Examples"}</div>
          <button
            className={`join-item btn ${mode === "code" ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setMode(mode === "code" ? "preview" : "code")}
          >
            <CodeIcon /> Source
          </button>

          <a
            target="_blank"
            className="join-item btn btn-ghost"
            href={`https://github.com/hzrd149/applesauce/tree/master/packages/examples/src/${path}`}
          >
            <ExternalLinkIcon />
          </a>
        </div>
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
