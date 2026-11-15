// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseCgmesFiles } from "../parser/cgmes-rdf-parser.js";
import { lintCgmesModel } from "./index.js";

/**
 * Performs multi-file CGMES RDF/XML profile linting across a workspace
 * (`EQ`, `TP`, `SSH`, `SV`, `DL`, `GL`), checking cross-profile `rdf:resource` /
 * `rdf:about` references via XML WASM CST and running ENTSO-E CGMES validation rules on the merged model.
 */
export function lintCgmesWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const fallbackUri = rootUri ?? entries[0]?.[0] ?? "";
  const definedIds = new Set<string>();
  const referencedIds: Array<{ uri: string; id: string }> = [];

  for (const [uri, xml] of entries) {
    for (const { attrs } of collectXmlElementsFromWasm(xml)) {
      const defRaw = attrs["rdf:ID"] ?? attrs["rdf:about"];
      if (defRaw) {
        const clean = defRaw.startsWith("#") ? defRaw.slice(1) : defRaw;
        if (clean) definedIds.add(clean);
      }
      const resRaw = attrs["rdf:resource"];
      if (resRaw?.startsWith("#")) {
        const id = resRaw.slice(1);
        if (id) referencedIds.push({ uri, id });
      }
    }
  }

  for (const ref of referencedIds) {
    if (!definedIds.has(ref.id)) {
      diagnostics.push({
        uri: ref.uri,
        code: "C1011",
        rule: "unresolved-cgmes-resource",
        severity: "error",
        message: `CGMES rdf:resource '#${ref.id}' does not resolve to any rdf:ID or rdf:about in the workspace.`,
      });
    }
  }

  const merged = parseCgmesFiles(entries.map(([, xml]) => xml));
  for (const d of lintCgmesModel(merged)) {
    diagnostics.push({
      uri: fallbackUri,
      code: d.code,
      rule: d.rule,
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
