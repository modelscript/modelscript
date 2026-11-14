// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseSpice } from "../parser/spice-parser.js";
import { lintSpiceCircuit } from "./rules.js";

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

  function expand(uri: string): void {
    if (visited.has(uri)) return;
    visited.add(uri);
    const text = docs.get(uri) ?? "";
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*\.(?:include|inc|lib)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
      if (m) {
        const targetRaw = m[1] ?? m[2] ?? m[3] ?? "";
        const resolved = resolveRelativeUri(uri, targetRaw, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "SP3001",
            rule: "unresolved-spice-include",
            severity: "error",
            message: `SPICE .include/.lib target '${targetRaw}' was not found in the workspace.`,
          });
        } else {
          outEdges.push(resolved);
          expand(resolved);
        }
      } else {
        expandedLines.push(line);
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
    });
  }

  return diagnostics;
}
