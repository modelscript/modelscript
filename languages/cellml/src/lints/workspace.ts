// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseCellml } from "../parser/index.js";
import { lintCellmlDocument } from "./index.js";

/**
 * Performs multi-file CellML 1.1/2.0 workspace linting across `.cellml` files,
 * resolving `<import xlink:href="...">` dependencies via XML WASM CST, detecting cycles,
 * and linting each parsed model.
 */
export function lintCellmlWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();

  for (const [uri, xml] of entries) {
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const model = parseCellml(xml);
    for (const d of lintCellmlDocument(model)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "cellml-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const { tagName, attrs } of collectXmlElementsFromWasm(xml)) {
      if (tagName.toLowerCase() !== "import") continue;
      const href = (attrs["xlink:href"] ?? attrs["href"])?.trim();
      if (!href || /^https?:\/\//i.test(href)) continue;
      const resolved = resolveRelativeUri(uri, href, docs);
      if (!resolved) {
        diagnostics.push({
          uri,
          code: "CM3001",
          rule: "unresolved-cellml-import",
          severity: "error",
          message: `CellML import xlink:href '${href}' was not found in the workspace.`,
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
      code: "CM3002",
      rule: "cyclic-cellml-import",
      severity: "error",
      message: `Circular CellML import dependency: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
