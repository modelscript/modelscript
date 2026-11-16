// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  collectXmlElementsFromWasm,
  offsetSpanToRange,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { lintSsd, lintSsv } from "./linter.js";

/**
 * Performs multi-file SSP workspace linting across `.ssd` system structures,
 * `.ssv` parameter value sets, `.ssm` parameter mappings, and FMU `modelDescription.xml`
 * descriptors.
 */
export function lintSspWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  for (const [uri, text] of entries) {
    const lower = uri.toLowerCase();
    if (
      lower.endsWith(".ssd") ||
      uri === rootUri ||
      (entries.length === 1 && text.includes("<SystemStructureDescription"))
    ) {
      for (const d of lintSsd(text)) {
        diagnostics.push({
          uri,
          code: String(d.code),
          rule: "ssp-ssd",
          severity: d.severity,
          message: d.message,
          line: d.line,
          column: d.column,
          endLine: d.endLine,
          endColumn: d.endColumn,
        });
      }
      for (const el of collectXmlElementsFromWasm(text)) {
        const localName = (el.tagName.includes(":") ? el.tagName.split(":").pop()! : el.tagName).toLowerCase();
        if (localName === "component") {
          const src = el.attrs["source"];
          if (!src) continue;
          const resolved =
            resolveRelativeUri(uri, src, docs) ??
            resolveRelativeUri(uri, `${src.replace(/\/+$/, "")}/modelDescription.xml`, docs);
          if (!resolved) {
            const span = el.attrSpans["source"] ?? { start: el.start, end: el.openEnd };
            const r = offsetSpanToRange(text, span.start, span.end);
            diagnostics.push({
              uri,
              code: "SSP3001",
              rule: "unresolved-ssp-component-source",
              severity: "error",
              message: `SSP Component source '${src}' was not found in the workspace.`,
              line: r.startLine,
              column: r.startColumn,
              endLine: r.endLine,
              endColumn: r.endColumn,
              range: r,
            });
          }
        } else if (localName === "parametervalues") {
          const ssvSrc = el.attrs["source"];
          if (ssvSrc && !resolveRelativeUri(uri, ssvSrc, docs)) {
            const span = el.attrSpans["source"] ?? { start: el.start, end: el.openEnd };
            const r = offsetSpanToRange(text, span.start, span.end);
            diagnostics.push({
              uri,
              code: "SSP3002",
              rule: "unresolved-ssp-ssv-source",
              severity: "error",
              message: `SSP ParameterValues source '${ssvSrc}' was not found in the workspace.`,
              line: r.startLine,
              column: r.startColumn,
              endLine: r.endLine,
              endColumn: r.endColumn,
              range: r,
            });
          }
        }
      }
    } else if (lower.endsWith(".ssv")) {
      for (const d of lintSsv(text)) {
        diagnostics.push({
          uri,
          code: String(d.code),
          rule: "ssp-ssv",
          severity: d.severity,
          message: d.message,
          line: d.line,
          column: d.column,
          endLine: d.endLine,
          endColumn: d.endColumn,
        });
      }
    }
  }

  return diagnostics;
}
