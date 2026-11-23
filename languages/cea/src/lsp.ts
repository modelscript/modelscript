// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cea — Language Server Protocol (LSP) Services for NASA CEA Decks.
 */

import { CEA_STD_SPECIES_DATA } from "./catalog/cea-std-schemas.js";
import { lintCeaDeck } from "./lints/index.js";
import { parseCeaDeck } from "./parser/cea-parser.js";
import { lookupCeaSpecies } from "./solver/thermo-db.js";

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
  Variable = 13,
  Constant = 14,
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
  severity: 1 | 2 | 3 | 4;
  code: string;
  source: string;
  message: string;
}

export interface LspHover {
  contents: {
    kind: "markdown" | "plaintext";
    value: string;
  };
  range?: LspRange | undefined;
}

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
}

const KEYWORD_DOCS: Record<string, string> = {
  problem:
    "NASA CEA **problem** dataset: defines problem type (`hp`, `tp`, `uv`, `tv`, `sp`, `sv`, `rocket`, `deton`, `shock`), mixture ratios (`o/f`, `phi`), pressures (`p,bar`, `p,atm`, `p,psia`), and nozzle area ratios (`supar`, `subar`, `pi/pe`).",
  reactants:
    "NASA CEA **reactants** dataset: declares `fuel=`, `oxid=`, or `name=` reactants with `wt%`, `moles`, `t(k)=`, and `h,kj/mol=`.",
  only: "NASA CEA **only** dataset: restricts equilibrium product species to the specified list.",
  omit: "NASA CEA **omit** dataset: excludes specific species from equilibrium products.",
  insert: "NASA CEA **insert** dataset: forces initial condensed/gas species consideration.",
  output:
    "NASA CEA **output** dataset: configures output units (`siunits`, `calories`), `short`, `massf`, `molef`, `trace=`, and `plot`.",
  end: "Terminates the current NASA CEA problem deck.",
  rocket: "1D isentropic rocket performance problem (`c*`, `C_F`, `I_sp,vac`, `I_sp,sl`, Mach).",
  deton: "Chapman-Jouguet (CJ) detonation wave equilibrium problem.",
  hp: "Constant enthalpy and pressure adiabatic flame equilibrium problem.",
  tp: "Assigned temperature and pressure chemical equilibrium problem.",
  equilibrium: "Shifting chemical equilibrium expansion throughout the rocket nozzle.",
  frozen: "Frozen-composition isentropic expansion from the combustion chamber.",
};

/**
 * Validates a NASA CEA problem deck and returns LSP diagnostics.
 */
export function validateCea(content: string, _uri: string = "problem.cea"): LspDiagnostic[] {
  const deck = parseCeaDeck(content);
  const diags = lintCeaDeck(deck);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const lineText = lines[lineIdx] ?? "";
    const startChar = Math.max(0, Math.min(lineText.length, d.column - 1));
    const endChar = Math.max(startChar + 1, lineText.length);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.code,
      source: "modelscript-cea",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (problem, reactants, filters, output) from a CEA deck.
 */
export function getCeaDocumentSymbols(content: string): LspDocumentSymbol[] {
  const deck = parseCeaDeck(content);
  const lines = content.split(/\r?\n/);
  const fullRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, lines.length - 1), character: (lines[lines.length - 1] ?? "").length },
  };

  const children: LspDocumentSymbol[] = [];

  if (deck.hasProblem && deck.problem.span) {
    const pRange: LspRange = {
      start: { line: deck.problem.span.startLine - 1, character: Math.max(0, deck.problem.span.startColumn - 1) },
      end: { line: deck.problem.span.endLine - 1, character: Math.max(0, deck.problem.span.endColumn - 1) },
    };
    children.push({
      name: `problem (${deck.problem.problemType ?? "hp"})`,
      detail: deck.problem.frozen && !deck.problem.equilibrium ? "frozen" : "equilibrium",
      kind: LspSymbolKind.Module,
      range: pRange,
      selectionRange: pRange,
    });
  }

  for (const r of deck.reactants) {
    const rLine = Math.max(0, r.line - 1);
    const rRange: LspRange = {
      start: { line: rLine, character: Math.max(0, r.column - 1) },
      end: { line: rLine, character: (lines[rLine] ?? "").length },
    };
    const detailParts: string[] = [r.role];
    if (r.wtPercent !== undefined) detailParts.push(`wt%=${r.wtPercent}`);
    if (r.moles !== undefined) detailParts.push(`moles=${r.moles}`);
    if (r.temperatureK !== undefined) detailParts.push(`T=${r.temperatureK} K`);
    children.push({
      name: r.name,
      detail: detailParts.join(", "),
      kind: LspSymbolKind.Variable,
      range: rRange,
      selectionRange: rRange,
    });
  }

  return [
    {
      name: deck.name,
      detail: `NASA CEA ${deck.problem.problemType ?? "hp"} deck`,
      kind: LspSymbolKind.Package,
      range: fullRange,
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: Math.min(20, (lines[0] ?? "").length) },
      },
      children,
    },
  ];
}

