// SPDX-License-Identifier: AGPL-3.0-or-later

import { easy5ToDae } from "./dae/easy5-to-dae.js";
import { computeBodePlot, linearizeEasy5 } from "./linear/index.js";
import { type Easy5Diagnostic, lintEasy5 } from "./lints/index.js";
import { parseEasy5 } from "./parser/easy5-parser.js";
import { easy5ToModelica, easy5ToSsp } from "./projections/index.js";
import { type SyncOptions, type SyncResult, synchronizeModelicaToEasy5 } from "./tgg/index.js";
import type { Easy5Model } from "./types.js";

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

/**
 * Validates an EASY5 model deck and returns diagnostics.
 */
export function validateEasy5(content: string, _uri: string = "model.ez5"): LspDiagnostic[] {
  try {
    const model = parseEasy5(content);
    const diags = lintEasy5(model);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      let lineNum = d.line ? Math.max(0, d.line - 1) : 0;
      if (lineNum === 0 && d.componentId) {
        const found = lines.findIndex((l) => l.includes(d.componentId!));
        if (found >= 0) lineNum = found;
      }
      const colNum = d.column ? Math.max(0, d.column - 1) : 0;
      const lineLen = lines[lineNum]?.length ?? 1;

      return {
        range: {
          start: { line: lineNum, character: colNum },
          end: { line: lineNum, character: Math.max(colNum + 1, lineLen) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.id,
        source: "modelscript-easy5",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: "M7000",
        source: "modelscript-easy5",
        message: `Failed to parse EASY5 model: ${errMsg}`,
      },
    ];
  }
}

/**
 * Extracts document symbols for EASY5 components (gains, summers, transfer functions, integrators).
 */
export function getEasy5DocumentSymbols(content: string, _uri: string = "model.ez5"): LspDocumentSymbol[] {
  try {
    const model = parseEasy5(content);
    const children: LspDocumentSymbol[] = [];

    for (const [compId, comp] of model.components) {
      let kind = LspSymbolKind.Property;
      let detail = `Type: ${comp.type}`;

      if (comp.type.includes("GA")) {
        kind = LspSymbolKind.Field;
        detail = `Gain: K = ${comp.parameters["K"] ?? 1.0}`;
      } else if (comp.type.includes("SJ")) {
        kind = LspSymbolKind.Operator;
        detail = `Summing Junction`;
      } else if (comp.type.includes("TF")) {
        kind = LspSymbolKind.Class;
        detail = `Transfer Function`;
      } else if (comp.type.includes("IN")) {
        kind = LspSymbolKind.Variable;
        detail = `Continuous Integrator`;
      } else if (comp.type.includes("LA")) {
        kind = LspSymbolKind.Interface;
        detail = `Lead-Lag Compensator`;
      } else if (comp.type.includes("UG")) {
        kind = LspSymbolKind.Method;
        detail = `User Fortran Subroutine`;
      }

      children.push({
        name: `${compId} [${comp.type}]`,
        detail,
        kind,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
      });
    }

    return [
      {
        name: model.name || "EASY5 Control Model",
        detail: `Components: ${model.components.size} | Connections: ${model.connections.length} | Tables: ${model.tables.size}`,
        kind: LspSymbolKind.Package,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
        children: children.length > 0 ? children : undefined,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Contextual hover documentation for EASY5 control blocks and parameters.
 */
export function getEasy5Hover(
  content: string,
  position: LspPosition,
  _uri: string = "model.ez5",
): LspHover | undefined {
  try {
    const model = parseEasy5(content);
    const lines = content.split(/\r?\n/);
    const line = lines[position.line] ?? "";

    for (const [compId, comp] of model.components) {
      if (line.includes(compId)) {
        let details = `### EASY5 Component \`${compId}\`\n- **Block Type**: \`${comp.type}\`\n`;
        if (comp.title) details += `- **Title**: ${comp.title}\n`;
        const paramKeys = Object.keys(comp.parameters);
        if (paramKeys.length > 0) {
          details += `- **Parameters**: ${paramKeys.map((k) => `${k}=${comp.parameters[k]}`).join(", ")}\n`;
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

    return undefined;
  } catch {
    return undefined;
  }
}

export type Easy5ActionResult =
  | Easy5Diagnostic[]
  | string
  | ReturnType<typeof easy5ToSsp>
  | { varCount: number; eqCount: number }
  | ReturnType<typeof linearizeEasy5>
  | ReturnType<typeof computeBodePlot>
  | SyncResult;

/**
 * Executes domain actions on an EASY5 control model.
 */
export async function executeEasy5Action(action: "lint", args: Record<string, unknown>): Promise<Easy5Diagnostic[]>;
export async function executeEasy5Action(action: "to_modelica", args: Record<string, unknown>): Promise<string>;
export async function executeEasy5Action(
  action: "to_ssp",
  args: Record<string, unknown>,
): Promise<ReturnType<typeof easy5ToSsp>>;
export async function executeEasy5Action(
  action: "to_dae",
  args: Record<string, unknown>,
): Promise<{ varCount: number; eqCount: number }>;
export async function executeEasy5Action(
  action: "linearize",
  args: Record<string, unknown>,
): Promise<ReturnType<typeof linearizeEasy5>>;
export async function executeEasy5Action(
  action: "bode",
  args: Record<string, unknown>,
): Promise<ReturnType<typeof computeBodePlot>>;
export async function executeEasy5Action(
  action: "sync_from_modelica",
  args: Record<string, unknown>,
): Promise<SyncResult>;
export async function executeEasy5Action(action: string, args: Record<string, unknown>): Promise<Easy5ActionResult>;
export async function executeEasy5Action(action: string, args: Record<string, unknown>): Promise<Easy5ActionResult> {
  const content = typeof args["content"] === "string" ? args["content"] : "";
  const model: Easy5Model = parseEasy5(content);

  switch (action) {
    case "lint":
      return lintEasy5(model);

    case "to_modelica":
      return easy5ToModelica(model);

    case "to_ssp":
      return easy5ToSsp(model);

    case "to_dae": {
      const dae = easy5ToDae(model);
      return {
        varCount: dae.varCount,
        eqCount: dae.eqCount,
      };
    }

    case "linearize":
      return linearizeEasy5(model);

    case "bode": {
      const lin = linearizeEasy5(model);
      return computeBodePlot(lin);
    }

    case "sync_from_modelica": {
      const modelicaText = typeof args["modelicaText"] === "string" ? args["modelicaText"] : "";
      const options = args["options"] as SyncOptions | undefined;
      return synchronizeModelicaToEasy5(content, modelicaText, options);
    }

    default:
      throw new Error(`Unknown EASY5 action: ${action}`);
  }
}
