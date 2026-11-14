// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseSlxXml } from "../parser/slx-xml-parser.js";
import { lintSimulinkModel } from "./index.js";

/**
 * Performs multi-file Simulink workspace linting across `.slx`/`.xml`/`.sldd`
 * files, resolving `ModelReference` targets and `DataDictionary` references.
 */
export function lintSimulinkWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const modelNames = new Set<string>();
  for (const [uri] of entries) {
    const base = uri.replace(/\\/g, "/").split("/").pop() ?? "";
    const stem = base.replace(/\.(?:slx|mdl|xml)$/i, "");
    if (stem) modelNames.add(stem);
  }

  for (const [uri, xml] of entries) {
    if (uri.toLowerCase().endsWith(".sldd")) continue;
    if (rootUri && entries.length === 0) continue;

    const model = parseSlxXml(xml);
    for (const d of lintSimulinkModel(model)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "simulink-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const m of xml.matchAll(/<P\b[^>]*\bName=["']ModelName(?:Dialog)?["'][^>]*>([^<]+)<\/P>/gi)) {
      const refModel = m[1]?.trim().replace(/\.(?:slx|mdl)$/i, "");
      if (refModel && !modelNames.has(refModel)) {
        diagnostics.push({
          uri,
          code: "SL3001",
          rule: "unresolved-simulink-modelref",
          severity: "error",
          message: `Simulink ModelReference '${refModel}' was not found in the workspace.`,
        });
      }
    }

    for (const m of xml.matchAll(/<P\b[^>]*\bName=["']DataDictionary["'][^>]*>([^<]+)<\/P>/gi)) {
      const sldd = m[1]?.trim();
      if (sldd && !resolveRelativeUri(uri, sldd, docs)) {
        diagnostics.push({
          uri,
          code: "SL3002",
          rule: "unresolved-simulink-sldd",
          severity: "error",
          message: `Simulink DataDictionary '${sldd}' was not found in the workspace.`,
        });
      }
    }
  }

  return diagnostics;
}
