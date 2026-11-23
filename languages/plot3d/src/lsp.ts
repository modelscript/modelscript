// SPDX-License-Identifier: AGPL-3.0-or-later

import { Plot3dErrorCode } from "./errors.js";
import { lintPlot3dDataset } from "./lints/index.js";
import { parsePlot3dAuto } from "./parser/ascii-parser.js";
import { computeGridMetrics } from "./solver/metrics.js";
import type { Plot3dDataset } from "./types.js";

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

const DEFAULT_RANGE: LspRange = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

const PLOT3D_KEYWORDS: ReadonlyArray<{ label: string; detail: string }> = [
  { label: "FSMACH", detail: "Freestream Mach number (PLOT3D .q header)" },
  { label: "ALPHA", detail: "Angle of attack in degrees (PLOT3D .q header)" },
  { label: "RE", detail: "Freestream Reynolds number (PLOT3D .q header)" },
  { label: "TIME", detail: "Simulation time (PLOT3D .q header)" },
  { label: "RHO", detail: "Fluid density rho [kg/m^3]" },
  { label: "RHOU", detail: "X-momentum density rho*u [kg/(m^2*s)]" },
  { label: "RHOV", detail: "Y-momentum density rho*v [kg/(m^2*s)]" },
  { label: "RHOW", detail: "Z-momentum density rho*w [kg/(m^2*s)]" },
  { label: "ENERGY", detail: "Total energy per unit volume e [J/m^3]" },
  { label: "PRESSURE", detail: "Static pressure p [Pa]" },
  { label: "MACH", detail: "Local Mach number M" },
  { label: "TEMPERATURE", detail: "Static temperature T [K]" },
  { label: "CP", detail: "Pressure coefficient Cp" },
  { label: "ENTROPY", detail: "Specific entropy change ds [J/(kg*K)]" },
];

/**
 * Validates an ASCII PLOT3D file (`.xyz`, `.g`, `.q`, `.f`, `.nam`) and returns LSP diagnostics.
 */
export function validatePlot3d(content: string, uri: string = "grid.xyz"): LspDiagnostic[] {
  try {
    const dataset = parsePlot3dAuto(content, uri);
    const diags = lintPlot3dDataset(dataset);
    const lines = content.split(/\r?\n/);

    return diags.map((d) => {
      const lineNum = d.line ? Math.max(0, d.line - 1) : 0;
      const colNum = d.column ? Math.max(0, d.column - 1) : 0;
      const lineLen = lines[lineNum]?.length ?? 1;

      return {
        range: {
          start: { line: lineNum, character: colNum },
          end: { line: lineNum, character: Math.max(colNum + 1, lineLen) },
        },
        severity: d.severity === "error" ? 1 : d.severity === "warning" ? 2 : 3,
        code: d.id,
        source: "modelscript-plot3d",
        message: d.message,
      };
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: DEFAULT_RANGE,
        severity: 1,
        code: Plot3dErrorCode.SYNTAX_ERROR.stdCode,
        source: "modelscript-plot3d",
        message: Plot3dErrorCode.SYNTAX_ERROR.message(msg),
      },
    ];
  }
}

/**
 * Extracts hierarchical LSP document symbols for a PLOT3D dataset.
 */
