// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/c/parser";
import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { createRequire } from "node:module";
import { lintCSource } from "./index.js";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getCWasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/c/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

/**
 * Performs multi-file C workspace linting across `.c`/`.h` translation units,
 * resolving local `#include "..."` directives, detecting missing headers or cycles,
 * and running `lintCSource`.
 */
export function lintCWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();
  const parser = getCWasmParser();

  for (const [uri, text] of entries) {
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    for (const d of lintCSource(text)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: d.rule ?? "c-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    const tree = parser.parse(text);
    for (const { tokens } of groupCstLeavesByLine(tree?.rootNode)) {
      if (tokens[0]?.text === "#" && tokens[1]?.text === "include") {
        const rest = tokens
          .slice(2)
          .map((t) => t.text)
          .join("")
          .trim();
        if (!rest.startsWith('"') || !rest.endsWith('"')) continue;
        const header = rest.slice(1, -1).trim();
        if (!header) continue;
        const resolved = resolveRelativeUri(uri, header, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "C3001",
            rule: "unresolved-c-include",
            severity: "error",
            message: `C #include header "${header}" was not found in the workspace.`,
          });
        } else {
          outEdges.push(resolved);
        }
      }
    }
  }

  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "C3002",
      rule: "cyclic-c-include",
      severity: "error",
      message: `Circular C #include dependency: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
