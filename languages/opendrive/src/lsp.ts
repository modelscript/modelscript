// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/opendrive — Language Server Protocol (LSP) Service Integration.
 */

import { lowerOpenDriveToDae } from "./dae/opendrive-to-dae.js";
import { sampleRoadTrack } from "./geometry/clothoid.js";
import { lintOpenDrive } from "./lints/rules.js";
import { parseOpenDrive } from "./parser/index.js";
import { opendriveToGensys } from "./projections/opendrive-to-gensys.js";
import type { OpenDriveDocument } from "./types.js";

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

export function validateOpenDrive(content: string): LspDiagnostic[] {
  let doc: OpenDriveDocument;
  try {
    doc = parseOpenDrive(content);
  } catch (err: any) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M7800",
        source: "opendrive-parser",
        message: `Parse error: ${err.message}`,
      },
    ];
  }

  const rawDiags = lintOpenDrive(doc);
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
      source: "opendrive-linter",
      message: d.message,
    };
  });
}

export function getOpenDriveDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: OpenDriveDocument;
  try {
    doc = parseOpenDrive(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  // Roads
  for (const road of doc.roads) {
    const startLine = Math.max(0, road.range.startLine - 1);
    const startCol = Math.max(0, road.range.startColumn - 1);
    const endLine = Math.max(0, road.range.endLine - 1);
    const endCol = Math.max(0, road.range.endColumn - 1);

    const roadRange: LspRange = {
      start: { line: startLine, character: startCol },
      end: { line: endLine, character: endCol },
    };

    const geomChildren: LspDocumentSymbol[] = road.planView.map((g, gi) => ({
      name: `geom_${gi}_${g.type}`,
      detail: `s=${g.s.toFixed(1)}m, len=${g.length.toFixed(1)}m`,
      kind: LspSymbolKind.Field,
      range: {
        start: {
          line: Math.max(0, g.range.startLine - 1),
          character: Math.max(0, g.range.startColumn - 1),
        },
        end: {
          line: Math.max(0, g.range.endLine - 1),
          character: Math.max(0, g.range.endColumn - 1),
        },
      },
      selectionRange: {
        start: {
          line: Math.max(0, g.range.startLine - 1),
          character: Math.max(0, g.range.startColumn - 1),
        },
        end: {
          line: Math.max(0, g.range.endLine - 1),
          character: Math.max(0, g.range.endColumn - 1),
        },
      },
    }));

    symbols.push({
      name: road.name ? `${road.name} (ID: ${road.id})` : `Road_${road.id}`,
      detail: `length=${road.length.toFixed(1)}m, ${road.planView.length} geoms`,
      kind: LspSymbolKind.Class,
      range: roadRange,
      selectionRange: roadRange,
      children: geomChildren,
    });
  }

  // Junctions
  for (const junc of doc.junctions) {
    const startLine = Math.max(0, junc.range.startLine - 1);
    const startCol = Math.max(0, junc.range.startColumn - 1);
    const endLine = Math.max(0, junc.range.endLine - 1);
    const endCol = Math.max(0, junc.range.endColumn - 1);

    const jRange: LspRange = {
      start: { line: startLine, character: startCol },
      end: { line: endLine, character: endCol },
    };

    symbols.push({
      name: junc.name ? `${junc.name} (ID: ${junc.id})` : `Junction_${junc.id}`,
      detail: `${junc.connections.length} connections`,
      kind: LspSymbolKind.Package,
      range: jRange,
      selectionRange: jRange,
    });
  }

  return symbols;
}

export function getOpenDriveHover(content: string, offset: number): LspHover | null {
  let doc: OpenDriveDocument;
  try {
    doc = parseOpenDrive(content);
  } catch {
    return null;
  }

  for (const road of doc.roads) {
    if (offset >= road.range.startOffset && offset <= road.range.endOffset) {
      // Check geometry hover
      for (let gi = 0; gi < road.planView.length; gi++) {
        const g = road.planView[gi]!;
        if (offset >= g.range.startOffset && offset <= g.range.endOffset) {
          const lines = [
            `### OpenDRIVE Geometry **[${gi}]: ${g.type.toUpperCase()}**`,
            `* Start: \`s = ${g.s.toFixed(2)}m\``,
            `* Length: \`${g.length.toFixed(2)}m\``,
            `* Origin: \`(${g.x.toFixed(2)}, ${g.y.toFixed(2)})\``,
            `* Heading: \`${g.hdg.toFixed(4)} rad\` (\`${((g.hdg * 180) / Math.PI).toFixed(1)}°\`)`,
          ];
          if (g.type === "arc") {
            lines.push(`* Curvature: \`${g.curvature.toFixed(6)} 1/m\` (R = ${(1.0 / g.curvature).toFixed(1)}m)`);
          } else if (g.type === "spiral") {
            lines.push(`* Curvature: \`${g.curvStart.toFixed(6)} -> ${g.curvEnd.toFixed(6)} 1/m\``);
          }
          return {
            contents: {
              kind: "markdown",
              value: lines.join("\n"),
            },
          };
        }
      }

      // Hover on road header
      return {
        contents: {
          kind: "markdown",
          value: [
            `### OpenDRIVE Road: **${road.name ?? road.id}**`,
            `* **ID:** \`${road.id}\``,
            `* **Length:** \`${road.length.toFixed(2)} m\``,
            `* **Junction:** \`${road.junction}\``,
            `* **Geometry Segments:** ${road.planView.length}`,
            `* **Lane Sections:** ${road.lanes.laneSections.length}`,
            `* **Signals:** ${road.signals.length}`,
          ].join("\n"),
        },
      };
    }
  }

  return null;
}

export async function executeOpenDriveAction(actionId: string, content: string, params?: any): Promise<any> {
  const doc = parseOpenDrive(content);

  switch (actionId) {
    case "opendrive_lint":
      return lintOpenDrive(doc);

    case "opendrive_sample_track": {
      const step = params?.step ?? 1.0;
      return doc.roads.map((r) => ({
        roadId: r.id,
        name: r.name,
        points: sampleRoadTrack(r, step),
      }));
    }

    case "opendrive_to_dae": {
      const arena = lowerOpenDriveToDae(doc);
      return {
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    case "opendrive_to_gensys": {
      const step = params?.step ?? 1.0;
      return opendriveToGensys(doc, step);
    }

    default:
      throw new Error(`Unknown OpenDRIVE action: ${actionId}`);
  }
}
