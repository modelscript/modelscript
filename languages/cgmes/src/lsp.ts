// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cgmes — Language Server Protocol (LSP) Service Integration.
 *
 * Provides diagnostic validation, CIM hierarchical document symbols,
 * contextual hover tooltips, and intelligent completions for CGMES RDF/XML models.
 */

import {
  offsetToLspPosition,
  parseXmlSync,
  xmlErrorToLspRange,
  type XmlAttribute,
  type XmlElement,
} from "@modelscript/dsl/xml";
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

interface CgmesXmlMridEntry {
  elem: XmlElement;
  attr?: XmlAttribute | undefined;
}

interface CgmesXmlIndex {
  root: XmlElement | null;
  byMrid: Map<string, CgmesXmlMridEntry>;
}

function buildCgmesXmlIndex(xmlSource: string): {
  index: CgmesXmlIndex;
  errors: ReturnType<typeof parseXmlSync>["errors"];
} {
  const xmlDoc = parseXmlSync(xmlSource);
  const byMrid = new Map<string, CgmesXmlMridEntry>();

  if (xmlDoc.root) {
    const stack: XmlElement[] = [xmlDoc.root];
    while (stack.length > 0) {
      const elem = stack.pop()!;
      for (const attr of elem.attributes) {
        const lower = attr.name.toLowerCase();
        if (lower === "rdf:id" || lower === "rdf:about" || lower === "id") {
          const val = attr.value.trim();
          const stripped = val.startsWith("#") ? val.slice(1) : val;
          if (val && !byMrid.has(val)) byMrid.set(val, { elem, attr });
          if (stripped && !byMrid.has(stripped)) byMrid.set(stripped, { elem, attr });
        }
      }
      for (let i = elem.children.length - 1; i >= 0; i--) {
        stack.push(elem.children[i]!);
      }
    }
  }

  return { index: { root: xmlDoc.root, byMrid }, errors: xmlDoc.errors };
}

function xmlElementRange(source: string, elem: XmlElement): LspRange {
  return {
    start: offsetToLspPosition(source, elem.start),
    end: offsetToLspPosition(source, Math.max(elem.start + 1, elem.end)),
  };
}

function xmlOpenTagRange(source: string, elem: XmlElement): LspRange {
  return {
    start: offsetToLspPosition(source, elem.start),
    end: offsetToLspPosition(source, Math.max(elem.start + 1, elem.openEnd)),
  };
}

/**
 * Validates a CGMES RDF/XML document and emits LSP diagnostics.
 */