/**
 * Provides Markdown hover documentation for NASA CEA keywords and thermodynamic species.
 */
export function getCeaHover(content: string, position: LspPosition): LspHover | null {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line];
  if (!line) return null;

  let start = position.character;
  let end = position.character;
  const isWordChar = (ch: string) => /[A-Za-z0-9_\-()/]/.test(ch);
  while (start > 0 && isWordChar(line[start - 1] ?? "")) start--;
  while (end < line.length && isWordChar(line[end] ?? "")) end++;

  const token = line.slice(start, end).trim();
  if (!token) return null;

  const lower = token.toLowerCase();
  if (lower in KEYWORD_DOCS) {
    return {
      contents: { kind: "markdown", value: KEYWORD_DOCS[lower]! },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  const sp = lookupCeaSpecies(token);
  if (sp) {
    const formulaStr = Object.entries(sp.formula)
      .map(([el, cnt]) => `${el}${cnt === 1 ? "" : cnt}`)
      .join("");
    const md = [
      `**${sp.name}** (${formulaStr}, ${sp.phase})`,
      ``,
      sp.description,
      ``,
      `- Molar mass: \`${(sp.molarMassKgMol * 1000).toFixed(4)} g/mol\``,
      `- $\\Delta H_f^\\circ(298.15\\,\\text{K})$: \`${sp.hf298KjMol.toFixed(3)} kJ/mol\``,
      `- NASA-7 range: \`${sp.nasa7.tLow}–${sp.nasa7.tMid}–${sp.nasa7.tHigh} K\``,
      `- Provenance: ${sp.provenance}`,
    ].join("\n");
    return {
      contents: { kind: "markdown", value: md },
      range: {
        start: { line: position.line, character: start },
        end: { line: position.line, character: end },
      },
    };
  }

  return null;
}

/**
 * Provides NASA CEA keyword and standard-library species completion items.
 */
export function getCeaCompletions(_content: string, _position: LspPosition): LspCompletionItem[] {
  const items: LspCompletionItem[] = Object.entries(KEYWORD_DOCS).map(([kw, doc]) => ({
    label: kw,
    kind: 14, // Keyword
    detail: "NASA CEA keyword",
    documentation: doc,
  }));

  for (const sp of CEA_STD_SPECIES_DATA) {
    items.push({
      label: sp.name,
      kind: 7, // Class / Species
      detail: `${(sp.molarMassKgMol * 1000).toFixed(3)} g/mol (${sp.phase})`,
      documentation: sp.description,
    });
  }

  return items;
}

export const ceaLanguageService = {
  validate: validateCea,
  getDocumentSymbols: getCeaDocumentSymbols,
  getHover: getCeaHover,
  getCompletions: getCeaCompletions,
};
