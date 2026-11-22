// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/lsp — Probabilistic Verification Verdict CodeLens & Diagnostics Service.
 *
 * Stores per-document {@link ProbabilisticVerdict} entries (from P-box flowpipes,
 * Kushner stochastic barriers, or `UqTheoryOracle`) and formats them into LSP
 * CodeLens badges and Diagnostics while strictly preserving the soundness contract:
 * never displays "Proven" or "Certified" unless `verdict.kind === "proven"`.
 */

import type { ProbabilisticVerdict } from "@modelscript/runtime";
import { CodeLens, Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver";

export interface ProbabilisticVerdictEntry {
  range: Range;
  label: string;
  verdict: ProbabilisticVerdict;
}

export function formatProbabilisticVerdictTitle(label: string, verdict: ProbabilisticVerdict): string {
  if (verdict.kind === "proven") {
    const [lo, hi] = verdict.probabilityBounds;
    return `✓ P-Box Proven (${verdict.rigor}): ${label} [${lo.toExponential(2)}, ${hi.toExponential(2)}] ≤ ${verdict.maxAllowedProbability}`;
  }
  if (verdict.kind === "violated") {
    const [lo, hi] = verdict.probabilityBounds;
    return `✖ Probabilistic Violation: ${label} [${lo.toExponential(2)}, ${hi.toExponential(2)}] > ${verdict.maxAllowedProbability}`;
  }
  return `⚠ Probabilistic Unknown (${verdict.reason}): ${label}`;
}

export function probabilisticVerdictToDiagnostic(entry: ProbabilisticVerdictEntry): Diagnostic | null {
  const { verdict, label, range } = entry;
  if (verdict.kind === "proven") return null;

  if (verdict.kind === "violated") {
    return {
      range,
      severity: DiagnosticSeverity.Error,
      source: "modelscript-uq",
      code: "UQ_VIOLATED",
      message: verdict.detail ?? formatProbabilisticVerdictTitle(label, verdict),
    };
  }

  return {
    range,
    severity: verdict.reason === "not-rigorous" ? DiagnosticSeverity.Information : DiagnosticSeverity.Warning,
    source: "modelscript-uq",
    code: `UQ_UNKNOWN_${verdict.reason.toUpperCase().replace(/-/g, "_")}`,
    message: verdict.detail ?? formatProbabilisticVerdictTitle(label, verdict),
  };
}

export class ProbabilisticVerdictService {
  private readonly entriesByUri = new Map<string, ProbabilisticVerdictEntry[]>();

  public setVerdicts(uri: string, entries: ProbabilisticVerdictEntry[]): void {
    this.entriesByUri.set(uri, entries);
  }

  public clearVerdicts(uri: string): void {
    this.entriesByUri.delete(uri);
  }

  public getVerdicts(uri: string): readonly ProbabilisticVerdictEntry[] {
    return this.entriesByUri.get(uri) ?? [];
  }

  public getCodeLenses(uri: string, problemsOnly = false): CodeLens[] {
    const entries = this.entriesByUri.get(uri);
    if (!entries || entries.length === 0) return [];

    const lenses: CodeLens[] = [];
    for (const entry of entries) {
      if (problemsOnly && entry.verdict.kind === "proven") continue;
      lenses.push({
        range: entry.range,
        command: {
          title: formatProbabilisticVerdictTitle(entry.label, entry.verdict),
          command: "modelscript.uq.inspectVerdict",
          arguments: [uri, entry.label, entry.verdict],
        },
      });
    }
    return lenses;
  }

  public getDiagnostics(uri: string): Diagnostic[] {
    const entries = this.entriesByUri.get(uri);
    if (!entries || entries.length === 0) return [];
    const diags: Diagnostic[] = [];
    for (const entry of entries) {
      const d = probabilisticVerdictToDiagnostic(entry);
      if (d) diags.push(d);
    }
    return diags;
  }
}

export const defaultProbabilisticVerdictService = new ProbabilisticVerdictService();
