import { ensureWebSocketURL, normalizeToPubkey, normalizeURL } from "applesauce-core/helpers";
import type { CountRouteFactory, CountSource } from "applesauce-loaders/loaders";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

export type Policy = "fallback" | "round-robin" | "availability";
export type RouteBlock =
  | { id: string; type: "relay"; url: string }
  | { id: string; type: "provider"; pubkey: string; relay: string; maxAge: number; batchWindow: number; batchSize: number }
  | { id: string; type: "policy"; mode: Policy; busy: "wait" | "skip"; timeout?: number; children: RouteBlock[] };
export type PolicyBlock = Extract<RouteBlock, { type: "policy" }>;
export const POLICY_LABELS: Record<Policy, string> = {
  fallback: "Ordered fallback", "round-robin": "Round-robin", availability: "Available first",
};
export function newBlock(type: RouteBlock["type"], mode: Policy = "fallback"): RouteBlock {
  const id = crypto.randomUUID();
  if (type === "relay") return { id, type, url: "" };
  if (type === "provider") return { id, type, pubkey: "", relay: "", maxAge: 86400, batchWindow: 10, batchSize: 100 };
  return { id, type, mode, busy: "wait", children: [] };
}
export function findBlock(tree: RouteBlock, id: string): RouteBlock | undefined {
  if (tree.id === id) return tree;
  if (tree.type === "policy") for (const child of tree.children) {
    const found = findBlock(child, id);
    if (found) return found;
  }
}
export function updateBlock(tree: RouteBlock, id: string, change: (block: RouteBlock) => RouteBlock): RouteBlock {
  if (tree.id === id) return change(tree);
  return tree.type === "policy" ? { ...tree, children: tree.children.map((child) => updateBlock(child, id, change)) } : tree;
}
export function removeBlock(tree: RouteBlock, id: string): RouteBlock {
  return tree.type === "policy" ? { ...tree, children: tree.children.filter((child) => child.id !== id).map((child) => removeBlock(child, id)) } : tree;
}
export function moveBlock(tree: RouteBlock, id: string, parent: string, index: number): RouteBlock {
  const block = findBlock(tree, id);
  const destination = findBlock(tree, parent);
  if (!block || id === tree.id || destination?.type !== "policy" || findBlock(block, parent)) return tree;
  const previous = destination.children.findIndex((child) => child.id === id);
  const position = previous >= 0 && previous < index ? index - 1 : index;
  return updateBlock(removeBlock(tree, id), parent, (node) => node.type === "policy"
    ? { ...node, children: [...node.children.slice(0, position), block, ...node.children.slice(position)] } : node);
}
function relayURL(value: string) {
  const url = new URL(ensureWebSocketURL(value.trim()));
  if (!["ws:", "wss:"].includes(url.protocol) || !url.hostname) throw new Error("Enter a valid WebSocket relay URL");
  return normalizeURL(url.toString());
}
export function compileRoute(block: RouteBlock, route: CountRouteFactory): CountSource {
  if (block.type === "relay") return route.relay(relayURL(block.url));
  if (block.type === "provider") {
    const pubkey = normalizeToPubkey(block.pubkey.trim());
    if (!pubkey) throw new Error("Enter a hex pubkey or npub for every NIP-85 provider");
    const relay = relayURL(block.relay);
    return route.nip85({ id: block.id, providers: (kind, tag) => [{ kind, tag, servicePubkey: pubkey, relay }],
      maxAge: block.maxAge, batchSize: block.batchSize, batchWindow: block.batchWindow });
  }
  if (!block.children.length) throw new Error("Every policy needs at least one source or nested policy");
  const method = block.mode === "round-robin" ? "roundRobin" : block.mode;
  return route[method](block.children.map((child) => compileRoute(child, route)), { id: block.id, busy: block.busy, timeout: block.timeout });
}

const BLOCK_DRAG = "application/x-count-routing-block";
const PALETTE_DRAG = "application/x-count-routing-palette";
const tools = [
  ["fallback", "Ordered fallback"], ["round-robin", "Round-robin"], ["availability", "Available first"],
  ["relay", "NIP-45 relay"], ["provider", "NIP-85 provider"],
] as const;
function makeTool(tool: string) {
  return tool === "relay" || tool === "provider" ? newBlock(tool) : newBlock("policy", tool as Policy);
}

