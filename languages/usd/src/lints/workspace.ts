// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { createWasmParserSync } from "@modelscript/usd/wasm-parser";
import { parseUsd } from "../parser/usd-parser.js";
import { lintUsdStage } from "./index.js";

function getUsdWasmParser() {
  return getOrLoadLanguageWasmParser("usd", import.meta.url, createWasmParserSync);
}

/**
 * Performs multi-file OpenUSD workspace linting across `.usd`/`.usda` layers,
 * resolving `subLayers`, `references`, and `payload` `@asset@` arcs and
 * detecting missing layers or composition cycles.
 */
export function lintUsdWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();
  const parser = getUsdWasmParser();

  for (const [uri, text] of entries) {
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const stage = parseUsd(text);
    for (const d of lintUsdStage(stage)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "usd-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    const tree = parser.parse(text);
    const rawLines = text.split(/\r?\n/);
    const visitedRows = new Set<number>();
    for (const { row } of groupCstLeavesByLine(tree?.rootNode)) {
      if (visitedRows.has(row)) continue;
      visitedRows.add(row);
      for (const m of (rawLines[row] ?? "").matchAll(/@([^@\r\n]+\.(?:usd|usda|usdc|usdz))@/gi)) {
        const refPath = m[1]?.trim();
        if (!refPath) continue;
        const resolved = resolveRelativeUri(uri, refPath, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "US3001",
            rule: "unresolved-usd-layer",
            severity: "error",
            message: `USD composition arc references '@${refPath}@', which was not found in the workspace.`,
          });
        } else {
          outEdges.push(resolved);
        }
      }
    }
  }

  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "US3002",
      rule: "cyclic-usd-layer",
      severity: "error",
      message: `Circular USD layer composition detected: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
