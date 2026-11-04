// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, hierarchical document symbols, physical SI dimension vector hover cards,
 * completions, go-to-definition, and custom action execution.
 */

import { lowerCellmlToDae } from "./dae/index.js";
import { formatDimensionVector, lintCellmlDocument } from "./lints/index.js";
import { BUILTIN_CELLML_UNITS, parseCellml, resolveUnitDimensions } from "./parser/index.js";
import { cellmlToModelica, cellmlToSbml } from "./projections/index.js";
import { solveCellml, type CellmlSimulationResult, type CellmlSolverOptions } from "./solvers/index.js";
import type { CellmlDiagnostic, CellmlDocument, CellmlSourceRange } from "./types.js";

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
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
  code: string | number;
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

function toLspRange(r: CellmlSourceRange): LspRange {
  return {
    start: {
      line: Math.max(0, r.startLine - 1),
      character: Math.max(0, r.startColumn - 1),
    },
    end: {
      line: Math.max(0, r.endLine - 1),
      character: Math.max(0, r.endColumn - 1),
    },
  };
}

export function validateCellml(content: string): LspDiagnostic[] {
  let doc: CellmlDocument;
  try {
    doc = parseCellml(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        severity: 1,
        code: "M9300",
        source: "cellml-parser",
        message: `CellML parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const diags = lintCellmlDocument(doc);
  return diags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "cellml-linter",
      message: d.message,
    };
  });
}

export function getCellmlDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: CellmlDocument;
  try {
    doc = parseCellml(content);
  } catch {
    return [];
  }

  const rootRange: LspRange = doc.range
    ? toLspRange(doc.range)
    : {
        start: { line: 0, character: 0 },
        end: { line: content.split("\n").length, character: 0 },
      };

  const modelChildren: LspDocumentSymbol[] = [];

  for (const u of doc.units.values()) {
    const r = toLspRange(u.range);
    modelChildren.push({
      name: u.name,
      detail: `Units (${formatDimensionVector(u.dimensions)})`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const comp of doc.components.values()) {
    const compRange = toLspRange(comp.range);
    const compChildren: LspDocumentSymbol[] = [];

    for (const v of comp.variables.values()) {
      const vr = toLspRange(v.range);
      compChildren.push({
        name: v.name,
        detail: `${v.units}${v.initialValue !== undefined ? ` = ${v.initialValue}` : ""}`,
        kind: LspSymbolKind.Variable,
        range: vr,
        selectionRange: vr,
      });
    }

    for (const eq of comp.equations) {
      const er = toLspRange(eq.range);
      const lhs = eq.isOde ? `d(${eq.targetVariable})/d(${eq.independentVariable ?? "t"})` : eq.targetVariable;
      compChildren.push({
        name: lhs,
        detail: `= ${eq.rhsExpression}`,
        kind: LspSymbolKind.Function,
        range: er,
        selectionRange: er,
      });
    }

    modelChildren.push({
      name: comp.name,
      detail: `Component (${comp.variables.size} vars, ${comp.equations.length} eqs)`,
      kind: LspSymbolKind.Module,
      range: compRange,
      selectionRange: compRange,
      children: compChildren,
    });
  }

  return [
    {
      name: doc.name || "CellmlModel",
      detail: `CellML ${doc.version} Model (${doc.components.size} components, ${doc.connections.length} connections)`,
      kind: LspSymbolKind.Package,
      range: rootRange,
      selectionRange: rootRange,
      children: modelChildren,
    },
  ];
}

function positionOrOffsetToOffset(content: string, posOrOffset: number | LspPosition): number {
  if (typeof posOrOffset === "number") return posOrOffset;
  const lines = content.split("\n");
  let offset = 0;
  for (let i = 0; i < posOrOffset.line && i < lines.length; i++) {
    offset += (lines[i]?.length ?? 0) + 1;
  }
  return offset + posOrOffset.character;
}

export function getCellmlHover(content: string, posOrOffset: number | LspPosition): LspHover | null {
  let doc: CellmlDocument;
  try {
    doc = parseCellml(content);
  } catch {
    return null;
  }

  const offset = positionOrOffsetToOffset(content, posOrOffset);

  for (const comp of doc.components.values()) {
    for (const v of comp.variables.values()) {
      if (offset >= v.range.startOffset && offset <= v.range.endOffset) {
        const dim = resolveUnitDimensions(v.units, doc.units);
        const dimText = dim ? formatDimensionVector(dim) : "unresolved";
        const lines = [
          `### CellML Variable: **${comp.name}.${v.name}**`,
          `- **Units:** \`${v.units}\` (${dimText})`,
          v.initialValue !== undefined ? `- **Initial Value:** \`${v.initialValue}\`` : "",
          `- **Public Interface:** \`${v.publicInterface}\``,
          `- **Private Interface:** \`${v.privateInterface}\``,
        ].filter(Boolean);

        return {
          contents: {
            kind: "markdown",
            value: lines.join("\n"),
          },
          range: toLspRange(v.range),
        };
      }
    }

    for (const eq of comp.equations) {
      if (offset >= eq.range.startOffset && offset <= eq.range.endOffset) {
        const lhs = eq.isOde ? `d(${eq.targetVariable})/d(${eq.independentVariable ?? "t"})` : eq.targetVariable;
        return {
          contents: {
            kind: "markdown",
            value: [
              `### CellML ${eq.isOde ? "Differential (ODE)" : "Algebraic"} Equation`,
              `- **Component:** \`${comp.name}\``,
              `- **Equation:** \`${lhs} = ${eq.rhsExpression}\``,
              eq.referencedIdentifiers.length > 0
                ? `- **Referenced Variables:** \`${eq.referencedIdentifiers.join(", ")}\``
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
          range: toLspRange(eq.range),
        };
      }
    }

    if (offset >= comp.range.startOffset && offset <= comp.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### CellML Component: **${comp.name}**`,
            `- **Variables:** ${comp.variables.size}`,
            `- **Equations:** ${comp.equations.length}`,
          ].join("\n"),
        },
        range: toLspRange(comp.range),
      };
    }
  }

  for (const u of doc.units.values()) {
    if (offset >= u.range.startOffset && offset <= u.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### CellML Units: **${u.name}**`,
            `- **SI Base Dimensions:** \`${formatDimensionVector(u.dimensions)}\``,
            `- **Log10 Scale Multiplier:** \`10^${u.dimensions.multiplierScale}\``,
          ].join("\n"),
        },
        range: toLspRange(u.range),
      };
    }
  }

  return null;
}

