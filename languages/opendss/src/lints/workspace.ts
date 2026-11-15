// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/opendss/wasm-parser";
import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { createRequire } from "node:module";
import { parseOpenDss } from "../parser/opendss-parser.js";
import { lintOpenDss } from "./opendss-linter.js";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getOpenDssWasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/opendss/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

/**
 * Performs multi-file OpenDSS workspace linting by resolving `Redirect` and `Compile`
 * directives across `.dss` files, detecting missing files or cycles, and running
 * `lintOpenDss` over the merged circuit deck.
 */
export function lintOpenDssWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  const firstEntry = entries[0];
  if (!firstEntry) return diagnostics;

  const entryUri = rootUri ?? firstEntry[0];
  const edges = new Map<string, string[]>();
  const expandedLines: string[] = [];
  const visited = new Set<string>();
  const parser = getOpenDssWasmParser();

  function expand(uri: string): void {
    if (visited.has(uri)) return;
    visited.add(uri);
    const text = docs.get(uri) ?? "";
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const tree = parser.parse(text);
    const rawLines = text.split(/\r?\n/);
    const redirectRows = new Map<number, string>();
    for (const { row } of groupCstLeavesByLine(tree?.rootNode)) {
      const m = (rawLines[row] ?? "").match(/^\s*(?:redirect|compile)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/i);
      if (m) {
        redirectRows.set(row, m[1] ?? m[2] ?? m[3] ?? "");
      }
    }

    for (let row = 0; row < rawLines.length; row++) {
      const targetRaw = redirectRows.get(row);
      if (targetRaw !== undefined) {
        const resolved = resolveRelativeUri(uri, targetRaw, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "D3001",
            rule: "unresolved-opendss-redirect",
            severity: "error",
            message: `OpenDSS Redirect/Compile target '${targetRaw}' was not found in the workspace.`,
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
      code: "D3002",
      rule: "cyclic-opendss-redirect",
      severity: "error",
      message: `Circular OpenDSS Redirect/Compile dependency: ${cycle.join(" -> ")}.`,
    });
  }

  const deck = parseOpenDss(expandedLines.join("\n"));
  for (const d of lintOpenDss(deck)) {
    diagnostics.push({
      uri: entryUri,
      code: String(d.code),
      rule: d.rule,
      severity: d.severity,
      message: d.message,
    });
  }

  return diagnostics;
}
