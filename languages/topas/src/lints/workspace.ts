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
import { createWasmParserSync } from "@modelscript/topas/wasm-parser";
import { parseTopas } from "../parser/index.js";
import { lintTopasDocument } from "./index.js";

function getTopasWasmParser() {
  return getOrLoadLanguageWasmParser("topas", import.meta.url, createWasmParserSync);
}

/**
 * Performs multi-file TOPAS/Geant4 workspace linting by resolving `includeFile = ...`
 * parameter file hierarchies, detecting cycles, and linting the expanded parameter set.
 */
export function lintTopasWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();
  const expandedLines: string[] = [];
  const visited = new Set<string>();
  const parser = getTopasWasmParser();

  function expand(uri: string): void {
    if (visited.has(uri)) return;
    visited.add(uri);
    const text = docs.get(uri) ?? "";
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const tree = parser.parse(text);
    const rawLines = text.split(/\r?\n/);
    const includeRows = new Map<number, string>();
    for (const { row } of groupCstLeavesByLine(tree?.rootNode)) {
      const m = (rawLines[row] ?? "").match(/^\s*includeFile\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/i);
      if (m) {
        includeRows.set(row, m[1] ?? m[2] ?? m[3] ?? "");
      }
    }

    for (let row = 0; row < rawLines.length; row++) {
      const targetRaw = includeRows.get(row);
      if (targetRaw !== undefined) {
        const resolved = resolveRelativeUri(uri, targetRaw, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "TP3001",
            rule: "unresolved-topas-includefile",
            severity: "error",
            message: `TOPAS includeFile '${targetRaw}' was not found in the workspace.`,
          });
        } else {
          outEdges.push(resolved);
          expand(resolved);
        }
      } else {
        expandedLines.push(rawLines[row] ?? "");
      }
    }
  }

  expand(entryUri);
  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "TP3002",
      rule: "cyclic-topas-includefile",
      severity: "error",
      message: `Circular TOPAS includeFile dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const parsed = parseTopas(expandedLines.join("\n"));
  for (const d of lintTopasDocument(parsed)) {
    diagnostics.push({
      uri: entryUri,
      code: String(d.code),
      rule: "topas-lint",
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
