// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseFlow, parseGeometry, parseHecRas } from "../parser/index.js";
import { lintHecRas } from "./index.js";

/**
 * Performs multi-file HEC-RAS workspace linting across `.prj` project files,
 * `.g01` geometry files, and `.f01`/`.u01` flow files.
 */
export function lintHecRasWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const baseStem =
    (rootUri ?? entries[0]![0])
      .replace(/\.[^/.]+$/, "")
      .split("/")
      .pop() ?? "project";
  let geomText: string | undefined;
  let flowText: string | undefined;
  let geomUri = entries[0]![0];

  for (const [uri, text] of entries) {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".prj")) {
      for (const m of text.matchAll(/^(?:Geom|Flow|Unsteady)\s+File\s*=\s*([^\r\n]+)/gim)) {
        const ext = m[1]?.trim();
        if (!ext) continue;
        const candidate = ext.includes(".") ? ext : `${baseStem}.${ext}`;
        if (!resolveRelativeUri(uri, candidate, docs)) {
          diagnostics.push({
            uri,
            code: "HR3001",
            rule: "unresolved-hecras-project-file",
            severity: "error",
            message: `HEC-RAS project references '${candidate}', which was not found in the workspace.`,
          });
        }
      }
    } else if (/\.g\d+$/i.test(lower)) {
      geomText = text;
      geomUri = uri;
    } else if (/\.(?:f|u)\d+$/i.test(lower)) {
      flowText = text;
    }
  }

  if (geomText && flowText) {
    const geom = parseGeometry(geomText);
    const flow = parseFlow(flowText);
    for (const d of lintHecRas(geom, flow)) {
      diagnostics.push({
        uri: geomUri,
        code: String(d.code),
        rule: "hecras-lint",
        severity: d.severity,
        message: d.message,
      });
    }
  } else if (entries.length === 1) {
    const parsed = parseHecRas(entries[0]![1]);
    if (parsed.geometry) {
      for (const d of lintHecRas(parsed.geometry, parsed.flow)) {
        diagnostics.push({
          uri: entries[0]![0],
          code: String(d.code),
          rule: "hecras-lint",
          severity: d.severity,
          message: d.message,
        });
      }
    }
  }

  return diagnostics;
}
