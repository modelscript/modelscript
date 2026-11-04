// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opensim — Language Server Protocol (LSP) Service Integration.
 *
 * Provides validation, document symbols, biomechanical hover cards,
 * completions, go-to-definition, and custom OpenSim action execution.
 */

import { lowerOpenSimToDae } from "./dae/index.js";
import { lintOpenSimDocument } from "./lints/index.js";
import { parseOpenSim } from "./parser/index.js";
import { openSimToModelica, openSimToUrdf } from "./projections/index.js";
import {
  simulateMuscleDynamics,
  type OpenSimSimulationOptions,
  type OpenSimSimulationResult,
} from "./solvers/index.js";
import type { OpenSimDiagnostic, OpenSimDocument, OpenSimSourceRange } from "./types.js";

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

export interface LspCompletionItem {
  label: string;
  kind: number;
  detail?: string | undefined;
  documentation?: string | undefined;
  insertText?: string | undefined;
}

function toLspRange(r: OpenSimSourceRange): LspRange {
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

function resolveOffset(content: string, positionOrOffset: LspPosition | number): number {
  if (typeof positionOrOffset === "number") {
    return positionOrOffset;
  }
  let line = 0;
  let i = 0;
  while (i < content.length && line < positionOrOffset.line) {
    if (content[i] === "\n") {
      line++;
    }
    i++;
  }
  return Math.min(content.length, i + Math.max(0, positionOrOffset.character));
}

export function validateOpenSimDocument(content: string): LspDiagnostic[] {
  let doc: OpenSimDocument;
  try {
    doc = parseOpenSim(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M9100",
        source: "opensim-parser",
        message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const diags = lintOpenSimDocument(doc);
  return diags.map((d) => {
    let sev: 1 | 2 | 3 | 4 = 1;
    if (d.severity === "warning") sev = 2;
    else if (d.severity === "info") sev = 3;

    return {
      range: toLspRange(d.range),
      severity: sev,
      code: d.code,
      source: "opensim-linter",
      message: d.message,
    };
  });
}

export const validateOpenSim = validateOpenSimDocument;

export function getOpenSimDocumentSymbols(content: string): LspDocumentSymbol[] {
  let doc: OpenSimDocument;
  try {
    doc = parseOpenSim(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  for (const b of doc.bodies) {
    const r = toLspRange(b.range);
    symbols.push({
      name: b.name,
      detail: `Body (${b.mass} kg)`,
      kind: LspSymbolKind.Struct,
      range: r,
      selectionRange: r,
    });
  }

  for (const j of doc.joints) {
    const r = toLspRange(j.range);
    const children: LspDocumentSymbol[] = j.coordinates.map((c) => {
      const cr = toLspRange(c.range);
      return {
        name: c.name,
        detail: `${c.motionType} [${c.rangeMin}, ${c.rangeMax}]`,
        kind: LspSymbolKind.Variable,
        range: cr,
        selectionRange: cr,
      };
    });

    symbols.push({
      name: j.name,
      detail: `${j.jointType} (${j.parentFrame} -> ${j.childFrame})`,
      kind: LspSymbolKind.Class,
      range: r,
      selectionRange: r,
      children,
    });
  }

  for (const m of doc.muscles) {
    const r = toLspRange(m.range);
    symbols.push({
      name: m.name,
      detail: `${m.muscleType} (F0=${m.maxIsometricForce} N, l0=${m.optimalFiberLength} m)`,
      kind: LspSymbolKind.Function,
      range: r,
      selectionRange: r,
    });
  }

  for (const mk of doc.markers) {
    const r = toLspRange(mk.range);
    symbols.push({
      name: mk.name,
      detail: `Marker (${mk.bodyFrame})`,
      kind: LspSymbolKind.Constant,
      range: r,
      selectionRange: r,
    });
  }

  for (const w of doc.wrapObjects) {
    const r = toLspRange(w.range);
    symbols.push({
      name: w.name,
      detail: `${w.wrapType} (${w.bodyFrame}, r=${w.radius} m)`,
      kind: LspSymbolKind.Property,
      range: r,
      selectionRange: r,
    });
  }

  for (const c of doc.constraints) {
    const r = toLspRange(c.range);
    symbols.push({
      name: c.name,
      detail: `${c.constraintType} (${c.body1} <-> ${c.body2})`,
      kind: LspSymbolKind.Event,
      range: r,
      selectionRange: r,
    });
  }

  return symbols;
}

export function provideOpenSimHover(content: string, positionOrOffset: LspPosition | number): LspHover | null {
  let doc: OpenSimDocument;
  try {
    doc = parseOpenSim(content);
  } catch {
    return null;
  }

  const offset = resolveOffset(content, positionOrOffset);

  for (const j of doc.joints) {
    for (const c of j.coordinates) {
      if (offset >= c.range.startOffset && offset <= c.range.endOffset) {
        return {
          contents: {
            kind: "markdown",
            value: [
              `### OpenSim Coordinate: **${c.name}**`,
              `* **Joint:** \`${j.name}\` (\`${j.jointType}\`)`,
              `* **Motion Type:** \`${c.motionType}\``,
              `* **Default Value:** \`${c.defaultValue}\``,
              `* **Range:** \`[${c.rangeMin}, ${c.rangeMax}]\``,
              `* **Clamped / Locked:** \`${c.clamped}\` / \`${c.locked}\``,
            ].join("\n"),
          },
          range: toLspRange(c.range),
        };
      }
    }

    if (offset >= j.range.startOffset && offset <= j.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### OpenSim Joint: **${j.name}** (\`${j.jointType}\`)`,
            `* **Parent Frame:** \`${j.parentFrame}\``,
            `* **Child Frame:** \`${j.childFrame}\``,
            `* **Coordinates:** \`${j.coordinates.map((c) => c.name).join(", ") || "none"}\``,
          ].join("\n"),
        },
        range: toLspRange(j.range),
      };
    }
  }

  for (const m of doc.muscles) {
    if (offset >= m.range.startOffset && offset <= m.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### Hill-Type Muscle: **${m.name}** (\`${m.muscleType}\`)`,
            `* **Max Isometric Force ($F_0^M$):** \`${m.maxIsometricForce} N\``,
            `* **Optimal Fiber Length ($l_0^M$):** \`${m.optimalFiberLength} m\``,
            `* **Tendon Slack Length ($l_s^T$):** \`${m.tendonSlackLength} m\``,
            `* **Pennation Angle ($\\alpha_0$):** \`${m.pennationAngleAtOptimal} rad\``,
            `* **Time Constants ($\\tau_{\\text{act}}, \\tau_{\\text{deact}}$):** \`${m.activationTimeConstant} s, ${m.deactivationTimeConstant} s\``,
            `* **Path Points:** \`${m.pathPoints.length}\``,
          ].join("\n"),
        },
        range: toLspRange(m.range),
      };
    }
  }

  for (const b of doc.bodies) {
    if (offset >= b.range.startOffset && offset <= b.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### OpenSim Rigid Body: **${b.name}**`,
            `* **Mass:** \`${b.mass} kg\``,
            `* **Mass Center:** \`[${b.massCenter.join(", ")}] m\``,
            `* **Inertia ($I_{xx}, I_{yy}, I_{zz}$):** \`[${b.inertia.slice(0, 3).join(", ")}] kg·m²\``,
          ].join("\n"),
        },
        range: toLspRange(b.range),
      };
    }
  }

  for (const w of doc.wrapObjects) {
    if (offset >= w.range.startOffset && offset <= w.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### OpenSim WrapObject: **${w.name}** (\`${w.wrapType}\`)`,
            `* **Body Frame:** \`${w.bodyFrame}\``,
            `* **Radius:** \`${w.radius} m\``,
            `* **Length:** \`${w.length} m\``,
          ].join("\n"),
        },
        range: toLspRange(w.range),
      };
    }
  }

  for (const mk of doc.markers) {
    if (offset >= mk.range.startOffset && offset <= mk.range.endOffset) {
      return {
        contents: {
          kind: "markdown",
          value: [
            `### OpenSim Marker: **${mk.name}**`,
            `* **Body Frame:** \`${mk.bodyFrame}\``,
            `* **Location:** \`[${mk.location.join(", ")}] m\``,
          ].join("\n"),
        },
        range: toLspRange(mk.range),
      };
    }
  }

  return null;
}

