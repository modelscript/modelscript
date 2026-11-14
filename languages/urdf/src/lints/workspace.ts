// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseUrdf } from "../parser/urdf-parser.js";
import { lintUrdfRobot } from "./index.js";

/**
 * Performs multi-file URDF / Xacro workspace linting, resolving `xacro:include`
 * and `<mesh filename="..."/>` / `<texture filename="..."/>` asset URIs
 * across workspace files.
 */
export function lintUrdfWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();

  for (const [uri, text] of entries) {
    if (!/\.(?:urdf|xacro|xml)$/i.test(uri) && uri !== entryUri) continue;
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const robot = parseUrdf(text);
    for (const d of lintUrdfRobot(robot)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "urdf-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const m of text.matchAll(/<xacro:include\b[^>]*\bfilename=["']([^"']+)["']/gi)) {
      const refPath = m[1]?.replace(/^\$\(find\s+[^)]+\)\/?/i, "").trim();
      if (!refPath) continue;
      const resolved = resolveRelativeUri(uri, refPath, docs);
      if (!resolved) {
        diagnostics.push({
          uri,
          code: "UR3001",
          rule: "unresolved-xacro-include",
          severity: "error",
          message: `Xacro include '${m[1]}' was not found in the workspace.`,
        });
      } else {
        outEdges.push(resolved);
      }
    }

    for (const m of text.matchAll(/<(?:mesh|texture)\b[^>]*\bfilename=["']([^"']+)["']/gi)) {
      const rawFile = m[1]?.trim();
      if (!rawFile) continue;
      const stripped = rawFile.replace(/^package:\/\/[^/]+\//i, "").replace(/^file:\/\//i, "");
      if (!resolveRelativeUri(uri, stripped, docs)) {
        diagnostics.push({
          uri,
          code: "UR3002",
          rule: "unresolved-urdf-asset",
          severity: "warning",
          message: `URDF asset '${rawFile}' was not found in the workspace.`,
        });
      }
    }
  }

  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "UR3003",
      rule: "cyclic-xacro-include",
      severity: "error",
      message: `Circular Xacro include detected: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
