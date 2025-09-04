import { useState } from "react";
import { type PocketItem } from "../hooks/usePocket";

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

  const handleCopy = async () => {
    const success = await onCopyAsMarkdown();
    if (success) {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
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

            <div className="flex items-center gap-2">
              {pocketItems.length > 0 && (
                <>
                  <button
                    onClick={handleCopy}
                    className={`btn btn-sm ${copySuccess ? "btn-success" : "btn-ghost"}`}
                    title="Copy as Markdown"
                  >
                    {copySuccess ? (
                      <>
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Copied!
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        Copy
                      </>
                    )}
                  </button>

                  <button onClick={onDownloadAsMarkdown} className="btn btn-sm btn-ghost" title="Download as Markdown">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Download
                  </button>

                  <button
                    onClick={onClearPocket}
                    className="btn btn-sm btn-ghost text-error hover:btn-error"
                    title="Clear all items"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                    Clear
                  </button>
                </>
              )}

              <button onClick={() => setIsExpanded(false)} className="btn btn-sm btn-ghost" title="Close pocket">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
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

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onViewItem(item.event.id)}
                            className="btn btn-xs btn-ghost"
                            title="View snippet"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                              />
                            </svg>
                          </button>

                          <button
                            onClick={() => onRemoveItem(item.event.id)}
                            className="btn btn-xs btn-ghost text-error hover:btn-error"
                            title="Remove from pocket"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
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
          className={`btn btn-circle btn-lg shadow-lg transition-all duration-300 ${
            pocketItems.length > 0 ? "btn-primary" : "btn-ghost"
          } ${isExpanded ? "btn-outline" : ""}`}
          title={`${isExpanded ? "Close" : "Open"} pocket (${pocketItems.length} items)`}
        >
          {isExpanded ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          ) : (
            <div className="relative">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
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
