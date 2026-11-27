// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/gaussian`:
 *  - Validation / diagnostics (`validateGaussian`)
 *  - Document symbols (`getGaussianDocumentSymbols`)
 *  - Hover documentation (`getGaussianHover`)
 *  - Code completion (`getGaussianCompletions`)
 */

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { GAUSSIAN_MODEL_SPECS, lookupGaussianModelSchema } from "./catalog/index.js";
import { lookupElement } from "./elements.js";
import { lintGaussian } from "./lints/index.js";
import { parseGaussianInput } from "./parser/gjf-parser.js";

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
  insertText?: string | undefined;
}

const LINK0_DOCS: Record<string, string> = {
  chk: "Specifies the checkpoint file path (`.chk`) for saving wavefunctions, geometries, and Hessians.",
  oldchk: "Specifies an existing checkpoint file to copy prior to job execution.",
  mem: "Specifies the amount of dynamic memory allocated to Gaussian (e.g. `%mem=4GB`, `%mem=512MB`).",
  nprocshared: "Specifies the number of shared-memory CPU threads/cores (e.g. `%nprocshared=8`).",
  nproc: "Specifies the number of processors/cores for parallel execution (e.g. `%nproc=4`).",
  rwf: "Specifies the read-write scratch file path and optional size limits (`.rwf`).",
  nosave: "Deletes scratch files upon normal job termination.",
};

const ROUTE_KEYWORD_DOCS: Record<string, string> = {
  opt: "Requests a geometry optimization to a stationary point (minimum or transition state with `opt=ts`).",
  freq: "Computes analytical or numerical second derivatives (Hessian), harmonic vibrational frequencies, and thermochemistry.",
  sp: "Performs a single-point energy calculation at the specified molecular geometry.",
  td: "Time-Dependent DFT / Hartree-Fock excited-state electronic structure calculation (e.g. `td=(nstates=10)`).",
  scrf: "Self-Consistent Reaction Field continuum solvation model (e.g. `scrf=(pcm,solvent=water)`).",
  pop: "Controls population analysis and molecular orbital printing (e.g. `pop=full`, `pop=nbo`, `pop=esp`).",
  scf: "Controls Self-Consistent Field convergence algorithms and thresholds (e.g. `scf=tight`, `scf=qc`).",
  geom: "Specifies the source or handling of molecular geometry (e.g. `geom=checkpoint`, `geom=connectivity`).",
};

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
}

interface GaussianCstIndex {
  byRow: Map<number, CstLineEntry>;
  lastRow: number;
  lastEndCol: number;
}

function buildGaussianCstIndex(content: string): GaussianCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("gaussian", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
  } catch {
    rootNode = null;
  }

  let lastRow = 0;
  let lastEndCol = 0;
  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode as CstNodeLike)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      byRow.set(row, { row, text: lineText, startCol, endCol });
      if (row >= lastRow) {
        lastRow = row;
        lastEndCol = endCol;
      }
    }
  } else {
    const rawLines = content.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
      const raw = rawLines[i] ?? "";
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const startCol = Math.max(0, raw.search(/\S/));
      const endCol = startCol + trimmed.length;
      byRow.set(i, { row: i, text: trimmed, startCol, endCol });
      lastRow = i;
      lastEndCol = endCol;
    }
  }
  return { byRow, lastRow, lastEndCol };
}

function makeLineRange(cstIndex: GaussianCstIndex, line1Based: number): LspRange {
  const zeroLine = Math.max(0, line1Based - 1);
  const entry = cstIndex.byRow.get(zeroLine);
  const startChar = entry?.startCol ?? 0;
  const endChar = Math.max(startChar + 1, entry?.endCol ?? 1);
  return {
    start: { line: zeroLine, character: startChar },
    end: { line: zeroLine, character: endChar },
  };
}

/**
 * Validates a Gaussian `.gjf`/`.com` document and returns LSP diagnostics.
 */
