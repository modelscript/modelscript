// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/fortran/parser";
import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { lintFortranSource } from "./index.js";

let cachedParser: ReturnType<typeof createWasmParserSync>["parser"] | undefined;
function getFortranWasmParser() {
  if (!cachedParser) {
    const wasmUrl = new URL("../../dist/parser.wasm", import.meta.url);
    const wasmPath = wasmUrl.protocol === "file:" ? decodeURIComponent(wasmUrl.pathname) : wasmUrl.href;
    cachedParser = createWasmParserSync(wasmPath).parser;
  }
  return cachedParser;
}

const BUILTIN_FORTRAN_MODULES = new Set(["iso_c_binding", "iso_fortran_env", "ieee_arithmetic", "omp_lib", "mpi"]);

/**
 * Performs multi-file Fortran workspace linting across `.f`/`.f90`/`.f95`/`.h`
 * files, resolving `USE <module>` and `#include`/`INCLUDE` dependencies, detecting
 * cycles, and running `lintFortranSource`.
 */
export function lintFortranWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const entryUri = rootUri ?? entries[0]![0];
  const moduleToUri = new Map<string, string>();
  const edges = new Map<string, string[]>();
  const parser = getFortranWasmParser();
  const parsedLines = new Map<string, ReturnType<typeof groupCstLeavesByLine>>();

  for (const [uri, text] of entries) {
    const tree = parser.parse(text);
    const lines = groupCstLeavesByLine(tree?.rootNode);
    parsedLines.set(uri, lines);

    for (const { tokens } of lines) {
      const first = tokens[0];
      const second = tokens[1];
      if (first?.text.toLowerCase() === "module" && second && second.text.toLowerCase() !== "procedure") {
        moduleToUri.set(second.text.toLowerCase(), uri);
      }
    }
  }

  for (const [uri, text] of entries) {
    const outEdges: string[] = [];
    edges.set(uri, outEdges);

    for (const d of lintFortranSource(text)) {
      diagnostics.push({
        uri,
        code: String(d.code),
        rule: d.rule ?? "fortran-lint",
        severity: d.severity,
        message: d.message,
      });
    }

    for (const { tokens } of parsedLines.get(uri) ?? []) {
      const first = tokens[0]?.text.toLowerCase();
      if (first === "include" || (tokens[0]?.text === "#" && tokens[1]?.text.toLowerCase() === "include")) {
        const rest = tokens
          .slice(first === "include" ? 1 : 2)
          .map((t) => t.text)
          .join("");
        const inc = rest.replace(/^["']|["']$/g, "").trim();
        if (!inc) continue;
        const resolved = resolveRelativeUri(uri, inc, docs);
        if (!resolved) {
          diagnostics.push({
            uri,
            code: "F3001",
            rule: "unresolved-fortran-include",
            severity: "error",
            message: `Fortran INCLUDE '${inc}' was not found in the workspace.`,
          });
        } else {
          outEdges.push(resolved);
        }
      } else if (first === "use") {
        const modTok = tokens
          .slice(1)
          .find(
            (t) =>
              t.type === "IDENTIFIER" &&
              t.text.toLowerCase() !== "intrinsic" &&
              t.text.toLowerCase() !== "non_intrinsic",
          );
        const modName = modTok?.text.toLowerCase();
        if (!modTok || !modName || BUILTIN_FORTRAN_MODULES.has(modName)) continue;
        const targetUri = moduleToUri.get(modName);
        if (!targetUri) {
          diagnostics.push({
            uri,
            code: "F3002",
            rule: "unresolved-fortran-module",
            severity: "error",
            message: `Fortran USE module '${modTok.text}' is not defined in the workspace.`,
          });
        } else if (targetUri !== uri) {
          outEdges.push(targetUri);
        }
      }
    }
  }

  const cycle = findIncludeCycle(edges, entryUri);
  if (cycle) {
    diagnostics.push({
      uri: entryUri,
      code: "F3003",
      rule: "cyclic-fortran-dependency",
      severity: "error",
      message: `Circular Fortran module/include dependency: ${cycle.join(" -> ")}.`,
    });
  }

  return diagnostics;
}
