import { useState } from "react";
import { Link, useParams } from "react-router";
import examples from "../examples";
import SettingsButton from "./settings-modal";

export default function SideNav() {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const { "*": splat } = useParams();
  const exampleId = splat;

  const filtered = examples.filter((item) => item.id.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="drawer-side">
      <label htmlFor="drawer" className="drawer-overlay"></label>
      <div className="flex flex-col h-full bg-base-200 text-base-content p-2 gap-2">
        <div className="flex flex-none items-center gap-2">
          <a href="https://applesauce.build" className="flex-none">
            <img src="./icon.svg" alt="applesauce" className="w-10 h-10" />
          </a>
          <input
            type="text"
            placeholder="Search..."
            className="input input-bordered flex-1 min-w-0"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <SettingsButton />
        </div>
        <ul className="menu menu-lg flex-1 flex-nowrap min-h-0 overflow-y-auto px-0 font-mono w-xs">
          {filtered.map((item) => (
            <li key={item.id}>
              <Link to={`/example/${item.id}`} className={"text-sm " + (exampleId === item.id ? "menu-active" : "")}>
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