export function RouteSummary({ tree, relayName }: { tree: RouteBlock; relayName: (url: string) => ReactNode }) {
  if (tree.type === "relay") return <div className="truncate py-1">{relayName(tree.url)}</div>;
  if (tree.type === "provider") return <div className="py-1">NIP-85 · {relayName(tree.relay)}</div>;
  return <div className="border-l-2 border-primary pl-3">
    <div className="py-1 font-medium">{POLICY_LABELS[tree.mode]} <span className="font-normal text-base-content/60">· {tree.busy}</span></div>
    {tree.children.map((child) => <RouteSummary key={child.id} tree={child} relayName={relayName} />)}
  </div>;
}

export default function CountRoutingBuilder({ tree, onChange, relayName }: {
  tree: RouteBlock; onChange: (tree: RouteBlock) => void; relayName: (url: string) => ReactNode;
}) {
  const [selected, setSelected] = useState(tree.id);
  const [over, setOver] = useState<string | null>(null);
  const active = findBlock(tree, selected) ?? tree;
  const policies: PolicyBlock[] = [];
  const collect = (node: RouteBlock) => { if (node.type === "policy") { policies.push(node); node.children.forEach(collect); } };
  collect(tree);
  const patch = (change: Partial<RouteBlock>) => onChange(updateBlock(tree, active.id, (block) => ({ ...block, ...change }) as RouteBlock));
  const add = (tool: string) => {
    const parent = active.type === "policy" ? active : policies.find((policy) => policy.children.some((child) => child.id === active.id))!;
    const block = makeTool(tool);
    onChange(updateBlock(tree, parent.id, (node) => node.type === "policy" ? { ...node, children: [...node.children, block] } : node));
    setSelected(block.id);
  };
  const slot = (parent: string, index: number) => {
    const key = `${parent}-${index}`;
    return <div key={key} className={`my-1 min-h-5 border border-dashed px-2 text-xs ${over === key ? "border-primary bg-primary/20 text-primary" : "border-base-300 text-base-content/40"}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(BLOCK_DRAG) || e.dataTransfer.types.includes(PALETTE_DRAG)) { e.preventDefault(); e.stopPropagation(); setOver(key); } }}
      onDragLeave={() => setOver(null)} onDrop={(e) => {
        e.preventDefault(); e.stopPropagation(); setOver(null);
        const id = e.dataTransfer.getData(BLOCK_DRAG);
        if (id) onChange(moveBlock(tree, id, parent, index));
        else {
          const tool = e.dataTransfer.getData(PALETTE_DRAG);
          if (!tools.some(([value]) => value === tool)) return;
          const block = makeTool(tool);
          onChange(updateBlock(tree, parent, (node) => node.type === "policy" ? { ...node, children: [...node.children.slice(0, index), block, ...node.children.slice(index)] } : node));
          setSelected(block.id);
        }
      }}>Drop block here</div>;
  };
  const render = (node: RouteBlock, parent?: PolicyBlock, index = 0): ReactNode => <div key={node.id}
    className={`border-l-4 ${node.type === "policy" ? "border-primary" : node.type === "relay" ? "border-success" : "border-warning"} bg-base-100`}>
    <div className={`flex items-center gap-2 border-y border-r p-2 ${active.id === node.id ? "border-primary bg-primary/10" : "border-base-300"}`}>
      <button className="btn btn-ghost btn-xs cursor-grab" draggable={!!parent} aria-label="Drag block"
        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.setData(BLOCK_DRAG, node.id); e.dataTransfer.effectAllowed = "move"; }}><GripVertical size={16} /></button>
      <button className="min-w-0 flex-1 text-left text-sm font-medium" onClick={() => setSelected(node.id)}>
        {node.type === "policy" ? POLICY_LABELS[node.mode] : node.type === "provider" ? "NIP-85 provider" : node.url ? relayNameSafe(node.url) : "Configure relay"}
        {node.type === "policy" && <span className="ml-2 font-normal text-base-content/60">{node.busy} · {node.timeout ? `${node.timeout} ms` : "inherited deadline"}</span>}
      </button>
      {parent && <>
        <button className="btn btn-ghost btn-xs" aria-label="Move block up" disabled={index === 0} onClick={() => onChange(moveBlock(tree, node.id, parent.id, index - 1))}><ArrowUp size={14} /></button>
        <button className="btn btn-ghost btn-xs" aria-label="Move block down" disabled={index === parent.children.length - 1} onClick={() => onChange(moveBlock(tree, node.id, parent.id, index + 2))}><ArrowDown size={14} /></button>
        <button className="btn btn-ghost btn-xs" aria-label="Delete block" onClick={() => onChange(removeBlock(tree, node.id))}><Trash2 size={14} /></button>
      </>}
    </div>
    {node.type === "policy" && <div className="ml-3 border-l border-base-300 p-2">
      {node.children.map((child, i) => <div key={child.id}>{slot(node.id, i)}{render(child, node, i)}</div>)}
      {slot(node.id, node.children.length)}
    </div>}
  </div>;
  const relayNameSafe = (url: string) => { try { return relayName(relayURL(url)); } catch { return "Configure relay"; } };
  const number = (label: string, value: number | undefined, change: (value: number | undefined) => void, optional = false, min = 1) => <label className="flex flex-col gap-1 text-sm">{label}<input className="input input-sm w-full" type="number" min={min} step="1" placeholder={optional ? "Inherit deadline" : undefined} value={value ?? ""} onChange={(e) => {
    if (optional && !e.target.value) return change(undefined);
    const n = e.target.valueAsNumber;
    if (Number.isSafeInteger(n) && n >= min) change(n);
  }} /></label>;
  return <div className="grid min-h-0 gap-4 xl:grid-cols-[13rem_minmax(0,1fr)_18rem]">
    <section className="flex flex-col gap-2"><h2 className="font-semibold">Blocks</h2>
      <p className="text-xs text-base-content/60">Drag into any slot, or select a policy and click a block to add it.</p>
      {tools.map(([tool, label]) => <button key={tool} className="btn justify-start rounded-none border-l-4 border-l-primary" draggable onDragStart={(e) => { e.dataTransfer.setData(PALETTE_DRAG, tool); e.dataTransfer.effectAllowed = "copy"; }} onClick={() => add(tool)}><GripVertical size={16} />{label}</button>)}
      <p className="mt-3 text-xs text-base-content/60">Policies can contain other policies at any depth. Child order controls fallback preference and round-robin rotation.</p>
    </section>
    <section className="min-w-0 overflow-x-auto"><h2 className="mb-2 font-semibold">Routing program</h2>{render(tree)}</section>
    <section className="flex flex-col gap-3 border-l border-base-300 pl-4"><h2 className="font-semibold">Selected block</h2>
      {active.type === "policy" ? <>
        <label className="flex flex-col gap-1 text-sm">Policy<select className="select select-sm w-full" value={active.mode} onChange={(e) => patch({ mode: e.target.value as Policy })}>{Object.entries(POLICY_LABELS).map(([mode, label]) => <option key={mode} value={mode}>{label}</option>)}</select></label>
        <p className="text-xs text-base-content/60">{active.mode === "fallback" ? "Tries children in order until one answers." : active.mode === "round-robin" ? "Rotates the first candidate across resolutions, then tries remaining children." : "Prefers available candidates instead of queueing behind busy peers."}</p>
        <label className="flex flex-col gap-1 text-sm">Busy candidates<select className="select select-sm w-full" value={active.busy} onChange={(e) => patch({ busy: e.target.value as "wait" | "skip" })}><option value="wait">Wait for capacity</option><option value="skip">Skip busy candidates</option></select></label>
        {number("Branch budget (ms)", active.timeout, (timeout) => patch({ timeout }), true)}
      </> : active.type === "relay" ? <label className="flex flex-col gap-1 text-sm">Relay URL<input className="input input-sm w-full" placeholder="wss://relay.example.com" value={active.url} onChange={(e) => patch({ url: e.target.value })} /></label> : <>
        <label className="flex flex-col gap-1 text-sm">Provider pubkey or npub<input className="input input-sm w-full" value={active.pubkey} onChange={(e) => patch({ pubkey: e.target.value })} /></label>
        <label className="flex flex-col gap-1 text-sm">Provider relay URL<input className="input input-sm w-full" value={active.relay} onChange={(e) => patch({ relay: e.target.value })} /></label>
        {number("Maximum assertion age (seconds)", active.maxAge, (maxAge) => patch({ maxAge: maxAge! }))}
        {number("Batch window (ms)", active.batchWindow, (batchWindow) => patch({ batchWindow: batchWindow! }), false, 0)}
        {number("Subjects per batch", active.batchSize, (batchSize) => patch({ batchSize: batchSize! }))}
      </>}
      {active.id !== tree.id && <label className="flex flex-col gap-1 text-sm">Move into policy<select className="select select-sm w-full" value="" onChange={(e) => { if (e.target.value) onChange(moveBlock(tree, active.id, e.target.value, (findBlock(tree, e.target.value) as PolicyBlock).children.length)); }}><option value="">Choose destination…</option>{policies.filter((policy) => !findBlock(active, policy.id)).map((policy, i) => <option key={policy.id} value={policy.id}>{i + 1}. {POLICY_LABELS[policy.mode]}</option>)}</select></label>}
    </section>
  </div>;
}