export function validateGaussian(content: string, _uri: string = "molecule.gjf"): LspDiagnostic[] {
  const doc = parseGaussianInput(content);
  const diags = lintGaussian(doc);
  const cstIndex = buildGaussianCstIndex(content);

  return diags.map((d) => {
    const lineIdx = Math.max(0, d.line - 1);
    const entry = cstIndex.byRow.get(lineIdx);
    const startChar = d.column > 1 ? d.column - 1 : (entry?.startCol ?? 0);
    const endChar = Math.max(startChar + 1, entry?.endCol ?? startChar + 1);
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: endChar },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-gaussian",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols (Job steps, Link0, Route, Atoms, Variables/Constants).
 */
export function getGaussianDocumentSymbols(content: string): LspDocumentSymbol[] {
  const doc = parseGaussianInput(content);
  const cstIndex = buildGaussianCstIndex(content);
  const symbols: LspDocumentSymbol[] = [];

  for (const job of doc.jobs) {
    const children: LspDocumentSymbol[] = [];

    for (const cmd of job.link0) {
      const r = makeLineRange(cstIndex, cmd.line);
      children.push({
        name: `%${cmd.directive}`,
        detail: cmd.value,
        kind: LspSymbolKind.Property,
        range: r,
        selectionRange: r,
      });
    }

    if (job.route) {
      const r = makeLineRange(cstIndex, job.route.line);
      const level =
        job.route.method && job.route.basisSet ? `${job.route.method}/${job.route.basisSet}` : job.route.raw;
      children.push({
        name: `Route: ${level}`,
        detail: job.route.keywords.map((k) => k.raw).join(" "),
        kind: LspSymbolKind.Method,
        range: r,
        selectionRange: r,
      });
    }

    for (const atom of job.atoms) {
      const r = makeLineRange(cstIndex, atom.line);
      children.push({
        name: `${atom.element}${atom.index}`,
        detail: atom.kind === "zmatrix" ? "Z-Matrix" : "Cartesian",
        kind: LspSymbolKind.Field,
        range: r,
        selectionRange: r,
      });
    }

    for (const v of job.variableEntries) {
      const r = makeLineRange(cstIndex, v.line);
      children.push({
        name: v.name,
        detail: `${v.value}`,
        kind: v.isConstant ? LspSymbolKind.Constant : LspSymbolKind.Variable,
        range: r,
        selectionRange: r,
      });
    }

    const firstLine = job.link0[0]?.line ?? job.route?.line ?? job.titleLine ?? 1;
    const lastLine =
      job.variableEntries[job.variableEntries.length - 1]?.line ??
      job.atoms[job.atoms.length - 1]?.line ??
      job.chargeMultLine ??
      firstLine;
    const lastZeroLine = Math.max(0, lastLine - 1);
    const lastEntry = cstIndex.byRow.get(lastZeroLine);

    const jobRange: LspRange = {
      start: {
        line: Math.max(0, firstLine - 1),
        character: cstIndex.byRow.get(Math.max(0, firstLine - 1))?.startCol ?? 0,
      },
      end: {
        line: lastZeroLine,
        character: Math.max(1, lastEntry?.endCol ?? 1),
      },
    };

    symbols.push({
      name: job.title?.trim() || `Step ${job.stepIndex + 1}`,
      detail:
        job.charge !== undefined && job.multiplicity !== undefined
          ? `charge=${job.charge}, mult=${job.multiplicity}`
          : undefined,
      kind: LspSymbolKind.Package,
      range: jobRange,
      selectionRange: makeLineRange(cstIndex, firstLine),
      children,
    });
  }

  return symbols;
}

function getTokenAtPosition(lineText: string, character: number): { token: string; start: number; end: number } | null {
  if (!lineText || character < 0 || character > lineText.length) return null;
  const isWordChar = (ch: string): boolean => /[A-Za-z0-9_%#\-+()/*]/.test(ch);
  let start = character;
  while (start > 0 && isWordChar(lineText[start - 1]!)) start--;
  let end = character;
  while (end < lineText.length && isWordChar(lineText[end]!)) end++;
  const token = lineText.slice(start, end);
  return token.length > 0 ? { token, start, end } : null;
}

/**
 * Provides contextual Markdown hover documentation for Link0 commands, quantum chemistry
 * methods/basis sets, route keywords, elements, and Z-matrix variables.
 */
export function getGaussianHover(content: string, position: LspPosition): LspHover | null {
  const cstIndex = buildGaussianCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  if (!entry) return null;

  const relChar = position.character - entry.startCol;
  const tok = getTokenAtPosition(entry.text, relChar);
  if (!tok) return null;

  const range: LspRange = {
    start: { line: position.line, character: entry.startCol + tok.start },
    end: { line: position.line, character: entry.startCol + tok.end },
  };

  // 1. Link0 directive (%chk, %mem, %nprocshared, etc.)
  if (tok.token.startsWith("%")) {
    const dir = tok.token.slice(1).toLowerCase();
    const doc = LINK0_DOCS[dir];
    if (doc) {
      return {
        contents: { kind: "markdown", value: `**Link0 Directive \`%${dir}\`**\n\n${doc}` },
        range,
      };
    }
  }

  // 2. Method/Basis token (e.g. B3LYP/6-31G(d))
  if (tok.token.includes("/")) {
    const [m, b] = tok.token.split("/", 2);
    const mSchema = m ? lookupGaussianModelSchema(m) : undefined;
    const bSchema = b ? lookupGaussianModelSchema(b) : undefined;
    if (mSchema || bSchema) {
      const parts: string[] = [];
      if (mSchema) {
        parts.push(`**Method: ${mSchema.label}**\n\n${mSchema.description}\n\n*Reference:* ${mSchema.provenance}`);
      }
      if (bSchema) {
        parts.push(`**Basis Set: ${bSchema.label}**\n\n${bSchema.description}\n\n*Reference:* ${bSchema.provenance}`);
      }
      return {
        contents: { kind: "markdown", value: parts.join("\n\n---\n\n") },
        range,
      };
    }
  }

  // 3. Direct stdlib method or basis set
  const schema = lookupGaussianModelSchema(tok.token);
  if (schema) {
    return {
      contents: {
        kind: "markdown",
        value: `**${schema.label}** (${schema.category})\n\n${schema.description}\n\n*Reference:* ${schema.provenance}`,
      },
      range,
    };
  }

  // 4. Route keyword
  const kwKey = tok.token.toLowerCase().replace(/\(.*\)$/, "");
  if (ROUTE_KEYWORD_DOCS[kwKey]) {
    return {
      contents: {
        kind: "markdown",
        value: `**Gaussian Route Keyword \`${kwKey}\`**\n\n${ROUTE_KEYWORD_DOCS[kwKey]}`,
      },
      range,
    };
  }

  // 5. Z-matrix variable lookup in parsed document
  const parsed = parseGaussianInput(content);
  const lowerTok = tok.token.toLowerCase();
  for (const job of parsed.jobs) {
    const entry = job.variables.get(lowerTok) ?? job.constants.get(lowerTok);
    if (entry) {
      return {
        contents: {
          kind: "markdown",
          value: `**Z-Matrix ${entry.isConstant ? "Constant" : "Variable"} \`${entry.name}\`** = \`${entry.value}\``,
        },
        range,
      };
    }
  }

  // 6. Chemical element symbol
  const el = lookupElement(tok.token);
  if (el) {
    return {
      contents: {
        kind: "markdown",
        value: `**Element ${el.symbol} (${el.name})**\n\n- Atomic Number $Z$: \`${el.atomicNumber}\`\n- Atomic Weight: \`${el.atomicWeight} amu\`\n- Covalent Radius: \`${el.covalentRadius} Å\``,
      },
      range,
    };
  }

  return null;
}

/**
 * Provides contextual code completions for Link0 directives, methods, basis sets, and route keywords.
 */
export function getGaussianCompletions(content: string, position: LspPosition): LspCompletionItem[] {
  const cstIndex = buildGaussianCstIndex(content);
  const entry = cstIndex.byRow.get(position.line);
  const lineText = entry ? entry.text.slice(0, Math.max(0, position.character - entry.startCol)) : "";
  const trimmed = lineText.trimStart();

  // Link0 completions
  if (trimmed.startsWith("%")) {
    return Object.entries(LINK0_DOCS).map(([k, doc]) => ({
      label: `%${k}=`,
      kind: 10,
      detail: "Link0 directive",
      documentation: doc,
      insertText: `%${k}=`,
    }));
  }

  // Route section completions
  if (trimmed.startsWith("#")) {
    const items: LspCompletionItem[] = [];
    for (const spec of GAUSSIAN_MODEL_SPECS) {
      items.push({
        label: spec.modelType,
        kind: spec.category.includes("Basis") ? 12 : 6,
        detail: spec.category,
        documentation: spec.description,
      });
    }
    for (const [kw, doc] of Object.entries(ROUTE_KEYWORD_DOCS)) {
      items.push({
        label: kw,
        kind: 14,
        detail: "Route keyword",
        documentation: doc,
      });
    }
    return items;
  }

  return [
    { label: "Variables:", kind: 14, detail: "Z-matrix variable block header" },
    { label: "Constants:", kind: 14, detail: "Z-matrix constant block header" },
    { label: "--Link1--", kind: 14, detail: "Multi-step Gaussian job separator" },
  ];
}
