/**
 * Metadata parsing utilities for example files
 */

export type ExampleMetadata = {
  /** Description of what the example demonstrates */
  description?: string;
  /** Tags/categories for the example */
  tags?: string[];
  /** Related example paths */
  related?: string[];
};

/**
 * Parses JSDoc metadata from TypeScript/TSX source code
 * Metadata should be in the format:
 * / **
 *  * Description of the example
 *  * @tags tag1, tag2, tag3
 *  * @related example/path1, example/path2
 *  * /
 */
export function parseMetadata(source: string): {
  metadata: ExampleMetadata | null;
  code: string;
} {
  // Match the first JSDoc comment: /** ... */
  const jsdocRegex = /^\/\*\*\s*\n([\s\S]*?)\*\//;
  const match = source.match(jsdocRegex);

  if (!match) {
    return { metadata: null, code: source };
  }

  const jsdocContent = match[1];
  const code = source.replace(jsdocRegex, "").trimStart();

  try {
    const metadata: ExampleMetadata = {};

    // Extract description (all lines that don't start with @)
    const descriptionLines: string[] = [];
    const lines = jsdocContent.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim().replace(/^\*\s?/, ""); // Remove leading * and space

      if (trimmedLine.startsWith("@tags")) {
        // Parse tags - comma-separated list after @tags
        const tagsMatch = trimmedLine.match(/@tags\s+(.+)/);
        if (tagsMatch) {
          metadata.tags = tagsMatch[1]
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean);
        }
      } else if (trimmedLine.startsWith("@related")) {
        // Parse related - comma-separated list after @related
        const relatedMatch = trimmedLine.match(/@related\s+(.+)/);
        if (relatedMatch) {
          metadata.related = relatedMatch[1]
            .split(",")
            .map((rel) => rel.trim())
            .filter(Boolean);
        }
      } else if (!trimmedLine.startsWith("@") && trimmedLine) {
        // This is part of the description
        descriptionLines.push(trimmedLine);
      }
    }

    // Join description lines with spaces
    const description = descriptionLines.join(" ").trim();
    if (description) {
      metadata.description = description;
    }

    return { metadata: metadata, code };
  } catch (error) {
    console.warn("Failed to parse JSDoc metadata:", error);
    return { metadata: null, code: source };
  }
}
