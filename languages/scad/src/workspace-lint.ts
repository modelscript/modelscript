// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { lintScad } from "./index.js";

/**
 * Performs multi-file OpenSCAD workspace linting by resolving `include <...>` and
 * `use <...>` directives, detecting missing libraries and cycles, and linting
 * all workspace `.scad` files.
 */
export async function lintScadWorkspace(
  workspace: WorkspaceDocumentInput,
  rootUri?: string,
): Promise<WorkspaceLintDiagnostic[]> {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();

  for (const [uri, text] of entries) {
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    for (const d of await lintScad(text)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "scad-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const m of text.matchAll(/^\s*(?:include|use)\s*<([^>\r\n]+)>/gm)) {
      const target = m[1]?.trim();
      if (!target) continue;
      const resolved = resolveRelativeUri(uri, target, docs);
      if (!resolved) {
        diagnostics.push({
          uri,
          code: "SCAD3001",
          rule: "unresolved-scad-include",
          severity: "error",
          message: `OpenSCAD include/use target '<${target}>' was not found in the workspace.`,
        });
      } else {
        outEdges.push(resolved);
      }
    }
  }

  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "SCAD3002",
      rule: "cyclic-scad-include",
      severity: "error",
      message: `Circular OpenSCAD include/use dependency: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