export const getOpenSimHover = provideOpenSimHover;

export function provideOpenSimCompletions(
  content: string,
  _positionOrOffset?: LspPosition | number,
): LspCompletionItem[] {
  const items: LspCompletionItem[] = [
    {
      label: "Body",
      kind: 14,
      detail: "OpenSim Rigid Body",
      insertText:
        '<Body name="segment"><mass>1.0</mass><mass_center>0 0 0</mass_center><inertia>0.1 0.1 0.1 0 0 0</inertia></Body>',
    },
    {
      label: "PinJoint",
      kind: 14,
      detail: "OpenSim 1-DOF Revolute PinJoint",
      insertText:
        '<PinJoint name="joint_1"><socket_parent_frame>ground</socket_parent_frame><socket_child_frame>segment</socket_child_frame></PinJoint>',
    },
    {
      label: "SliderJoint",
      kind: 14,
      detail: "OpenSim 1-DOF Prismatic SliderJoint",
    },
    {
      label: "Thelen2003Muscle",
      kind: 14,
      detail: "Hill-Type Thelen2003Muscle",
      insertText:
        '<Thelen2003Muscle name="muscle_1"><max_isometric_force>1000</max_isometric_force><optimal_fiber_length>0.1</optimal_fiber_length><tendon_slack_length>0.2</tendon_slack_length></Thelen2003Muscle>',
    },
    {
      label: "Millard2012EquilibriumMuscle",
      kind: 14,
      detail: "Hill-Type Millard2012EquilibriumMuscle",
    },
    {
      label: "Schutte1993Muscle",
      kind: 14,
      detail: "Hill-Type Schutte1993Muscle",
    },
    {
      label: "WrapCylinder",
      kind: 14,
      detail: "OpenSim Cylindrical Muscle Wrapping Surface",
    },
  ];

  try {
    const doc = parseOpenSim(content);
    for (const b of doc.bodies) {
      items.push({
        label: b.name,
        kind: 6,
        detail: `Body ${b.name} (${b.mass} kg)`,
      });
    }
    for (const j of doc.joints) {
      items.push({
        label: j.name,
        kind: 7,
        detail: `Joint ${j.name} (${j.jointType})`,
      });
      for (const c of j.coordinates) {
        items.push({
          label: c.name,
          kind: 6,
          detail: `Coordinate ${c.name} (${c.motionType})`,
        });
      }
    }
    for (const m of doc.muscles) {
      items.push({
        label: m.name,
        kind: 3,
        detail: `Muscle ${m.name} (${m.muscleType})`,
      });
    }
    for (const w of doc.wrapObjects) {
      items.push({
        label: w.name,
        kind: 10,
        detail: `WrapObject ${w.name} (${w.wrapType})`,
      });
    }
  } catch {
    // ignore parse errors during completion
  }

  return items;
}

