// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseSedml } from "../parser/index.js";
import { lintSedml } from "./index.js";

/**
 * Performs multi-file SED-ML workspace linting across `.sedml`/`.omex` workspaces,
 * validating `<model source="..."/>` targets via XML WASM CST against workspace SBML/CellML files.
 */
export function lintSedmlWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  for (const [uri, xml] of entries) {
    if (!/\.(?:sedml|xml)$/i.test(uri) && uri !== rootUri && entries.length > 1) continue;
    const elements = collectXmlElementsFromWasm(xml);
    if (!elements.some((t) => t.tagName.toLowerCase() === "sedml")) continue;

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

    for (const { tagName, attrs } of elements) {
      if (tagName.toLowerCase() !== "model") continue;
      const src = attrs["source"]?.trim();
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
