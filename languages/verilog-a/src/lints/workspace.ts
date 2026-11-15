// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { createWasmParserSync } from "@modelscript/verilog-a/wasm-parser";
import { createRequire } from "node:module";
import { parseVerilogA } from "../parser/verilog-a-parser.js";
import { lintVerilogA } from "./rules.js";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getVerilogAWasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/verilog-a/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

const BUILTIN_VAMS_HEADERS = new Set(["disciplines.vams", "constants.vams", "disciplines.h", "constants.h"]);

/**
 * Performs multi-file Verilog-A workspace linting by resolving `` `include ``
 * directives across workspace headers, detecting missing/cyclic includes,
 * and linting all parsed modules.
 */
export function lintVerilogAWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  const firstEntry = entries[0];
  if (!firstEntry) return diagnostics;

  const entryUri = rootUri ?? firstEntry[0];
  const edges = new Map<string, string[]>();
  const expandedParts: string[] = [];
  const visited = new Set<string>();
  const parser = getVerilogAWasmParser();

  function expand(uri: string): void {
    if (visited.has(uri)) return;
    visited.add(uri);
    const text = docs.get(uri) ?? "";
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const tree = parser.parse(text);
    const rawLines = text.split(/\r?\n/);
    const includeRows = new Map<number, string>();
    for (const { row, tokens } of groupCstLeavesByLine(tree?.rootNode)) {
      const joined = tokens
        .map((t) => t.text)
        .join("")
        .trim();
      const m = joined.match(/^`include\s+(?:"([^"]+)"|<([^>]+)>)/i);
      if (m) {
        includeRows.set(row, m[1] ?? m[2] ?? "");
      }
    }

    for (let row = 0; row < rawLines.length; row++) {
      const targetRaw = includeRows.get(row);
      if (targetRaw !== undefined) {
        const resolved = resolveRelativeUri(uri, targetRaw, docs);
        if (!resolved) {
          const base = targetRaw.split("/").pop()?.toLowerCase() ?? "";
          if (!BUILTIN_VAMS_HEADERS.has(base)) {
            diagnostics.push({
              uri,
              code: "VA3001",
              rule: "unresolved-veriloga-include",
              severity: "error",
              message: `Verilog-A \`include target '${targetRaw}' was not found in the workspace.`,
            });
          }
        } else {
          outEdges.push(resolved);
          expand(resolved);
        }
      } else {
        expandedParts.push(rawLines[row] ?? "");
      }
    }
  }

  expand(entryUri);
  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "VA3002",
      rule: "cyclic-veriloga-include",
      severity: "error",
      message: `Circular Verilog-A \`include dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const ast = parseVerilogA(expandedParts.join("\n"));
  for (const d of lintVerilogA(ast)) {
    diagnostics.push({
      uri: entryUri,
      code: d.code,
      rule: d.rule ?? "veriloga-lint",
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
