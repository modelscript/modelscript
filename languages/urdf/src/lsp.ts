// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Language Server Protocol (LSP) Services Integration.
 */

import { lintUrdfRobot } from "./lints/index.js";
import { parseUrdf } from "./parser/index.js";
import type { UrdfRobot } from "./types.js";

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
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      let lineEnd = i;
      if (lineEnd > lineStart && text.charCodeAt(lineEnd - 1) === 13) {
        lineEnd--;
      }
      const lineStr = text.slice(lineStart, lineEnd);
      const match = lineStr.indexOf(searchPattern);
      if (match >= 0) {
        return {
          start: { line, character: match },
          end: { line, character: match + searchPattern.length },
        };
      }
      line++;
      lineStart = i + 1;
    }
  }
  const lastLine = text.slice(lineStart);
  const match = lastLine.indexOf(searchPattern);
  if (match >= 0) {
    return {
      start: { line, character: match },
      end: { line, character: match + searchPattern.length },
    };
  }
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  };
}

/**
 * Validates URDF/SDF XML document and returns diagnostics with M7501-M7508 codes.
 */
export function validateUrdf(content: string): LspDiagnostic[] {
  let robot: UrdfRobot;
  try {
    robot = parseUrdf(content);
  } catch (err: unknown) {
    return [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 },
        },
        severity: 1,
        code: "M7500",
        source: "urdf-parser",
        message: `XML Parse error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  const rawDiags = lintUrdfRobot(robot);
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
      source: "urdf-linter",
      message: d.message,
    };
  });
}

/**
 * Extracts hierarchical DocumentSymbols from a URDF robot model.
 */
export function getUrdfDocumentSymbols(content: string): LspDocumentSymbol[] {
  let robot: UrdfRobot;
  try {
    robot = parseUrdf(content);
  } catch {
    return [];
  }

  const symbols: LspDocumentSymbol[] = [];

  // Links
  for (const link of robot.links.values()) {
    const range = findLineAndCol(content, `<link name="${link.name}"`);
    const mass = link.inertial?.mass ?? 0;
    const detail = link.inertial
      ? `mass: ${mass} kg, I=[${link.inertial.ixx}, ${link.inertial.iyy}, ${link.inertial.izz}]`
      : "Visual/Collision Link";

    symbols.push({
      name: `Link: ${link.name}`,
      detail,
      kind: LspSymbolKind.Class,
      range,
      selectionRange: range,
    });
  }

  // Joints
  for (const joint of robot.joints.values()) {
    const range = findLineAndCol(content, `<joint name="${joint.name}"`);
    symbols.push({
      name: `Joint: ${joint.name}`,
      detail: `${joint.type} [${joint.parentLink} -> ${joint.childLink}]`,
      kind: LspSymbolKind.Interface,
      range,
      selectionRange: range,
    });
  }

  return symbols;
}

/**
 * Returns contextual Markdown hover documentation for the token under cursor.
 */
export function getUrdfHover(content: string, offset: number): LspHover | null {
  let robot: UrdfRobot;
  try {
    robot = parseUrdf(content);
  } catch {
    return null;
  }

  function isIdentifierChar(ch: number): boolean {
    return (
      (ch >= 48 && ch <= 57) || // 0-9
      (ch >= 65 && ch <= 90) || // A-Z
      (ch >= 97 && ch <= 122) || // a-z
      ch === 95 || // _
      ch === 47 || // /
      ch === 46 || // .
      ch === 58 || // :
      ch === 45 // -
    );
  }

  // Extract word under cursor
  let start = offset;
  let end = offset;
  while (start > 0 && isIdentifierChar(content.charCodeAt(start - 1))) {
    start--;
  }
  while (end < content.length && isIdentifierChar(content.charCodeAt(end))) {
    end++;
  }
  const token = content.slice(start, end).trim();
  if (!token) return null;

  // 1. Link hover
  if (robot.links.has(token)) {
    const link = robot.links.get(token)!;
    const mass = link.inertial?.mass ?? 0;
    return {
      contents: {
        kind: "markdown",
        value: `### ROS URDF Link: \`${link.name}\`
- **Mass**: \`${mass} kg\`
- **Inertia**:
  - $I_{xx} = ${link.inertial?.ixx ?? 0}$
  - $I_{yy} = ${link.inertial?.iyy ?? 0}$
  - $I_{zz} = ${link.inertial?.izz ?? 0}$
- **Visual Elements**: \`${link.visuals.length}\`
- **Collision Elements**: \`${link.collisions.length}\`
`,
      },
    };
  }

  // 2. Joint hover
  if (robot.joints.has(token)) {
    const joint = robot.joints.get(token)!;
    return {
      contents: {
        kind: "markdown",
        value: `### ROS URDF Joint: \`${joint.name}\`
- **Type**: \`${joint.type}\`
- **Parent Link**: \`${joint.parentLink}\`
- **Child Link**: \`${joint.childLink}\`
- **Axis**: \`[${joint.axis.x}, ${joint.axis.y}, ${joint.axis.z}]\`
- **Effort Limit**: \`${joint.limits?.effort ?? "unbounded"} N*m\`
- **Velocity Limit**: \`${joint.limits?.velocity ?? "unbounded"} rad/s\`
- **Range Limits**: \`[${joint.limits?.lower ?? "-inf"}, ${joint.limits?.upper ?? "+inf"}]\`
`,
      },
    };
  }

  return null;
}
