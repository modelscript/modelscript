// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseEnergyPlus } from "../parser/index.js";
import { lintEnergyPlus } from "./index.js";

/**
 * Performs multi-file EnergyPlus workspace linting across `.idf`/`.epJSON`,
 * `.epw` weather files, and `Schedule:File` CSV references.
 */
export function lintEnergyPlusWorkspace(
  workspace: WorkspaceDocumentInput,
  rootUri?: string,
): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  for (const [uri, text] of entries) {
    if (uri.toLowerCase().endsWith(".epw") || uri.toLowerCase().endsWith(".csv")) continue;
    if (rootUri && entries.length === 0) continue;

    const doc = parseEnergyPlus(text);
    for (const d of lintEnergyPlus(doc)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "energyplus-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const m of text.matchAll(/([^\s,;]+\.(?:csv|epw))\b/gi)) {
      const ref = m[1]?.trim();
      if (ref && !resolveRelativeUri(uri, ref, docs)) {
        diagnostics.push({
          uri,
          code: "EP3001",
          rule: "unresolved-energyplus-external-file",
          severity: "warning",
          message: `EnergyPlus model references external file '${ref}', which was not found in the workspace.`,
        });
      }
    }
  }

  return diagnostics;
}
