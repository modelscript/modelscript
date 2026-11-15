// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseSclXml } from "../parser/scl-parser.js";
import { lintSclDocument } from "./index.js";

/**
 * Performs multi-file IEC 61850 SCL workspace linting across `.scd`, `.icd`, `.ssd`,
 * and `.cid` files, checking cross-file `ExtRef` `iedName` targets and duplicate GOOSE `appID`s via XML WASM CST.
 */
export function lintSclWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const knownIeds = new Set<string>();
  const gooseAppIds = new Map<string, string>();
  const parsedDocs: Array<{
    uri: string;
    elements: ReturnType<typeof collectXmlElementsFromWasm>;
    doc: ReturnType<typeof parseSclXml>;
  }> = [];

  for (const [uri, xml] of entries) {
    const doc = parseSclXml(xml);
    const elements = collectXmlElementsFromWasm(xml);
    parsedDocs.push({ uri, elements, doc });
    for (const [iedName] of doc.ieds ?? []) {
      if (iedName) knownIeds.add(iedName);
    }
    for (const { tagName, attrs } of elements) {
      const lowerTag = tagName.toLowerCase();
      if (lowerTag === "ied" && attrs["name"]) {
        knownIeds.add(attrs["name"]);
      } else if (lowerTag === "gsecontrol" && attrs["appID"]) {
        const appId = attrs["appID"];
        const prevUri = gooseAppIds.get(appId);
        if (prevUri && prevUri !== uri) {
          diagnostics.push({
            uri,
            code: "SC3001",
            rule: "duplicate-goose-appid",
            severity: "warning",
            message: `GOOSE appID '${appId}' is also declared in '${prevUri}'.`,
          });
        } else {
          gooseAppIds.set(appId, uri);
        }
      }
    }
  }

  for (const { uri, elements, doc } of parsedDocs) {
    void rootUri;
    for (const d of lintSclDocument(doc)) {
      diagnostics.push({
        uri,
        code: d.code,
        rule: "scl-lint",
        severity: d.severity,
        message: d.message,
      });
    }
    if (knownIeds.size > 0) {
      for (const { tagName, attrs } of elements) {
        if (tagName.toLowerCase() !== "extref") continue;
        const targetIed = attrs["iedName"];
        if (targetIed && !knownIeds.has(targetIed)) {
          diagnostics.push({
            uri,
            code: "SC3002",
            rule: "unresolved-scl-extref-ied",
            severity: "error",
            message: `ExtRef references IED '${targetIed}', which is not declared in any SCL file in the workspace.`,
          });
        }
      }
    }
  }

  return diagnostics;
}
