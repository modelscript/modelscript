// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  findIncludeCycle,
  offsetSpanToRange,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseUrdf } from "../parser/urdf-parser.js";
import { lintUrdfRobot } from "./index.js";

/**
 * Performs multi-file URDF / Xacro workspace linting, resolving `xacro:include`
 * and `<mesh filename="..."/>` / `<texture filename="..."/>` asset URIs via XML WASM CST
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
        line: d.range?.startLine,
        column: d.range?.startColumn,
        endLine: d.range?.endLine,
        endColumn: d.range?.endColumn,
        range: d.range,
      });
    }

    for (const el of collectXmlElementsFromWasm(text)) {
      const lowerTag = el.tagName.toLowerCase();
      if (lowerTag === "xacro:include") {
        const rawFilename = el.attrs["filename"];
        const refPath = rawFilename?.replace(/^\$\(find\s+[^)]+\)\/?/i, "").trim();
        if (!refPath) continue;
        const resolved = resolveRelativeUri(uri, refPath, docs);
        if (!resolved) {
          const span = el.attrSpans["filename"] ?? { start: el.start, end: el.openEnd };
          const r = offsetSpanToRange(text, span.start, span.end);
          diagnostics.push({
            uri,
            code: "UR3001",
            rule: "unresolved-xacro-include",
            severity: "error",
            message: `Xacro include '${rawFilename}' was not found in the workspace.`,
            line: r.startLine,
            column: r.startColumn,
            endLine: r.endLine,
            endColumn: r.endColumn,
            range: r,
          });
        } else {
          outEdges.push(resolved);
        }
      } else if (lowerTag === "mesh" || lowerTag === "texture") {
        const rawFile = el.attrs["filename"]?.trim();
        if (!rawFile) continue;
        const stripped = rawFile.replace(/^package:\/\/[^/]+\//i, "").replace(/^file:\/\//i, "");
        if (!resolveRelativeUri(uri, stripped, docs)) {
          const span = el.attrSpans["filename"] ?? { start: el.start, end: el.openEnd };
          const r = offsetSpanToRange(text, span.start, span.end);
          diagnostics.push({
            uri,
            code: "UR3002",
            rule: "unresolved-urdf-asset",
            severity: "warning",
            message: `URDF asset '${rawFile}' was not found in the workspace.`,
            line: r.startLine,
            column: r.startColumn,
            endLine: r.endLine,
            endColumn: r.endColumn,
            range: r,
          });
        }
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
