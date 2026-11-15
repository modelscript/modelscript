// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseAutomationML } from "../parser/index.js";
import { lintAutomationML } from "./index.js";

const AML_LIB_TAGS = new Set([
  "roleclass",
  "interfaceclass",
  "systemunitclass",
  "roleclasslib",
  "interfaceclasslib",
  "systemunitclasslib",
]);

/**
 * Performs multi-file AutomationML (CAEX) workspace linting across `.aml` files,
 * checking `ExternalReference/@Path` and cross-file `RefBaseSystemUnitPath` /
 * `RefBaseClassPath` library references via XML WASM CST.
 */
export function lintAutomationMLWorkspace(
  workspace: WorkspaceDocumentInput,
  rootUri?: string,
): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const knownLibNames = new Set<string>();
  const parsedDocs: Array<{
    uri: string;
    elements: ReturnType<typeof collectXmlElementsFromWasm>;
    doc: ReturnType<typeof parseAutomationML>;
  }> = [];

  for (const [uri, xml] of entries) {
    const doc = parseAutomationML(xml);
    const elements = collectXmlElementsFromWasm(xml);
    parsedDocs.push({ uri, elements, doc });
    for (const { tagName, attrs } of elements) {
      if (AML_LIB_TAGS.has(tagName.toLowerCase()) && attrs["Name"]) {
        knownLibNames.add(attrs["Name"]);
      }
    }
  }

  for (const { uri, elements, doc } of parsedDocs) {
    if (rootUri && entries.length === 0) continue;
    for (const d of lintAutomationML(doc)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: d.rule ?? "aml-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const { tagName, attrs } of elements) {
      if (tagName.toLowerCase() === "externalreference") {
        const refPath = attrs["Path"];
        if (refPath && !resolveRelativeUri(uri, refPath, docs)) {
          diagnostics.push({
            uri,
            code: "AM3001",
            rule: "unresolved-aml-external-reference",
            severity: "error",
            message: `AutomationML ExternalReference Path '${refPath}' was not found in the workspace.`,
          });
        }
      }

      if (knownLibNames.size > 0) {
        for (const attrKey of ["RefBaseSystemUnitPath", "RefBaseClassPath", "RefBaseRoleClassPath"]) {
          const refPath = attrs[attrKey];
          const leaf = refPath?.split("/").filter(Boolean).pop();
          if (leaf && !knownLibNames.has(leaf)) {
            diagnostics.push({
              uri,
              code: "AM3002",
              rule: "unresolved-aml-class-path",
              severity: "warning",
              message: `AutomationML class reference '${refPath}' does not match any library class in the workspace.`,
            });
          }
        }
      }
    }
  }

  return diagnostics;
}
