// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseModflow } from "../parser/index.js";
import { lintModflow } from "./index.js";

/**
 * Performs multi-file MODFLOW workspace linting across `.nam` namefiles and
 * `.dis`/`.bas`/`.wel`/`.npf` package files, verifying referenced package files
 * exist and running `lintModflow`.
 */
export function lintModflowWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  for (const [uri, text] of entries) {
    if (uri.toLowerCase().endsWith(".nam")) {
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || /^(?:BEGIN|END)\b/i.test(trimmed)) continue;
        const m = trimmed.match(
          /^(?:DIS6?|NPF6?|IC6?|OC6?|WEL6?|CHD6?|RCH6?|BAS6|LPF|PCG|SMS|DATA)\s+(?:\d+\s+)?([^\s#]+)/i,
        );
        const ref = m?.[1]?.replace(/^["']|["']$/g, "");
        if (ref && !resolveRelativeUri(uri, ref, docs)) {
          diagnostics.push({
            uri,
            code: "MF3001",
            rule: "unresolved-modflow-package-file",
            severity: "error",
            message: `MODFLOW namefile references '${ref}', which was not found in the workspace.`,
          });
        }
      }
    } else if (uri === rootUri || /\.(?:mf|modflow|dis)$/i.test(uri) || entries.length === 1) {
      const model = parseModflow(text);
      for (const d of lintModflow(model)) {
        diagnostics.push({
          uri,
          code: String(d.code),
          rule: "modflow-lint",
          severity: d.severity,
          message: d.message,
        });
      }
    }
  }

  return diagnostics;
}
