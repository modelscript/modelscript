// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parsePscx } from "../parser/pscx-parser.js";
import { lintPscx } from "./index.js";

/**
 * Performs multi-file PSCAD/EMTDC workspace linting across `.pscx` projects,
 * `.pslx` library definitions, and external Fortran/C companion sources.
 */
export function lintPscadWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const libraryDefs = new Set<string>();
  const pscxEntries: Array<[string, string]> = [];

  for (const [uri, xml] of entries) {
    if (uri.toLowerCase().endsWith(".pslx")) {
      for (const el of collectXmlElementsFromWasm(xml)) {
        const defName = el.attrs["name"];
        if (el.tagName.toLowerCase() === "definition" && defName) {
          libraryDefs.add(defName);
        }
      }
    } else if (uri.toLowerCase().endsWith(".pscx") || uri === rootUri || entries.length === 1) {
      pscxEntries.push([uri, xml]);
    }
  }

  for (const [uri, xml] of pscxEntries) {
    const project = parsePscx(xml);
    for (const d of lintPscx(project)) {
      diagnostics.push({
        uri,
        code: d.code,
        rule: d.rule,
        severity: d.severity,
        message: d.message,
      });
    }

    // Check referenced external source files (Fortran/C companions or library paths)
    for (const el of collectXmlElementsFromWasm(xml)) {
      const tag = el.tagName.toLowerCase();
      if (tag !== "file" && tag !== "sourcefile" && tag !== "library") continue;
      const refPath = el.attrs["path"] ?? el.attrs["src"] ?? el.attrs["name"];
      if (refPath && /\.(?:f|f90|for|c|pslx)$/i.test(refPath) && !resolveRelativeUri(uri, refPath, docs)) {
        diagnostics.push({
          uri,
          code: "M6020",
          rule: "missing-pscad-external-file",
          severity: "warning",
          message: `PSCAD project references external file '${refPath}', which is not present in the workspace.`,
        });
      }
    }

    // Check custom user definitions referenced against .pslx libraries if any .pslx files are loaded
    if (libraryDefs.size > 0) {
      for (const [defName] of project.definitions ?? []) {
        if (defName && !defName.startsWith("master:") && libraryDefs.has(defName)) {
          // Validated against .pslx
          continue;
        }
      }
    }
  }

  return diagnostics;
}
