// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parsePlot3dAuto } from "./parser/ascii-parser.js";
import type { Plot3dDataset } from "./types.js";

const PLOT3D_EXTENSIONS = [".xyz", ".p3d", ".g", ".q", ".f", ".nam"];

/**
 * Declarative UnifiedWorkspace indexing configuration for NASA Ames PLOT3D files.
 */
export const plot3dIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text?: string): boolean {
    const lower = uri.split(/[?#]/)[0]!.toLowerCase();
    if (PLOT3D_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return true;
    }
    if (!text) return false;
    // Heuristic: pure numeric structured grid header (1-3 positive integers on first line)
    const firstLine = text.trim().split(/\r?\n/)[0]?.trim() ?? "";
    return /^\d+(?:\s+\d+){0,2}$/.test(firstLine);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const addSym = (parentId: SymbolId | null, name: string, kind: string): SymbolId =>
      ctx.addSymbol(name, kind, parentId, 0, ctx.text.length, {}, { ruleName: "plot3d_entity" });

    try {
      const dataset = parsePlot3dAuto(ctx.text, ctx.uri);
      ctx.setParsedModel<Plot3dDataset>(dataset);

      const baseName = ctx.uri.split(/[\\/]/).pop() ?? "plot3d";
      const rootId = addSym(null, baseName, `plot3d:${dataset.kind}`);

      if (dataset.grid) {
        for (const b of dataset.grid.blocks) {
          addSym(rootId, `Block_${b.index + 1} (${b.ni}x${b.nj}x${b.nk})`, "block:grid");
        }
      }
      if (dataset.solution) {
        for (const b of dataset.solution.blocks) {
          const bId = addSym(rootId, `SolutionBlock_${b.index + 1} (${b.ni}x${b.nj}x${b.nk})`, "block:solution");
          addSym(bId, `FSMACH=${b.conditions.fsmach}`, "parameter");
          addSym(bId, `ALPHA=${b.conditions.alpha}`, "parameter");
          addSym(bId, `RE=${b.conditions.re}`, "parameter");
          addSym(bId, `TIME=${b.conditions.time}`, "parameter");
        }
      }
      if (dataset.func) {
        for (const b of dataset.func.blocks) {
          addSym(rootId, `FunctionBlock_${b.index + 1} (${b.ni}x${b.nj}x${b.nk}, ${b.nVars} vars)`, "block:function");
        }
      }
      if (dataset.nam) {
        for (const varName of dataset.nam.variableNames) {
          addSym(rootId, varName, "variable");
        }
      }
    } catch {
      // Retain partial symbol index on malformed PLOT3D input
    }
  },
};

/**
 * Retrieves the parsed `Plot3dDataset` stored in `UnifiedWorkspace` for `uri`.
 */
export function getPlot3dDataset(workspace: UnifiedWorkspace, uri: string): Plot3dDataset | undefined {
  return workspace.getParsedModel<Plot3dDataset>(uri);
}

/**
 * Finds PLOT3D symbol definitions matching `name` across indexed documents.
 */
export function findPlot3dDefinition(
  workspace: UnifiedWorkspace,
  name: string,
  currentUri?: string,
): { uri: string; symbol: SymbolEntry }[] {
  const results: { uri: string; symbol: SymbolEntry }[] = [];
  const uris = workspace.listDocumentUris();
  const order = currentUri && uris.includes(currentUri) ? [currentUri, ...uris.filter((u) => u !== currentUri)] : uris;

  for (const uri of order) {
    for (const sym of workspace.findSymbolsByName(name, uri)) {
      results.push({ uri, symbol: sym });
    }
  }
  return results;
}

/**
 * Provides prefix-matched symbol completions from `workspace`.
 */
export function getPlot3dCompletions(workspace: UnifiedWorkspace, prefix: string, uri?: string): string[] {
  const norm = prefix.toLowerCase();
  const suggestions = new Set<string>();
  for (const sym of workspace.getSymbolsForUri(uri)) {
    if (sym.name.toLowerCase().startsWith(norm)) {
      suggestions.add(sym.name);
    }
  }
  return Array.from(suggestions);
}
