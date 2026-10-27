// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Language Server Protocol (LSP) Service Integration.
 */

import { keplerianToCartesian, propagateOrbit } from "./astrodynamics/orbital-mechanics.js";
import { lowerCcsdsToDae } from "./dae/ccsds-to-dae.js";
import { lintCcsds } from "./lints/rules.js";
import { parseCcsds } from "./parser/index.js";
import { ccsdsToModelica } from "./projections/ccsds-to-modelica.js";
import { ccsdsToSysml } from "./projections/ccsds-to-sysml.js";
import type { CcsdsDocument } from "./types.js";

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

export function validateCcsds(content: string, filename?: string): LspDiagnostic[] {
  let doc: CcsdsDocument;
  try {
    doc = parseCcsds(content, filename);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M8200",
        source: "ccsds-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintCcsds(doc);
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
      source: "ccsds-linter",
      message: d.message,
    };
  });
}

export function getCcsdsDocumentSymbols(content: string, filename?: string): LspDocumentSymbol[] {
  let doc: CcsdsDocument;
  try {
    doc = parseCcsds(content, filename);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  if (doc.format === "XTCE") {
    const rootSymbol: LspDocumentSymbol = {
      name: doc.name,
      detail: `SpaceSystem (${doc.parameters.length} params, ${doc.containers.length} containers)`,
      kind: LspSymbolKind.Package,
      range: {
        start: { line: 0, character: 0 },
        end: { line: doc.range.endLine, character: doc.range.endColumn },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: doc.name.length },
      },
      children: [],
    };

    for (const p of doc.parameters) {
      rootSymbol.children!.push({
        name: p.name,
        detail: `${p.paramType} [${p.bitLength} bits]${p.units ? " " + p.units : ""}`,
        kind: LspSymbolKind.Variable,
        range: {
          start: { line: p.range.startLine - 1, character: p.range.startColumn - 1 },
          end: { line: p.range.endLine - 1, character: p.range.endColumn - 1 },
        },
        selectionRange: {
          start: { line: p.range.startLine - 1, character: p.range.startColumn - 1 },
          end: { line: p.range.endLine - 1, character: p.range.endColumn - 1 },
        },
      });
    }

    for (const c of doc.containers) {
      rootSymbol.children!.push({
        name: c.name,
        detail: `SequenceContainer (${c.entries.length} entries)`,
        kind: LspSymbolKind.Class,
        range: {
          start: { line: c.range.startLine - 1, character: c.range.startColumn - 1 },
          end: { line: c.range.endLine - 1, character: c.range.endColumn - 1 },
        },
        selectionRange: {
          start: { line: c.range.startLine - 1, character: c.range.startColumn - 1 },
          end: { line: c.range.endLine - 1, character: c.range.endColumn - 1 },
        },
      });
    }

    symbols.push(rootSymbol);
  } else {
    const rootSymbol: LspDocumentSymbol = {
      name: doc.metadata.objectName,
      detail: `${doc.format} (${doc.metadata.refFrame}, ${doc.metadata.timeSystem})`,
      kind: LspSymbolKind.Class,
      range: {
        start: { line: 0, character: 0 },
        end: { line: doc.range.endLine, character: doc.range.endColumn },
      },
      selectionRange: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: doc.metadata.objectName.length },
      },
      children: [],
    };

    if (doc.format === "OEM") {
      rootSymbol.children!.push({
        name: "EphemerisPoints",
        detail: `${doc.points.length} points`,
        kind: LspSymbolKind.Array,
        range: {
          start: { line: 0, character: 0 },
          end: { line: doc.range.endLine, character: doc.range.endColumn },
        },
        selectionRange: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 15 },
        },
      });
    } else if (doc.format === "OPM") {
      rootSymbol.children!.push({
        name: "StateVector",
        detail: `Epoch ${doc.stateVector.epoch}`,
        kind: LspSymbolKind.Struct,
        range: {
          start: { line: 0, character: 0 },
          end: { line: doc.range.endLine, character: doc.range.endColumn },
        },
        selectionRange: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 11 },
        },
      });
    }

    symbols.push(rootSymbol);
  }

  return symbols;
}

