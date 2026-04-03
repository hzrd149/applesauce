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

  const search = useDeboucedValue(searchTerm, 500);

  /** Search examples */
  const { loading } = useAsync(async () => {
    if (search.trim().length < 3) return onResultsChange(examples);

    const filtered = examples.filter(
      (e) =>
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        e.metadata?.description?.toLowerCase().includes(search.toLowerCase()),
    );

    return onResultsChange(filtered);
  }, [search]);

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
    </div>
  );
}
