// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseEclipse } from "../parser/index.js";
import { lintEclipse } from "./index.js";

/**
 * Performs multi-file ECLIPSE reservoir deck workspace linting by resolving
 * `INCLUDE` directives, detecting missing files or cycles, and linting the expanded deck.
 */
export function lintEclipseWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

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

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^\s*INCLUDE\b/i.test(line)) {
        const nextLine = lines[i + 1] ?? "";
        const m = nextLine.match(/^\s*(?:'([^']+)'|"([^"]+)"|([^\s/]+))/);
        const targetRaw = m?.[1] ?? m?.[2] ?? m?.[3] ?? "";
        if (targetRaw) {
          const resolved = resolveRelativeUri(uri, targetRaw, docs);
          if (!resolved) {
            diagnostics.push({
              uri,
              code: "EC3001",
              rule: "unresolved-eclipse-include",
              severity: "error",
              message: `ECLIPSE INCLUDE target '${targetRaw}' was not found in the workspace.`,
            });
          } else {
            outEdges.push(resolved);
            expand(resolved);
          }
          i++;
          continue;
        }
      }
      expandedLines.push(line);
    }
  }

  expand(entryUri);
  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "EC3002",
      rule: "cyclic-eclipse-include",
      severity: "error",
      message: `Circular ECLIPSE INCLUDE dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const deck = parseEclipse(expandedLines.join("\n"));
  for (const d of lintEclipse(deck)) {
    diagnostics.push({
      uri: entryUri,
      code: String(d.code),
      rule: "eclipse-lint",
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
