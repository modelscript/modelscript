// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintLandgem } from "./lints/index.js";
import { parseLandgem } from "./parser/index.js";
import type { LandgemModel } from "./types.js";

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

export function validateLandgem(text: string): LspDiagnostic[] {
  try {
    const lines = text.split(/\r?\n/);
    const model = parseLandgem(text);
    const diags = lintLandgem(model);
    return diags.map((d) => {
      const l = Math.min(Math.max(0, d.line - 1), Math.max(0, lines.length - 1));
      const lt = lines[l] ?? "";
      let sChar = 0;
      while (sChar < lt.length && (lt[sChar] === " " || lt[sChar] === "\t")) sChar++;
      const tok = lt.slice(sChar).match(/^[^,\s;]+/);
      return {
        range: {
          start: { line: l, character: sChar },
          end: { line: l, character: Math.min(lt.length, sChar + (tok ? tok[0].length : 1)) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: `LG${d.code}`,
        source: "landgem",
        message: d.message,
      };
    });
  } catch (err) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "LG1001",
        source: "landgem",
        message: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

export function getLandgemDocumentSymbols(input: string | LandgemModel): LspDocumentSymbol[] {
  let model: LandgemModel;
  try {
    model = typeof input === "string" ? parseLandgem(input) : input;
  } catch {
    return [];
  }

  const lines = typeof input === "string" ? input.split(/\r?\n/) : [];
  const lineEnd = (line: number, fallback: number): number => {
    const lt = lines[line] ?? "";
    return lt.length > 0 ? Math.max(1, lt.trimEnd().length) : Math.max(1, fallback);
  };
  const symbols: LspDocumentSymbol[] = [];

  for (const site of model.sites) {
    const l = Math.max(0, (site.line ?? 1) - 1);
    symbols.push({
      name: site.name,
      detail: `Landfill (${site.openYear} - ${site.closeYear}, k=${site.params.k})`,
      kind: 5,
      range: { start: { line: l, character: 0 }, end: { line: l, character: lineEnd(l, site.name.length) } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: site.name.length } },
    });
  }

  for (const dig of model.digesters) {
    const l = Math.max(0, (dig.line ?? 1) - 1);
    symbols.push({
      name: dig.name,
      detail: `Anaerobic Digester (Vol: ${dig.volumeM3} m^3, HRT: ${dig.hrtDays}d, pH: ${dig.ph})`,
      kind: 13,
      range: { start: { line: l, character: 0 }, end: { line: l, character: lineEnd(l, dig.name.length) } },
      selectionRange: { start: { line: l, character: 0 }, end: { line: l, character: dig.name.length } },
    });
  }

  return symbols;
}

export function getLandgemHover(text: string, pos: LspPosition): LspHover | null {
  try {
    const model = parseLandgem(text);
    const symbols = getLandgemDocumentSymbols(model);
    for (const s of symbols) {
      if (pos.line >= s.range.start.line && pos.line <= s.range.end.line) {
        return {
          contents: {
            kind: "markdown",
            value: `**LandGEM / Biogas ${s.detail ?? ""}**: \`${s.name}\``,
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
