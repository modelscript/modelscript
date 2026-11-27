// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { cstLineText, groupAllCstTokensByLine, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync } from "../src-gen/bindings.js";
import { rocetsToDae } from "./dae/rocets-to-dae.js";
import { lintRocets } from "./lints/index.js";
import { parseRocetsDeck } from "./parser/deck-parser.js";
import { rocetsToModelica, rocetsToSsp } from "./projections/index.js";
import { simulateRocetsTransient, solveRocetsBalance } from "./solver/index.js";
import type { RocetsEngineModel } from "./types.js";

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

interface RocetsCstLine {
  row: number;
  text: string;
  colLine: string;
  startCol: number;
  endCol: number;
}

interface RocetsCstIndex {
  byRow: Map<number, RocetsCstLine>;
  entries: RocetsCstLine[];
  rootRange: LspRange;
}

function buildRocetsCstIndex(content: string): RocetsCstIndex {
  const byRow = new Map<number, RocetsCstLine>();
  const entries: RocetsCstLine[] = [];
  let lastRow = 0;
  let lastEndCol = 0;

  let rootNode: CstNodeLike | null = null;
  try {
    rootNode =
      (getOrLoadLanguageWasmParser("rocets", import.meta.url, createWasmParserSync).parse(content)?.rootNode as
        CstNodeLike | undefined) ?? null;
  } catch {
    rootNode = null;
  }

  if (rootNode) {
    for (const { row, tokens } of groupAllCstTokensByLine(rootNode)) {
      const lineText = cstLineText(content, tokens);
      const first = tokens[0] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const last = tokens[tokens.length - 1] as (CstNodeLike & { endPosition?: { column: number } }) | undefined;
      const startCol = first?.startPosition?.column ?? 0;
      const endCol = last?.endPosition?.column ?? startCol + lineText.length;
      const colLine = startCol > 0 ? " ".repeat(startCol) + lineText : lineText;
      const entry: RocetsCstLine = { row, text: lineText, colLine, startCol, endCol };
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
      const endCol = startCol + trimmed.length;
      const entry: RocetsCstLine = { row: i, text: trimmed, colLine: raw, startCol, endCol };
      byRow.set(i, entry);
      entries.push(entry);
      lastRow = i;
      lastEndCol = endCol;
    }
  }

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: lastRow, character: Math.max(1, lastEndCol) },
  };
  return { byRow, entries, rootRange };
}

function findRocetsNeedleRange(cstIndex: RocetsCstIndex, needle: string): LspRange {
  const found = cstIndex.entries.find((e) => e.text.includes(needle));
  if (!found) return DEFAULT_RANGE;
  const idx = found.colLine.indexOf(needle);
  if (idx >= 0) {
    return {
      start: { line: found.row, character: idx },
      end: { line: found.row, character: idx + needle.length },
    };
  }
  return {
    start: { line: found.row, character: found.startCol },
    end: { line: found.row, character: Math.max(found.startCol + 1, found.endCol) },
  };
}

/**
 * Validates a NASA ROCETS liquid rocket engine simulation deck and returns diagnostics.
 */
