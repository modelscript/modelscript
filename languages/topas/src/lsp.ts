// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/topas — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, document symbols, Bragg peak depth-dose hover telemetry,
 * completions, go-to-definition, and custom TOPAS / GATE action execution.
 */

import { BUILTIN_GEANT4_NIST_MATERIALS, lintTopasDocument } from "./lints/rules.js";
import { parseTopas } from "./parser/index.js";
import { type BraggPeakResult, computeBraggPeakDepthDose, lowerTopasToDae } from "./physics/index.js";
import { topasToModelica, topasToScad } from "./projections/index.js";
import type { TopasDiagnostic, TopasDocument, TopasSourceRange } from "./types.js";

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

function toLspRange(r: TopasSourceRange): LspRange {
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

export function validateTopas(content: string, sourceUri?: string): LspDiagnostic[] {
  let doc: TopasDocument;
  try {
    doc = parseTopas(content, sourceUri);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M9600",
        source: "topas-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintTopasDocument(doc);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "topas-linter",
      message: d.message,
    };
  });
}

export function getTopasDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: TopasDocument;
  try {
    doc = parseTopas(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const comp of doc.components) {
    const r = toLspRange(comp.range);
    symbols.push({
      name: `Ge/${comp.name}`,
      detail: `${comp.type} (${comp.material ?? "default"}, parent=${comp.parent ?? "World"})`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const src of doc.sources) {
    const r = toLspRange(src.range);
    symbols.push({
      name: `So/${src.name}`,
      detail: `${src.beamParticle}${src.beamEnergy !== undefined ? ` @ ${src.beamEnergy} MeV` : ""}`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  for (const sc of doc.scorers) {
    const r = toLspRange(sc.range);
    symbols.push({
      name: `Sc/${sc.name}`,
      detail: `${sc.quantity ?? "Unknown"} on ${sc.component ?? "Unbound"}`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  for (const mat of doc.materials) {
    const r = toLspRange(mat.range);
    symbols.push({
      name: `Ma/${mat.name}`,
      detail: mat.density !== undefined ? `${mat.density} g/cm3` : "Custom Material",
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

export function getTopasHover(content: string, offset: number): LspHover | null {
  let doc: TopasDocument;
  try {
    doc = parseTopas(content);
  } catch {
    return null;
  }

  const word = extractWordAtOffset(content, offset);

  for (const src of doc.sources) {
    if ((offset >= src.range.startOffset && offset <= src.range.endOffset) || word === src.name) {
      const bragg = computeBraggPeakDepthDose({
        energyMeV: src.beamEnergy && src.beamEnergy > 0 ? src.beamEnergy : 150.0,
        energySpreadPercent: src.beamEnergySpread && src.beamEnergySpread >= 0 ? src.beamEnergySpread : 0.5,
        particle: src.beamParticle,
      });
      const lines = [
        `### Particle Source: **So/${src.name}**`,
        `* **Particle:** \`${src.beamParticle}\` (${src.type})`,
        `* **Beam Energy:** \`${src.beamEnergy ?? 150.0} MeV\` (Spread: \`${src.beamEnergySpread ?? 0.5}%\`)`,
        `* **Bragg Peak Range ($R_0$ in Water):** \`${bragg.projectedRangeMm} mm\` (\`${bragg.projectedRangeCm} cm\`)`,
        `* **Distal 80% Depth ($R_{80}$):** \`${bragg.distal80DepthMm} mm\``,
        `* **Range Straggling ($\\sigma_R$):** \`${bragg.rangeStragglingMm} mm\``,
        `* **Peak-to-Entrance Ratio:** \`${bragg.peakToEntranceRatio}\``,
      ];
      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(src.range),
      };
    }
  }

  for (const comp of doc.components) {
    if ((offset >= comp.range.startOffset && offset <= comp.range.endOffset) || word === comp.name) {
      const lines = [
        `### Geometry Component: **Ge/${comp.name}**`,
        `* **Type:** \`${comp.type}\``,
        `* **Parent Volume:** \`${comp.parent ?? "World"}\``,
        `* **Material:** \`${comp.material ?? "G4_AIR"}\``,
        comp.hlx !== undefined
          ? `* **Half-Lengths (X, Y, Z):** \`(${comp.hlx}, ${comp.hly ?? 0}, ${comp.hlz ?? 0}) mm\``
          : "",
        comp.rMax !== undefined
          ? `* **Radius (RMin, RMax, HL):** \`(${comp.rMin ?? 0}, ${comp.rMax}, ${comp.hl ?? 0}) mm\``
          : "",
      ].filter(Boolean);
      return {
        contents: {
          kind: "markdown",
          value: lines.join("\n"),
        },
        range: toLspRange(comp.range),
      };
    }
  }

  for (const sc of doc.scorers) {
    if ((offset >= sc.range.startOffset && offset <= sc.range.endOffset) || word === sc.name) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Dosimetry Scorer: **Sc/${sc.name}**`,
            `* **Quantity:** \`${sc.quantity ?? "Unspecified"}\``,
            `* **Target Component:** \`${sc.component ?? "Unspecified"}\``,
          ].join("\n"),
        },
        range: toLspRange(sc.range),
      };
    }
  }

  return null;
}

export function getTopasCompletions(content: string, _offset?: number): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "s:Ge/WaterPhantom/Type",
      kind: 14,
      detail: "TOPAS Box Geometry Component",
      insertText: 's:Ge/WaterPhantom/Type = "TsBox"',
    },
    {
      label: "d:So/ProtonBeam/BeamEnergy",
      kind: 14,
      detail: "TOPAS Beam Energy (MeV)",
      insertText: "d:So/ProtonBeam/BeamEnergy = 150.0 MeV",
    },
    {
      label: "s:Sc/BraggScorer/Quantity",
      kind: 14,
      detail: "TOPAS DoseToMedium Scorer",
      insertText: 's:Sc/BraggScorer/Quantity = "DoseToMedium"',
    },
  ];

  for (const mat of BUILTIN_GEANT4_NIST_MATERIALS) {
    items.push({
      label: mat,
      kind: 21,
      detail: "Geant4 / NIST Built-in Material",
    });
  }

  try {
    const doc = parseTopas(content);
    for (const comp of doc.components) {
      items.push({
        label: comp.name,
        kind: 6,
        detail: `Geometry Component Ge/${comp.name} (${comp.type})`,
      });
    }
  } catch {
    // ignore parse errors during completion
  }

  return items;
}

export function getTopasDefinition(
  content: string,
  offset: number,
  uri = "file:///simulation.topas",
): LspLocation | null {
  let doc: TopasDocument;
  try {
    doc = parseTopas(content, uri);
  } catch {
    return null;
  }

  const word = extractWordAtOffset(content, offset);
  if (!word) return null;

  const comp = doc.components.find((c) => c.name === word || `Ge/${c.name}` === word);
  if (comp) return { uri, range: toLspRange(comp.range) };

  const src = doc.sources.find((s) => s.name === word || `So/${s.name}` === word);
  if (src) return { uri, range: toLspRange(src.range) };

  const sc = doc.scorers.find((s) => s.name === word || `Sc/${s.name}` === word);
  if (sc) return { uri, range: toLspRange(sc.range) };

  const mat = doc.materials.find((m) => m.name === word || `Ma/${m.name}` === word);
  if (mat) return { uri, range: toLspRange(mat.range) };

  return null;
}

function extractWordAtOffset(text: string, offset: number): string {
  if (offset < 0 || offset > text.length) return "";
  const isWordChar = (ch: string | undefined) => Boolean(ch && /[A-Za-z0-9_/-]/.test(ch));
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isWordChar(text[end])) end++;
  return text.slice(start, end);
}

export async function executeTopasAction(
  actionId: "topas_lint",
  content: string,
  params?: Record<string, unknown>,
): Promise<TopasDiagnostic[]>;
export async function executeTopasAction(
  actionId: "topas_bragg_peak",
  content: string,
  params?: Record<string, unknown>,
): Promise<BraggPeakResult>;
export async function executeTopasAction(
  actionId: "topas_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ variableCount: number; equationCount: number }>;
export async function executeTopasAction(
  actionId: "topas_to_scad" | "topas_to_modelica",
  content: string,
  params?: Record<string, unknown>,
): Promise<string>;
export async function executeTopasAction(
  actionId: string,
  content: string,
  params?: Record<string, unknown>,
): Promise<unknown>;
export async function executeTopasAction(
  actionId: string,
  content: string,
  _params?: Record<string, unknown>,
): Promise<unknown> {
  const doc = parseTopas(content);

  switch (actionId) {
    case "topas_lint":
      return lintTopasDocument(doc);
    case "topas_bragg_peak":
      return computeBraggPeakDepthDose(doc);
    case "topas_to_dae": {
      const arena = lowerTopasToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }
    case "topas_to_scad":
      return topasToScad(doc);
    case "topas_to_modelica":
      return topasToModelica(doc);
    default:
      throw new Error(`Unknown TOPAS action: ${actionId}`);
  }
}
