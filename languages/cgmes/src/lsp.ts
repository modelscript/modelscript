// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostic validation, CIM hierarchical document symbols,
 * contextual hover tooltips, and intelligent completions for CGMES RDF/XML models.
 */

import { lintCgmesModel } from "./lints/index.js";
import { parseCgmesRdf } from "./parser/cgmes-rdf-parser.js";
import type { CgmesModel } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1: Error, 2: Warning, 3: Info, 4: Hint
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

/**
 * Validates a CGMES RDF/XML document and emits LSP diagnostics.
 */
export function validateCgmes(xmlSource: string): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];
  const lines = xmlSource.split(/\r?\n/);

  let model: CgmesModel;
  try {
    model = parseCgmesRdf(xmlSource);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "C1000",
        source: "cgmes-parser",
        message: `XML Parsing Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawLints = lintCgmesModel(model);
  for (const lint of rawLints) {
    let lineIdx = 0;
    if (lint.mRID) {
      const matchIdx = lines.findIndex((l) => l.includes(lint.mRID!));
      if (matchIdx >= 0) lineIdx = matchIdx;
    }

    let sev: 1 | 2 | 3 | 4 = 1;
    if (lint.severity === "warning") sev = 2;
    else if (lint.severity === "info") sev = 3;

    diags.push({
      range: {
        start: { line: lineIdx, character: 0 },
        end: { line: lineIdx, character: 40 },
      },
      severity: sev,
      code: lint.code,
      source: "cgmes-linter",
      message: lint.message,
    });
  }

  return diags;
}

/**
 * Extracts hierarchical document symbols for substations, voltage levels, lines, transformers, and generators.
 */
export function getCgmesDocumentSymbols(xmlSource: string): LspDocumentSymbol[] {
  const symbols: LspDocumentSymbol[] = [];
  const lines = xmlSource.split(/\r?\n/);

  let model: CgmesModel;
  try {
    model = parseCgmesRdf(xmlSource);
  } catch {
    return symbols;
  }

  const findLine = (needle: string): number => {
    const idx = lines.findIndex((l) => l.includes(needle));
    return idx >= 0 ? idx : 0;
  };

  // 1. Group by Substation
  for (const [subId, sub] of model.substations.entries()) {
    const subLine = findLine(subId);
    const subRange: LspRange = {
      start: { line: subLine, character: 0 },
      end: { line: subLine, character: 20 },
    };

    const vlChildren: LspDocumentSymbol[] = [];

    // Find voltage levels for this substation
    for (const [vlId, vl] of model.voltageLevels.entries()) {
      if (vl.substationId === subId) {
        const vlLine = findLine(vlId);
        const vlRange: LspRange = {
          start: { line: vlLine, character: 0 },
          end: { line: vlLine, character: 20 },
        };

        const eqChildren: LspDocumentSymbol[] = [];

        // Busbars
        for (const [bbId, bb] of model.busbars.entries()) {
          if (bb.voltageLevelId === vlId) {
            const bbLine = findLine(bbId);
            eqChildren.push({
              name: `Busbar: ${bb.name || bbId}`,
              detail: `mRID: ${bbId}`,
              kind: LspSymbolKind.Field,
              range: { start: { line: bbLine, character: 0 }, end: { line: bbLine, character: 20 } },
              selectionRange: { start: { line: bbLine, character: 0 }, end: { line: bbLine, character: 20 } },
            });
          }
        }

        vlChildren.push({
          name: `VoltageLevel ${vl.baseVoltageKv} kV: ${vl.name || vlId}`,
          detail: `${vl.baseVoltageKv} kV`,
          kind: LspSymbolKind.Namespace,
          range: vlRange,
          selectionRange: vlRange,
          children: eqChildren,
        });
      }
    }

    symbols.push({
      name: `Substation: ${sub.name || subId}`,
      detail: sub.region ? `Region: ${sub.region}` : `mRID: ${subId}`,
      kind: LspSymbolKind.Package,
      range: subRange,
      selectionRange: subRange,
      children: vlChildren,
    });
  }

  // 2. Lines
  if (model.lines.size > 0) {
    const lineSymbols: LspDocumentSymbol[] = [];
    for (const [lineId, line] of model.lines.entries()) {
      const lLine = findLine(lineId);
      const lRange: LspRange = {
        start: { line: lLine, character: 0 },
        end: { line: lLine, character: 20 },
      };
      lineSymbols.push({
        name: `ACLine: ${line.name || lineId}`,
        detail: `R=${line.r} Ω, X=${line.x} Ω`,
        kind: LspSymbolKind.Class,
        range: lRange,
        selectionRange: lRange,
      });
    }

    symbols.push({
      name: "Transmission Lines",
      detail: `${model.lines.size} segments`,
      kind: LspSymbolKind.Module,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      children: lineSymbols,
    });
  }

  // 3. Generators
  if (model.generators.size > 0) {
    const genSymbols: LspDocumentSymbol[] = [];
    for (const [genId, gen] of model.generators.entries()) {
      const gLine = findLine(genId);
      const gRange: LspRange = {
        start: { line: gLine, character: 0 },
        end: { line: gLine, character: 20 },
      };
      genSymbols.push({
        name: `Generator: ${gen.name || genId}`,
        detail: `${gen.pMw} MW / ${gen.qMvar} Mvar`,
        kind: LspSymbolKind.Method,
        range: gRange,
        selectionRange: gRange,
      });
    }

    symbols.push({
      name: "Synchronous Machines",
      detail: `${model.generators.size} units`,
      kind: LspSymbolKind.Module,
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } },
      children: genSymbols,
    });
  }

  return symbols;
}

const CIM_CLASS_DOCS: Record<string, string> = {
  Substation: "### `cim:Substation`\nA collection of equipment for step-up or step-down electrical power distribution.",
  VoltageLevel: "### `cim:VoltageLevel`\nA collection of equipment associated with a specific nominal voltage level.",
  ACLineSegment: "### `cim:ACLineSegment`\nA wire or combination of wires with consistent electrical characteristics.",
  PowerTransformer: "### `cim:PowerTransformer`\nAn electrical device consisting of two or more coupled windings.",
  SynchronousMachine:
    "### `cim:SynchronousMachine`\nAn electromechanical device that converts mechanical power to AC electrical power.",
  EnergyConsumer: "### `cim:EnergyConsumer`\nGeneric user of energy - a point of consumption on the power grid.",
  Terminal: "### `cim:Terminal`\nAn electrical connection point to a piece of conducting equipment.",
  TopologicalNode: "### `cim:TopologicalNode`\nA collection of connectivity nodes combined by closed switches.",
};

/**
 * Provides contextual hover details for CIM RDF elements under the cursor.
 */
export function getCgmesHover(xmlSource: string, pos: LspPosition): LspHover | undefined {
  const lines = xmlSource.split(/\r?\n/);
  if (pos.line >= lines.length) return undefined;
  const line = lines[pos.line] ?? "";

  for (const [className, doc] of Object.entries(CIM_CLASS_DOCS)) {
    if (line.includes(`cim:${className}`) || line.includes(`<${className}`)) {
      return {
        contents: {
          kind: "markdown",
          value: doc,
        },
      };
    }
  }

  // Check for mRID
  const mridMatch = line.match(/(?:rdf:ID|rdf:about)="([^"]+)"/);
  if (mridMatch) {
    return {
      contents: {
        kind: "markdown",
        value: `**mRID:** \`${mridMatch[1]}\`\n\n*ENTSO-E Unique Master Resource Identifier*`,
      },
    };
  }

  return undefined;
}

