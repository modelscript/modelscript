// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectCstNodes,
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { getScadParser, lintScad } from "./index.js";

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
  const parser = await getScadParser();

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
        line: d.line,
        column: d.column,
        endLine: d.endLine,
        endColumn: d.endColumn,
      });
    }

    const tree = parser.parse(text);
    for (const node of collectCstNodes(tree?.rootNode, ["INCLUDE_DIRECTIVE", "USE_DIRECTIVE"])) {
      const lt = node.text.indexOf("<");
      const gt = node.text.lastIndexOf(">");
      const target = lt >= 0 && gt > lt ? node.text.slice(lt + 1, gt).trim() : "";
      if (!target) continue;
      const resolved = resolveRelativeUri(uri, target, docs);
      if (!resolved) {
        const endPosition = (node as { endPosition?: { row: number; column: number } }).endPosition;
        diagnostics.push({
          uri,
          code: "SCAD3001",
          rule: "unresolved-scad-include",
          severity: "error",
          message: `OpenSCAD include/use target '<${target}>' was not found in the workspace.`,
          line: node.startPosition ? node.startPosition.row + 1 : undefined,
          column: node.startPosition ? node.startPosition.column + 1 : undefined,
          endLine: endPosition ? endPosition.row + 1 : undefined,
          endColumn: endPosition ? endPosition.column + 1 : undefined,
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
