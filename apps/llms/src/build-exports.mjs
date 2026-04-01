import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SKIP_PACKAGES = new Set(["sqlite", "extra"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "__tests__", ".git"]);

async function getAllTsFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await getAllTsFiles(fullPath)));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

async function parsePackageJson(packageRoot) {
  const raw = await fs.readFile(path.join(packageRoot, "package.json"), "utf8");
  const pkg = JSON.parse(raw);
  return { name: pkg.name || "unknown", version: pkg.version || "0.0.0", exports: pkg.exports || {} };
}

function mapSourceToExportPath(sourceFile, exportsMap, packageRoot) {
  const normalized = sourceFile.replace(/\\/g, "/");
  let bestMatch;

  for (const [exportPath, exportValue] of Object.entries(exportsMap)) {
    if (typeof exportValue !== "object" || exportValue === null) continue;
    const importTarget = exportValue.import || exportValue.types || exportValue.require;
    if (!importTarget) continue;

    let srcPath = importTarget.replace("./dist/", "src/").replace(/\.js$/, ".ts").replace(/\.d\.ts$/, ".ts");

    if (srcPath.includes("*")) {
      const prefix = srcPath.replace("*", "");
      if (normalized.includes(prefix)) {
        const specificity = prefix.length;
        if (!bestMatch || specificity > bestMatch.specificity) {
          bestMatch = { exportPath: exportPath.replace(/\/\*$/, "").replace(/^\.\//, ""), specificity };
        }
      }
    } else {
      if (normalized.endsWith(srcPath) || normalized.includes(srcPath.replace(/\/index\.ts$/, "/"))) {
        const specificity = srcPath.length;
        if (!bestMatch || specificity > bestMatch.specificity) {
          bestMatch = { exportPath: exportPath === "." ? "" : exportPath.replace(/^\.\//, ""), specificity };
        }
      }
    }
  }
  return bestMatch?.exportPath;
}

function hasExportModifier(node) {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasModifier(node, kind) {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return modifiers?.some((mod) => mod.kind === kind) ?? false;
}

function getJSDocComment(node) {
  const jsDocs = node.jsDoc;
  if (!jsDocs || jsDocs.length === 0) return "";
  return jsDocs
    .map((doc) => doc.comment)
    .filter(Boolean)
    .map((comment) => {
      if (typeof comment === "string") return comment;
      if (Array.isArray(comment)) return comment.map((c) => c.text || "").join("");
      return "";
    })
    .join("\n")
    .trim();
}

function getSignatureLine(node, sourceFile) {
  let text = node.getText(sourceFile).split("\n")[0];
  text = text.replace(/^export\s+/, "").replace(/\{$/, "").trim();
  if (text.length > 200) text = text.substring(0, 200) + "...";
  return text;
}

function truncateToFirstSentence(text) {
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])\s/);
  return match ? match[1] : text.split("\n")[0];
}

function parseFile(filePath, packageRoot) {
  const program = ts.createProgram({
    rootNames: [filePath],
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowJs: false,
      skipLibCheck: true,
    },
  });

  const sf = program.getSourceFile(filePath);
  if (!sf) return [];

  const symbols = [];

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && hasExportModifier(node) && node.body) {
      symbols.push({
        name: node.name.text,
        kind: "function",
        signature: getSignatureLine(node, sf),
        jsDoc: truncateToFirstSentence(getJSDocComment(node)),
      });
    } else if (ts.isClassDeclaration(node) && node.name && hasExportModifier(node)) {
      const methods = [];
      for (const member of node.members || []) {
        if (!ts.isMethodDeclaration(member) || !member.name) continue;
        if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) continue;
        if (!ts.isIdentifier(member.name)) continue;
        if (!member.body) continue;

        methods.push({
          name: `.${member.name.text}`,
          signature: getSignatureLine(member, sf),
          jsDoc: truncateToFirstSentence(getJSDocComment(member)),
        });
      }

      symbols.push({
        name: node.name.text,
        kind: "class",
        signature: getSignatureLine(node, sf),
        jsDoc: truncateToFirstSentence(getJSDocComment(node)),
        methods,
      });
    } else if (ts.isInterfaceDeclaration(node) && node.name && hasExportModifier(node)) {
      symbols.push({
        name: node.name.text,
        kind: "interface",
        signature: getSignatureLine(node, sf),
        jsDoc: truncateToFirstSentence(getJSDocComment(node)),
      });
    } else if (ts.isTypeAliasDeclaration(node) && node.name && hasExportModifier(node)) {
      symbols.push({
        name: node.name.text,
        kind: "type",
        signature: getSignatureLine(node, sf),
        jsDoc: truncateToFirstSentence(getJSDocComment(node)),
      });
    } else if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        symbols.push({
          name: decl.name.text,
          kind: "const",
          signature: getSignatureLine(node, sf),
          jsDoc: truncateToFirstSentence(getJSDocComment(node)),
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);
  return symbols;
}

/**
 * Scan all applesauce packages, extract exported symbols with JSDoc,
 * write per-package markdown files to dist/exports/, and return
 * an array of { packageName, npmName, relativePath, symbolCount } for the index.
 */
export async function buildExports(repoRoot, distDir) {
  const packagesDir = path.join(repoRoot, "packages");
  const distExportsDir = path.join(distDir, "exports");
  const entries = await fs.readdir(packagesDir, { withFileTypes: true });

  await fs.mkdir(distExportsDir, { recursive: true });

  const results = [];
  let totalSymbols = 0;

  const packageNames = entries.filter((e) => e.isDirectory() && !SKIP_PACKAGES.has(e.name)).map((e) => e.name);
  console.log(`[llms:exports] Found ${packageNames.length} packages: ${packageNames.join(", ")}`);

  for (const pkgName of packageNames) {
    const packageRoot = path.join(packagesDir, pkgName);
    let packageInfo;
    try {
      packageInfo = await parsePackageJson(packageRoot);
    } catch {
      console.log(`[llms:exports]   ${pkgName}: skipped (no package.json)`);
      continue;
    }

    const srcDir = path.join(packageRoot, "src");
    const tsFiles = await getAllTsFiles(srcDir);

    // Collect symbols grouped by import path for this package
    const groups = new Map();
    let pkgSymbols = 0;
    let pkgErrors = 0;

    for (const filePath of tsFiles) {
      let symbols;
      try {
        symbols = parseFile(filePath, packageRoot);
      } catch (err) {
        pkgErrors++;
        continue;
      }
      if (symbols.length === 0) continue;

      const exportPath = mapSourceToExportPath(filePath, packageInfo.exports, packageRoot);
      const importPath = exportPath ? `${packageInfo.name}/${exportPath}` : packageInfo.name;

      if (!groups.has(importPath)) groups.set(importPath, []);
      groups.get(importPath).push(...symbols);
      pkgSymbols += symbols.length;
    }

    if (pkgSymbols > 0) {
      const markdown = renderPackageExports(packageInfo.name, groups);
      const fileName = `${pkgName}.md`;
      await fs.writeFile(path.join(distExportsDir, fileName), markdown, "utf8");

      results.push({
        packageName: pkgName,
        npmName: packageInfo.name,
        relativePath: `exports/${fileName}`,
        symbolCount: pkgSymbols,
        subpaths: [...groups.keys()].sort(),
      });
      totalSymbols += pkgSymbols;
    }

    const errNote = pkgErrors > 0 ? ` (${pkgErrors} files failed)` : "";
    console.log(`[llms:exports]   ${packageInfo.name}: ${tsFiles.length} files -> ${pkgSymbols} exports${errNote}`);
  }

  console.log(`[llms:exports] Total: ${totalSymbols} exports across ${results.length} packages`);
  return results;
}

function renderPackageExports(npmName, groups) {
  const lines = [`# ${npmName} — Exports`, ""];
  const sortedPaths = [...groups.keys()].sort();

  for (const importPath of sortedPaths) {
    const symbols = groups.get(importPath);
    if (symbols.length === 0) continue;

    lines.push(`## ${importPath}`);
    lines.push("");

    const seen = new Set();
    for (const sym of symbols) {
      if (seen.has(sym.name)) continue;
      seen.add(sym.name);

      const doc = sym.jsDoc ? ` — ${sym.jsDoc}` : "";
      lines.push(`- \`${sym.name}\` (${sym.kind})${doc}`);

      if (sym.kind === "class" && sym.methods?.length) {
        for (const m of sym.methods) {
          const mdoc = m.jsDoc ? ` — ${m.jsDoc}` : "";
          lines.push(`  - \`${m.name}()\`${mdoc}`);
        }
      }
    }

    lines.push("");
  }

  return lines.join("\n");
}
