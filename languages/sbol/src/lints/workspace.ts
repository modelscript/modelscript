// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseSbol } from "../parser/index.js";
import { lintSbol } from "./index.js";

/**
 * Performs multi-file SBOL 3 workspace linting across `.sbol`/`.rdf`/`.xml`
 * files, resolving cross-file `rdf:about` / `rdf:resource` URIs and running `lintSbol`.
 */
export function lintSbolWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const definedUris = new Set<string>();
  const parsedDocs: Array<{ uri: string; xml: string; doc: ReturnType<typeof parseSbol> }> = [];

  for (const [uri, xml] of entries) {
    const doc = parseSbol(xml);
    parsedDocs.push({ uri, xml, doc });
    for (const m of xml.matchAll(/\brdf:about=["']([^"']+)["']/g)) {
      if (m[1]) definedUris.add(m[1]);
    }
  }

  for (const { uri, xml, doc } of parsedDocs) {
    if (rootUri && entries.length === 0) continue;
    for (const d of lintSbol(doc)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "sbol-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    if (definedUris.size > 0) {
      for (const m of xml.matchAll(
        /<(?:sbol:definition|sbol:sequence|sbol:hasFeature)\b[^>]*\brdf:resource=["']([^"']+)["']/gi,
      )) {
        const ref = m[1];
        if (
          ref &&
          !/^https?:\/\/(?:identifiers\.org|www\.biopax\.org|www\.w3\.org)\//i.test(ref) &&
          !definedUris.has(ref)
        ) {
          diagnostics.push({
            uri,
            code: "SB3001",
            rule: "unresolved-sbol-resource",
            severity: "error",
            message: `SBOL reference '${ref}' does not resolve to any rdf:about in the workspace.`,
          });
        }
      }
    }
  }

  return diagnostics;
}
