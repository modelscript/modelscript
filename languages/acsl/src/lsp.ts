// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Language Server Protocol (LSP) services for `@modelscript/acsl`:
 * diagnostics, documentSymbols, hover, completions, and domain actions.
 */

import { ACSL_OPERATOR_SPECS, lookupAcslOperatorSchema } from "./catalog/index.js";
import { acslToDae } from "./dae/index.js";
import { lintAcsl } from "./lints/index.js";
import { parseAcsl } from "./parser/acsl-parser.js";
import { acslToModelica } from "./projections/index.js";
import { simulateAcsl } from "./solver/index.js";

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

const ACSL_KEYWORDS = [
  "PROGRAM",
  "INITIAL",
  "DYNAMIC",
  "DERIVATIVE",
  "DISCRETE",
  "TERMINAL",
  "END",
  "CONSTANT",
  "INTEGER",
  "LOGICAL",
  "REAL",
  "ARRAY",
  "TABLE",
  "MACRO",
  "SCHEDULE",
  "PROCEDURAL",
  "CINTERVAL",
  "MAXTERVAL",
  "ALGORITHM",
  "DERIVT",
  "TERMT",
  "INTERVAL",
  "VARIABLE",
  "NSTEPS",
];

function lineRange(lineNum: number, lineText: string): LspRange {
  const zeroLine = Math.max(0, lineNum - 1);
  return {
    start: { line: zeroLine, character: 0 },
    end: { line: zeroLine, character: Math.max(1, lineText.length) },
  };
}

/**
 * Validates an ACSL document and returns LSP diagnostics.
 */
export function validateAcsl(content: string, _uri: string = "model.csl"): LspDiagnostic[] {
  const program = parseAcsl(content);
  const diags = lintAcsl(program);
  const lines = content.split(/\r?\n/);

  return diags.map((d) => {
    const lineIdx = d.line ? Math.max(0, d.line - 1) : 0;
    const lineText = lines[lineIdx] ?? "";
    let startChar = d.column ? Math.max(0, d.column - 1) : 0;
    let endChar = lineText.length;
    if (d.symbol) {
      const idx = lineText.toUpperCase().indexOf(d.symbol.toUpperCase());
      if (idx >= 0) {
        startChar = idx;
        endChar = idx + d.symbol.length;
      }
    }
    return {
      range: {
        start: { line: lineIdx, character: startChar },
        end: { line: lineIdx, character: Math.max(startChar + 1, endChar) },
      },
      severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
      code: d.id,
      source: "modelscript-acsl",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical LSP document symbols for an ACSL program.
 */
export function getAcslDocumentSymbols(content: string, _uri: string = "model.csl"): LspDocumentSymbol[] {
  const program = parseAcsl(content);
  const lines = content.split(/\r?\n/);
  const children: LspDocumentSymbol[] = [];

  for (const sec of program.sections) {
    if (sec.kind === "PROGRAM") continue;
    const rng = lineRange(sec.line, lines[sec.line - 1] ?? "");
    children.push({
      name: sec.name ? `${sec.kind} ${sec.name}` : sec.kind,
      detail: `ACSL ${sec.kind} section`,
      kind: sec.kind === "DISCRETE" ? LspSymbolKind.Event : LspSymbolKind.Namespace,
      range: rng,
      selectionRange: rng,
    });
  }

  for (const decl of program.declarations) {
    const rng = lineRange(decl.line, lines[decl.line - 1] ?? "");
    children.push({
      name: decl.name,
      detail: `${decl.kind} (${decl.section})`,
      kind: decl.kind === "CONSTANT" ? LspSymbolKind.Constant : LspSymbolKind.Variable,
      range: rng,
      selectionRange: rng,
    });
  }

  for (const integ of program.integrators) {
    const rng = lineRange(integ.line, lines[integ.line - 1] ?? "");
    children.push({
      name: integ.stateVar,
      detail: `Continuous State (${integ.operator})`,
      kind: LspSymbolKind.Field,
      range: rng,
      selectionRange: rng,
    });
  }

  for (const tbl of program.tables) {
    const rng = lineRange(tbl.line, lines[tbl.line - 1] ?? "");
    children.push({
      name: tbl.name,
      detail: `TABLE (${tbl.breakpoints.length} pts)`,
      kind: LspSymbolKind.Array,
      range: rng,
      selectionRange: rng,
    });
  }

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: Math.max(0, lines.length - 1), character: lines[lines.length - 1]?.length ?? 0 },
  };

  return [
    {
      name: program.name,
      detail: `States: ${program.integrators.length} | Discrete: ${program.discreteBlocks.length}`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: Math.max(1, lines[0]?.length ?? 1) },
      },
      children: children.length > 0 ? children : undefined,
    },
  ];
}

function wordAtPosition(line: string, character: number): string {
  const isIdentChar = (c: string) => /[A-Za-z0-9_]/.test(c);
  let start = Math.min(character, line.length);
  while (start > 0 && isIdentChar(line[start - 1]!)) start--;
  let end = start;
  while (end < line.length && isIdentChar(line[end]!)) end++;
  return line.slice(start, end);
}

