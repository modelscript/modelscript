// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IndexedDataset } from "@modelscript/simulate/charts";
import { LasErrorCode } from "./errors.js";

export type LasDelimiter = "whitespace" | "," | "\t";

export interface LasHeaderItem {
  mnemonic: string;
  unit: string;
  value: string;
  description: string;
  line: number;
}

export interface LasCurveDef {
  mnemonic: string;
  unit: string;
  apiCode: string;
  description: string;
  line: number;
}

export interface LasDataSection {
  name: string;
  curves: LasCurveDef[];
  rows: number[][];
}

export interface LasDocument {
  version: string;
  wrap: boolean;
  delimiter: LasDelimiter;
  nullValue: number;
  well: Record<string, LasHeaderItem>;
  params: Record<string, LasHeaderItem>;
  curves: LasCurveDef[];
  other: string;
  rows: number[][];
  sections: Record<string, LasDataSection>;
}

export interface LasDiagnostic {
  code: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  startOffset: number;
  endOffset: number;
}

const DEPTH_MNEMONICS = new Set(["DEPT", "DEPTH", "MD", "TVD", "TVDSS"]);
const TIME_MNEMONICS = new Set(["TIME", "ETIM", "T"]);

/**
 * Parses a standard CWLS LAS header line of the form `MNEM.UNIT  VALUE : DESCRIPTION`.
 */
function parseHeaderLine(rawLine: string, lineNumber: number): LasHeaderItem | null {
  const trimmed = rawLine.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const dotIdx = trimmed.indexOf(".");
  if (dotIdx === -1) return null;

  const mnemonic = trimmed.slice(0, dotIdx).trim().toUpperCase();
  if (!mnemonic) return null;

  const afterDot = trimmed.slice(dotIdx + 1);
  // Unit runs from right after `.` up to the first whitespace character
  const wsMatch = /\s/.exec(afterDot);
  const unit = wsMatch ? afterDot.slice(0, wsMatch.index).trim() : afterDot.trim();
  const remainder = wsMatch ? afterDot.slice(wsMatch.index).trim() : "";

  // Separate value and description at `:` (prefer ` : ` or `: ` to preserve HH:MM:SS timestamps)
  let value = remainder;
  let description = "";
  const spacedColonIdx = remainder.search(/\s+:/);
  if (spacedColonIdx !== -1) {
    value = remainder.slice(0, spacedColonIdx).trim();
    const colonPos = remainder.indexOf(":", spacedColonIdx);
    description = remainder.slice(colonPos + 1).trim();
  } else {
    const colonIdx = remainder.indexOf(":");
    if (colonIdx !== -1) {
      value = remainder.slice(0, colonIdx).trim();
      description = remainder.slice(colonIdx + 1).trim();
    }
  }

  return { mnemonic, unit, value, description, line: lineNumber };
}

