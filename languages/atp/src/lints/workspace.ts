// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/atp/wasm-parser";
import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { createRequire } from "node:module";
import { parseAtp } from "../parser/atp-parser.js";
import { lintAtpCase } from "./index.js";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getAtpWasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/atp/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

/**
 * Performs multi-file ATP/EMTP workspace linting by resolving `$INCLUDE`
 * directives, detecting missing files or cycles, and linting the expanded deck.
 */
export function lintAtpWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();
  const expandedLines: string[] = [];
  const visited = new Set<string>();
  const parser = getAtpWasmParser();

  function expand(uri: string): void {
    if (visited.has(uri)) return;
    visited.add(uri);
    const text = docs.get(uri) ?? "";
    const rawLines = text.split(/\r?\n/);
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const includeRows = new Map<number, string>();
    const tree = parser.parse(text);
    for (const { row, tokens } of groupCstLeavesByLine(tree?.rootNode)) {
      if (tokens[0]?.text.toUpperCase() === "$INCLUDE") {
        const targetTok = tokens.slice(1).find((t) => t.type !== "DeckPunct" && t.text !== ",");
        if (targetTok) {
          includeRows.set(row, targetTok.text.replace(/^["']|["']$/g, "").trim());
        }
      }
    }

    for (let row = 0; row < rawLines.length; row++) {
      const targetRaw = includeRows.get(row);
      if (targetRaw !== undefined) {
        const resolved = resolveRelativeUri(uri, targetRaw, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "AT3001",
            rule: "unresolved-atp-include",
            severity: "error",
            message: `ATP $INCLUDE target '${targetRaw}' was not found in the workspace.`,
          });
        } else {
          outEdges.push(resolved);
          expand(resolved);
        }
      } else {
        expandedLines.push(rawLines[row] ?? "");
      }
    }
  }

  expand(entryUri);
  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "AT3002",
      rule: "cyclic-atp-include",
      severity: "error",
      message: `Circular ATP $INCLUDE dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const parsed = parseAtp(expandedLines.join("\n"));
  for (const d of lintAtpCase(parsed)) {
    diagnostics.push({
      uri: entryUri,
      code: d.code,
      rule: "atp-lint",
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
