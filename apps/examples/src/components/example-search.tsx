import { useEffect, useState } from "react";
import { useAsync } from "react-use";
import examples, { type Example } from "../examples";

type ExampleSearchProps = {
  onResultsChange: (results: Example[]) => void;
};

function useDeboucedValue<T>(value: T, delay: number) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

export function ExampleSearch({ onResultsChange }: ExampleSearchProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [useMCPSearch, setUseMCPSearch] = useState(true);
  const [mcpFailed, setMCPFailed] = useState(false);

  const search = useDeboucedValue(searchTerm, 500);

  /** Search examples */
  const { loading } = useAsync(async () => {
    if (search.trim().length < 3) return onResultsChange(examples);

    // Filter examples by name or description if MCP is disabled or failed
    if (!useMCPSearch || mcpFailed) {
      const filtered = examples.filter(
        (e) =>
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.metadata?.description?.toLowerCase().includes(search.toLowerCase()),
      );

      return onResultsChange(filtered);
    }

    try {
      console.log("Searching with MCP:", search);
      const { getMCPClient } = await import("../services/mcp-client");
      const client = await getMCPClient();
      if (!client) return [];

      const response = await client.callTool({
        name: "search_examples",
        arguments: { query: search },
      });

      const results = JSON.parse((response.content as any)[0].text) as {
        name: string;
        description: string;
      }[];
      console.log("MCP results:", results);

      const filtered = results
        .map((r) => {
          const example = examples.find((e) => e.id === r.name);
          if (!example) return example;

          // Add the description to the example metadata
          return {
            ...example,
            metadata: { ...example.metadata, description: r.description },
          };
        })
        .filter((e) => e !== undefined);

      return onResultsChange(filtered);
    } catch (error) {
      console.error("Failed to search with MCP:", error);
      setMCPFailed(true);
    }
  }, [search, useMCPSearch, mcpFailed]);

  return (
    <div className="mb-8 max-w-2xl mx-auto">
      <label className="input input-bordered w-full input-lg  mb-2">
        <svg className="h-[1em] opacity-50" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <g strokeLinejoin="round" strokeLinecap="round" strokeWidth="2.5" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </g>
        </svg>
        <input
          type="search"
          placeholder="Search examples by name or description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {loading && <span className="loading loading-spinner loading-lg"></span>}
      </label>

      {!mcpFailed && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={useMCPSearch}
            onChange={(e) => setUseMCPSearch(e.target.checked)}
          />
          <span className="text-sm text-base-content/70">
            Use{" "}
            <a className="link link-info" href="https://applesauce.build/introduction/mcp-server">
              Applesauce MCP
            </a>
          </span>
        </label>
      )}
    </div>
  );
}
