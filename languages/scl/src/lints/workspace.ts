// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseSclXml } from "../parser/scl-parser.js";
import { lintSclDocument } from "./index.js";

/**
 * Performs multi-file IEC 61850 SCL workspace linting across `.scd`, `.icd`, `.ssd`,
 * and `.cid` files, checking cross-file `ExtRef` `iedName` targets and duplicate GOOSE `appID`s.
 */
export function lintSclWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const knownIeds = new Set<string>();
  const gooseAppIds = new Map<string, string>();
  const parsedDocs: Array<{ uri: string; xml: string; doc: ReturnType<typeof parseSclXml> }> = [];

  for (const [uri, xml] of entries) {
    const doc = parseSclXml(xml);
    parsedDocs.push({ uri, xml, doc });
    for (const [iedName] of doc.ieds ?? []) {
      if (iedName) knownIeds.add(iedName);
    }
    for (const m of xml.matchAll(/<IED\b[^>]*\bname=["']([^"']+)["']/gi)) {
      if (m[1]) knownIeds.add(m[1]);
    }
    for (const m of xml.matchAll(/<GSEControl\b[^>]*\bappID=["']([^"']+)["']/gi)) {
      const appId = m[1];
      if (!appId) continue;
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

  for (const { uri, xml, doc } of parsedDocs) {
    if (rootUri && uri !== rootUri && entries.length > 1 && uri.toLowerCase().endsWith(".icd")) {
      // Still lint all files in workspace
    }
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
      for (const m of xml.matchAll(/<ExtRef\b[^>]*\biedName=["']([^"']+)["']/gi)) {
        const targetIed = m[1];
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
