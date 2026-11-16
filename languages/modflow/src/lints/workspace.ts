// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/modflow/wasm-parser";
import {
  collectWorkspaceDocuments,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseModflow } from "../parser/index.js";
import { lintModflow } from "./index.js";

function getModflowWasmParser() {
  return getOrLoadLanguageWasmParser("modflow", import.meta.url, createWasmParserSync);
}

const MODFLOW_NAM_PACKAGES = new Set([
  "DIS",
  "DIS6",
  "NPF",
  "NPF6",
  "IC",
  "IC6",
  "OC",
  "OC6",
  "WEL",
  "WEL6",
  "CHD",
  "CHD6",
  "RCH",
  "RCH6",
  "BAS6",
  "LPF",
  "PCG",
  "SMS",
  "DATA",
]);

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
  const parser = getModflowWasmParser();

  for (const [uri, text] of entries) {
    if (uri.toLowerCase().endsWith(".nam")) {
      const tree = parser.parse(text);
      for (const { tokens } of groupCstLeavesByLine(tree?.rootNode)) {
        const pkg = tokens[0]?.text.toUpperCase();
        if (!pkg || pkg === "BEGIN" || pkg === "END" || !MODFLOW_NAM_PACKAGES.has(pkg)) continue;
        const idx = tokens[1] && /^\d+$/.test(tokens[1].text) ? 2 : 1;
        const ref = tokens[idx]?.text.replace(/^["']|["']$/g, "");
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
