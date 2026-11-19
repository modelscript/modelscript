// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { getMasterComponentSchema } from "../catalog/master-library-schemas.js";
import { registeredExternalDefinitions } from "../model/workspace-registry.js";
import { parsePscx } from "../parser/pscx-parser.js";
import { lintPscx } from "./index.js";

/**
 * Performs multi-file PSCAD/EMTDC workspace linting across `.pscx` projects,
 * `.pslx` library definitions, and external Fortran/C companion sources.
 */
export function lintPscadWorkspace(
  workspace: WorkspaceDocumentInput,
  rootUri?: string,
  options?: { tier?: "fast" | "deep" | "formal" },
): WorkspaceLintDiagnostic[] {
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
    for (const d of lintPscx(project, options)) {
      diagnostics.push({
        uri,
        code: d.code,
        rule: d.rule,
        severity: d.severity,
        message: d.message,
        line: d.line,
        column: d.column,
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

    // Check component definitions against project definitions, submodules, loaded .pslx libraries, and workspace registry
    const extDefs = registeredExternalDefinitions();
    const BUILTIN_BARE_DEFS = new Set([
      "bus",
      "wire",
      "graphframe",
      "sticky",
      "annotate",
      "divider",
      "label",
      "pgb",
      "tline",
      "cable",
    ]);
    const modules = [project.rootModule, ...project.subModules.values()];
    for (const mod of modules) {
      for (const cmp of mod.components) {
        const defName = cmp.definitionName;
        if (!defName) continue;
        const colonIdx = defName.indexOf(":");
        const ns = colonIdx >= 0 ? defName.slice(0, colonIdx) : "";
        const shortName = colonIdx >= 0 ? defName.slice(colonIdx + 1) : defName;
        if (ns.toLowerCase() === "master") continue;
        if (colonIdx < 0 && BUILTIN_BARE_DEFS.has(shortName.toLowerCase())) continue;
        if (project.definitions?.has(defName) || project.definitions?.has(shortName)) continue;
        if (project.subModules?.has(defName) || project.subModules?.has(shortName)) continue;
        if (libraryDefs.has(defName) || libraryDefs.has(shortName)) continue;
        if (ns && extDefs?.(ns, shortName)) continue;
        if (getMasterComponentSchema(defName) || getMasterComponentSchema(shortName)) continue;
        if (colonIdx >= 0 || libraryDefs.size > 0) {
          diagnostics.push({
            uri,
            code: "M6021",
            rule: "unresolved-component-definition",
            severity: "warning",
            message: `Component '${cmp.instanceName || cmp.id}' references definition '${defName}', which is not found in the project or loaded .pslx libraries.`,
          });
        }
      }
    }
  }

  return diagnostics;
}
