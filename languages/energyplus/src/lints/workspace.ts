// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/energyplus/wasm-parser";
import {
  collectWorkspaceDocuments,
  extractCstLeafNodes,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { createRequire } from "node:module";
import { parseEnergyPlus } from "../parser/index.js";
import { lintEnergyPlus } from "./index.js";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getEnergyPlusWasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/energyplus/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

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
  const parser = getEnergyPlusWasmParser();

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

    const tree = parser.parse(text);
    for (const leaf of extractCstLeafNodes(tree?.rootNode)) {
      const ref = leaf.text.replace(/^["']|["']$/g, "").trim();
      if (/\.(?:csv|epw)$/i.test(ref) && !resolveRelativeUri(uri, ref, docs)) {
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
