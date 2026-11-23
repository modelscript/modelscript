// SPDX-License-Identifier: AGPL-3.0-or-later

import { collectWasmSyntaxErrors } from "@modelscript/dsl";
import {
  CHEMKIN_ELEMENT_ATOMIC_WEIGHTS,
  CHEMKIN_STD_SPECIES,
  computeMolecularWeightGPerMol,
  getElementAtomicWeight,
} from "./catalog/chemkin-std-schemas.js";
import { ChemkinErrorCode } from "./errors.js";
import { lintChemkin } from "./lints/index.js";
import { getChemkinWasmParser, parseChemkin } from "./parser/chemkin-parser.js";
import { evaluateNasa7, resolveSpeciesThermo } from "./solver/thermo.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export enum LspSymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string | undefined;
  kind: LspSymbolKind;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[] | undefined;
}

export interface LspDiagnostic {
  range: LspRange;
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Info, 4 = Hint
  code: number | string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown";
    value: string;
  };
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

function toLspRange(range?: { startLine: number; startColumn: number; endLine: number; endColumn: number }): LspRange {
  if (!range) {
    return {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    };
  }
  return {
    start: { line: Math.max(0, range.startLine - 1), character: Math.max(0, range.startColumn - 1) },
    end: { line: Math.max(0, range.endLine - 1), character: Math.max(0, range.endColumn - 1) },
  };
}

function wordAtPosition(text: string, pos: LspPosition): string {
  const lines = text.split(/\r?\n/);
  const line = lines[pos.line] ?? "";
  let start = Math.min(pos.character, line.length);
  let end = start;
  const isWordChar = (ch: string): boolean => /[A-Za-z0-9_*,/-]/.test(ch);
  while (start > 0 && isWordChar(line[start - 1] ?? "")) start--;
  while (end < line.length && isWordChar(line[end] ?? "")) end++;
  return line.slice(start, end);
}

/**
 * Validates a CHEMKIN deck and returns combined WASM syntax and semantic LSP diagnostics.
 */
export function validateChemkin(text: string): LspDiagnostic[] {
  const results: LspDiagnostic[] = [];

  try {
    const cstTree = getChemkinWasmParser().parse(text);
    const syntaxErrors = collectWasmSyntaxErrors(cstTree?.rootNode);
    for (const err of syntaxErrors) {
      results.push({
        range: {
          start: { line: Math.max(0, err.startLine - 1), character: Math.max(0, err.startColumn - 1) },
          end: { line: Math.max(0, err.endLine - 1), character: Math.max(0, err.endColumn - 1) },
        },
        severity: 1,
        code: ChemkinErrorCode.SYNTAX_ERROR.code,
        source: "chemkin-parser",
        message: err.message,
      });
    }
  } catch {
    // Continue to semantic diagnostics
  }

  const doc = parseChemkin(text);
  const diags = lintChemkin(doc);
  for (const d of diags) {
    let sev: 1 | 2 | 3 = 1;
    if (d.severity === "warning") sev = 2;
    if (d.severity === "info") sev = 3;
    results.push({
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "chemkin-linter",
      message: d.message,
    });
  }

  return results;
}

/**
 * Builds a hierarchical LSP document symbol outline for a CHEMKIN deck.
 */
export function getChemkinDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseChemkin(text);
  const mech = doc.mechanism;
  const symbols: LspDocumentSymbol[] = [];

  if (mech.elements.size > 0) {
    const children: LspDocumentSymbol[] = [];
    for (const [name, el] of mech.elements) {
      const r = toLspRange(el.range);
      const aw = el.atomicWeight ?? getElementAtomicWeight(name);
      children.push({
        name,
        detail: aw !== undefined ? `${aw.toFixed(4)} g/mol` : "Element",
        kind: LspSymbolKind.Constant,
        range: r,
        selectionRange: r,
      });
    }
    symbols.push({
      name: "ELEMENTS",
      detail: `${mech.elements.size} elements`,
      kind: LspSymbolKind.Namespace,
      range: children[0]!.range,
      selectionRange: children[0]!.selectionRange,
      children,
    });
  }

  if (mech.species.size > 0) {
    const children: LspDocumentSymbol[] = [];
    for (const [name, sp] of mech.species) {
      const r = toLspRange(sp.range);
      const th = resolveSpeciesThermo(mech, name);
      const mw = th ? computeMolecularWeightGPerMol(th.composition) : undefined;
      children.push({
        name,
        detail: mw ? `${mw.toFixed(3)} g/mol` : "Species",
        kind: LspSymbolKind.Variable,
        range: r,
        selectionRange: r,
      });
    }
    symbols.push({
      name: "SPECIES",
      detail: `${mech.species.size} species`,
      kind: LspSymbolKind.Namespace,
      range: children[0]!.range,
      selectionRange: children[0]!.selectionRange,
      children,
    });
  }

  if (mech.thermo.size > 0) {
    const children: LspDocumentSymbol[] = [];
    for (const [name, rec] of mech.thermo) {
      const r = toLspRange(rec.range);
      children.push({
        name,
        detail: `NASA-7 [${rec.tLow}–${rec.tMid}–${rec.tHigh} K]`,
        kind: LspSymbolKind.Struct,
        range: r,
        selectionRange: r,
      });
    }
    symbols.push({
      name: "THERMO",
      detail: `${mech.thermo.size} records`,
      kind: LspSymbolKind.Namespace,
      range: children[0]!.range,
      selectionRange: children[0]!.selectionRange,
      children,
    });
  }

  if (mech.reactions.length > 0) {
    const children: LspDocumentSymbol[] = [];
    for (const rxn of mech.reactions) {
      const r = toLspRange(rxn.range);
      children.push({
        name: `${rxn.id}: ${rxn.equation}`,
        detail: `A=${rxn.rate.A.toExponential(2)}, b=${rxn.rate.b}, Ea=${rxn.rate.Ea}`,
        kind: LspSymbolKind.Function,
        range: r,
        selectionRange: r,
      });
    }
    symbols.push({
      name: "REACTIONS",
      detail: `${mech.reactions.length} reactions (${mech.energyUnits})`,
      kind: LspSymbolKind.Namespace,
      range: children[0]!.range,
      selectionRange: children[0]!.selectionRange,
      children,
    });
  }

  return symbols;
}

