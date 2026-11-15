// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintModflow } from "./lints/index.js";
import { parseModflow } from "./parser/index.js";
import type { ModflowModel } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4;
  code: number | string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: { kind: "markdown" | "plaintext"; value: string };
  range?: LspRange | undefined;
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
}

export function validateModflow(text: string): LspDiagnostic[] {
  try {
    const lines = text.split(/\r?\n/);
    const model = parseModflow(text);
    const diags = lintModflow(model);
    return diags.map((d) => {
      const l = Math.min(Math.max(0, d.line - 1), Math.max(0, lines.length - 1));
      const lt = lines[l] ?? "";
      let sChar = 0;
      while (sChar < lt.length && (lt[sChar] === " " || lt[sChar] === "\t")) sChar++;
      const tok = lt.slice(sChar).match(/^[^\s,;]+/);
      return {
        range: {
          start: { line: l, character: sChar },
          end: { line: l, character: Math.min(lt.length, sChar + (tok ? tok[0].length : 1)) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: `MF${d.code}`,
        source: "modflow",
        message: d.message,
      };
    });
  } catch (err) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "MF1001",
        source: "modflow",
        message: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

export function getModflowDocumentSymbols(input: string | ModflowModel): LspDocumentSymbol[] {
  let model: ModflowModel;
  try {
    model = typeof input === "string" ? parseModflow(input) : input;
  } catch {
    return [];
  }

  const lines = typeof input === "string" ? input.split(/\r?\n/) : [];
  const lineRange = (line: number, endLine: number, fallbackLen: number): LspRange => {
    const sLine = Math.min(Math.max(0, line), Math.max(0, lines.length - 1));
    const eLine = Math.min(Math.max(sLine, endLine), Math.max(sLine, lines.length - 1));
    const lt = lines[eLine] ?? "";
    const endChar = lt.length > 0 ? Math.max(1, lt.trimEnd().length) : Math.max(1, fallbackLen);
    return { start: { line: sLine, character: 0 }, end: { line: eLine, character: endChar } };
  };
  const symbols: LspDocumentSymbol[] = [];

  if (model.dis) {
    const label = `DIS (${model.dis.nlay}x${model.dis.nrow}x${model.dis.ncol})`;
    symbols.push({
      name: label,
      detail: `Grid: ${model.dis.nlay} layers, ${model.dis.nrow} rows, ${model.dis.ncol} cols`,
      kind: 5,
      range: lineRange(0, 10, label.length),
      selectionRange: lineRange(0, 0, label.length),
    });
  }

  if (model.npf) {
    const label = `NPF (K=${model.npf.k})`;
    symbols.push({
      name: label,
      detail: `Hydraulic Conductivity K: ${model.npf.k} m/d`,
      kind: 14,
      range: lineRange(0, 20, label.length),
      selectionRange: lineRange(0, 0, label.length),
    });
  }

  for (const w of model.wells) {
    const l = Math.max(0, (w.line ?? 1) - 1);
    const label = w.name ?? `Well (${w.cell.layer}, ${w.cell.row}, ${w.cell.col})`;
    const r = lineRange(l, l, label.length);
    symbols.push({
      name: label,
      detail: `Pumping rate: ${w.q} m^3/d`,
      kind: 13,
      range: r,
      selectionRange: r,
    });
  }

  for (const r of model.rivers) {
    const l = Math.max(0, (r.line ?? 1) - 1);
    const label = `River (${r.cell.layer}, ${r.cell.row}, ${r.cell.col})`;
    const rng = lineRange(l, l, label.length);
    symbols.push({
      name: label,
      detail: `Stage: ${r.stage} m, Cond: ${r.cond} m^2/d`,
      kind: 13,
      range: rng,
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 10 } },
    });
  }

  for (const c of model.chds) {
    const l = Math.max(0, (c.line ?? 1) - 1);
    symbols.push({
      name: `CHD (${c.cell.layer}, ${c.cell.row}, ${c.cell.col})`,
      detail: `Constant Head: ${c.head} m`,
      kind: 13,
      range: { start: { line: l, character: 0 }, end: { line: l, character: 80 } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 10 } },
    });
  }

  return symbols;
}

export function getModflowHover(text: string, pos: LspPosition): LspHover | null {
  try {
    const model = parseModflow(text);
    const symbols = getModflowDocumentSymbols(model);
    for (const s of symbols) {
      if (pos.line >= s.range.start.line && pos.line <= s.range.end.line) {
        return {
          contents: {
            kind: "markdown",
            value: `**MODFLOW ${s.detail ?? ""}**: \`${s.name}\``,
          },
          range: s.range,
        };
      }
    }
  } catch {
    // Ignore
  }
  return null;
}
