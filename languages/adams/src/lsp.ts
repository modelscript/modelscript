// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Language Server Protocol (LSP) Service Integration.
 */

import { analyzeAdamsMobility, lintAdamsModel } from "./lints/index.js";
import { parseAdams } from "./parser/index.js";
import type { AdamsDataset } from "./types.js";

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

function findLineAndCol(text: string, searchPattern: string): LspRange {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = line.indexOf(searchPattern);
    if (match >= 0) {
      return {
        start: { line: i, character: match },
        end: { line: i, character: match + searchPattern.length },
      };
    }
  }
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };
}

/**
 * Validates MSC Adams deck and emits LSP diagnostics with M7301-M7310 codes.
 */
export function validateAdams(content: string): LspDiagnostic[] {
  let dataset: AdamsDataset;
  try {
    dataset = parseAdams(content);
  } catch (err: any) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M7300",
        source: "adams-parser",
        message: `Parse error: ${err.message}`,
      },
    ];
  }

  const rawDiags = lintAdamsModel(dataset);
  return rawDiags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: {
        start: { line: Math.max(0, d.range.startLine - 1), character: Math.max(0, d.range.startColumn - 1) },
        end: { line: Math.max(0, d.range.endLine - 1), character: Math.max(0, d.range.endColumn - 1) },
      },
      severity: sev,
      code: d.code,
      source: "adams-linter",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical DocumentSymbols from an MSC Adams model.
 */
export function getAdamsDocumentSymbols(content: string): LspDocumentSymbol[] {
  let dataset: AdamsDataset;
  try {
    dataset = parseAdams(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  // Group markers by part
  const markersByPart = new Map<string | number, typeof dataset.markers extends Map<any, infer V> ? V[] : never[]>();
  for (const marker of dataset.markers.values()) {
    const list = markersByPart.get(marker.partId) ?? [];
    list.push(marker);
    markersByPart.set(marker.partId, list);
  }

  // Parts
  for (const part of dataset.parts.values()) {
    const searchId = `PART/${part.id}`;
    const range = findLineAndCol(content, searchId);
    const markerChildren: LspDocumentSymbol[] = (markersByPart.get(part.id) ?? []).map((m) => {
      const mRange = findLineAndCol(content, `MARKER/${m.id}`);
      return {
        name: `MARKER/${m.id}`,
        detail: `(${m.position.x}, ${m.position.y}, ${m.position.z})`,
        kind: LspSymbolKind.Field,
        range: mRange,
        selectionRange: mRange,
      };
    });

    symbols.push({
      name: part.isGround ? `PART/${part.id} (GROUND)` : `PART/${part.id}`,
      detail: part.isGround
        ? "Ground Reference"
        : `mass: ${part.mass} kg, I=[${part.inertia.ixx}, ${part.inertia.iyy}, ${part.inertia.izz}]`,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
      children: markerChildren.length > 0 ? markerChildren : undefined,
    });
  }

  // Joints
  for (const joint of dataset.joints.values()) {
    const searchId = `JOINT/${joint.id}`;
    const range = findLineAndCol(content, searchId);
    symbols.push({
      name: searchId,
      detail: `${joint.type} [I=${joint.iMarkerId} -> J=${joint.jMarkerId}], DOF=${joint.dofCount}`,
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
    });
  }

  // Forces
  for (const force of dataset.forces.values()) {
    const searchId = `${force.type}/${force.id}`;
    const range = findLineAndCol(content, searchId);
    const detail =
      force.type === "SPRINGDAMPER"
        ? `K=${force.stiffness ?? 0} N/m, C=${force.damping ?? 0} Ns/m`
        : `${force.actionType ?? "TRANSLATIONAL"}`;
    symbols.push({
      name: searchId,
      detail,
      kind: LspSymbolKind.Property,
      range,
      selectionRange: range,
    });
  }

  // Motions
  for (const mot of dataset.motions.values()) {
    const searchId = `MOTION/${mot.id}`;
    const range = findLineAndCol(content, searchId);
    symbols.push({
      name: searchId,
      detail: `${mot.type}: ${mot.functionExpr}`,
      kind: LspSymbolKind.Event,
      range,
      selectionRange: range,
    });
  }

  return symbols;
}

/**
 * Returns contextual Markdown hover documentation for the token under cursor.
 */
export function getAdamsHover(content: string, offset: number): LspHover | null {
  let dataset: AdamsDataset;
  try {
    dataset = parseAdams(content);
  } catch {
    return null;
  }

  // Extract word under cursor
  let start = offset;
  let end = offset;
  while (start > 0 && /[\w/.]/.test(content[start - 1] ?? "")) {
    start--;
  }
  while (end < content.length && /[\w/.]/.test(content[end] ?? "")) {
    end++;
  }
  const token = content.slice(start, end).trim();
  if (!token) return null;

  const upper = token.toUpperCase();

  // 1. Part hover
  for (const part of dataset.parts.values()) {
    if (upper === `PART/${part.id}` || upper === `PART_${part.id}` || upper === String(part.id)) {
      const mobility = analyzeAdamsMobility(dataset);
      return {
        contents: {
          kind: "markdown",
          value: `### MSC Adams Part: \`${part.name}\` (ID: ${part.id})
- **Type**: ${part.isGround ? "**Ground Reference Body**" : "Rigid Body"}
- **Mass**: \`${part.mass} kg\`
- **Inertia Tensor**:
  - $I_{xx} = ${part.inertia.ixx}$
  - $I_{yy} = ${part.inertia.iyy}$
  - $I_{zz} = ${part.inertia.izz}$
- **Center of Mass Marker**: \`${part.cmMarkerId ?? "origin"}\`
- **System Mobility**: \`${mobility.calculatedMobility} DOF\` (${mobility.isOverconstrained ? "Overconstrained" : "Feasible"})
`,
        },
      };
    }
  }

  // 2. Joint hover
  for (const joint of dataset.joints.values()) {
    if (upper === `JOINT/${joint.id}` || upper === `JOINT_${joint.id}` || upper === String(joint.id)) {
      return {
        contents: {
          kind: "markdown",
          value: `### MSC Adams Joint: \`${joint.name}\` (ID: ${joint.id})
- **Joint Type**: \`${joint.type}\`
- **Degrees of Freedom**: \`${joint.dofCount}\`
- **Constraints Imposed**: \`${6 - joint.dofCount}\`
- **Base Marker (I)**: \`${joint.iMarkerId}\`
- **Follower Marker (J)**: \`${joint.jMarkerId}\`
`,
        },
      };
    }
  }

  // 3. Force hover
  for (const force of dataset.forces.values()) {
    if (upper.includes(String(force.id)) && upper.includes(force.type)) {
      return {
        contents: {
          kind: "markdown",
          value: `### MSC Adams Force: \`${force.name}\` (ID: ${force.id})
- **Type**: \`${force.type}\` (${force.actionType ?? "TRANSLATIONAL"})
- **Stiffness (K)**: \`${force.stiffness ?? 0} N/m\`
- **Damping (C)**: \`${force.damping ?? 0} Ns/m\`
- **Free Length**: \`${force.freeLength ?? 0} m\`
- **Connected Markers**: \`I=${force.iMarkerId}\` $\\longleftrightarrow$ \`J=${force.jMarkerId}\`
`,
        },
      };
    }
  }

  return null;
}