function splitDataTokens(line: string, delimiter: LasDelimiter): string[] {
  if (delimiter === ",") {
    return line.split(",").map((s) => s.trim());
  }
  if (delimiter === "\t") {
    return line.split("\t").map((s) => s.trim());
  }
  return line
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function isNullNumeric(val: number, nullValue: number): boolean {
  return Number.isFinite(nullValue) && Math.abs(val - nullValue) <= 1e-9;
}

/**
 * Parses a LAS 1.2, 2.0, or 3.0 well-log text document into a structured `LasDocument`.
 * Sentinel null values (e.g., `-999.25`) are normalized to `NaN` in `rows`, while `nullValue` preserves the header value.
 */
export function parseLas(text: string): LasDocument {
  const lines = text.split(/\r?\n/);

  let version = "2.0";
  let wrap = false;
  let delimiter: LasDelimiter = "whitespace";
  let nullValue = -999.25;

  const well: Record<string, LasHeaderItem> = {};
  const params: Record<string, LasHeaderItem> = {};
  const primaryCurves: LasCurveDef[] = [];
  const otherLines: string[] = [];
  const primaryRows: number[][] = [];
  const sections: Record<string, LasDataSection> = {};

  type ActiveSection =
    | { kind: "none" }
    | { kind: "V" }
    | { kind: "W" }
    | { kind: "C"; target: LasCurveDef[] }
    | { kind: "P" }
    | { kind: "O" }
    | { kind: "A"; name: string; curves: LasCurveDef[]; rows: number[][]; pendingTokens: string[] };

  let current: ActiveSection = { kind: "none" };

  const flushPending = (sec: ActiveSection) => {
    if (sec.kind !== "A" || sec.pendingTokens.length === 0) return;
    const expectedCols = sec.curves.length;
    if (expectedCols > 0 && sec.pendingTokens.length >= expectedCols) {
      for (let i = 0; i + expectedCols <= sec.pendingTokens.length; i += expectedCols) {
        const slice = sec.pendingTokens.slice(i, i + expectedCols);
        sec.rows.push(
          slice.map((tok) => {
            const num = Number(tok);
            if (!Number.isFinite(num) || isNullNumeric(num, nullValue)) return NaN;
            return num;
          }),
        );
      }
    }
    sec.pendingTokens = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();
    const lineNum = i + 1;

    if (trimmed.startsWith("~")) {
      flushPending(current);
      const headerBody = trimmed.slice(1).trim();
      const upper = headerBody.toUpperCase();

      if (upper.includes("_DATA")) {
        const pipeParts = headerBody.split("|").map((p) => p.trim());
        const secName = pipeParts[0]!.replace(/_DATA$/i, "");
        const defRef = pipeParts[1]?.replace(/_DEFINITION$/i, "") ?? secName;
        const sec = sections[secName] ?? {
          name: secName,
          curves: sections[defRef]?.curves ?? primaryCurves,
          rows: [],
        };
        sections[secName] = sec;
        current = { kind: "A", name: secName, curves: sec.curves, rows: sec.rows, pendingTokens: [] };
      } else if (upper.includes("_DEFINITION")) {
        const secName = headerBody.split(/[|\s]/)[0]!.replace(/_DEFINITION$/i, "");
        const sec = sections[secName] ?? { name: secName, curves: [], rows: [] };
        sections[secName] = sec;
        current = { kind: "C", target: sec.curves };
      } else if (upper.startsWith("V")) {
        current = { kind: "V" };
      } else if (upper.startsWith("W")) {
        current = { kind: "W" };
      } else if (upper.startsWith("C")) {
        current = { kind: "C", target: primaryCurves };
      } else if (upper.startsWith("P")) {
        current = { kind: "P" };
      } else if (upper.startsWith("O")) {
        current = { kind: "O" };
      } else if (upper.startsWith("A")) {
        current = {
          kind: "A",
          name: headerBody.split(/\s+/)[0] || "ASCII",
          curves: primaryCurves,
          rows: primaryRows,
          pendingTokens: [],
        };
      } else {
        current = { kind: "none" };
      }
      continue;
    }

    if (current.kind === "O") {
      otherLines.push(rawLine);
      continue;
    }

    if (!trimmed || trimmed.startsWith("#")) continue;

    if (current.kind === "V") {
      const item = parseHeaderLine(rawLine, lineNum);
      if (item) {
        if (item.mnemonic === "VERS") {
          version = item.value.split(/\s+/)[0] || version;
        } else if (item.mnemonic === "WRAP") {
          wrap = item.value.toUpperCase().startsWith("YES");
        } else if (item.mnemonic === "DLM") {
          const d = item.value.toUpperCase();
          if (d.includes("COMMA")) delimiter = ",";
          else if (d.includes("TAB")) delimiter = "\t";
          else delimiter = "whitespace";
        }
      }
    } else if (current.kind === "W") {
      const item = parseHeaderLine(rawLine, lineNum);
      if (item) {
        well[item.mnemonic] = item;
        if (item.mnemonic === "NULL") {
          const parsedNull = Number(item.value);
          if (Number.isFinite(parsedNull)) nullValue = parsedNull;
        }
      }
    } else if (current.kind === "P") {
      const item = parseHeaderLine(rawLine, lineNum);
      if (item) params[item.mnemonic] = item;
    } else if (current.kind === "C") {
      const item = parseHeaderLine(rawLine, lineNum);
      if (item) {
        current.target.push({
          mnemonic: item.mnemonic,
          unit: item.unit,
          apiCode: item.value,
          description: item.description,
          line: item.line,
        });
      }
    } else if (current.kind === "A") {
      const tokens = splitDataTokens(trimmed, delimiter);
      if (tokens.length === 0) continue;

      const expectedCols = current.curves.length;
      if (wrap && expectedCols > 0) {
        current.pendingTokens.push(...tokens);
        while (current.pendingTokens.length >= expectedCols) {
          const recordTokens = current.pendingTokens.splice(0, expectedCols);
          current.rows.push(
            recordTokens.map((tok) => {
              const num = Number(tok);
              if (!Number.isFinite(num) || isNullNumeric(num, nullValue)) return NaN;
              return num;
            }),
          );
        }
      } else {
        current.rows.push(
          tokens.map((tok) => {
            const num = Number(tok);
            if (!Number.isFinite(num) || isNullNumeric(num, nullValue)) return NaN;
            return num;
          }),
        );
      }
    }
  }

  flushPending(current);

  return {
    version,
    wrap,
    delimiter,
    nullValue,
    well,
    params,
    curves: primaryCurves,
    other: otherLines.join("\n").trim(),
    rows: primaryRows,
    sections,
  };
}

/**
 * Converts a parsed `LasDocument` into a canonical `@modelscript/simulate/charts` `IndexedDataset`.
 */
export function lasToDataset(doc: LasDocument, options?: { title?: string | undefined }): IndexedDataset {
  const indexCurveIdx = (() => {
    const depthIdx = doc.curves.findIndex((c) => DEPTH_MNEMONICS.has(c.mnemonic.toUpperCase()));
    if (depthIdx !== -1) return depthIdx;
    const timeIdx = doc.curves.findIndex((c) => TIME_MNEMONICS.has(c.mnemonic.toUpperCase()));
    if (timeIdx !== -1) return timeIdx;
    return 0;
  })();

  const indexCurve = doc.curves[indexCurveIdx];
  const indexMnem = indexCurve?.mnemonic ?? "DEPT";
  const isTime = TIME_MNEMONICS.has(indexMnem.toUpperCase());
  const isDepth = !isTime && (DEPTH_MNEMONICS.has(indexMnem.toUpperCase()) || indexCurveIdx === 0);

  const indexValues = doc.rows.map((r, i) => {
    const val = r[indexCurveIdx];
    return typeof val === "number" && Number.isFinite(val) ? val : i;
  });

  const series = doc.curves
    .map((curve, cIdx) => ({ curve, cIdx }))
    .filter(({ cIdx }) => cIdx !== indexCurveIdx)
    .map(({ curve, cIdx }) => ({
      name: curve.mnemonic,
      ...(curve.unit ? { unit: curve.unit } : {}),
      ...(curve.description ? { description: curve.description } : {}),
      values: doc.rows.map((r) => r[cIdx] ?? NaN),
    }));

  const metadata: Record<string, string | number | boolean> = {
    lasVersion: doc.version,
  };
  for (const key of ["WELL", "COMP", "FLD", "LOC", "UWI", "API"]) {
    const val = doc.well[key]?.value;
    if (val) metadata[key] = val;
  }

  const title = options?.title ?? (doc.well["WELL"]?.value || undefined);

  return {
    ...(title !== undefined ? { title } : {}),
    sourceFormat: "las",
    indexAxis: {
      key: indexMnem,
      label: isTime ? "Time" : isDepth ? "Depth" : indexMnem,
      ...(indexCurve?.unit ? { unit: indexCurve.unit } : {}),
      inverted: isDepth,
      nullValue: doc.nullValue,
    },
    indexValues,
    series,
    metadata,
  };
}

/**
 * Serializes a canonical `IndexedDataset` into a CWLS LAS 2.0 or 3.0 string.
 */
export function datasetToLas(
  dataset: IndexedDataset,
  options?: { version?: "2.0" | "3.0" | undefined; nullValue?: number | undefined },
): string {
  const version = options?.version ?? "2.0";
  const nullVal = options?.nullValue ?? dataset.indexAxis.nullValue ?? -999.25;
  const idxVals = dataset.indexValues;
  const startVal = idxVals.length > 0 ? idxVals[0]! : 0;
  const stopVal = idxVals.length > 0 ? idxVals[idxVals.length - 1]! : 0;
  const stepVal = idxVals.length > 1 ? idxVals[1]! - idxVals[0]! : 0;

  const lines: string[] = [
    "~VERSION INFORMATION",
    ` VERS.                          ${version} : CWLS LOG ASCII STANDARD - VERSION ${version}`,
    " WRAP.                          NO : ONE LINE PER DEPTH STEP",
  ];
  if (version === "3.0") {
    lines.push(" DLM .                          SPACE : DELIMITING CHARACTER");
  }

  lines.push("~WELL INFORMATION");
  lines.push(` STRT.${dataset.indexAxis.unit ?? ""} ${startVal} : START INDEX`);
  lines.push(` STOP.${dataset.indexAxis.unit ?? ""} ${stopVal} : STOP INDEX`);
  lines.push(` STEP.${dataset.indexAxis.unit ?? ""} ${stepVal} : STEP`);
  lines.push(` NULL. ${nullVal} : NULL VALUE`);
  if (dataset.title) {
    lines.push(` WELL. ${dataset.title} : WELL`);
  }

  lines.push("~CURVE INFORMATION");
  lines.push(` ${dataset.indexAxis.key}.${dataset.indexAxis.unit ?? ""} : ${dataset.indexAxis.label}`);
  for (const s of dataset.series) {
    lines.push(` ${s.name}.${s.unit ?? ""} : ${s.description ?? s.name}`);
  }

  lines.push("~ASCII");
  for (let i = 0; i < idxVals.length; i++) {
    const idx = Number.isFinite(idxVals[i]) ? String(idxVals[i]) : String(nullVal);
    const cols = dataset.series.map((s) => {
      const v = s.values[i];
      return typeof v === "number" && Number.isFinite(v) ? String(v) : String(nullVal);
    });
    lines.push(` ${[idx, ...cols].join(" ")}`);
  }

  return lines.join("\n");
}

/**
 * Validates a LAS document and produces span-accurate diagnostics (`LAS1001`–`LAS1007`).
 */
export function lintLas(text: string, baseOffset = 0): LasDiagnostic[] {
  const diags: LasDiagnostic[] = [];
  const lines = text.split(/\r?\n/);

  let hasVersionSection = false;
  let hasVersMnemonic = false;
  let hasCurvesSection = false;
  let hasAsciiSection = false;
  let wrap = false;
  let delimiter: LasDelimiter = "whitespace";

  const curveNames: string[] = [];
  const curveLineSeen = new Map<string, number>();

  let section: "none" | "V" | "W" | "C" | "P" | "O" | "A" = "none";
  let offset = baseOffset;
  let recordIdx = 0;
  let prevIndexVal: number | null = null;
  let indexDirection: 1 | -1 | 0 = 0;
  let wrappedTokens: { token: string; start: number; end: number }[] = [];

  const pushDiag = (
    entry: { code: string; rule: string; severity: "error" | "warning" },
    message: string,
    startOffset: number,
    endOffset: number,
  ) => {
    diags.push({
      code: entry.code,
      rule: entry.rule,
      severity: entry.severity,
      message,
      startOffset,
      endOffset: Math.max(startOffset, endOffset),
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineLen = line.length;
    const lineStart = offset;
    const lineEnd = offset + lineLen;
    offset += lineLen + 1;

    const trimmed = line.trim();
    if (trimmed.startsWith("~")) {
      const upper = trimmed.slice(1).trim().toUpperCase();
      if (upper.includes("_DATA")) {
        hasAsciiSection = true;
        section = "A";
        wrappedTokens = [];
      } else if (upper.includes("_DEFINITION")) {
        section = "none";
      } else if (upper.startsWith("V")) {
        hasVersionSection = true;
        section = "V";
      } else if (upper.startsWith("W")) {
        section = "W";
      } else if (upper.startsWith("C")) {
        hasCurvesSection = true;
        section = "C";
      } else if (upper.startsWith("P")) {
        section = "P";
      } else if (upper.startsWith("O")) {
        section = "O";
      } else if (upper.startsWith("A")) {
        hasAsciiSection = true;
        section = "A";
        wrappedTokens = [];
      } else {
        section = "none";
      }
      continue;
    }

    if (section === "O" || !trimmed || trimmed.startsWith("#")) continue;

    if (section === "V") {
      const item = parseHeaderLine(line, i + 1);
      if (item) {
        if (item.mnemonic === "VERS") hasVersMnemonic = true;
        else if (item.mnemonic === "WRAP") wrap = item.value.toUpperCase().startsWith("YES");
        else if (item.mnemonic === "DLM") {
          const d = item.value.toUpperCase();
          if (d.includes("COMMA")) delimiter = ",";
          else if (d.includes("TAB")) delimiter = "\t";
          else delimiter = "whitespace";
        }
      }
    } else if (section === "C") {
      const item = parseHeaderLine(line, i + 1);
      if (item) {
        const prevLine = curveLineSeen.get(item.mnemonic);
        if (prevLine !== undefined) {
          pushDiag(
            LasErrorCode.LAS_DUPLICATE_CURVE,
            LasErrorCode.LAS_DUPLICATE_CURVE.message(item.mnemonic, prevLine),
            lineStart,
            lineEnd,
          );
        } else {
          curveLineSeen.set(item.mnemonic, i + 1);
        }
        curveNames.push(item.mnemonic);
      }
    } else if (section === "A") {
      const tokens = splitDataTokens(trimmed, delimiter);
      if (tokens.length === 0) continue;

      const checkRecord = (recTokens: { token: string; start: number; end: number }[]) => {
        recordIdx++;
        if (curveNames.length > 0 && recTokens.length !== curveNames.length) {
          pushDiag(
            LasErrorCode.LAS_COLUMN_COUNT_MISMATCH,
            LasErrorCode.LAS_COLUMN_COUNT_MISMATCH.message(recordIdx, recTokens.length, curveNames.length),
            recTokens[0]!.start,
            recTokens[recTokens.length - 1]!.end,
          );
        }
        for (let c = 0; c < recTokens.length; c++) {
          const tok = recTokens[c]!;
          const num = Number(tok.token);
          if (!Number.isFinite(num)) {
            const curveName = curveNames[c] ?? `col_${c + 1}`;
            pushDiag(
              LasErrorCode.LAS_INVALID_NUMERIC_VALUE,
              LasErrorCode.LAS_INVALID_NUMERIC_VALUE.message(tok.token, curveName, recordIdx),
              tok.start,
              tok.end,
            );
          } else if (c === 0) {
            if (prevIndexVal !== null) {
              const delta = num - prevIndexVal;
              if (delta === 0 || (indexDirection !== 0 && delta * indexDirection <= 0)) {
                pushDiag(
                  LasErrorCode.LAS_NON_MONOTONIC_INDEX,
                  LasErrorCode.LAS_NON_MONOTONIC_INDEX.message(num, recordIdx, prevIndexVal),
                  tok.start,
                  tok.end,
                );
              } else if (indexDirection === 0 && delta !== 0) {
                indexDirection = delta > 0 ? 1 : -1;
              }
            }
            prevIndexVal = num;
          }
        }
      };

      const mapped = tokens.map((tok) => ({ token: tok, start: lineStart, end: lineEnd }));
      if (wrap && curveNames.length > 0) {
        wrappedTokens.push(...mapped);
        while (wrappedTokens.length >= curveNames.length) {
          checkRecord(wrappedTokens.splice(0, curveNames.length));
        }
      } else {
        checkRecord(mapped);
      }
    }
  }

  if (!hasVersionSection || !hasVersMnemonic) {
    pushDiag(LasErrorCode.LAS_MISSING_VERSION, LasErrorCode.LAS_MISSING_VERSION.message(), baseOffset, baseOffset);
  }
  if (!hasCurvesSection || curveNames.length === 0) {
    pushDiag(LasErrorCode.LAS_MISSING_CURVES, LasErrorCode.LAS_MISSING_CURVES.message(), baseOffset, baseOffset);
  }
  if (!hasAsciiSection) {
    pushDiag(
      LasErrorCode.LAS_MISSING_ASCII_DATA,
      LasErrorCode.LAS_MISSING_ASCII_DATA.message(),
      baseOffset,
      baseOffset,
    );
  }

  return diags;
}

/**
 * Generates a Modelica `package` containing LAS well metadata and curve constant arrays.
 */
export function parseLasToModelica(text: string, packageName = "WellLogData"): string {
  const doc = parseLas(text);
  const safePkg = packageName.replace(/[^a-zA-Z0-9_]/g, "_") || "WellLogData";
  const numRows = doc.rows.length;
  const numCurves = doc.curves.length;

  const lines: string[] = [
    `package ${safePkg}`,
    `  constant Integer numRows = ${numRows};`,
    `  constant Integer numCurves = ${numCurves};`,
    `  constant Real nullValue = ${doc.nullValue};`,
  ];

  for (let c = 0; c < doc.curves.length; c++) {
    const curve = doc.curves[c]!;
    const safeName = curve.mnemonic.replace(/[^a-zA-Z0-9_]/g, "_") || `curve_${c + 1}`;
    const unitAttr = curve.unit ? `(unit = "${curve.unit}")` : "";
    const vals = doc.rows.map((r) => {
      const v = r[c];
      return typeof v === "number" && Number.isFinite(v) ? String(v) : String(doc.nullValue);
    });
    const desc = curve.description ? ` "${curve.description.replace(/"/g, '\\"')}"` : "";
    lines.push(`  constant Real ${safeName}${unitAttr}[${numRows}] = {${vals.join(", ")}}${desc};`);
  }

  lines.push(`end ${safePkg};`);
  return lines.join("\n");
}