export function validateCgmes(xmlSource: string): LspDiagnostic[] {
  const diags: LspDiagnostic[] = [];
  const { index, errors } = buildCgmesXmlIndex(xmlSource);

  let model: CgmesModel;
  try {
    model = parseCgmesRdf(xmlSource);
  } catch (err: unknown) {
    const range =
      errors.length > 0
        ? xmlErrorToLspRange(xmlSource, errors[0]!)
        : {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          };
    return [
      {
        range,
        severity: 1,
        code: "C1000",
        source: "cgmes-parser",
        message: `XML Parsing Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const fallbackRange: LspRange = index.root
    ? xmlOpenTagRange(xmlSource, index.root)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };

  const rawLints = lintCgmesModel(model);
  for (const lint of rawLints) {
    let range: LspRange = fallbackRange;
    if (lint.mRID) {
      const stripped = lint.mRID.startsWith("#") ? lint.mRID.slice(1) : lint.mRID;
      const entry = index.byMrid.get(lint.mRID) ?? index.byMrid.get(stripped);
      if (entry) {
        if (entry.attr) {
          range = {
            start: offsetToLspPosition(xmlSource, entry.attr.valueStart),
            end: offsetToLspPosition(xmlSource, Math.max(entry.attr.valueStart + 1, entry.attr.valueEnd)),
          };
        } else {
          range = xmlOpenTagRange(xmlSource, entry.elem);
        }
      }
    }

    let sev: 1 | 2 | 3 | 4 = 1;
    if (lint.severity === "warning") sev = 2;
    else if (lint.severity === "info") sev = 3;

    diags.push({
      range,
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
  const { index } = buildCgmesXmlIndex(xmlSource);

  let model: CgmesModel;
  try {
    model = parseCgmesRdf(xmlSource);
  } catch {
    return symbols;
  }

  const defaultRange: LspRange = index.root
    ? xmlOpenTagRange(xmlSource, index.root)
    : { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } };

  const lookupRange = (mrid: string): { range: LspRange; selectionRange: LspRange } => {
    const stripped = mrid.startsWith("#") ? mrid.slice(1) : mrid;
    const entry = index.byMrid.get(mrid) ?? index.byMrid.get(stripped);
    if (!entry) return { range: defaultRange, selectionRange: defaultRange };
    return {
      range: xmlElementRange(xmlSource, entry.elem),
      selectionRange: xmlOpenTagRange(xmlSource, entry.elem),
    };
  };

  // 1. Group by Substation
  for (const [subId, sub] of model.substations.entries()) {
    const subLoc = lookupRange(subId);

    const vlChildren: LspDocumentSymbol[] = [];

    // Find voltage levels for this substation
    for (const [vlId, vl] of model.voltageLevels.entries()) {
      if (vl.substationId === subId) {
        const vlLoc = lookupRange(vlId);

        const eqChildren: LspDocumentSymbol[] = [];

        // Busbars
        for (const [bbId, bb] of model.busbars.entries()) {
          if (bb.voltageLevelId === vlId) {
            const bbLoc = lookupRange(bbId);
            eqChildren.push({
              name: `Busbar: ${bb.name || bbId}`,
              detail: `mRID: ${bbId}`,
              kind: LspSymbolKind.Field,
              range: bbLoc.range,
              selectionRange: bbLoc.selectionRange,
            });
          }
        }

        vlChildren.push({
          name: `VoltageLevel ${vl.baseVoltageKv} kV: ${vl.name || vlId}`,
          detail: `${vl.baseVoltageKv} kV`,
          kind: LspSymbolKind.Namespace,
          range: vlLoc.range,
          selectionRange: vlLoc.selectionRange,
          children: eqChildren,
        });
      }
    }

    symbols.push({
      name: `Substation: ${sub.name || subId}`,
      detail: sub.region ? `Region: ${sub.region}` : `mRID: ${subId}`,
      kind: LspSymbolKind.Package,
      range: subLoc.range,
      selectionRange: subLoc.selectionRange,
      children: vlChildren,
    });
  }

  // 2. Lines
  if (model.lines.size > 0) {
    const lineSymbols: LspDocumentSymbol[] = [];
    for (const [lineId, line] of model.lines.entries()) {
      const lLoc = lookupRange(lineId);
      lineSymbols.push({
        name: `ACLine: ${line.name || lineId}`,
        detail: `R=${line.r} Ω, X=${line.x} Ω`,
        kind: LspSymbolKind.Class,
        range: lLoc.range,
        selectionRange: lLoc.selectionRange,
      });
    }

    symbols.push({
      name: "Transmission Lines",
      detail: `${model.lines.size} segments`,
      kind: LspSymbolKind.Module,
      range: defaultRange,
      selectionRange: defaultRange,
      children: lineSymbols,
    });
  }

  // 3. Generators
  if (model.generators.size > 0) {
    const genSymbols: LspDocumentSymbol[] = [];
    for (const [genId, gen] of model.generators.entries()) {
      const gLoc = lookupRange(genId);
      genSymbols.push({
        name: `Generator: ${gen.name || genId}`,
        detail: `${gen.pMw} MW / ${gen.qMvar} Mvar`,
        kind: LspSymbolKind.Method,
        range: gLoc.range,
        selectionRange: gLoc.selectionRange,
      });
    }

    symbols.push({
      name: "Synchronous Machines",
      detail: `${model.generators.size} units`,
      kind: LspSymbolKind.Module,
      range: defaultRange,
      selectionRange: defaultRange,
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

function computeLineBounds(text: string, targetLine: number): { lineStart: number; lineEnd: number } | null {
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

  return line === targetLine ? { lineStart, lineEnd: len } : null;
}

function findDeepestXmlElementAtOffset(root: XmlElement, offset: number): XmlElement | null {
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

function findXmlElementsStartingOnLine(root: XmlElement, lineStart: number, lineEnd: number): XmlElement[] {
  const hits: XmlElement[] = [];
  const stack: XmlElement[] = [root];
  while (stack.length > 0) {
    const elem = stack.pop()!;
    if (elem.start >= lineStart && elem.start <= lineEnd) {
      hits.push(elem);
    }
    for (let i = elem.children.length - 1; i >= 0; i--) {
      stack.push(elem.children[i]!);
    }
  }
  return hits;
}

/**
 * Provides contextual hover details for CIM RDF elements under the cursor.
 */
export function getCgmesHover(xmlSource: string, pos: LspPosition): LspHover | undefined {
  const bounds = computeLineBounds(xmlSource, pos.line);
  if (!bounds) return undefined;

  const xmlDoc = parseXmlSync(xmlSource);
  if (!xmlDoc.root) return undefined;

  const offset = Math.min(bounds.lineStart + Math.max(0, pos.character), bounds.lineEnd);
  const candidates: XmlElement[] = [];
  const exactElem = findDeepestXmlElementAtOffset(xmlDoc.root, offset);
  if (exactElem) candidates.push(exactElem);
  for (const lineElem of findXmlElementsStartingOnLine(xmlDoc.root, bounds.lineStart, bounds.lineEnd)) {
    if (!candidates.includes(lineElem)) candidates.push(lineElem);
  }

  for (const elem of candidates) {
    const colonIdx = elem.name.indexOf(":");
    const localName = colonIdx >= 0 ? elem.name.slice(colonIdx + 1) : elem.name;
    const doc = CIM_CLASS_DOCS[localName];
    if (doc) {
      return {
        contents: {
          kind: "markdown",
          value: doc,
        },
      };
    }
  }

  // Check for mRID attribute (rdf:ID or rdf:about)
  for (const elem of candidates) {
    for (const attr of elem.attributes) {
      const lower = attr.name.toLowerCase();
      if (lower === "rdf:id" || lower === "rdf:about") {
        return {
          contents: {
            kind: "markdown",
            value: `**mRID:** \`${attr.value}\`\n\n*ENTSO-E Unique Master Resource Identifier*`,
          },
        };
      }
    }
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
