import { useState } from "react";
import { Link, useParams } from "react-router";
import examples from "../examples";

export default function SideNav() {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const { "*": splat } = useParams();
  const exampleId = splat;

  const filtered = examples.filter((item) => item.id.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="drawer-side">
      <label htmlFor="drawer" className="drawer-overlay"></label>
      <div className="menu bg-base-200 text-base-content min-h-full">
        <input
          type="text"
          placeholder="Search..."
          className="input input-bordered w-full"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <ul className="menu menu-lg px-0 font-mono w-xs">
          {filtered.map((item) => (
            <li key={item.id}>
              <Link to={`/example/${item.id}`} className={"text-sm " + (exampleId === item.id ? "menu-active" : "")}>
                {item.name}
              </Link>
            </li>
          ))}
        </ul>

        <ul className="menu menu-horizontal px-1 mt-auto">
          <li>
            <a href="https://hzrd149.github.io/applesauce">Documentation</a>
          </li>
          <li>
            <a href="https://applesauce.hzrd149.com/typedoc/">Reference</a>
          </li>
        </ul>
      </div>
    </div>
  );
}
