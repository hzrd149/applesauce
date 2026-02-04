import { useState } from "react";
import { Link } from "react-router";
import examples from "../examples";

export default function LandingPage() {
  const [searchTerm, setSearchTerm] = useState("");

  // Filter examples by search term (searches name and description)
  const filteredExamples = examples.filter((example) => {
    const searchLower = searchTerm.toLowerCase();
    const nameMatch = example.name.toLowerCase().includes(searchLower);
    const descMatch = example.frontmatter?.description?.toLowerCase().includes(searchLower) ?? false;
    return nameMatch || descMatch;
  });

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
              <a href="https://applesauce.build/typedoc/">Reference</a>
            </li>
          </ul>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Search Section */}
        <div className="mb-8 max-w-2xl mx-auto">
          <input
            type="text"
            placeholder="Search examples by name or description..."
            className="input input-bordered w-full input-lg"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <div className="text-sm text-base-content/70 mt-2">
            Showing {filteredExamples.length} of {examples.length} examples
          </div>
        </div>

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
                {example.frontmatter?.description && (
                  <p className="text-sm text-base-content/70 line-clamp-3">{example.frontmatter.description}</p>
                )}
                {example.frontmatter?.tags && example.frontmatter.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {example.frontmatter.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className="badge badge-primary badge-sm">
                        {tag}
                      </span>
                    ))}
                    {example.frontmatter.tags.length > 3 && (
                      <span className="badge badge-ghost badge-sm">+{example.frontmatter.tags.length - 3}</span>
                    )}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* No Results */}
        {filteredExamples.length === 0 && (
          <div className="text-center py-12">
            <p className="text-lg text-base-content/70">No examples found matching "{searchTerm}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
