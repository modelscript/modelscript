// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseAntimony } from "../parser/index.js";
import { lintAntimony } from "./index.js";

/**
 * Performs multi-file Antimony workspace linting across `.ant` files, resolving
 * `import "..."` directives, detecting cycles, and linting each module.
 */
export function lintAntimonyWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();

  for (const [uri, text] of entries) {
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const model = parseAntimony(text);
    for (const d of lintAntimony(model)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "antimony-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const m of text.matchAll(/^\s*import\s+["']([^"'\r\n]+)["']/gim)) {
      const target = m[1]?.trim();
      if (!target) continue;
      const resolved = resolveRelativeUri(uri, target, docs);
      if (!resolved) {
        diagnostics.push({
          uri,
          code: "AN3001",
          rule: "unresolved-antimony-import",
          severity: "error",
          message: `Antimony import '${target}' was not found in the workspace.`,
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
      code: "AN3002",
      rule: "cyclic-antimony-import",
      severity: "error",
      message: `Circular Antimony import dependency: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