export function getPlot3dDocumentSymbols(content: string, uri: string = "grid.xyz"): LspDocumentSymbol[] {
  try {
    const dataset: Plot3dDataset = parsePlot3dAuto(content, uri);
    const children: LspDocumentSymbol[] = [];

    if (dataset.grid) {
      for (const b of dataset.grid.blocks) {
        children.push({
          name: `Block ${b.index + 1}`,
          detail: `${b.ni} x ${b.nj} x ${b.nk} (${b.ni * b.nj * b.nk} nodes)`,
          kind: LspSymbolKind.Struct,
          range: DEFAULT_RANGE,
          selectionRange: DEFAULT_RANGE,
        });
      }
    }

    if (dataset.solution) {
      for (const b of dataset.solution.blocks) {
        children.push({
          name: `Solution Block ${b.index + 1}`,
          detail: `${b.ni}x${b.nj}x${b.nk} | M=${b.conditions.fsmach}, Re=${b.conditions.re}`,
          kind: LspSymbolKind.Module,
          range: DEFAULT_RANGE,
          selectionRange: DEFAULT_RANGE,
        });
      }
    }

    if (dataset.func) {
      for (const b of dataset.func.blocks) {
        children.push({
          name: `Function Block ${b.index + 1}`,
          detail: `${b.ni}x${b.nj}x${b.nk} | ${b.nVars} variable(s)`,
          kind: LspSymbolKind.Array,
          range: DEFAULT_RANGE,
          selectionRange: DEFAULT_RANGE,
        });
      }
    }

    if (dataset.nam) {
      for (let i = 0; i < dataset.nam.variableNames.length; i++) {
        children.push({
          name: dataset.nam.variableNames[i]!,
          detail: `Variable #${i + 1}`,
          kind: LspSymbolKind.Variable,
          range: {
            start: { line: i, character: 0 },
            end: { line: i, character: dataset.nam.variableNames[i]!.length },
          },
          selectionRange: {
            start: { line: i, character: 0 },
            end: { line: i, character: dataset.nam.variableNames[i]!.length },
          },
        });
      }
    }

    const baseName = uri.split(/[\\/]/).pop() ?? "PLOT3D";
    return [
      {
        name: baseName,
        detail: `PLOT3D ${dataset.kind}`,
        kind: LspSymbolKind.File,
        range: DEFAULT_RANGE,
        selectionRange: DEFAULT_RANGE,
        children,
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Generates an LSP hover summary for a PLOT3D file at the requested position.
 */
export function getPlot3dHover(content: string, position: LspPosition, uri: string = "grid.xyz"): LspHover | null {
  try {
    const dataset = parsePlot3dAuto(content, uri);
    const lines = content.split(/\r?\n/);
    const lineText = lines[position.line] ?? "";

    if (dataset.grid) {
      const metrics = computeGridMetrics(dataset.grid);
      return {
        contents: {
          kind: "markdown",
          value: [
            `### NASA PLOT3D Structured Grid (\`${dataset.grid.dimension.toUpperCase()}\`)`,
            `- **Blocks**: ${dataset.grid.blocks.length} (${dataset.grid.multiBlock ? "multi-block" : "single-block"})`,
            `- **Total Cells**: ${metrics.totalCellCount}`,
            `- **Total Volume**: \`${metrics.totalVolume.toExponential(4)}\``,
            `- **Min Jacobian**: \`${metrics.minJacobian.toExponential(4)}\``,
            `- **Inverted Cells**: ${metrics.invertedCellCount}`,
          ].join("\n"),
        },
        range: {
          start: { line: position.line, character: 0 },
          end: { line: position.line, character: Math.max(1, lineText.length) },
        },
      };
    }

    if (dataset.solution) {
      const b0 = dataset.solution.blocks[0];
      return {
        contents: {
          kind: "markdown",
          value: [
            `### NASA PLOT3D Conservative Solution (\`.q\`)`,
            `- **Blocks**: ${dataset.solution.blocks.length}`,
            b0
              ? `- **Block 1 Conditions**: \`FSMACH=${b0.conditions.fsmach}\`, \`ALPHA=${b0.conditions.alpha}\`, \`RE=${b0.conditions.re}\`, \`TIME=${b0.conditions.time}\``
              : "",
          ]
            .filter(Boolean)
            .join("\n"),
        },
      };
    }

    if (dataset.nam) {
      const word = lineText.trim();
      const kw = PLOT3D_KEYWORDS.find((k) => k.label.toLowerCase() === word.toLowerCase());
      return {
        contents: {
          kind: "markdown",
          value: kw
            ? `**${kw.label}** — ${kw.detail}`
            : `PLOT3D variable metadata (\`${dataset.nam.variableNames.length}\` variables).`,
        },
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Returns LSP completion items for PLOT3D `.nam` variable names and standard headers.
 */
export function getPlot3dLspCompletions(prefix: string = ""): Array<{ label: string; detail: string }> {
  const norm = prefix.trim().toLowerCase();
  return PLOT3D_KEYWORDS.filter((k) => k.label.toLowerCase().startsWith(norm));
}
