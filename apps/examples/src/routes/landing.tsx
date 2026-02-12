import { useState } from "react";
import { Link } from "react-router";
import examples, { Example } from "../examples";
import { ExampleSearch } from "../components/example-search";

export default function LandingPage() {
  const [filteredExamples, setFilteredExamples] = useState<Example[]>(examples);

  return (
    <div className="min-h-screen bg-base-100">
      {/* Header */}
      <div className="navbar bg-base-300">
        <div className="flex-1">
          <h1 className="text-2xl font-bold px-4">Applesauce Examples</h1>
        </div>
        <div className="flex-none">
          <ul className="menu menu-horizontal px-1">
            <li>
              <a href="https://hzrd149.github.io/applesauce">Documentation</a>
            </li>
            <li>
              <a href="https://applesauce.hzrd149.com/typedoc/">Reference</a>
            </li>
          </ul>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Search Section */}
        <ExampleSearch onResultsChange={setFilteredExamples} />

        {/* Examples Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredExamples.map((example) => (
            <Link
              key={example.id}
              to={`/example/${example.id}`}
              className="card bg-base-200 hover:bg-base-300 transition-colors border border-base-300 hover:border-primary"
            >
              <div className="card-body p-4">
                <h2 className="card-title text-base font-mono">{example.name}</h2>
                {example.metadata?.description && (
                  <p className="text-sm text-base-content/70 line-clamp-3">{example.metadata.description}</p>
                )}
                {example.metadata?.tags && example.metadata.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {example.metadata.tags.slice(0, 3).map((tag: string) => (
                      <span key={tag} className="badge badge-primary badge-sm">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* No Results */}
        {filteredExamples.length === 0 && (
          <div className="text-center py-12">
            <p className="text-lg text-base-content/70">No examples found</p>
          </div>
        )}
      </div>
    </div>
  );
}
