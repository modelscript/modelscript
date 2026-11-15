// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseArxml } from "../parser/arxml-parser.js";
import { lintAutosarModel } from "./index.js";

/**
 * Performs multi-file AUTOSAR ARXML workspace linting, collecting `/Package/Element`
 * paths across all `.arxml` files and detecting unresolved `*-REF` references via XML WASM CST.
 */
export function lintAutosarWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const knownShortNames = new Set<string>();
  const parsedDocs: Array<{
    uri: string;
    elements: ReturnType<typeof collectXmlElementsFromWasm>;
    model: ReturnType<typeof parseArxml>;
  }> = [];

  for (const [uri, xml] of entries) {
    const model = parseArxml(xml);
    const elements = collectXmlElementsFromWasm(xml);
    parsedDocs.push({ uri, elements, model });
    for (const el of elements) {
      if (el.tagName.toUpperCase() === "SHORT-NAME" && el.text) {
        knownShortNames.add(el.text);
      }
    }
  }

  for (const { uri, elements, model } of parsedDocs) {
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
      for (const el of elements) {
        const upperTag = el.tagName.toUpperCase();
        if (!upperTag.endsWith("-REF") && !upperTag.endsWith("-TREF")) continue;
        if (!el.attrs["DEST"] || !el.text.startsWith("/")) continue;
        const leaf = el.text.split("/").filter(Boolean).pop();
        if (leaf && !knownShortNames.has(leaf)) {
          diagnostics.push({
            uri,
            code: "AU3001",
            rule: "unresolved-autosar-ref",
            severity: "error",
            message: `AUTOSAR reference '${el.text}' does not resolve to any SHORT-NAME in the workspace.`,
          });
        }
      }
    }
  }

  return diagnostics;
}