export function getCcsdsHover(content: string, offset: number, filename?: string): LspHover | null {
  let doc: CcsdsDocument;
  try {
    doc = parseCcsds(content, filename);
  } catch {
    return null;
  }

  if (doc.format === "XTCE") {
    for (const p of doc.parameters) {
      if (offset >= p.range.startOffset && offset <= p.range.endOffset) {
        return {
          contents: {
            kind: "markdown",
            value: [
              `### Telemetry Parameter \`${p.name}\``,
              `- **Type:** \`${p.paramType}\``,
              `- **Bit Length:** ${p.bitLength} bits`,
              `- **Signed:** ${p.signed ?? true}`,
              p.units ? `- **Units:** \`${p.units}\`` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        };
      }
    }
  } else {
    if (doc.format === "OEM") {
      for (const pt of doc.points) {
        if (offset >= pt.range.startOffset && offset <= pt.range.endOffset) {
          const r = Math.sqrt(pt.x * pt.x + pt.y * pt.y + pt.z * pt.z);
          const v = Math.sqrt(pt.vx * pt.vx + pt.vy * pt.vy + pt.vz * pt.vz);
          return {
            contents: {
              kind: "markdown",
              value: [
                `### Ephemeris Point at \`${pt.epoch}\``,
                `- **Position (ECI):** [${pt.x.toFixed(2)}, ${pt.y.toFixed(2)}, ${pt.z.toFixed(2)}] km`,
                `- **Velocity:** [${pt.vx.toFixed(3)}, ${pt.vy.toFixed(3)}, ${pt.vz.toFixed(3)}] km/s`,
                `- **Radius:** ${r.toFixed(2)} km (Altitude: ${(r - 6378.137).toFixed(2)} km)`,
                `- **Speed:** ${v.toFixed(3)} km/s`,
              ].join("\n"),
            },
          };
        }
      }
    }
  }

  return null;
}

export interface CcsdsActionParams {
  filename?: string | undefined;
  title?: string | undefined;
  duration?: number | undefined;
  step?: number | undefined;
  includeJ2?: boolean | undefined;
  includeDrag?: boolean | undefined;
}

export function executeCcsdsAction(
  action: "ccsds.toModelica",
  content: string,
  params?: CcsdsActionParams,
): { modelica: string };
export function executeCcsdsAction(
  action: "ccsds.toSysml",
  content: string,
  params?: CcsdsActionParams,
): { sysml: string };
export function executeCcsdsAction(
  action: "ccsds.toDae",
  content: string,
  params?: CcsdsActionParams,
): { variables: number; equations: number };
export function executeCcsdsAction(
  action: "ccsds.propagate",
  content: string,
  params?: CcsdsActionParams,
): { pointCount: number; points: ReturnType<typeof propagateOrbit> };
export function executeCcsdsAction(
  action: "ccsds.summary",
  content: string,
  params?: CcsdsActionParams,
): { format: string; name: string; details: Record<string, unknown> };
export function executeCcsdsAction(action: string, content: string, params?: CcsdsActionParams): unknown;
export function executeCcsdsAction(action: string, content: string, params?: CcsdsActionParams): unknown {
  const doc = parseCcsds(content, params?.filename);

  switch (action) {
    case "ccsds.toModelica":
      return { modelica: ccsdsToModelica(doc) };
    case "ccsds.toSysml":
      return { sysml: ccsdsToSysml(doc) };
    case "ccsds.toDae": {
      const arena = lowerCcsdsToDae(doc, params?.title);
      return {
        variables: arena.getVarCount(),
        equations: arena.getEqCount(),
      };
    }
    case "ccsds.propagate": {
      let initPos: [number, number, number] = [7000, 0, 0];
      let initVel: [number, number, number] = [0, 7.546, 0];

      if (doc.format === "OPM") {
        if (doc.stateVector.x !== 0 || doc.stateVector.y !== 0) {
          initPos = [doc.stateVector.x, doc.stateVector.y, doc.stateVector.z];
          initVel = [doc.stateVector.vx, doc.stateVector.vy, doc.stateVector.vz];
        } else if (doc.keplerian) {
          const sv = keplerianToCartesian(doc.keplerian);
          initPos = [sv.x, sv.y, sv.z];
          initVel = [sv.vx, sv.vy, sv.vz];
        }
      } else if (doc.format === "OEM" && doc.points.length > 0) {
        const p0 = doc.points[0]!;
        initPos = [p0.x, p0.y, p0.z];
        initVel = [p0.vx, p0.vy, p0.vz];
      }

      const traj = propagateOrbit(
        { x: initPos[0], y: initPos[1], z: initPos[2], vx: initVel[0], vy: initVel[1], vz: initVel[2] },
        "spacecraft" in doc ? doc.spacecraft : undefined,
        {
          durationSeconds: params?.duration ?? 5400,
          stepSeconds: params?.step ?? 30,
          includeJ2: params?.includeJ2 ?? true,
          includeDrag: params?.includeDrag ?? false,
        },
      );

      return {
        pointCount: traj.length,
        points: traj,
      };
    }
    case "ccsds.summary":
      return {
        format: doc.format,
        name: doc.format === "XTCE" ? doc.name : doc.metadata.objectName,
        details:
          doc.format === "XTCE"
            ? { parameters: doc.parameters.length, containers: doc.containers.length }
            : doc.format === "OEM"
              ? { points: doc.points.length, refFrame: doc.metadata.refFrame }
              : { refFrame: doc.metadata.refFrame },
      };
    default:
      throw new Error(`Unknown CCSDS LSP action: ${action}`);
  }
}
