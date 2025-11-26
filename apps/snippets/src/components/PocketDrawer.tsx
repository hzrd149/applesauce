import { useState } from "react";
import { nip19 } from "nostr-tools";
import { getSeenRelays } from "applesauce-core/helpers";
import { type PocketItem } from "../hooks/usePocket";
import { AddressIcon, CheckIcon, ClearIcon, CloseIcon, CopyIcon, DownloadIcon, PocketIcon } from "./icons";

interface PocketDrawerProps {
  pocketItems: PocketItem[];
  onRemoveItem: (eventId: string) => void;
  onClearPocket: () => void;
  onCopyAsMarkdown: () => Promise<boolean>;
  onDownloadAsMarkdown: () => void;
  onViewItem: (eventId: string) => void;
}

export default function PocketDrawer({
  pocketItems,
  onRemoveItem,
  onClearPocket,
  onCopyAsMarkdown,
  onDownloadAsMarkdown,
  onViewItem,
}: PocketDrawerProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyAddressesSuccess, setCopyAddressesSuccess] = useState(false);

  const handleCopy = async () => {
    const success = await onCopyAsMarkdown();
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleCopyAddresses = async () => {
    if (pocketItems.length === 0) return;

    try {
      const addresses = pocketItems.map((item) => {
        const relayHints = Array.from(getSeenRelays(item.event) || []).slice(0, 3);
        return nip19.neventEncode({
          id: item.event.id,
          relays: relayHints,
          author: item.event.pubkey,
        });
      });

      const addressList = addresses.join("\n");
      await navigator.clipboard.writeText(addressList);
      setCopyAddressesSuccess(true);
      setTimeout(() => setCopyAddressesSuccess(false), 2000);
    } catch (error) {
      console.error("Failed to copy addresses to clipboard:", error);
    }
  };

  const formatAddedDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getLanguageBadgeColor = (language: string) => {
    switch (language?.toLowerCase()) {
      case "typescript":
        return "badge-primary";
      case "javascript":
        return "badge-secondary";
      case "python":
        return "badge-accent";
      case "rust":
        return "badge-warning";
      case "go":
        return "badge-info";
      default:
        return "badge-ghost";
    }
  };

  return (
    <>
      {/* Pocket Drawer */}
      <div
        className={`fixed bottom-0 left-0 right-0 bg-base-100 border-t border-base-300 shadow-2xl transition-transform duration-300 ease-in-out z-40 ${
          isExpanded ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* Drawer Content */}
        <div className="h-96 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-base-300">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">My Pocket</h3>
              <span className="badge badge-outline">{pocketItems.length} items</span>
            </div>

            <div className="join flex-wrap">
              {pocketItems.length > 0 && (
                <>
                  <button
                    onClick={handleCopy}
                    className={`btn btn-sm join-item ${copySuccess ? "btn-success" : "btn-ghost"}`}
                    title="Copy as Markdown"
                  >
                    {copySuccess ? (
                      <>
                        <CheckIcon />
                        <span className="hidden sm:inline">Copied!</span>
                      </>
                    ) : (
                      <>
                        <CopyIcon />
                        <span className="hidden sm:inline">Copy</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleCopyAddresses}
                    className={`btn btn-sm join-item ${copyAddressesSuccess ? "btn-success" : "btn-ghost"}`}
                    title="Copy nevent addresses"
                  >
                    {copyAddressesSuccess ? (
                      <>
                        <CheckIcon />
                        <span className="hidden sm:inline">Copied!</span>
                      </>
                    ) : (
                      <>
                        <AddressIcon />
                        <span className="hidden sm:inline">Addresses</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={onDownloadAsMarkdown}
                    className="btn btn-sm join-item btn-ghost"
                    title="Download as Markdown"
                  >
                    <DownloadIcon />
                    <span className="hidden sm:inline">Download</span>
                  </button>

                  <button
                    onClick={onClearPocket}
                    className="btn btn-sm join-item btn-soft btn-error"
                    title="Clear all items"
                  >
                    <ClearIcon />
                    <span className="hidden sm:inline">Clear</span>
                  </button>
                </>
              )}

              <button
                onClick={() => setIsExpanded(false)}
                className="btn btn-sm join-item btn-ghost ml-auto btn-square"
                title="Close pocket"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="size-6"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                </svg>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4">
            {pocketItems.length === 0 ? (
              <div className="text-center py-8 opacity-60">
                <div className="text-6xl mb-4">📝</div>
                <p className="text-lg mb-2">Your pocket is empty</p>
                <p className="text-sm">Add code snippets to collect and export them later</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {pocketItems.map((item) => {
                  const language = item.event.tags.find((t) => t[0] === "l")?.[1] || "typescript";

                  return (
                    <div key={item.event.id} className="bg-base-200 rounded-lg p-3 hover:bg-base-300 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="font-medium truncate" title={item.name}>
                              {item.name}
                            </h4>
                            <span className={`badge badge-xs ${getLanguageBadgeColor(language)}`}>{language}</span>
                          </div>

                          {item.description && (
                            <p className="text-sm opacity-70 truncate mb-1" title={item.description}>
                              {item.description}
                            </p>
                          )}

                          <div className="flex items-center gap-3 text-xs opacity-60">
                            <span>{item.event.content.split("\n").length} lines</span>
                            <span>{item.event.content.length} chars</span>
                            <span>Added {formatAddedDate(item.addedAt)}</span>
                          </div>
                        </div>

                        <div className="join">
                          <button
                            onClick={() => onViewItem(item.event.id)}
                            className="btn btn-sm join-item"
                            title="View snippet"
                          >
                            View code
                          </button>

                          <button
                            onClick={() => onRemoveItem(item.event.id)}
                            className="btn btn-sm btn-soft btn-error btn-square join-item"
                            title="Remove from pocket"
                          >
                            <CloseIcon />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pocket Toggle Button - Fixed at bottom right */}
      <div className="fixed bottom-4 right-4 z-50">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`btn btn-circle btn-lg shadow-lg transition-all duration-300  ${
            pocketItems.length > 0 ? "btn-primary" : "btn-ghost"
          } ${isExpanded ? "btn-outline" : ""}`}
          title={`${isExpanded ? "Close" : "Open"} pocket (${pocketItems.length} items)`}
        >
          {isExpanded ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="size-6"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
            </svg>
          ) : (
            <div className="relative">
              <PocketIcon />
              {pocketItems.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-accent text-accent-content text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                  {pocketItems.length > 9 ? "9+" : pocketItems.length}
                </span>
              )}
            </div>
          )}
        </button>
      </div>
    </>
  );
}
