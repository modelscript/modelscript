// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseArxml } from "../parser/arxml-parser.js";
import { lintAutosarModel } from "./index.js";

/**
 * Performs multi-file AUTOSAR ARXML workspace linting, collecting `/Package/Element`
 * paths across all `.arxml` files and detecting unresolved `*-REF` references.
 */
export function lintAutosarWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const knownShortNames = new Set<string>();
  const parsedDocs: Array<{ uri: string; xml: string; model: ReturnType<typeof parseArxml> }> = [];

  for (const [uri, xml] of entries) {
    const model = parseArxml(xml);
    parsedDocs.push({ uri, xml, model });
    for (const m of xml.matchAll(/<SHORT-NAME>([^<]+)<\/SHORT-NAME>/gi)) {
      if (m[1]) knownShortNames.add(m[1].trim());
    }
  }

  for (const { uri, xml, model } of parsedDocs) {
    if (rootUri && entries.length === 0) continue;
    for (const d of lintAutosarModel(model)) {
      diagnostics.push({
        uri,
        code: d.code,
        rule: "autosar-lint",
        severity: d.severity,
        message: d.message,
      });
    }
    if (knownShortNames.size > 0) {
      for (const m of xml.matchAll(
        /<[A-Z0-9-]+-(?:T)?REF\b[^>]*\bDEST=["'][^"']+["'][^>]*>(\/[^<]+)<\/[A-Z0-9-]+-(?:T)?REF>/gi,
      )) {
        const refPath = m[1]?.trim();
        const leaf = refPath?.split("/").filter(Boolean).pop();
        if (leaf && !knownShortNames.has(leaf)) {
          diagnostics.push({
            uri,
            code: "AU3001",
            rule: "unresolved-autosar-ref",
            severity: "error",
            message: `AUTOSAR reference '${refPath}' does not resolve to any SHORT-NAME in the workspace.`,
          });
        }
      }
    }
  }

  return diagnostics;
}