export function getCellmlCompletions(content: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "component",
      kind: 14,
      detail: "CellML <component> element",
      insertText:
        '<component name="membrane">\n  <variable name="V" units="millivolt" initial_value="-75.0" public_interface="out"/>\n</component>',
    },
    {
      label: "variable",
      kind: 14,
      detail: "CellML <variable> declaration",
      insertText: '<variable name="V" units="millivolt" initial_value="-75.0" public_interface="out"/>',
    },
    {
      label: "units",
      kind: 14,
      detail: "CellML <units> definition",
      insertText: '<units name="millivolt">\n  <unit units="volt" prefix="milli"/>\n</units>',
    },
    {
      label: "connection",
      kind: 14,
      detail: "CellML <connection> mapping",
      insertText:
        '<connection>\n  <map_components component_1="comp1" component_2="comp2"/>\n  <map_variables variable_1="V" variable_2="V"/>\n</connection>',
    },
    {
      label: "encapsulation",
      kind: 14,
      detail: "CellML <group> encapsulation hierarchy",
      insertText:
        '<group>\n  <relationship_ref relationship="encapsulation"/>\n  <component_ref component="parent">\n    <component_ref component="child"/>\n  </component_ref>\n</group>',
    },
  ];

  for (const unitName of BUILTIN_CELLML_UNITS.keys()) {
    items.push({
      label: unitName,
      kind: 21,
      detail: `Built-in CellML / SI unit (${unitName})`,
    });
  }

  try {
    const doc = parseCellml(content);
    for (const u of doc.units.values()) {
      items.push({
        label: u.name,
        kind: 21,
        detail: `Custom CellML unit (${formatDimensionVector(u.dimensions)})`,
      });
    }
    for (const comp of doc.components.values()) {
      items.push({
        label: comp.name,
        kind: 9,
        detail: `Component ${comp.name} (${comp.variables.size} variables)`,
      });
      for (const v of comp.variables.values()) {
        items.push({
          label: v.name,
          kind: 6,
          detail: `Variable ${comp.name}.${v.name} [${v.units}]`,
        });
      }
    }
  } catch {
    // Ignore parse errors during completion
  }

  return items;
}

function extractWordAtOffset(text: string, offset: number): string {
  if (offset < 0 || offset > text.length) return "";
  const isWordChar = (ch: string | undefined) => Boolean(ch && /[A-Za-z0-9_-]/.test(ch));
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isWordChar(text[end])) end++;
  return text.slice(start, end);
}

export function getCellmlDefinition(
  content: string,
  posOrOffset: number | LspPosition,
  uri = "file:///model.cellml",
): LspLocation | null {
  let doc: CellmlDocument;
  try {
    doc = parseCellml(content, uri);
  } catch {
    return null;
  }

  const offset = positionOrOffsetToOffset(content, posOrOffset);
  const word = extractWordAtOffset(content, offset);
  if (!word) return null;

  const comp = doc.components.get(word);
  if (comp) {
    return { uri, range: toLspRange(comp.range) };
  }

  const unit = doc.units.get(word);
  if (unit) {
    return { uri, range: toLspRange(unit.range) };
  }

  // Search variable in enclosing component first, then globally
  for (const c of doc.components.values()) {
    if (offset >= c.range.startOffset && offset <= c.range.endOffset) {
      const localVar = c.variables.get(word);
      if (localVar) {
        return { uri, range: toLspRange(localVar.range) };
      }
    }
  }

  for (const c of doc.components.values()) {
    const v = c.variables.get(word);
    if (v) {
      return { uri, range: toLspRange(v.range) };
    }
  }

  return null;
}

export async function executeCellmlAction(
  actionId: "cellml_lint",
  content: string,
  params?: Record<string, unknown>,
): Promise<CellmlDiagnostic[]>;
export async function executeCellmlAction(
  actionId: "cellml_simulate",
  content: string,
  params?: { options?: CellmlSolverOptions },
): Promise<CellmlSimulationResult>;
export async function executeCellmlAction(
  actionId: "cellml_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeCellmlAction(
  actionId: "cellml_to_modelica" | "cellml_to_sbml",
  content: string,
  params?: Record<string, unknown>,
): Promise<string>;
export async function executeCellmlAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export async function executeCellmlAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const doc = parseCellml(content);

  switch (actionId) {
    case "cellml_lint":
      return lintCellmlDocument(doc);

    case "cellml_simulate":
      return solveCellml(doc, params?.["options"] as CellmlSolverOptions | undefined);

    case "cellml_to_dae": {
      const dae = lowerCellmlToDae(doc);
      return {
        modelName: doc.name || "CellmlModel",
        variableCount: dae.getVarCount(),
        equationCount: dae.getEqCount(),
      };
    }

    case "cellml_to_modelica":
      return cellmlToModelica(doc);

    case "cellml_to_sbml":
      return cellmlToSbml(doc);

    default:
      throw new Error(`Unknown CellML action: ${actionId}`);
  }
}
