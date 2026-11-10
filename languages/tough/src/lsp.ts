// SPDX-License-Identifier: AGPL-3.0-or-later

import { lintTough } from "./lints/index.js";
import { parseTough } from "./parser/index.js";
import type { ToughDeck } from "./types.js";

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

export function validateTough(text: string): LspDiagnostic[] {
  try {
    const deck = parseTough(text);
    const diags = lintTough(deck);
    return diags.map((d) => ({
      range: {
        start: { line: Math.max(0, d.line - 1), character: 0 },
        end: { line: Math.max(0, d.line - 1), character: 80 },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: `T${d.code}`,
      source: "tough",
      message: d.message,
    }));
  } catch (err) {
    return [
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: 1,
        code: "T8401",
        source: "tough",
        message: err instanceof Error ? err.message : String(err),
      },
    ];
  }
}

export function getToughDocumentSymbols(input: string | ToughDeck): LspDocumentSymbol[] {
  let deck: ToughDeck;
  try {
    deck = typeof input === "string" ? parseTough(input) : input;
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];
  for (const r of deck.rocks) {
    symbols.push({
      name: r.name,
      detail: `Rock (porosity: ${r.porosity})`,
      kind: 5,
      range: { start: { line: Math.max(0, r.line - 1), character: 0 }, end: { line: Math.max(0, r.line - 1), character: 80 } },
      selectionRange: { start: { line: Math.max(0, r.line - 1), character: 0 }, end: { line: Math.max(0, r.line - 1), character: 5 } },
    });
  }

  for (const el of deck.elements) {
    symbols.push({
      name: el.name,
      detail: `Grid Element (volume: ${el.volume} m^3)`,
      kind: 13,
      range: { start: { line: Math.max(0, el.line - 1), character: 0 }, end: { line: Math.max(0, el.line - 1), character: 80 } },
      selectionRange: { start: { line: Math.max(0, el.line - 1), character: 0 }, end: { line: Math.max(0, el.line - 1), character: 5 } },
    });
  }

  return symbols;
}

export function getToughHover(text: string, pos: LspPosition): LspHover | null {
  try {
    const deck = parseTough(text);
    const symbols = getToughDocumentSymbols(deck);
    for (const s of symbols) {
      if (pos.line >= s.range.start.line && pos.line <= s.range.end.line) {
        return {
          contents: {
            kind: "markdown",
            value: `**TOUGH ${s.detail ?? ""}**: \`${s.name}\``,
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
