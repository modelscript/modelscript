// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/antimony/wasm-parser";
import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { createRequire } from "node:module";
import { parseAntimony } from "../parser/index.js";
import { lintAntimony } from "./index.js";

const require = createRequire(import.meta.url);
let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getAntimonyWasmParser() {
  if (!cachedParser) {
    const wasmPath = require.resolve("@modelscript/antimony/parser.wasm");
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

/**
 * Performs multi-file Antimony workspace linting across `.ant` files, resolving
 * `import "..."` directives, detecting cycles, and linting each module.
 */
export function lintAntimonyWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const edges = new Map<string, string[]>();
  const parser = getAntimonyWasmParser();

  for (const [uri, text] of entries) {
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    const model = parseAntimony(text);
    for (const d of lintAntimony(model)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: "antimony-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    const tree = parser.parse(text);
    for (const { tokens } of groupCstLeavesByLine(tree?.rootNode)) {
      const first = tokens[0];
      const second = tokens[1];
      if (
        first?.text.toLowerCase() === "import" &&
        second &&
        (second.type === "DeckString" || /^["']/.test(second.text))
      ) {
        const target = second.text.replace(/^["']|["']$/g, "").trim();
        if (!target) continue;
        const resolved = resolveRelativeUri(uri, target, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "AN3001",
            rule: "unresolved-antimony-import",
            severity: "error",
            message: `Antimony import '${target}' was not found in the workspace.`,
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
      code: "AN3002",
      rule: "cyclic-antimony-import",
      severity: "error",
      message: `Circular Antimony import dependency: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
