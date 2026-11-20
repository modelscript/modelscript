// SPDX-License-Identifier: AGPL-3.0-or-later

import { getModelicaErrorCodeDef } from "@modelscript/modelica";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";

function isDigitsOnly(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function normalizeRuleToken(s: string): string {
  return s.toLowerCase().replaceAll("-", "").replaceAll("_", "");
}

function parseMPrefixedCodeNumber(raw: string): number | null {
  const digits = raw.startsWith("M") || raw.startsWith("m") ? raw.slice(1) : raw;
  return isDigitsOnly(digits) ? Number(digits) : null;
}

/**
 * Canonical error code information extracted from diagnostic code or lint name.
 */
export function extractCanonicalErrorInfo(
  code: string | number | undefined,
  lintName?: string,
  plugin?: any,
): { codeNum?: number | undefined; ruleName?: string | undefined; raw: string } {
  const raw = String(code ?? lintName ?? "").trim();
  if (!raw) return { raw: "" };

  if (typeof code === "number") {
    const def = plugin?.languageDef?.errorCodes?.[code] ?? getModelicaErrorCodeDef(code);
    const rule = def?.rule ? normalizeRuleToken(def.rule) : undefined;
    return { codeNum: code, ruleName: rule, raw };
  }

  const num = parseMPrefixedCodeNumber(raw);
  if (num !== null) {
    const def = plugin?.languageDef?.errorCodes?.[num] ?? getModelicaErrorCodeDef(num);
    const rule = def?.rule ? normalizeRuleToken(def.rule) : undefined;
    return { codeNum: num, ruleName: rule, raw };
  }

  const normalizedRule = normalizeRuleToken(raw);
  const def = getModelicaErrorCodeDef(raw);
  if (def) {
    return {
      codeNum: def.code,
      ruleName: def.rule ? normalizeRuleToken(def.rule) : normalizedRule,
      raw,
    };
  }

  return { ruleName: normalizedRule, raw };
}

/**
 * Line-indexed lookup table for fast semantic diagnostic deduplication/merging.
 * Avoids O(n^2) scans over existing diagnostics while preserving insertion-order matching.
 */
export class SemanticDiagnosticLineIndex {
  private readonly byLine = new Map<number, Diagnostic[]>();
  private readonly multiLine: Diagnostic[] = [];

  constructor(initial?: Diagnostic[]) {
    if (initial) {
      for (const d of initial) this.add(d);
    }
  }

  add(diag: Diagnostic): void {
    const startLine = diag.range.start.line;
    const endLine = diag.range.end.line;
    if (endLine - startLine > 16) {
      this.multiLine.push(diag);
      return;
    }
    for (let line = startLine; line <= endLine; line++) {
      let bucket = this.byLine.get(line);
      if (!bucket) {
        bucket = [];
        this.byLine.set(line, bucket);
      }
      bucket.push(diag);
    }
  }

  updateRange(diag: Diagnostic, prevStartLine: number, prevEndLine: number): void {
    const nextStart = diag.range.start.line;
    const nextEnd = diag.range.end.line;
    if (nextStart === prevStartLine && nextEnd === prevEndLine) return;
    if (nextEnd - nextStart > 16) {
      if (prevEndLine - prevStartLine <= 16) {
        this.multiLine.push(diag);
      }
      return;
    }
    for (let line = nextStart; line <= nextEnd; line++) {
      if (line >= prevStartLine && line <= prevEndLine) continue;
      let bucket = this.byLine.get(line);
      if (!bucket) {
        bucket = [];
        this.byLine.set(line, bucket);
      }
      bucket.push(diag);
    }
  }

  candidatesFor(incoming: Diagnostic, existingList: Diagnostic[]): Diagnostic[] {
    const startLine = incoming.range.start.line;
    const endLine = incoming.range.end.line;
    if (endLine - startLine > 16) return existingList;
    if (startLine === endLine && this.multiLine.length === 0) {
      return this.byLine.get(startLine) ?? [];
    }
    const seen = new Set<Diagnostic>();
    const out: Diagnostic[] = [];
    for (let line = startLine; line <= endLine; line++) {
      const bucket = this.byLine.get(line);
      if (!bucket) continue;
      for (const d of bucket) {
        if (!seen.has(d)) {
          seen.add(d);
          out.push(d);
        }
      }
    }
    for (const d of this.multiLine) {
      if (!seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
    }
    return out;
  }
}

/**
 * Deduplicate or merge a semantic diagnostic into an existing diagnostics list.
 * Returns true if the diagnostic was merged or recognized as a duplicate.
 */
export function tryDeduplicateOrMergeSemanticDiagnostic(
  existingList: Diagnostic[],
  incoming: Diagnostic,
  plugin?: any,
  lineIndex?: SemanticDiagnosticLineIndex,
): boolean {
  const incomingInfo = extractCanonicalErrorInfo(incoming.code, undefined, plugin);
  const candidates = lineIndex ? lineIndex.candidatesFor(incoming, existingList) : existingList;

  for (const existing of candidates) {
    const sameLine = existing.range.start.line === incoming.range.start.line;
    const linesOverlap =
      Math.max(existing.range.start.line, incoming.range.start.line) <=
      Math.min(existing.range.end.line, incoming.range.end.line);

    if (!sameLine && !linesOverlap) continue;

    const existingInfo = extractCanonicalErrorInfo(existing.code, undefined, plugin);
    const codesMatch =
      (existingInfo.codeNum !== undefined &&
        incomingInfo.codeNum !== undefined &&
        existingInfo.codeNum === incomingInfo.codeNum) ||
      (existingInfo.ruleName !== undefined &&
        incomingInfo.ruleName !== undefined &&
        existingInfo.ruleName === incomingInfo.ruleName) ||
      (existingInfo.raw.length > 0 &&
        incomingInfo.raw.length > 0 &&
        existingInfo.raw.toLowerCase() === incomingInfo.raw.toLowerCase());

    const charOverlap =
      Math.max(existing.range.start.character, incoming.range.start.character) <=
      Math.min(existing.range.end.character, incoming.range.end.character);

    const charAdjacent =
      Math.abs(existing.range.start.character - incoming.range.start.character) <= 15 ||
      Math.abs(existing.range.end.character - incoming.range.end.character) <= 15;

    let isMatch = false;
    if (codesMatch) {
      const existingGeneric =
        !existing.message ||
        existing.message.startsWith("Linter Rule ") ||
        existing.message.startsWith("Linter rule ") ||
        existing.message === "Syntax Error";
      const incomingGeneric =
        !incoming.message || incoming.message.startsWith("Linter Rule ") || incoming.message.startsWith("Linter rule ");
      const existingStem = existing.message.replace(/\.$/, "");
      const incomingStem = incoming.message.replace(/\.$/, "");
      const messageCompatible =
        existing.message === incoming.message ||
        existingGeneric ||
        incomingGeneric ||
        (existingStem.length > 0 && incoming.message.startsWith(existingStem)) ||
        (incomingStem.length > 0 && existing.message.startsWith(incomingStem));
      if (charOverlap || ((sameLine || charAdjacent) && messageCompatible)) {
        isMatch = true;
      }
    } else if (charOverlap) {
      if (existing.message === incoming.message) {
        isMatch = true;
      } else {
        const m1 = existing.message.toLowerCase();
        const m2 = incoming.message.toLowerCase();
        if (
          (m1.startsWith("type mismatch") && m2.startsWith("type mismatch")) ||
          (m1.startsWith("variable") && m2.startsWith("variable")) ||
          (m1.startsWith("duplicate") && m2.startsWith("duplicate")) ||
          (m1.startsWith("syntax error") && m2.startsWith("syntax error"))
        ) {
          isMatch = true;
        }
      }
    }

    if (isMatch) {
      const prevStartLine = existing.range.start.line;
      const prevEndLine = existing.range.end.line;

      const existingIsGeneric =
        !existing.message ||
        existing.message.startsWith("Linter Rule ") ||
        existing.message.startsWith("Linter rule ") ||
        existing.message === "Syntax Error";

      const incomingIsSpecific =
        incoming.message &&
        !incoming.message.startsWith("Linter Rule ") &&
        !incoming.message.startsWith("Linter rule ");

      if (existingIsGeneric && incomingIsSpecific) {
        existing.message = incoming.message;
        if (incoming.code !== undefined) existing.code = incoming.code;
        existing.range = incoming.range;
      } else if (incomingIsSpecific && incoming.message.length > existing.message.length) {
        existing.message = incoming.message;
        if (incoming.code) existing.code = incoming.code;
      }

      if (incoming.severity === DiagnosticSeverity.Error) {
        existing.severity = DiagnosticSeverity.Error;
      }

      if (
        existing.range.start.line === existing.range.end.line &&
        existing.range.end.character - existing.range.start.character <= 1 &&
        incoming.range.end.character - incoming.range.start.character > 1
      ) {
        existing.range = incoming.range;
      }

      if (lineIndex) {
        lineIndex.updateRange(existing, prevStartLine, prevEndLine);
      }

      return true;
    }
  }

  return false;
}

/**
 * Clean deduplication pass over a list of diagnostics to remove exact or shadowed duplicates.
 */
export function deduplicateAllDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  const result: Diagnostic[] = [];
  const startBuckets = new Map<string, number[]>();

  for (const d of diagnostics) {
    const startKey = `${d.range.start.line}:${d.range.start.character}`;
    const bucket = startBuckets.get(startKey);
    let isDup = false;

    if (bucket) {
      for (const idx of bucket) {
        const existing = result[idx]!;
        const sameEnd =
          existing.range.end.line === d.range.end.line && existing.range.end.character === d.range.end.character;

        if (sameEnd) {
          if (existing.message === d.message) {
            isDup = true;
            break;
          }
          const existingIsGeneric = existing.message === "Syntax Error" || existing.message === "Syntax error";
          const dIsGeneric = d.message === "Syntax Error" || d.message === "Syntax error";
          if (existingIsGeneric && !dIsGeneric) {
            result[idx] = d;
            isDup = true;
            break;
          }
          if (!existingIsGeneric && dIsGeneric) {
            isDup = true;
            break;
          }
        }

        if (
          existing.code !== undefined &&
          d.code !== undefined &&
          String(existing.code) === String(d.code) &&
          existing.message === d.message
        ) {
          isDup = true;
          break;
        }
      }
    }

    if (!isDup) {
      const nextIdx = result.length;
      result.push(d);
      if (bucket) {
        bucket.push(nextIdx);
      } else {
        startBuckets.set(startKey, [nextIdx]);
      }
    }
  }
  return result;
}
