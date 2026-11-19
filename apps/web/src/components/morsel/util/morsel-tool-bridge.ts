// SPDX-License-Identifier: AGPL-3.0-or-later

import type { editor } from "monaco-editor";

export interface MorselToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface MorselToolCall {
  id?: string | undefined;
  name: string;
  arguments: Record<string, unknown>;
}

export interface MorselToolResult {
  toolCallId?: string | undefined;
  name: string;
  ok: boolean;
  output: string;
  previousCode?: string | undefined;
  editedCode?: string | undefined;
}

export interface MorselDiagnosticSummary {
  severity: string;
  message: string;
  line?: number | undefined;
  column?: number | undefined;
}

export interface MorselToolHost {
  getFileName: () => string;
  getDialect: () => string;
  getCode: () => string;
  getDiagnostics: () => MorselDiagnosticSummary[];
  getSelectedComponent: () => string | undefined;
  applyCodeEdit: (nextCode: string, description?: string) => boolean;
  runFlatten?: (() => Promise<{ ok: boolean; output: string }>) | undefined;
  runSimulate?: (() => Promise<{ ok: boolean; output: string }>) | undefined;
  switchView?: ((view: "code" | "diagram" | "simulation" | "3d" | "inspector" | "split") => void) | undefined;
  getDiagramSummary?: (() => Promise<string>) | undefined;
}

