// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import { lowerEclipseToDae } from "./dae/eclipse-to-dae.js";
import { lintEclipse } from "./lints/index.js";
import { parseEclipse } from "./parser/eclipse-parser.js";
import { eclipseToModelica } from "./projections/eclipse-to-modelica.js";
import { solveReservoirDepletion } from "./solvers/reservoir-solver.js";

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

export function validateEclipse(text: string): LspDiagnostic[] {
  try {
    const deck = parseEclipse(text);
    const diags = lintEclipse(deck);

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
        source: "eclipse-linter",
        message: d.message,
      };
    });
  } catch (err: any) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 10 },
        },
        severity: 1,
        code: "M8700",
        source: "eclipse-parser",
        message: `ECLIPSE parse error: ${err.message}`,
      },
    ];
  }
}

export function getEclipseDocumentSymbols(text: string): LspDocumentSymbol[] {
  const deck = parseEclipse(text);
  const symbols: LspDocumentSymbol[] = [];

  const rootRange: LspRange = {
    start: { line: 0, character: 0 },
    end: { line: text.split("\n").length, character: 0 },
  };

  const wellSymbols: LspDocumentSymbol[] = [];
  for (const well of deck.wells.values()) {
    const startLine = well.range ? Math.max(0, well.range.startLine - 1) : 0;
    const endLine = well.range ? Math.max(0, well.range.endLine - 1) : startLine;
    const r: LspRange = {
      start: { line: startLine, character: 0 },
      end: { line: endLine, character: 40 },
    };
    const ctrl = well.productionControl
      ? `Producer (${well.productionControl.controlMode}=${well.productionControl.oilRate})`
      : well.injectionControl
        ? `Injector (${well.injectionControl.fluidType} ${well.injectionControl.controlMode})`
        : "Well";

    wellSymbols.push({
      name: well.name,
      detail: `${ctrl} @ (${well.i}, ${well.j}) with ${well.completions.length} completions`,
      kind: LspSymbolKind.Field,
      range: r,
      selectionRange: r,
    });
  }

  const otherChildren: LspDocumentSymbol[] = [];
  if (deck.grid) {
    otherChildren.push({
      name: "GRID",
      detail: `${deck.dimensions.nx}x${deck.dimensions.ny}x${deck.dimensions.nz}, poro=${deck.grid.poro}, kx=${deck.grid.permX}mD`,
      kind: LspSymbolKind.Struct,
      range: rootRange,
      selectionRange: rootRange,
    });
  }

  if (deck.props) {
    otherChildren.push({
      name: "PROPS",
      detail: `PVDO: ${deck.props.pvdo.length} pts, SWOF: ${deck.props.swof.length} pts`,
      kind: LspSymbolKind.Class,
      range: rootRange,
      selectionRange: rootRange,
    });
  }

  symbols.push({
    name: deck.title || "EclipseDeck",
    detail: `ECLIPSE ${deck.units} Model (${deck.wells.size} wells, ${deck.dimensions.nx * deck.dimensions.ny * deck.dimensions.nz} cells)`,
    kind: LspSymbolKind.Package,
    range: rootRange,
    selectionRange: rootRange,
    children: [...otherChildren, ...wellSymbols],
  });

  return symbols;
}

export function getEclipseHover(text: string, position: LspPosition): LspHover | null {
  const deck = parseEclipse(text);
  const lines = text.split("\n");
  const lineText = lines[position.line] ?? "";

  // Check Well match
  for (const well of deck.wells.values()) {
    if (lineText.includes(well.name)) {
      const completionsStr = well.completions
        .map((c) => `Layer K=${c.k1}-${c.k2} (WI=${c.wellIndex > 0 ? c.wellIndex : "auto"}, status=${c.status})`)
        .join("\n- ");
      return {
        contents: {
          kind: "markdown",
          value: [
            `### ECLIPSE Well: **${well.name}**`,
            `- **Group:** \`${well.group}\``,
            `- **Location (I, J):** (${well.i}, ${well.j})`,
            `- **Preferred Phase:** ${well.preferredPhase}`,
            `- **Completions:**`,
            `- ${completionsStr}`,
            well.productionControl
              ? `- **Production Control:** ${well.productionControl.controlMode} = ${well.productionControl.oilRate}, BHP Limit = ${well.productionControl.bhpLimit}`
              : well.injectionControl
                ? `- **Injection Control:** ${well.injectionControl.fluidType} ${well.injectionControl.controlMode} = ${well.injectionControl.rate}, BHP Limit = ${well.injectionControl.bhpLimit}`
                : "- **Status:** Default",
          ].join("\n"),
        },
      };
    }
  }

  // Check Grid match
  if (
    lineText.toUpperCase().includes("DIMENS") ||
    lineText.toUpperCase().includes("DX") ||
    lineText.toUpperCase().includes("PORO")
  ) {
    return {
      contents: {
        kind: "markdown",
        value: [
          `### ECLIPSE Reservoir Grid`,
          `- **Dimensions:** ${deck.dimensions.nx} x ${deck.dimensions.ny} x ${deck.dimensions.nz} (${deck.dimensions.nx * deck.dimensions.ny * deck.dimensions.nz} total cells)`,
          `- **Cell Size (dx, dy, dz):** ${deck.grid.dx} x ${deck.grid.dy} x ${deck.grid.dz}`,
          `- **Datum Top:** ${deck.grid.tops}`,
          `- **Porosity:** ${deck.grid.poro}`,
          `- **Permeability (X, Y, Z):** ${deck.grid.permX} mD, ${deck.grid.permY} mD, ${deck.grid.permZ} mD`,
        ].join("\n"),
      },
    };
  }

  return null;
}

export async function executeEclipseAction(action: string, text: string, params?: any): Promise<any> {
  const deck = parseEclipse(text);

  switch (action) {
    case "lint_eclipse":
      return lintEclipse(deck);

    case "eclipse_reservoir_solve":
      return solveReservoirDepletion(deck, params?.options);

    case "eclipse_to_dae": {
      const dae = lowerEclipseToDae(deck);
      return {
        modelName: deck.title || "EclipseReservoir",
        variableCount: dae.variables().length,
        equationCount: dae.equations().length,
      };
    }

    case "eclipse_to_modelica":
      return eclipseToModelica(deck, params?.modelName);

    default:
      throw new Error(`Unknown ECLIPSE action: ${action}`);
  }
}
