import { useEffect, useState } from "react";
import { type NostrEvent } from "nostr-tools";

export interface PocketItem {
  event: NostrEvent;
  addedAt: number;
  name?: string;
  description?: string;
}

const POCKET_STORAGE_KEY = "applesauce_pocket";

export function usePocket() {
  const [pocketItems, setPocketItems] = useState<PocketItem[]>([]);

  // Load pocket items from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(POCKET_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as PocketItem[];
        setPocketItems(parsed);
      }
    } catch (error) {
      console.error("Failed to load pocket items from localStorage:", error);
    }
  }, []);

  // Save pocket items to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(POCKET_STORAGE_KEY, JSON.stringify(pocketItems));
    } catch (error) {
      console.error("Failed to save pocket items to localStorage:", error);
    }
  }, [pocketItems]);

  const addToPocket = (event: NostrEvent) => {
    // Check if item is already in pocket
    const exists = pocketItems.some((item) => item.event.id === event.id);
    if (exists) return false;

    // Extract name and description from tags
    const name = event.tags.find((t) => t[0] === "name")?.[1] || `snippet-${event.id.slice(0, 8)}`;
    const description = event.tags.find((t) => t[0] === "description")?.[1] || "";

    const newItem: PocketItem = {
      event,
      addedAt: Date.now(),
      name,
      description,
    };

    setPocketItems((prev) => [...prev, newItem]);
    return true;
  };

  const removeFromPocket = (eventId: string) => {
    setPocketItems((prev) => prev.filter((item) => item.event.id !== eventId));
  };

  const clearPocket = () => {
    setPocketItems([]);
  };

  const isInPocket = (eventId: string) => {
    return pocketItems.some((item) => item.event.id === eventId);
  };

  const exportAsMarkdown = () => {
    if (pocketItems.length === 0) return "";

    const markdown = [
      "# My Code Snippet Collection",
      "",
      `Generated on ${new Date().toLocaleDateString()}`,
      "",
      ...pocketItems.map((item, index) => {
        const language = item.event.tags.find((t) => t[0] === "l")?.[1] || "typescript";
        const extension = item.event.tags.find((t) => t[0] === "extension")?.[1] || "ts";

        return [
          `## ${index + 1}. ${item.name}`,
          "",
          ...(item.description ? [item.description, ""] : []),
          `**Language:** ${language}  `,
          `**File:** ${item.name}.${extension}  `,
          `**Added:** ${new Date(item.addedAt).toLocaleDateString()}  `,
          "",
          "```" + language,
          item.event.content,
          "```",
          "",
        ].join("\n");
      }),
    ].join("\n");

    return markdown;
  };

  const downloadAsMarkdown = () => {
    const markdown = exportAsMarkdown();
    if (!markdown) return;

    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `code-snippets-${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyAsMarkdown = async () => {
    const markdown = exportAsMarkdown();
    if (!markdown) return false;

    try {
      await navigator.clipboard.writeText(markdown);
      return true;
    } catch (error) {
      console.error("Failed to copy markdown to clipboard:", error);
      return false;
    }
  };

  return {
    pocketItems,
    addToPocket,
    removeFromPocket,
    clearPocket,
    isInPocket,
    exportAsMarkdown,
    downloadAsMarkdown,
    copyAsMarkdown,
  };
}