export function validateRocets(content: string, _uri: string = "engine.roc"): LspDiagnostic[] {
  try {
    const model = parseRocetsDeck(content);
    const diags = lintRocets(model);
    const cstIndex = buildRocetsCstIndex(content);

    return diags.map((d) => {
      let lineNum = d.line ? Math.max(0, d.line - 1) : 0;
      const compId = d.componentId;
      if (lineNum === 0 && compId) {
        const found = cstIndex.entries.find((e) => e.text.includes(compId));
        if (found) lineNum = found.row;
      }
      const entry = cstIndex.byRow.get(lineNum);
      const lt = entry?.colLine ?? "";
      let startChar = d.column ? Math.max(0, d.column - 1) : (entry?.startCol ?? 0);
      let endChar = 0;
      if (!d.column && compId) {
        const idx = lt.indexOf(compId);
        if (idx >= 0) {
          startChar = idx;
          endChar = idx + compId.length;
        }
      }
      if (endChar <= startChar) {
        endChar = entry?.endCol ?? startChar + 1;
      }

      return {
        range: {
          start: { line: lineNum, character: startChar },
          end: { line: lineNum, character: Math.max(startChar + 1, endChar) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.id,
        source: "modelscript-rocets",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M8000",
        source: "modelscript-rocets",
        message: `Failed to parse ROCETS engine deck: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for rocket engine turbopumps, combustion chambers, valves, and lines.
 */
export function getRocetsDocumentSymbols(content: string, _uri: string = "engine.roc"): LspDocumentSymbol[] {
  try {
    const model = parseRocetsDeck(content);
    const cstIndex = buildRocetsCstIndex(content);
    const children: LspDocumentSymbol[] = [];

    for (const [compId, comp] of model.components) {
      let kind = LspSymbolKind.Property;
      let detail = `Type: ${comp.type}`;

      if (comp.type === "CHAMBER" || comp.type === "COMBUSTOR") {
        kind = LspSymbolKind.Class;
        const pc = comp.parameters["PC"] ?? comp.initialStates["PC"];
        detail = `Chamber | Pc: ${pc ? `${(Number(pc) / 1e6).toFixed(1)} MPa` : "nominal"}`;
      } else if (comp.type === "PUMP") {
        kind = LspSymbolKind.Method;
        detail = `Turbopump | Fluid: ${comp.ports["OUT"]?.fluid ?? comp.ports["IN"]?.fluid ?? "propellant"}`;
      } else if (comp.type === "TURBINE") {
        kind = LspSymbolKind.Constructor;
        detail = `Drive Turbine`;
      } else if (comp.type === "SHAFT") {
        kind = LspSymbolKind.Interface;
        const speed = comp.parameters["SPEED"] ?? comp.initialStates["SPEED"];
        detail = `Shaft | Speed: ${speed ?? 30000} RPM`;
      } else if (comp.type === "VALVE") {
        kind = LspSymbolKind.Field;
        detail = `Control Valve`;
      }

      const compRange = findRocetsNeedleRange(cstIndex, compId);
      children.push({
        name: `${compId} [${comp.type}]`,
        detail,
        kind,
        range: compRange,
        selectionRange: compRange,
      });
    }

    return [
      {
        name: model.name || "ROCETS Liquid Engine Deck",
        detail: `Components: ${model.components.size} | Connections: ${model.connections.length} | Cycle: ${model.config?.cycle ?? "standard"}`,
        kind: LspSymbolKind.Package,
        range: cstIndex.rootRange,
        selectionRange: cstIndex.rootRange,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Contextual hover documentation for rocket engine propulsion modules and parameters.
 */
export function getRocetsHover(
  content: string,
  position: LspPosition,
  _uri: string = "engine.roc",
): LspHover | undefined {
  try {
    const model = parseRocetsDeck(content);
    const cstIndex = buildRocetsCstIndex(content);
    const line = cstIndex.byRow.get(position.line)?.colLine ?? "";

    for (const [compId, comp] of model.components) {
      if (line.includes(compId)) {
        let details = `### ROCETS Component \`${compId}\`\n- **Module Type**: \`${comp.type}\`\n`;
        if (comp.title) details += `- **Title**: ${comp.title}\n`;
        const paramKeys = Object.keys(comp.parameters);
        if (paramKeys.length > 0) {
          details += `- **Parameters**: ${paramKeys
            .slice(0, 5)
            .map((k) => `${k}=${comp.parameters[k]}`)
            .join(", ")}\n`;
        }
        const portKeys = Object.keys(comp.ports);
        if (portKeys.length > 0) {
          details += `- **Ports**: ${portKeys.join(", ")}\n`;
        }
        return {
          contents: {
            kind: "markdown",
            value: details,
          },
        };
      }
    }

    if (/thrust|chamber|pc|mr|cycle|oxidizer|fuel/i.test(line)) {
      const cfg = model.config;
      return {
        contents: {
          kind: "markdown",
          value: `### ROCETS Engine Configuration\n- **Cycle**: \`${cfg?.cycle ?? "unspecified"}\`\n- **Design Chamber Pressure**: ${cfg?.designPcPa ? `${(cfg.designPcPa / 1e6).toFixed(1)} MPa` : "N/A"}\n- **Design Thrust**: ${cfg?.designThrustN ? `${(cfg.designThrustN / 1000).toFixed(1)} kN` : "N/A"}`,
        },
      };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Executes domain actions on a NASA ROCETS rocket propulsion model.
 */
export async function executeRocetsAction(action: string, args: Record<string, unknown>): Promise<unknown> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const model: RocetsEngineModel = parseRocetsDeck(content);

  switch (action) {
    case "lint":
      return lintRocets(model);

    case "to_modelica":
      return rocetsToModelica(model);

    case "to_ssp":
      return rocetsToSsp(model);

    case "to_dae": {
      const dae = rocetsToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "balance":
      return solveRocetsBalance(model);

    case "simulate": {
      const duration = typeof args["duration"] === "number" ? args["duration"] : 2.0;
      const timeStep = typeof args["timeStep"] === "number" ? args["timeStep"] : 0.001;
      return simulateRocetsTransient(model, { tEnd: duration, dt: timeStep });
    }

    default:
      throw new Error(`Unknown ROCETS action: ${action}`);
  }
}
