// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lsp — Adapter converting `@modelscript/runtime` cross-domain static lints
 * (M5101 identifiability, M5102 passivity, M5103 stoichiometric conservation, M5104 VF2 LVS)
 * into inline VS Code / LSP `Diagnostic` objects.
 */

import type { DomainLintDiagnostic } from "@modelscript/runtime";
import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";

function mapSeverity(sev: DomainLintDiagnostic["severity"]): DiagnosticSeverity {
  if (sev === "error") return DiagnosticSeverity.Error;
  if (sev === "warning") return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Information;
}

/**
 * Maps `DomainLintDiagnostic[]` into LSP `Diagnostic[]`, optionally anchored to entity ranges
 * located via `resolveRange(entityName)`.
 */
export function toLspDomainDiagnostics(
  diags: readonly DomainLintDiagnostic[],
  resolveRange?: (entity?: string) => Range,
): Diagnostic[] {
  const defaultRange: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };
  return diags.map((d) => ({
    range: resolveRange ? resolveRange(d.entity) : defaultRange,
    severity: mapSeverity(d.severity),
    code: d.code,
    source: `modelscript/${d.rule}`,
    message: `[${d.code}] ${d.message}`,
  }));
}
