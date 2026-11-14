// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parsePlcopenXml } from "../parser/plcopen-xml-parser.js";
import { lintPlcProject } from "./index.js";

const BUILTIN_IEC_FBS = new Set(["TON", "TOF", "TP", "CTU", "CTD", "CTUD", "R_TRIG", "F_TRIG", "SR", "RS"]);

/**
 * Performs multi-file IEC 61131-3 PLCopen workspace linting across multiple
 * `.xml` POU/library files, verifying cross-file derived FB/DUT type references.
 */
export function lintPlcopenWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const knownTypes = new Set<string>(BUILTIN_IEC_FBS);
  const parsedDocs: Array<{ uri: string; xml: string; proj: ReturnType<typeof parsePlcopenXml> }> = [];

  for (const [uri, xml] of entries) {
    const proj = parsePlcopenXml(xml);
    parsedDocs.push({ uri, xml, proj });
    for (const m of xml.matchAll(/<(?:pou|dataType)\b[^>]*\bname=["']([^"']+)["']/gi)) {
      if (m[1]) knownTypes.add(m[1]);
    }
  }

  for (const { uri, xml, proj } of parsedDocs) {
    if (rootUri && entries.length === 0) continue;
    for (const d of lintPlcProject(proj)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "plcopen-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const m of xml.matchAll(/<derived\b[^>]*\bname=["']([^"']+)["']/gi)) {
      const typeName = m[1];
      if (typeName && !knownTypes.has(typeName)) {
        diagnostics.push({
          uri,
          code: "PO3001",
          rule: "unresolved-plcopen-derived-type",
          severity: "error",
          message: `PLCopen derived type '${typeName}' is not declared in any POU or library in the workspace.`,
        });
      }
    }
  }

  return diagnostics;
}
