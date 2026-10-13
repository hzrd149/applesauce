import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import examples, { type Example } from "../examples";
import SettingsButton from "./settings-modal";

const sections = new Map<string, Example[]>();
for (const example of examples) {
  const section = example.id.includes("/") ? example.id.split("/")[0] : "general";
  const items = sections.get(section) ?? [];
  items.push(example);
  sections.set(section, items);
}

export default function SideNav() {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const { "*": splat } = useParams();
  const exampleId = splat;
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(exampleId ? [exampleId.includes("/") ? exampleId.split("/")[0] : "general"] : []),
  );

  const query = searchTerm.trim().toLowerCase();
  const filteredSections = [...sections]
    .map(([section, items]) => ({
      section,
      items: items.filter((item) => item.id.toLowerCase().includes(query)),
    }))
    .filter(({ items }) => items.length > 0);

  const toggleSection = (section: string) => {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  return (
    <div className="drawer-side">
      <label htmlFor="drawer" className="drawer-overlay"></label>
      <div className="flex flex-col h-full w-xs bg-base-200 text-base-content">
        <div className="flex flex-none items-center gap-2 p-2 border-b border-base-300">
          <a href="https://applesauce.build" className="flex-none">
            <img src="./icon.svg" alt="applesauce" className="w-10 h-10" />
          </a>
          <input
            type="text"
            placeholder="Search..."
            aria-label="Filter examples"
            className="input input-bordered flex-1 min-w-0"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <SettingsButton />
        </div>
        <nav aria-label="Examples" className="flex-1 min-h-0 overflow-y-auto font-mono">
          {filteredSections.map(({ section, items }) => {
            const open = Boolean(query) || openSections.has(section);
            return (
              <div key={section} className="border-b border-base-300">
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-2 py-2 text-sm text-left hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
                  aria-expanded={open}
                  aria-controls={`examples-section-${section}`}
                  onClick={() => {
                    if (!query) toggleSection(section);
                  }}
                >
                  <ChevronDown aria-hidden="true" className={`size-4 shrink-0 ${open ? "" : "-rotate-90"}`} />
                  <span className="flex-1">{section.replace(/[-_]/g, " ")}</span>
                  <span className="text-xs text-base-content/60">{items.length}</span>
                </button>
                <ul id={`examples-section-${section}`} hidden={!open} className={open ? "m-0 p-0 list-none" : "hidden"}>
                  {items.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={`/example/${item.id}`}
                        aria-current={exampleId === item.id ? "page" : undefined}
                        className={
                          "block pl-8 pr-2 py-1.5 text-sm hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 " +
                          (exampleId === item.id ? "bg-base-300 font-semibold" : "")
                        }
                      >
                        {item.id.includes("/") ? item.name.slice(item.name.indexOf(" / ") + 3) : item.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {filteredSections.length === 0 && <p className="px-3 py-4 text-sm text-base-content/60">No examples found</p>}
        </nav>
      </div>
    </div>
  );
}
