// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { lintCSource } from "./index.js";

/**
 * Performs multi-file C workspace linting across `.c`/`.h` translation units,
 * resolving local `#include "..."` directives, detecting missing headers or cycles,
 * and running `lintCSource`.
 */
export function lintCWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();

  for (const [uri, text] of entries) {
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    for (const d of lintCSource(text)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: d.rule ?? "c-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const m of text.matchAll(/^\s*#\s*include\s+"([^"\r\n]+)"/gm)) {
      const header = m[1]?.trim();
      if (!header) continue;
      const resolved = resolveRelativeUri(uri, header, docs);
      if (!resolved) {
        diagnostics.push({
          uri,
          code: "C3001",
          rule: "unresolved-c-include",
          severity: "error",
          message: `C #include header "${header}" was not found in the workspace.`,
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
      code: "C3002",
      rule: "cyclic-c-include",
      severity: "error",
      message: `Circular C #include dependency: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
