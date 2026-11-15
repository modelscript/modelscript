// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/eclipse/wasm-parser";
import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { createRequire } from "node:module";
import { parseEclipse } from "../parser/index.js";
import { lintEclipse } from "./index.js";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getEclipseWasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/eclipse/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

/**
 * Performs multi-file ECLIPSE reservoir deck workspace linting by resolving
 * `INCLUDE` directives, detecting missing files or cycles, and linting the expanded deck.
 */
export function lintEclipseWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const firstEntry = entries[0];
  if (!firstEntry) return diagnostics;

  const entryUri = rootUri ?? firstEntry[0];
  const edges = new Map<string, string[]>();
  const expandedLines: string[] = [];
  const visited = new Set<string>();
  const parser = getEclipseWasmParser();

  function expand(uri: string): void {
    if (visited.has(uri)) return;
    visited.add(uri);
    const text = docs.get(uri) ?? "";
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const lines = text.split(/\r?\n/);
    const tree = parser.parse(text);
    const cstLines = groupCstLeavesByLine(tree?.rootNode);
    const tokensByRow = new Map(cstLines.map((l) => [l.row, l.tokens]));
    const skipRows = new Set<number>();

    for (let i = 0; i < cstLines.length; i++) {
      const cur = cstLines[i];
      if (!cur) continue;
      if (cur.tokens[0]?.text.toUpperCase() === "INCLUDE") {
        const next = cstLines[i + 1];
        const nextRowTokens = next && next.row > cur.row ? next.tokens : tokensByRow.get(cur.row + 1);
        const targetTok = nextRowTokens?.[0];
        const targetRaw = targetTok ? targetTok.text.replace(/^['"]|['"]$/g, "").trim() : "";
        if (targetRaw && targetRaw !== "/") {
          skipRows.add(cur.row);
          if (next) skipRows.add(next.row);
          const resolved = resolveRelativeUri(uri, targetRaw, docs);
          if (!resolved) {
            diagnostics.push({
              uri,
              code: "EC3001",
              rule: "unresolved-eclipse-include",
              severity: "error",
              message: `ECLIPSE INCLUDE target '${targetRaw}' was not found in the workspace.`,
            });
          } else {
            outEdges.push(resolved);
            expand(resolved);
          }
        }
      }
    }

    for (let row = 0; row < lines.length; row++) {
      if (!skipRows.has(row)) {
        expandedLines.push(lines[row] ?? "");
      }
    }
  }

  expand(entryUri);
  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "EC3002",
      rule: "cyclic-eclipse-include",
      severity: "error",
      message: `Circular ECLIPSE INCLUDE dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const deck = parseEclipse(expandedLines.join("\n"));
  for (const d of lintEclipse(deck)) {
    diagnostics.push({
      uri: entryUri,
      code: String(d.code),
      rule: "eclipse-lint",
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
