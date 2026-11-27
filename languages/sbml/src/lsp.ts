// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseXmlSync, type XmlElement } from "@modelscript/dsl/xml";
import { lowerSbmlToDae } from "./dae/sbml-to-dae.js";
import { lintSbml } from "./lints/index.js";
import { parseSbml } from "./parser/sbml-parser.js";
import { sbmlToModelica } from "./projections/sbml-to-modelica.js";
import { solveReactions, type ReactionSolverOptions } from "./solvers/reaction-solver.js";

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

export function validateSbml(text: string, cstTree?: { rootNode?: unknown } | null): LspDiagnostic[] {
  try {
    const doc = parseSbml(text, undefined, { cstTree });
    const diags = lintSbml(doc);

    return diags.map((d) => {
      const line = d.range ? Math.max(0, d.range.startLine - 1) : 0;
      const col = d.range ? Math.max(0, d.range.startColumn - 1) : 0;
      const endLine = d.range ? Math.max(0, d.range.endLine - 1) : line;
      const endCol = d.range ? Math.max(0, d.range.endColumn - 1) : col + 10;

      let sev: 1 | 2 | 3 = 1;
      if (d.severity === "warning") sev = 2;
      if (d.severity === "info") sev = 3;

      return {
        range: {
          start: { line, character: col },
          end: { line: endLine, character: endCol },
        },
        severity: sev,
        code: `M${d.code}`,
        source: "sbml-linter",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8800",
        source: "sbml-parser",
        message: `SBML parse error: ${errMsg}`,
      },
    ];
  }
}

export function getSbmlDocumentSymbols(text: string): LspDocumentSymbol[] {
  const doc = parseSbml(text);
  const model = doc.model;
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const children: LspDocumentSymbol[] = [];

  // Species
  for (const s of model.species.values()) {
    const startLine = s.range ? Math.max(0, s.range.startLine - 1) : 0;
    const endLine = s.range ? Math.max(0, s.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const conc = s.initialConcentration ?? s.initialAmount ?? 0;
    children.push({
      name: s.id,
      detail: `Species (${s.compartment}) [${conc}]`,
      kind: LspSymbolKind.Variable,
      range: r,
      selectionRange: r,
    });
  }

  // Reactions
  for (const rxn of model.reactions.values()) {
    const startLine = rxn.range ? Math.max(0, rxn.range.startLine - 1) : 0;
    const endLine = rxn.range ? Math.max(0, rxn.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const reactStr = rxn.reactants.map((ref) => ref.species).join(" + ");
    const prodStr = rxn.products.map((ref) => ref.species).join(" + ");
    const arrow = rxn.reversible ? "<->" : "->";
    children.push({
      name: rxn.id,
      detail: `${reactStr} ${arrow} ${prodStr}`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  symbols.push({
    name: model.id || "SbmlModel",
    detail: `SBML L${doc.level}v${doc.version} Model (${model.species.size} species, ${model.reactions.size} reactions)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children,
  });

  return symbols;
}

function computeLineBounds(text: string, targetLine: number): { lineStart: number; lineEnd: number } {
  let line = 0;
  let lineStart = 0;
  const len = text.length;

  for (let i = 0; i < len; i++) {
    if (line === targetLine) {
      let lineEnd = i;
      while (lineEnd < len && text.charCodeAt(lineEnd) !== 10 && text.charCodeAt(lineEnd) !== 13) {
        lineEnd++;
      }
      return { lineStart, lineEnd };
    }
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }

  return { lineStart, lineEnd: len };
}

function getXmlAttrValue(elem: XmlElement, attrNameLower: string): string | undefined {
  for (const attr of elem.attributes) {
    if (attr.name.toLowerCase() === attrNameLower) {
      return attr.value;
    }
  }
  return undefined;
}

function findDeepestElementAtOffset(root: XmlElement, offset: number): XmlElement | null {
  if (offset < root.start || offset > root.end) return null;
  let current: XmlElement = root;
  while (true) {
    let next: XmlElement | null = null;
    for (const child of current.children) {
      if (offset >= child.start && offset <= child.end) {
        next = child;
        break;
      }
    }
    if (!next) return current;
    current = next;
  }
}

function findElementStartingOnLine(root: XmlElement, lineStart: number, lineEnd: number): XmlElement | null {
  const stack: XmlElement[] = [root];
  while (stack.length > 0) {
    const elem = stack.pop();
    if (!elem) continue;
    if (elem.start >= lineStart && elem.start <= lineEnd) {
      const tag = elem.name.toLowerCase();
      if (tag === "species" || tag === "speciesreference" || tag === "modifierspeciesreference" || tag === "reaction") {
        return elem;
      }
    }
    for (let i = elem.children.length - 1; i >= 0; i--) {
      const child = elem.children[i];
      if (child) stack.push(child);
    }
  }
  return null;
}

export function getSbmlHover(text: string, position: LspPosition): LspHover | null {
  const doc = parseSbml(text);
  const model = doc.model;
  const xmlDoc = parseXmlSync(text);
  if (!xmlDoc.root) return null;

  const { lineStart, lineEnd } = computeLineBounds(text, position.line);
  const offset = Math.min(lineStart + Math.max(0, position.character), lineEnd);

  const exactElem = findDeepestElementAtOffset(xmlDoc.root, offset);
  const lineElem = findElementStartingOnLine(xmlDoc.root, lineStart, lineEnd);

  const candidates: XmlElement[] = [];
  if (exactElem) candidates.push(exactElem);
  if (lineElem && lineElem !== exactElem) candidates.push(lineElem);

  for (const elem of candidates) {
    const tag = elem.name.toLowerCase();
    const idVal = getXmlAttrValue(elem, "id");
    const speciesVal = getXmlAttrValue(elem, "species");

    if (tag === "species" && idVal) {
      const s = model.species.get(idVal);
      if (s) {
        return {
          contents: {
            kind: "markdown",
            value: [
              `### SBML Species: **${s.id}** ${s.name ? `(${s.name})` : ""}`,
              `- **Compartment:** \`${s.compartment}\``,
              `- **Initial Quantity:** ${s.initialConcentration ?? s.initialAmount ?? 0}`,
              `- **Boundary Condition:** \`${s.boundaryCondition}\``,
              `- **Constant:** \`${s.constant}\``,
            ].join("\n"),
          },
        };
      }
    }

    if ((tag === "speciesreference" || tag === "modifierspeciesreference") && speciesVal) {
      const s = model.species.get(speciesVal);
      if (s) {
        return {
          contents: {
            kind: "markdown",
            value: [
              `### SBML Species: **${s.id}** ${s.name ? `(${s.name})` : ""}`,
              `- **Compartment:** \`${s.compartment}\``,
              `- **Initial Quantity:** ${s.initialConcentration ?? s.initialAmount ?? 0}`,
              `- **Boundary Condition:** \`${s.boundaryCondition}\``,
              `- **Constant:** \`${s.constant}\``,
            ].join("\n"),
          },
        };
      }
    }

    if (tag === "reaction" && idVal) {
      const r = model.reactions.get(idVal);
      if (r) {
        const reactStr = r.reactants
          .map((ref) => `${ref.stoichiometry > 1 ? ref.stoichiometry : ""}${ref.species}`)
          .join(" + ");
        const prodStr = r.products
          .map((ref) => `${ref.stoichiometry > 1 ? ref.stoichiometry : ""}${ref.species}`)
          .join(" + ");
        return {
          contents: {
            kind: "markdown",
            value: [
              `### SBML Reaction: **${r.id}** ${r.name ? `(${r.name})` : ""}`,
              `- **Stoichiometry:** ${reactStr} ${r.reversible ? "<=>" : "=>"} ${prodStr}`,
              `- **Reversible:** \`${r.reversible}\``,
              r.kineticLaw ? `- **Kinetic Law:** \`${r.kineticLaw.formula}\`` : "- **Kinetic Law:** None",
            ].join("\n"),
          },
        };
      }
    }
  }

  return null;
}

export interface SbmlActionParams {
  options?: ReactionSolverOptions | undefined;
  modelName?: string | undefined;
}

export type SbmlActionResult =
  | ReturnType<typeof lintSbml>
  | ReturnType<typeof solveReactions>
  | { modelName: string; variableCount: number; equationCount: number }
  | string;

export async function executeSbmlAction(
  action: "lint_sbml",
  text: string,
  params?: SbmlActionParams,
): Promise<ReturnType<typeof lintSbml>>;
export async function executeSbmlAction(
  action: "sbml_simulate",
  text: string,
  params?: SbmlActionParams,
): Promise<ReturnType<typeof solveReactions>>;
export async function executeSbmlAction(
  action: "sbml_to_dae",
  text: string,
  params?: SbmlActionParams,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeSbmlAction(
  action: "sbml_to_modelica",
  text: string,
  params?: SbmlActionParams,
): Promise<string>;
export async function executeSbmlAction(
  action: string,
  text: string,
  params?: SbmlActionParams,
): Promise<SbmlActionResult>;
export async function executeSbmlAction(
  action: string,
  text: string,
  params?: SbmlActionParams,
): Promise<SbmlActionResult> {
  const doc = parseSbml(text);

  switch (action) {
    case "lint_sbml":
      return lintSbml(doc);

    case "sbml_simulate":
      return solveReactions(doc, params?.options);

    case "sbml_to_dae": {
      const dae = lowerSbmlToDae(doc);
      return {
        modelName: doc.model.id || "SbmlModel",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "sbml_to_modelica":
      return sbmlToModelica(doc, params?.modelName);

    default:
      throw new Error(`Unknown SBML action: ${action}`);
  }
}
