/**
 * Frontmatter parsing utilities for example files
 */

import { extractYaml } from "@std/front-matter";

export type ExampleFrontmatter = {
  /** Display title for the example */
  title?: string;
  /** Description of what the example demonstrates */
  description?: string;
  /** Tags/categories for the example */
  tags?: string[];
  /** Required dependencies/packages */
  dependencies?: string[];
  /** Related example paths */
  related?: string[];
};

/**
 * Parses YAML frontmatter from TypeScript/TSX source code
 * Frontmatter should be in the format:
 * / *---
 * title: Example Title
 * description: Example description
 * tags:
 *   - tag1
 *   - tag2
 * ---* /
 */
export function parseFrontmatter(source: string): {
  frontmatter: ExampleFrontmatter | null;
  code: string;
} {
  // Match frontmatter block: /*--- ... ---*/
  const frontmatterRegex = /^\/\*---\s*\n([\s\S]*?)\n---\*\//;
  const match = source.match(frontmatterRegex);

  if (!match) {
    return { frontmatter: null, code: source };
  }

  const yamlContent = match[1];
  const code = source.replace(frontmatterRegex, "").trimStart();

  try {
    // Wrap the YAML content with proper delimiters for @std/front-matter
    const wrappedYaml = `---yaml\n${yamlContent}\n---`;
    const { attrs } = extractYaml(wrappedYaml);
    
    // Type cast the attributes to our frontmatter type
    const frontmatter = attrs as ExampleFrontmatter;
    return { frontmatter, code };
  } catch (error) {
    console.warn("Failed to parse frontmatter:", error);
    return { frontmatter: null, code: source };
  }
}
