// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { simulateGtSuiteTransient } from "./dae/cylinder-dae.js";
import { gtsuiteToDae } from "./dae/gtsuite-to-dae.js";
import { lintGtModel } from "./lints/index.js";
import { parseGtmModel } from "./parser/gtm-parser.js";
import { gtsuiteToModelica, gtsuiteToSsp, gtsuiteToSysml2 } from "./projections/index.js";
import type { GtDiagnostic, GtModel, GtSimulationResult } from "./types.js";

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
  severity: 1 | 2 | 3 | 4; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
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

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

interface CstLineEntry {
  row: number;
  text: string;
  startCol: number;
  endCol: number;
  firstTokEnd: number;
}

interface GtsuiteCstIndex {
  byRow: Map<number, CstLineEntry>;
  entries: CstLineEntry[];
  rootRange: LspRange;
}

function buildGtsuiteCstIndex(content: string): GtsuiteCstIndex {
  const byRow = new Map<number, CstLineEntry>();
  const entries: CstLineEntry[] = [];
  let rootNode: unknown = null;
  try {
    rootNode =
      getOrLoadLanguageWasmParser("gtsuite", import.meta.url, createWasmParserSync).parse(content)?.rootNode ?? null;
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
      const firstTokEnd = first?.endPosition?.column ?? startCol + Math.max(1, first?.text?.length ?? 1);
      const entry: CstLineEntry = { row, text: lineText, startCol, endCol, firstTokEnd };
      byRow.set(row, entry);
      entries.push(entry);
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
      const firstTok = trimmed.match(/^[^\s=,;]+/)?.[0] ?? "";
      const endCol = startCol + trimmed.length;
      const entry: CstLineEntry = {
        row: i,
        text: trimmed,
        startCol,
        endCol,
        firstTokEnd: startCol + Math.max(1, firstTok.length),
      };
      byRow.set(i, entry);
      entries.push(entry);
      lastRow = i;
      lastEndCol = endCol;
    }
  }

  const rootRange: LspRange =
    entries.length > 0
      ? {
          start: { line: entries[0]!.row, character: entries[0]!.startCol },
          end: { line: lastRow, character: lastEndCol },
        }
      : DEFAULT_RANGE;

  return { byRow, entries, rootRange };
}

function findIdentifierRange(cstIndex: GtsuiteCstIndex, id: string): LspRange | undefined {
  for (const entry of cstIndex.entries) {
    const idx = entry.text.indexOf(id);
    if (idx >= 0) {
      return {
        start: { line: entry.row, character: entry.startCol + idx },
        end: { line: entry.row, character: entry.startCol + idx + id.length },
      };
    }
  }
  return undefined;
}

/**
 * Validates a GT-SUITE engine model and returns LSP diagnostics.
 */