export const getOpenSimCompletions = provideOpenSimCompletions;

function extractWordAtOffset(text: string, offset: number): string {
  if (offset < 0 || offset > text.length) return "";
  const isWordChar = (ch: string | undefined) => Boolean(ch && /[A-Za-z0-9_/-]/.test(ch));
  let start = offset;
  while (start > 0 && isWordChar(text[start - 1])) {
    start--;
  }
  let end = offset;
  while (end < text.length && isWordChar(text[end])) {
    end++;
  }
  return text
    .slice(start, end)
    .replace(/^\/?bodyset\//i, "")
    .replace(/^\//, "");
}

export function provideOpenSimDefinition(
  content: string,
  positionOrOffset: LspPosition | number,
  uri = "file:///model.osim",
): LspLocation | null {
  let doc: OpenSimDocument;
  try {
    doc = parseOpenSim(content, uri);
  } catch {
    return null;
  }

  const offset = resolveOffset(content, positionOrOffset);
  const word = extractWordAtOffset(content, offset);

  if (word) {
    const body = doc.bodies.find((b) => b.name === word || b.id === word);
    if (body) return { uri, range: toLspRange(body.range) };

    const joint = doc.joints.find((j) => j.name === word || j.id === word);
    if (joint) return { uri, range: toLspRange(joint.range) };

    for (const j of doc.joints) {
      const coord = j.coordinates.find((c) => c.name === word || c.id === word);
      if (coord) return { uri, range: toLspRange(coord.range) };
    }

    const wrap = doc.wrapObjects.find((w) => w.name === word || w.id === word);
    if (wrap) return { uri, range: toLspRange(wrap.range) };

    const muscle = doc.muscles.find((m) => m.name === word || m.id === word);
    if (muscle) return { uri, range: toLspRange(muscle.range) };

    const marker = doc.markers.find((mk) => mk.name === word || mk.id === word);
    if (marker) return { uri, range: toLspRange(marker.range) };
  }

  // Contextual fallback: Marker / WrapObject / PathPoint -> Body
  for (const mk of doc.markers) {
    if (offset >= mk.range.startOffset && offset <= mk.range.endOffset) {
      const b = doc.bodies.find((x) => x.name === mk.bodyFrame || x.id === mk.bodyFrame);
      if (b) return { uri, range: toLspRange(b.range) };
    }
  }
  for (const w of doc.wrapObjects) {
    if (offset >= w.range.startOffset && offset <= w.range.endOffset) {
      const b = doc.bodies.find((x) => x.name === w.bodyFrame || x.id === w.bodyFrame);
      if (b) return { uri, range: toLspRange(b.range) };
    }
  }

  return null;
}

export const getOpenSimDefinition = provideOpenSimDefinition;

export async function executeOpenSimAction(
  actionId: "opensim_lint" | "lint_opensim",
  content: string,
  params?: Record<string, unknown>,
): Promise<OpenSimDiagnostic[]>;
export async function executeOpenSimAction(
  actionId: "opensim_simulate" | "simulate_opensim",
  content: string,
  params?: OpenSimSimulationOptions,
): Promise<OpenSimSimulationResult>;
export async function executeOpenSimAction(
  actionId: "opensim_to_dae",
  content: string,
  params?: Record<string, unknown>,
): Promise<{ modelName: string; variableCount: number; equationCount: number }>;
export async function executeOpenSimAction(
  actionId: "opensim_to_modelica" | "opensim_to_urdf",
  content: string,
  params?: Record<string, unknown>,
): Promise<string>;
export async function executeOpenSimAction(
  actionId: string,
  content: string,
  params?: OpenSimSimulationOptions | Record<string, unknown>,
): Promise<unknown>;
export async function executeOpenSimAction(
  actionId: string,
  content: string,
  params?: OpenSimSimulationOptions | Record<string, unknown>,
): Promise<unknown> {
  const doc = parseOpenSim(content);

  switch (actionId) {
    case "opensim_lint":
    case "lint_opensim":
      return lintOpenSimDocument(doc);

    case "opensim_simulate":
    case "simulate_opensim":
      return simulateMuscleDynamics(doc, params as OpenSimSimulationOptions | undefined);

    case "opensim_to_dae": {
      const arena = lowerOpenSimToDae(doc);
      return {
        modelName: doc.modelName,
        variableCount: arena.getVarCount(),
        equationCount: arena.getEqCount(),
      };
    }

    case "opensim_to_modelica":
      return openSimToModelica(doc);

    case "opensim_to_urdf":
      return openSimToUrdf(doc);

    default:
      throw new Error(`Unknown OpenSim action: ${actionId}`);
  }
}