/**
 * Provides contextual Markdown hover documentation for ACSL operators, states, constants, and sections.
 */
export function getAcslHover(content: string, position: LspPosition, _uri: string = "model.csl"): LspHover | undefined {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line] ?? "";
  const word = wordAtPosition(line, position.character);
  if (!word) return undefined;

  // 1. Check cleanroom stdlib operators
  const opSchema = lookupAcslOperatorSchema(word);
  if (opSchema) {
    const sig = (opSchema.extra?.["signature"] as string | undefined) ?? opSchema.name;
    return {
      contents: {
        kind: "markdown",
        value: `### ACSL Operator \`${opSchema.name}\`\n- **Signature**: \`${sig}\`\n- **Category**: ${opSchema.category}\n- ${opSchema.description}`,
      },
    };
  }

  // 2. Check declared symbols & states in the program
  const program = parseAcsl(content);
  const up = word.toUpperCase();

  const integ = program.integrators.find((i) => i.stateVar.toUpperCase() === up);
  if (integ) {
    return {
      contents: {
        kind: "markdown",
        value: `### Continuous State \`${integ.stateVar}\`\n- **Operator**: \`${integ.operator}\`\n- **Section**: \`${integ.section}\` (line ${integ.line})`,
      },
    };
  }

  const decl = program.declarations.find((d) => d.name.toUpperCase() === up);
  if (decl) {
    return {
      contents: {
        kind: "markdown",
        value: `### ACSL ${decl.kind} \`${decl.name}\`\n- **Declared in**: \`${decl.section}\` (line ${decl.line})`,
      },
    };
  }

  const disc = program.discreteBlocks.find((b) => b.name.toUpperCase() === up);
  if (disc) {
    return {
      contents: {
        kind: "markdown",
        value: `### ACSL DISCRETE Block \`${disc.name}\`\n- **Assignments**: ${disc.assignments.length}\n- **Line**: ${disc.line}`,
      },
    };
  }

  if (ACSL_KEYWORDS.includes(up)) {
    return {
      contents: {
        kind: "markdown",
        value: `### ACSL Keyword \`${up}\`\nStandard ACSL (1975) simulation language directive or section keyword.`,
      },
    };
  }

  return undefined;
}

/**
 * Provides LSP completion items for ACSL keywords, standard library operators, and in-scope symbols.
 */
export function getAcslCompletions(
  content: string,
  position: LspPosition,
  _uri: string = "model.csl",
): LspCompletionItem[] {
  const lines = content.split(/\r?\n/);
  const line = lines[position.line] ?? "";
  const prefix = wordAtPosition(line, position.character).toUpperCase();
  const program = parseAcsl(content);

  const items: LspCompletionItem[] = [];
  const seen = new Set<string>();

  for (const kw of ACSL_KEYWORDS) {
    if (prefix && !kw.startsWith(prefix)) continue;
    seen.add(kw);
    items.push({
      label: kw,
      kind: 14, // Keyword
      detail: "ACSL keyword",
    });
  }

  for (const spec of ACSL_OPERATOR_SPECS) {
    if (prefix && !spec.operatorName.startsWith(prefix)) continue;
    seen.add(spec.operatorName);
    items.push({
      label: spec.operatorName,
      kind: 3, // Function
      detail: spec.signature,
      documentation: spec.description,
    });
  }

  for (const decl of program.declarations) {
    const up = decl.name.toUpperCase();
    if (seen.has(up) || (prefix && !up.startsWith(prefix))) continue;
    seen.add(up);
    items.push({
      label: decl.name,
      kind: decl.kind === "CONSTANT" ? 21 : 6,
      detail: `${decl.kind} (${decl.section})`,
    });
  }

  for (const integ of program.integrators) {
    const up = integ.stateVar.toUpperCase();
    if (seen.has(up) || (prefix && !up.startsWith(prefix))) continue;
    seen.add(up);
    items.push({
      label: integ.stateVar,
      kind: 6, // Variable
      detail: `Continuous state (${integ.operator})`,
    });
  }

  return items;
}

/**
 * Executes domain actions on an ACSL simulation model.
 */
export async function executeAcslAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const program = parseAcsl(content);

  switch (action) {
    case "lint":
      return lintAcsl(program);
    case "to_modelica":
      return acslToModelica(program);
    case "to_dae": {
      const dae = acslToDae(program);
      return { varCount: dae.varCount, eqCount: dae.eqCount };
    }
    case "simulate": {
      const tEnd = typeof args["tEnd"] === "number" ? args["tEnd"] : 10.0;
      const method = args["method"] === "rk45" ? "rk45" : "rk4";
      return simulateAcsl(program, { tEnd, method });
    }
    default:
      throw new Error(`Unknown ACSL action: ${action}`);
  }
}
