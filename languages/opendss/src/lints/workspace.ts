// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseOpenDss } from "../parser/opendss-parser.js";
import { lintOpenDss } from "./opendss-linter.js";

/**
 * Performs multi-file OpenDSS workspace linting by resolving `Redirect` and `Compile`
 * directives across `.dss` files, detecting missing files or cycles, and running
 * `lintOpenDss` over the merged circuit deck.
 */
export function lintOpenDssWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
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
      const m = line.match(/^\s*(?:redirect|compile)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
      if (m) {
        const targetRaw = m[1] ?? m[2] ?? m[3] ?? "";
        const resolved = resolveRelativeUri(uri, targetRaw, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "D3001",
            rule: "unresolved-opendss-redirect",
            severity: "error",
            message: `OpenDSS Redirect/Compile target '${targetRaw}' was not found in the workspace.`,
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
      code: "D3002",
      rule: "cyclic-opendss-redirect",
      severity: "error",
      message: `Circular OpenDSS Redirect/Compile dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const deck = parseOpenDss(expandedLines.join("\n"));
  for (const d of lintOpenDss(deck)) {
    diagnostics.push({
      uri: entryUri,
      code: String(d.code),
      rule: d.rule,
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
