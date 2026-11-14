// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseTopas } from "../parser/index.js";
import { lintTopasDocument } from "./index.js";

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

  function expand(uri: string): void {
    if (visited.has(uri)) return;
    visited.add(uri);
    const text = docs.get(uri) ?? "";
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*includeFile\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s#]+))/i);
      if (m) {
        const targetRaw = m[1] ?? m[2] ?? m[3] ?? "";
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
        expandedLines.push(line);
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
