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
import { createWasmParserSync } from "@modelscript/spice/wasm-parser";
import { parseSpice } from "../parser/spice-parser.js";
import { lintSpiceCircuit } from "./rules.js";

function getSpiceWasmParser() {
  return getOrLoadLanguageWasmParser("spice", import.meta.url, createWasmParserSync);
}

/**
 * Performs multi-file SPICE workspace linting by resolving `.include` / `.lib`
 * directives, detecting missing files and include cycles, and linting the expanded netlist.
 */
export function lintSpiceWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  const firstEntry = entries[0];
  if (!firstEntry) return diagnostics;

  const entryUri = rootUri ?? firstEntry[0];
  const edges = new Map<string, string[]>();
  const expandedLines: string[] = [];
  const visited = new Set<string>();
  const parser = getSpiceWasmParser();

  function expand(uri: string): void {
    if (visited.has(uri)) return;
    visited.add(uri);
    const text = docs.get(uri) ?? "";
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const tree = parser.parse(text);
    const rawLines = text.split(/\r?\n/);
    const includeRows = new Map<number, string>();
    for (const { row, tokens } of groupCstLeavesByLine(tree?.rootNode)) {
      const joined = tokens
        .map((t) => t.text)
        .join("")
        .trim();
      const m = joined.match(/^\.(?:include|inc|lib)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
      if (m) {
        includeRows.set(row, m[1] ?? m[2] ?? m[3] ?? "");
      }
    }

    for (let row = 0; row < rawLines.length; row++) {
      const targetRaw = includeRows.get(row);
      if (targetRaw !== undefined) {
        const resolved = resolveRelativeUri(uri, targetRaw, docs);
        if (!resolved) {
          const lineText = rawLines[row] ?? "";
          const idx = targetRaw ? lineText.indexOf(targetRaw) : -1;
          const col = idx >= 0 ? idx + 1 : 1;
          const endCol = idx >= 0 ? col + targetRaw.length : lineText.length + 1;
          diagnostics.push({
            uri,
            code: "SP3001",
            rule: "unresolved-spice-include",
            severity: "error",
            message: `SPICE .include/.lib target '${targetRaw}' was not found in the workspace.`,
            line: row + 1,
            column: col,
            endLine: row + 1,
            endColumn: endCol,
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
      code: "SP3002",
      rule: "cyclic-spice-include",
      severity: "error",
      message: `Circular SPICE .include/.lib dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const circuit = parseSpice(expandedLines.join("\n"));
  for (const d of lintSpiceCircuit(circuit)) {
    diagnostics.push({
      uri: entryUri,
      code: String(d.code),
      rule: d.rule,
      severity: d.severity,
      message: d.message,
      line: d.span?.startLine,
      column: d.span?.startCol,
      endLine: d.span?.endLine,
      endColumn: d.span?.endCol,
    });
  }

  return diagnostics;
}
