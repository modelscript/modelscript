// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Verifies every language declaring `ui.panels` or `ui.simulationCards` in `languages/*`:
 *   1. Discovers all UI entries via `discoverWorkspaceLanguages()`.
 *   2. Transforms every panel & simulation card through Vite's module graph using the
 *      exact same source aliases as the lightweight ansatz (`scripts/tools/language-ansatz.ts`),
 *      verifying zero unresolved imports or TSX compilation errors.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { discoverWorkspaceLanguages } from "../../packages/ide-packager/src/language-discovery.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildDiagramAliases(): { find: string | RegExp; replacement: string }[] {
  const diagramPkgPath = path.join(REPO_ROOT, "packages", "diagram", "package.json");
  const aliases: { find: string | RegExp; replacement: string }[] = [];
  if (fs.existsSync(diagramPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(diagramPkgPath, "utf-8")) as {
      exports?: Record<string, string | { default?: string }>;
    };
    for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
      if (!subpath.startsWith("./") || subpath.includes("*")) continue;
      const relOut = typeof target === "string" ? target : target?.default;
      if (!relOut) continue;
      const srcGuess = relOut.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts");
      const absSrc = path.join(REPO_ROOT, "packages", "diagram", srcGuess);
      if (fs.existsSync(absSrc)) {
        aliases.push({
          find: new RegExp(`^@modelscript/diagram/${escapeRegExp(subpath.slice(2))}$`),
          replacement: absSrc,
        });
      }
    }
  }
  aliases.push({
    find: /^@modelscript\/diagram\/(.+)$/,
    replacement: path.join(REPO_ROOT, "packages", "diagram", "src", "$1.ts"),
  });
  aliases.push({
    find: /^@modelscript\/diagram$/,
    replacement: path.join(REPO_ROOT, "packages", "diagram", "src", "index.ts"),
  });
  return aliases;
}

async function main(): Promise<void> {
  const discovered = await discoverWorkspaceLanguages(path.join(REPO_ROOT, "languages"));
  const panels = discovered.ui.panels;
  const simCards = discovered.ui.simulationCards;

  console.log(
    `Discovered ${panels.length} UI panel(s), ${simCards.length} simulation card(s), and ${Object.keys(discovered.ui.stencilsByLanguage).length} language stencil set(s).`,
  );

  const server = await createServer({
    root: path.join(REPO_ROOT, "scripts", "ansatz"),
    configFile: false,
    clearScreen: false,
    logLevel: "error",
    optimizeDeps: { noDiscovery: true },
    esbuild: { jsx: "automatic" },
    resolve: {
      alias: [
        {
          find: /^@modelscript\/design-tokens\/tokens-web\.css$/,
          replacement: path.join(REPO_ROOT, "packages", "design-tokens", "src", "tokens-web.css"),
        },
        {
          find: /^@modelscript\/design-tokens\/tokens-vscode\.css$/,
          replacement: path.join(REPO_ROOT, "packages", "design-tokens", "src", "tokens-vscode.css"),
        },
        {
          find: /^@modelscript\/design-tokens$/,
          replacement: path.join(REPO_ROOT, "packages", "design-tokens", "src", "tokens.css"),
        },
        {
          find: /^@modelscript\/react\/panel$/,
          replacement: path.join(REPO_ROOT, "packages", "react", "src", "panel.ts"),
        },
        {
          find: /^@modelscript\/react$/,
          replacement: path.join(REPO_ROOT, "packages", "react", "src", "index.ts"),
        },
        ...buildDiagramAliases(),
      ],
    },
    server: {
      middlewareMode: true,
      fs: { allow: [REPO_ROOT] },
    },
  });

  const failures: { id: string; error: string }[] = [];

  try {
    for (const panel of panels) {
      const urlPath = `/@fs/${panel.resolvedEntryPath.replace(/\\/g, "/").replace(/^\/+/, "")}`;
      try {
        const res = await server.transformRequest(urlPath);
        if (!res || !res.code) {
          throw new Error("Empty transform output");
        }
        console.log(`  ✓ [${panel.languageId}] ${panel.id} (${res.code.length} bytes)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ [${panel.languageId}] ${panel.id}: ${msg}`);
        failures.push({ id: `${panel.languageId}:${panel.id}`, error: msg });
      }
    }

    for (const card of simCards) {
      const urlPath = `/@fs/${card.resolvedEntryPath.replace(/\\/g, "/").replace(/^\/+/, "")}`;
      try {
        const res = await server.transformRequest(urlPath);
        if (!res || !res.code) {
          throw new Error("Empty transform output");
        }
        console.log(`  ✓ [${card.languageId}] simCard:${card.id} (${res.code.length} bytes)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  ✗ [${card.languageId}] simCard:${card.id}: ${msg}`);
        failures.push({ id: `${card.languageId}:simCard:${card.id}`, error: msg });
      }
    }
  } finally {
    await server.close();
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} UI panel/card compilation failure(s).`);
    process.exit(1);
  }
  console.log(
    `\n✓ All ${panels.length} language UI panel(s) and ${simCards.length} simulation card(s) compiled cleanly.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