const KEYWORD_DOCS: Record<string, string> = {
  ELEMENTS: "Declares chemical elements used in species compositions (terminated by `END`).",
  ELEM: "Short alias for `ELEMENTS`.",
  SPECIES: "Declares gas-phase or surface chemical species (terminated by `END`).",
  SPEC: "Short alias for `SPECIES`.",
  THERMO: "Defines NASA-7 14-coefficient 4-line thermodynamic records (terminated by `END`).",
  REACTIONS: "Defines elementary, three-body, falloff, and PLOG chemical reactions (terminated by `END`).",
  REAC: "Short alias for `REACTIONS`.",
  DUPLICATE: "Marks a reaction as an intentional duplicate rate expression.",
  DUP: "Short alias for `DUPLICATE`.",
  LOW: "Low-pressure limit modified Arrhenius parameters `LOW / A b Ea /` for falloff reactions.",
  TROE: "Troe falloff broadening parameters `TROE / a T3 T1 [T2] /`.",
  SRI: "SRI falloff broadening parameters `SRI / a b c [d e] /`.",
  REV: "Explicit reverse modified Arrhenius parameters `REV / A b Ea /`.",
  PLOG: "Pressure-dependent logarithmic interpolation rate entry `PLOG / P(atm) A b Ea /`.",
};

/**
 * Returns Markdown hover information for CHEMKIN species, elements, and keywords.
 */
export function getChemkinHover(text: string, pos: LspPosition): LspHover | null {
  const word = wordAtPosition(text, pos);
  if (!word) return null;
  const upper = word.toUpperCase();

  if (KEYWORD_DOCS[upper]) {
    return {
      contents: {
        kind: "markdown",
        value: `**CHEMKIN Keyword \`${upper}\`**\n\n${KEYWORD_DOCS[upper]}`,
      },
    };
  }

  const doc = parseChemkin(text);
  const mech = doc.mechanism;

  // Check species
  const thermo = resolveSpeciesThermo(mech, word);
  if (mech.species.has(word) || thermo) {
    const lines = [`**CHEMKIN Species \`${word}\`**`];
    if (thermo) {
      const comp = Object.entries(thermo.composition)
        .map(([el, c]) => `${el}:${c}`)
        .join(", ");
      const mw = computeMolecularWeightGPerMol(thermo.composition);
      const st298 = evaluateNasa7(thermo, 298.15);
      lines.push(`- **Composition:** ${comp} (${mw.toFixed(3)} g/mol)`);
      lines.push(`- **Phase:** ${thermo.phase} | **Range:** ${thermo.tLow} – ${thermo.tMid} – ${thermo.tHigh} K`);
      lines.push(`- **Cp (298.15 K):** ${st298.cpMolar.toFixed(2)} J/(mol·K)`);
      lines.push(`- **Hf (298.15 K):** ${(st298.hMolar / 1000).toFixed(2)} kJ/mol`);
    }
    return { contents: { kind: "markdown", value: lines.join("\n") } };
  }

  // Check element
  const aw = mech.elements.get(upper)?.atomicWeight ?? CHEMKIN_ELEMENT_ATOMIC_WEIGHTS[upper];
  if (aw !== undefined) {
    return {
      contents: {
        kind: "markdown",
        value: `**CHEMKIN Element \`${upper}\`**\n\n- **Atomic Weight:** ${aw} g/mol (IUPAC)`,
      },
    };
  }

  return null;
}

/**
 * Returns context-aware LSP completion items for CHEMKIN decks.
 */
export function getChemkinCompletions(text: string, _pos: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = [];

  const sectionKeywords = ["ELEMENTS", "SPECIES", "THERMO", "REACTIONS", "END"];
  for (const kw of sectionKeywords) {
    items.push({ label: kw, kind: 14, detail: "CHEMKIN Section", documentation: KEYWORD_DOCS[kw] });
  }

  const auxKeywords = ["DUPLICATE", "LOW", "TROE", "SRI", "REV", "PLOG"];
  for (const kw of auxKeywords) {
    items.push({ label: kw, kind: 14, detail: "CHEMKIN Auxiliary Keyword", documentation: KEYWORD_DOCS[kw] });
  }

  const unitKeywords = ["CAL/MOLE", "KCAL/MOLE", "JOULES/MOLE", "KJOULES/MOLE", "KELVINS", "MOLES", "MOLECULES"];
  for (const u of unitKeywords) {
    items.push({ label: u, kind: 11, detail: "CHEMKIN Reaction Unit" });
  }

  const doc = parseChemkin(text);
  const seen = new Set<string>();
  for (const sp of doc.mechanism.species.keys()) {
    seen.add(sp);
    items.push({ label: sp, kind: 6, detail: "Declared Species" });
  }
  for (const std of CHEMKIN_STD_SPECIES) {
    if (!seen.has(std.species)) {
      items.push({ label: std.species, kind: 6, detail: `StdLib NASA-7 (${std.category})` });
    }
  }

  return items;
}