export const MORSEL_CORE_TOOLS: MorselToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "morsel_get_context",
      description: "Read the active file name, language dialect, source code, and current diagnostics in Ansatz.",
      parameters: {
        type: "object",
        properties: {
          startLine: { type: "integer", description: "Optional 1-indexed start line to slice code." },
          endLine: { type: "integer", description: "Optional 1-indexed end line to slice code." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "morsel_get_diagnostics",
      description: "Return all current compiler, linter, and simulation diagnostics in the active Ansatz editor.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "morsel_apply_edit",
      description:
        "Apply a code edit to the active Ansatz editor (undoable). Provide either fullText or startLine/endLine + replacement.",
      parameters: {
        type: "object",
        properties: {
          fullText: { type: "string", description: "Complete replacement source text for the active file." },
          startLine: { type: "integer", description: "1-indexed start line for a range replacement." },
          endLine: { type: "integer", description: "1-indexed end line (inclusive) for a range replacement." },
          replacement: { type: "string", description: "Replacement text for the specified line range." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "morsel_flatten",
      description: "Flatten/compile the active model in Ansatz and return flattened equations or errors.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "morsel_simulate",
      description: "Run the active model simulation in Ansatz and return status and summary.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export const MORSEL_EXTENDED_TOOLS: MorselToolDefinition[] = [
  ...MORSEL_CORE_TOOLS,
  {
    type: "function",
    function: {
      name: "morsel_switch_view",
      description: "Switch the active Ansatz workspace view.",
      parameters: {
        type: "object",
        properties: {
          view: {
            type: "string",
            enum: ["code", "diagram", "simulation", "3d", "inspector", "split"],
          },
        },
        required: ["view"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "morsel_get_diagram",
      description: "Inspect the current 2D diagram components and connections in Ansatz.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export function formatMonacoMarkers(markers: editor.IMarkerData[]): MorselDiagnosticSummary[] {
  return markers.map((m) => ({
    severity: m.severity >= 8 ? "error" : m.severity >= 4 ? "warning" : "info",
    message: m.message,
    line: m.startLineNumber,
    column: m.startColumn,
  }));
}

export function applyLineRangeEdit(source: string, startLine: number, endLine: number, replacement: string): string {
  const lines = source.split("\n");
  const safeStart = Math.max(1, startLine) - 1;
  const safeEnd = Math.max(safeStart, Math.min(lines.length, endLine));
  const repLines = replacement.split("\n");
  const next = [...lines.slice(0, safeStart), ...repLines, ...lines.slice(safeEnd)];
  return next.join("\n");
}

export async function executeMorselToolCall(host: MorselToolHost, call: MorselToolCall): Promise<MorselToolResult> {
  const args = call.arguments ?? {};

  try {
    switch (call.name) {
      case "morsel_get_context": {
        const code = host.getCode();
        let snippet = code;
        if (typeof args["startLine"] === "number" || typeof args["endLine"] === "number") {
          const lines = code.split("\n");
          const s = Math.max(1, Number(args["startLine"] ?? 1)) - 1;
          const e = Math.min(lines.length, Number(args["endLine"] ?? lines.length));
          snippet = lines.slice(s, e).join("\n");
        }
        return {
          toolCallId: call.id,
          name: call.name,
          ok: true,
          output: JSON.stringify({
            fileName: host.getFileName(),
            dialect: host.getDialect(),
            selectedComponent: host.getSelectedComponent(),
            diagnostics: host.getDiagnostics(),
            code: snippet,
          }),
        };
      }

      case "morsel_get_diagnostics": {
        return {
          toolCallId: call.id,
          name: call.name,
          ok: true,
          output: JSON.stringify({ diagnostics: host.getDiagnostics() }),
        };
      }

      case "morsel_apply_edit": {
        let nextCode: string | null = null;
        if (typeof args["fullText"] === "string") {
          nextCode = args["fullText"];
        } else if (
          typeof args["startLine"] === "number" &&
          typeof args["endLine"] === "number" &&
          typeof args["replacement"] === "string"
        ) {
          nextCode = applyLineRangeEdit(host.getCode(), args["startLine"], args["endLine"], args["replacement"]);
        }
        if (nextCode === null) {
          return {
            toolCallId: call.id,
            name: call.name,
            ok: false,
            output: "morsel_apply_edit requires either fullText or (startLine, endLine, replacement).",
          };
        }
        const previousCode = host.getCode();
        const applied = host.applyCodeEdit(nextCode, "Ansatz AI edit");
        return {
          toolCallId: call.id,
          name: call.name,
          ok: applied,
          output: applied ? "Edit applied to active Ansatz editor." : "Failed to apply edit to editor.",
          previousCode: applied ? previousCode : undefined,
          editedCode: applied ? nextCode : undefined,
        };
      }

      case "morsel_flatten": {
        if (!host.runFlatten) {
          return { toolCallId: call.id, name: call.name, ok: false, output: "Flatten is not available in this view." };
        }
        const res = await host.runFlatten();
        return { toolCallId: call.id, name: call.name, ok: res.ok, output: res.output };
      }

      case "morsel_simulate": {
        if (!host.runSimulate) {
          return {
            toolCallId: call.id,
            name: call.name,
            ok: false,
            output: "Simulation is not available in this view.",
          };
        }
        const res = await host.runSimulate();
        return { toolCallId: call.id, name: call.name, ok: res.ok, output: res.output };
      }

      case "morsel_switch_view": {
        const view = args["view"];
        if (
          typeof view === "string" &&
          ["code", "diagram", "simulation", "3d", "inspector", "split"].includes(view) &&
          host.switchView
        ) {
          host.switchView(view as "code" | "diagram" | "simulation" | "3d" | "inspector" | "split");
          return { toolCallId: call.id, name: call.name, ok: true, output: `Switched Ansatz view to '${view}'.` };
        }
        return { toolCallId: call.id, name: call.name, ok: false, output: "Invalid or unavailable view target." };
      }

      case "morsel_get_diagram": {
        if (!host.getDiagramSummary) {
          return { toolCallId: call.id, name: call.name, ok: false, output: "Diagram summary unavailable." };
        }
        const summary = await host.getDiagramSummary();
        return { toolCallId: call.id, name: call.name, ok: true, output: summary };
      }

      default:
        return { toolCallId: call.id, name: call.name, ok: false, output: `Unknown Ansatz tool '${call.name}'.` };
    }
  } catch (err) {
    return {
      toolCallId: call.id,
      name: call.name,
      ok: false,
      output: err instanceof Error ? err.message : String(err),
    };
  }
}
