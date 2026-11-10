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
    const model = parseModflow(text);
    const diags = lintModflow(model);
    return diags.map((d) => ({
      range: {
        start: { line: Math.max(0, d.line - 1), character: 0 },
        end: { line: Math.max(0, d.line - 1), character: 80 },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: `MF${d.code}`,
      source: "modflow",
      message: d.message,
    }));
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

  const symbols: LspDocumentSymbol[] = [];

  if (model.dis) {
    symbols.push({
      name: `DIS (${model.dis.nlay}x${model.dis.nrow}x${model.dis.ncol})`,
      detail: `Grid: ${model.dis.nlay} layers, ${model.dis.nrow} rows, ${model.dis.ncol} cols`,
      kind: 5,
      range: { start: { line: 0, character: 0 }, end: { line: 10, character: 80 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
    });
  }

  if (model.npf) {
    symbols.push({
      name: `NPF (K=${model.npf.k})`,
      detail: `Hydraulic Conductivity K: ${model.npf.k} m/d`,
      kind: 14,
      range: { start: { line: 0, character: 0 }, end: { line: 20, character: 80 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 10 } },
    });
  }

  for (const w of model.wells) {
    const l = Math.max(0, (w.line ?? 1) - 1);
    symbols.push({
      name: w.name ?? `Well (${w.cell.layer}, ${w.cell.row}, ${w.cell.col})`,
      detail: `Pumping rate: ${w.q} m^3/d`,
      kind: 13,
      range: { start: { line: l, character: 0 }, end: { line: l, character: 80 } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: 10 } },
    });
  }

  for (const r of model.rivers) {
    const l = Math.max(0, (r.line ?? 1) - 1);
    symbols.push({
      name: `River (${r.cell.layer}, ${r.cell.row}, ${r.cell.col})`,
      detail: `Stage: ${r.stage} m, Cond: ${r.cond} m^2/d`,
      kind: 13,
      range: { start: { line: l, character: 0 }, end: { line: l, character: 80 } },
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
