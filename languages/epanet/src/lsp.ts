// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Language Server Protocol (LSP) Service Integration.
 */

import { lowerEpanetToDae } from "./dae/epanet-to-dae.js";
import { lintEpanet } from "./lints/rules.js";
import { parseInp } from "./parser/index.js";
import { epanetToModelica } from "./projections/epanet-to-modelica.js";
import { solveHydraulics } from "./solver/todini-ggm.js";
import type { EpanetNetwork } from "./types.js";

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

export function validateEpanet(content: string): LspDiagnostic[] {
  let net: EpanetNetwork;
  try {
    net = parseInp(content);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8100",
        source: "epanet-parser",
        message: `Parse error: ${errMsg}`,
      },
    ];
  }

  const rawDiags = lintEpanet(net);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: {
        start: {
          line: Math.max(0, d.range.startLine - 1),
          character: Math.max(0, d.range.startColumn - 1),
        },
        end: {
          line: Math.max(0, d.range.endLine - 1),
          character: Math.max(0, d.range.endColumn - 1),
        },
      },
      severity: sev,
      code: d.code,
      source: "epanet-linter",
      message: d.message,
    };
  });
}

export function getEpanetDocumentSymbols(content: string): LspDocumentSymbol[] {
  let net: EpanetNetwork;
  try {
    net = parseInp(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  // Junctions
  for (const j of net.junctions) {
    const jRange: LspRange = {
      start: { line: Math.max(0, j.range.startLine - 1), character: 0 },
      end: { line: Math.max(0, j.range.endLine - 1), character: 0 },
    };
    symbols.push({
      name: `Junction: ${j.id}`,
      detail: `elev=${j.elevation}m, demand=${j.demand}`,
      kind: LspSymbolKind.Field,
      range: jRange,
      selectionRange: jRange,
    });
  }

  // Reservoirs & Tanks
  for (const r of net.reservoirs) {
    const rRange: LspRange = {
      start: { line: Math.max(0, r.range.startLine - 1), character: 0 },
      end: { line: Math.max(0, r.range.endLine - 1), character: 0 },
    };
    symbols.push({
      name: `Reservoir: ${r.id}`,
      detail: `totalHead=${r.totalHead}m`,
      kind: LspSymbolKind.Struct,
      range: rRange,
      selectionRange: rRange,
    });
  }

  // Pipes
  for (const p of net.pipes) {
    const pRange: LspRange = {
      start: { line: Math.max(0, p.range.startLine - 1), character: 0 },
      end: { line: Math.max(0, p.range.endLine - 1), character: 0 },
    };
    symbols.push({
      name: `Pipe: ${p.id} (${p.node1} -> ${p.node2})`,
      detail: `len=${p.length}m, diam=${p.diameter}mm`,
      kind: LspSymbolKind.Variable,
      range: pRange,
      selectionRange: pRange,
    });
  }

  return symbols;
}

export function getEpanetHover(content: string, offset: number): LspHover | null {
  let net: EpanetNetwork;
  try {
    net = parseInp(content);
  } catch {
    return null;
  }

  // Hover on Junction
  for (const j of net.junctions) {
    if (offset >= j.range.startOffset && offset <= j.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### EPANET Junction: **${j.id}**`,
            `* **Elevation:** \`${j.elevation} m\``,
            `* **Base Demand:** \`${j.demand}\``,
            `* **Pattern:** \`${j.patternId ?? "None"}\``,
          ].join("\n"),
        },
      };
    }
  }

  // Hover on Pipe
  for (const p of net.pipes) {
    if (offset >= p.range.startOffset && offset <= p.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### EPANET Pipe: **${p.id}**`,
            `* **From:** \`${p.node1}\``,
            `* **To:** \`${p.node2}\``,
            `* **Length:** \`${p.length} m\``,
            `* **Diameter:** \`${p.diameter} mm\``,
            `* **Roughness:** \`${p.roughness}\``,
            `* **Status:** \`${p.status}\``,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export interface EpanetActionParams {
  title?: string | undefined;
}

export type EpanetActionResult =
  | { modelica: string }
  | { variables: number; equations: number }
  | {
      converged: boolean;
      iterations: number;
      maxFlowChange: number;
      pressures: Record<string, number>;
      flows: Record<string, number>;
    }
  | {
      title: string | undefined;
      junctions: number;
      reservoirs: number;
      tanks: number;
      pipes: number;
      pumps: number;
      valves: number;
    };

export function executeEpanetAction(
  action: "epanet.toModelica",
  content: string,
  params?: EpanetActionParams,
): { modelica: string };
export function executeEpanetAction(
  action: "epanet.toDae",
  content: string,
  params?: EpanetActionParams,
): { variables: number; equations: number };
export function executeEpanetAction(
  action: "epanet.solve",
  content: string,
  params?: EpanetActionParams,
): {
  converged: boolean;
  iterations: number;
  maxFlowChange: number;
  pressures: Record<string, number>;
  flows: Record<string, number>;
};
export function executeEpanetAction(
  action: "epanet.summary",
  content: string,
  params?: EpanetActionParams,
): {
  title: string | undefined;
  junctions: number;
  reservoirs: number;
  tanks: number;
  pipes: number;
  pumps: number;
  valves: number;
};
export function executeEpanetAction(action: string, content: string, params?: EpanetActionParams): EpanetActionResult;
export function executeEpanetAction(action: string, content: string, params?: EpanetActionParams): EpanetActionResult {
  const net = parseInp(content);

  switch (action) {
    case "epanet.toModelica":
      return { modelica: epanetToModelica(net) };
    case "epanet.toDae": {
      const arena = lowerEpanetToDae(net, params?.title);
      return {
        variables: arena.getVarCount(),
        equations: arena.getEqCount(),
      };
    }
    case "epanet.solve": {
      const res = solveHydraulics(net);
      return {
        converged: res.converged,
        iterations: res.iterations,
        maxFlowChange: res.maxFlowChange,
        pressures: Object.fromEntries(res.nodePressures),
        flows: Object.fromEntries(res.linkFlows),
      };
    }
    case "epanet.summary":
      return {
        title: net.title,
        junctions: net.junctions.length,
        reservoirs: net.reservoirs.length,
        tanks: net.tanks.length,
        pipes: net.pipes.length,
        pumps: net.pumps.length,
        valves: net.valves.length,
      };
    default:
      throw new Error(`Unknown EPANET LSP action: ${action}`);
  }
}
