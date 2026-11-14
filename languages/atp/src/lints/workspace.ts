// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseAtp } from "../parser/atp-parser.js";
import { lintAtpCase } from "./index.js";

/**
 * Performs multi-file ATP/EMTP workspace linting by resolving `$INCLUDE`
 * directives, detecting missing files or cycles, and linting the expanded deck.
 */
export function lintAtpWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
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
      const m = line.match(/^\s*\$INCLUDE\b[,\s]*(?:"([^"]+)"|'([^']+)'|([^\s,]+))/i);
      if (m) {
        const targetRaw = m[1] ?? m[2] ?? m[3] ?? "";
        const resolved = resolveRelativeUri(uri, targetRaw, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "AT3001",
            rule: "unresolved-atp-include",
            severity: "error",
            message: `ATP $INCLUDE target '${targetRaw}' was not found in the workspace.`,
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
      code: "AT3002",
      rule: "cyclic-atp-include",
      severity: "error",
      message: `Circular ATP $INCLUDE dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const parsed = parseAtp(expandedLines.join("\n"));
  for (const d of lintAtpCase(parsed)) {
    diagnostics.push({
      uri: entryUri,
      code: d.code,
      rule: "atp-lint",
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