/**
 * Intelligent completion proposals for CGMES XML tags.
 */
export function getCgmesCompletions(_xmlSource: string, _pos: LspPosition): LspCompletionItem[] {
  return [
    {
      label: "cim:Substation",
      kind: 7,
      detail: "Substation container",
      insertText:
        '<cim:Substation rdf:ID="${1:Sub1}">\n\t<cim:IdentifiedObject.name>${2:Substation 1}</cim:IdentifiedObject.name>\n</cim:Substation>',
    },
    { label: "cim:VoltageLevel", kind: 7, detail: "Voltage level container" },
    { label: "cim:ACLineSegment", kind: 7, detail: "AC transmission line segment" },
    { label: "cim:PowerTransformer", kind: 7, detail: "Two/Three-winding power transformer" },
    { label: "cim:SynchronousMachine", kind: 7, detail: "Synchronous generator or condenser" },
    { label: "cim:EnergyConsumer", kind: 7, detail: "Active and reactive power load" },
    { label: "cim:Terminal", kind: 7, detail: "Conducting equipment terminal connection" },
    { label: "cim:TopologicalNode", kind: 7, detail: "Bus-branch topological node" },
  ];
}

/**
 * Unified CGMES Language Server Protocol Service.
 */
export class CgmesLspService {
  validate(xmlSource: string): LspDiagnostic[] {
    return validateCgmes(xmlSource);
  }

  getDocumentSymbols(xmlSource: string): LspDocumentSymbol[] {
    return getCgmesDocumentSymbols(xmlSource);
  }

  getHover(xmlSource: string, pos: LspPosition): LspHover | undefined {
    return getCgmesHover(xmlSource, pos);
  }

  getCompletions(xmlSource: string, pos: LspPosition): LspCompletionItem[] {
    return getCgmesCompletions(xmlSource, pos);
  }
}
