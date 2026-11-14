// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseSedml } from "../parser/index.js";
import { lintSedml } from "./index.js";

/**
 * Performs multi-file SED-ML workspace linting across `.sedml`/`.omex` workspaces,
 * validating `<model source="..."/>` targets against workspace SBML/CellML files.
 */
export function lintSedmlWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  for (const [uri, xml] of entries) {
    if (!/\.(?:sedml|xml)$/i.test(uri) && uri !== rootUri && entries.length > 1) continue;
    if (!xml.includes("<sedML")) continue;

    const doc = parseSedml(xml);
    for (const d of lintSedml(doc)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "sedml-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const m of xml.matchAll(/<model\b[^>]*\bsource=["']([^"']+)["']/gi)) {
      const src = m[1]?.trim();
      if (!src || src.startsWith("#") || /^https?:\/\//i.test(src)) continue;
      if (!resolveRelativeUri(uri, src, docs)) {
        diagnostics.push({
          uri,
          code: "SD3001",
          rule: "unresolved-sedml-model-source",
          severity: "error",
          message: `SED-ML model source '${src}' was not found in the workspace.`,
        });
      }
    }
  }

  return diagnostics;
}
