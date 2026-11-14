// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseOscal } from "../parser/index.js";
import { lintOscalDocument } from "./rules.js";

/**
 * Performs multi-file NIST OSCAL workspace linting across Catalogs, Profiles,
 * Component Definitions, SSPs, Assessment Plans/Results, and POA&Ms, checking
 * `href` imports and `control-id` traceability against workspace catalogs.
 */
export function lintOscalWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const catalogControlIds = new Set<string>();
  const parsedDocs: Array<{ uri: string; raw: string; doc: ReturnType<typeof parseOscal> }> = [];

  for (const [uri, raw] of entries) {
    const doc = parseOscal(raw);
    parsedDocs.push({ uri, raw, doc });
    if (doc.kind === "catalog" && Array.isArray(doc.controls)) {
      for (const c of doc.controls) {
        if (c.id) catalogControlIds.add(c.id.toLowerCase());
      }
    }
  }

  for (const { uri, raw, doc } of parsedDocs) {
    if (rootUri && uri !== rootUri && entries.length === 0) continue;
    for (const d of lintOscalDocument(doc)) {
      diagnostics.push({
        uri,
        code: d.code,
        rule: d.rule ?? "oscal-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    // Check cross-file import hrefs ("import-profile", "import-ssp", "import-ap", "href")
    for (const m of raw.matchAll(/"href"\s*:\s*"([^"]+)"/g)) {
      const href = m[1];
      if (!href || href.startsWith("#") || /^https?:\/\//i.test(href)) continue;
      if (!resolveRelativeUri(uri, href, docs)) {
        diagnostics.push({
          uri,
          code: "O3001",
          rule: "unresolved-oscal-href",
          severity: "error",
          message: `OSCAL import href '${href}' was not found in the workspace.`,
        });
      }
    }

    // Check implemented control IDs against workspace catalogs when catalogs are present
    const implReqs = doc.controlImplementation?.implementedRequirements;
    if (catalogControlIds.size > 0 && Array.isArray(implReqs)) {
      for (const req of implReqs) {
        if (req.controlId && !catalogControlIds.has(req.controlId.toLowerCase())) {
          diagnostics.push({
            uri,
            code: "O3002",
            rule: "unknown-oscal-control-id",
            severity: "warning",
            message: `Implemented requirement references control '${req.controlId}', which is not in any workspace OSCAL catalog.`,
          });
        }
      }
    }
  }

  return diagnostics;
}