export function validateGtsuite(content: string, uri: string = "model.gtm"): LspDiagnostic[] {
  try {
    const model = parseGtmModel(content, uri);
    const diags = lintGtModel(model);
    const cstIndex = buildGtsuiteCstIndex(content);
    const firstEntry = cstIndex.entries[0];
    const fallbackRange: LspRange = firstEntry
      ? {
          start: { line: firstEntry.row, character: firstEntry.startCol },
          end: { line: firstEntry.row, character: Math.max(firstEntry.startCol + 1, firstEntry.firstTokEnd) },
        }
      : DEFAULT_RANGE;

    return diags.map((d) => {
      const matched = d.componentId ? findIdentifierRange(cstIndex, d.componentId) : undefined;
      return {
        range: matched ?? fallbackRange,
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: `M${d.code}`,
        source: "modelscript-gtsuite",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M9000",
        source: "modelscript-gtsuite",
        message: `Failed to parse GT-SUITE model: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for engine cylinders, manifolds, valves, and turbochargers.
 */
export function getGtsuiteDocumentSymbols(content: string, uri: string = "model.gtm"): LspDocumentSymbol[] {
  try {
    const model = parseGtmModel(content, uri);
    const cstIndex = buildGtsuiteCstIndex(content);
    const children: LspDocumentSymbol[] = [];

    for (const comp of model.components) {
      let kind = LspSymbolKind.Property;
      let detail = `Kind: ${comp.kind}`;

      if (comp.kind === "cylinder") {
        kind = LspSymbolKind.Class;
        detail = `Bore: ${comp.boreM * 1000}mm | Stroke: ${comp.strokeM * 1000}mm`;
      } else if (comp.kind === "pipe") {
        kind = LspSymbolKind.Field;
        detail = `Len: ${comp.lengthM}m | Diam: ${comp.diameterM * 1000}mm`;
      } else if (comp.kind === "plenum") {
        kind = LspSymbolKind.Namespace;
        detail = `Vol: ${(comp.volumeM3 * 1e6).toFixed(0)}cm³`;
      } else if (comp.kind === "turbo_compressor" || comp.kind === "turbo_turbine") {
        kind = LspSymbolKind.Constructor;
        detail = `Type: ${comp.kind}`;
      }

      const compRange =
        findIdentifierRange(cstIndex, comp.id) ??
        (comp.title ? findIdentifierRange(cstIndex, comp.title) : undefined) ??
        DEFAULT_RANGE;
      children.push({
        name: `${comp.title || comp.id} [${comp.kind}]`,
        detail,
        kind,
        range: compRange,
        selectionRange: compRange,
      });
    }

    return [
      {
        name: model.name || "GT-SUITE Model",
        detail: `Components: ${model.components.length} | Connections: ${model.connections.length} | Speed: ${model.simulationSettings.engineSpeedRpm} RPM`,
        kind: LspSymbolKind.Package,
        range: cstIndex.rootRange,
        selectionRange: cstIndex.entries[0]
          ? {
              start: { line: cstIndex.entries[0].row, character: cstIndex.entries[0].startCol },
              end: { line: cstIndex.entries[0].row, character: cstIndex.entries[0].endCol },
            }
          : DEFAULT_RANGE,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Contextual hover documentation for engine powertrain elements.
 */
export function getGtsuiteHover(
  content: string,
  position: LspPosition,
  uri: string = "model.gtm",
): LspHover | undefined {
  try {
    const model = parseGtmModel(content, uri);
    const cstIndex = buildGtsuiteCstIndex(content);
    const entry = cstIndex.byRow.get(position.line);
    const line = entry?.text ?? "";

    for (const comp of model.components) {
      if (line.includes(comp.id) || (comp.title && line.includes(comp.title))) {
        let details = `### GT-SUITE Component \`${comp.title || comp.id}\`\n- **Kind**: \`${comp.kind}\`\n`;
        if (comp.kind === "cylinder") {
          const cyl = comp;
          details += `- **Bore**: ${(cyl.boreM * 1000).toFixed(1)} mm\n- **Stroke**: ${(cyl.strokeM * 1000).toFixed(1)} mm\n- **Compression Ratio**: ${cyl.compressionRatio ?? "default"}\n- **Clearance Vol**: ${cyl.clearanceVolumeM3 ? (cyl.clearanceVolumeM3 * 1e6).toFixed(1) + " cm³" : "calculated"}\n`;
        } else if (comp.kind === "pipe") {
          const pipe = comp;
          details += `- **Length**: ${pipe.lengthM} m\n- **Diameter**: ${(pipe.diameterM * 1000).toFixed(1)} mm\n- **Discretization**: ${pipe.discretizationLengthM ? (pipe.discretizationLengthM * 1000).toFixed(1) + " mm" : "auto"}\n`;
        } else if (comp.kind === "plenum") {
          const pl = comp;
          details += `- **Volume**: ${(pl.volumeM3 * 1e6).toFixed(1)} cm³\n- **Init Pressure**: ${pl.initialPressurePa ? (pl.initialPressurePa / 1000).toFixed(1) + " kPa" : "101.3 kPa"}\n`;
        }
        return {
          contents: {
            kind: "markdown",
            value: details,
          },
        };
      }
    }

    if (/speed|rpm|duration|timestep|engine/i.test(line)) {
      const s = model.simulationSettings;
      return {
        contents: {
          kind: "markdown",
          value: `### GT-SUITE Simulation Settings\n- **Engine Speed**: ${s.engineSpeedRpm} RPM\n- **Time Step**: ${(s.timeStepSeconds * 1e6).toFixed(1)} µs\n- **Air-Fuel Ratio**: λ = ${s.airFuelRatioLambda}`,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on a GT-SUITE model.
 */
export async function executeGtsuiteAction(action: "lint", args: Record<string, unknown>): Promise<GtDiagnostic[]>;
export async function executeGtsuiteAction(
  action: "to_modelica" | "to_ssp" | "to_sysml2",
  args: Record<string, unknown>,
): Promise<string>;
export async function executeGtsuiteAction(
  action: "to_dae",
  args: Record<string, unknown>,
): Promise<{ varCount: number; eqCount: number }>;
export async function executeGtsuiteAction(
  action: "simulate",
  args: Record<string, unknown>,
): Promise<GtSimulationResult>;
export async function executeGtsuiteAction(
  action: string,
  args: Record<string, unknown>,
): Promise<GtDiagnostic[] | string | { varCount: number; eqCount: number } | GtSimulationResult>;
export async function executeGtsuiteAction(
  action: string,
  args: Record<string, unknown>,
): Promise<GtDiagnostic[] | string | { varCount: number; eqCount: number } | GtSimulationResult> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const uri = typeof args["uri"] === "string" ? args["uri"] : "model.gtm";
  const model: GtModel = parseGtmModel(content, uri);

  switch (action) {
    case "lint":
      return lintGtModel(model);

    case "to_modelica":
      return gtsuiteToModelica(model);

    case "to_ssp":
      return gtsuiteToSsp(model);

    case "to_sysml2":
      return gtsuiteToSysml2(model);

    case "to_dae": {
      const dae = gtsuiteToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "simulate": {
      const duration = typeof args["duration"] === "number" ? args["duration"] : 1.0;
      const timeStep = typeof args["timeStep"] === "number" ? args["timeStep"] : 1e-4;
      return simulateGtSuiteTransient(model, { durationSeconds: duration, timeStepSeconds: timeStep });
    }

    default:
      throw new Error(`Unknown GT-SUITE action: ${action}`);
  }
}
