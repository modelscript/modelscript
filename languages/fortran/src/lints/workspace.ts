// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
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

function getFortranWasmParser() {
  try {
    return getOrLoadLanguageWasmParser("fortran", import.meta.url, createWasmParserSync);
  } catch {
    return null;
  }
}

function scanFortranLinesFallback(text: string): ReturnType<typeof groupCstLeavesByLine> {
  const rawLines = text.split(/\r?\n/);
  const result: ReturnType<typeof groupCstLeavesByLine> = [];
  for (let row = 0; row < rawLines.length; row++) {
    const stripped = rawLines[row]!.replace(/!.*$/, "").trim();
    if (!stripped) continue;
    const tokens: ReturnType<typeof groupCstLeavesByLine>[number]["tokens"] = [];
    const tokRegex = /#|[A-Za-z_][A-Za-z0-9_]*|"[^"]*"|'[^']*'|[^\s]/g;
    let m: RegExpExecArray | null;
    while ((m = tokRegex.exec(stripped)) !== null) {
      const tokText = m[0]!;
      const type = /^[A-Za-z_][A-Za-z0-9_]*$/.test(tokText) ? "IDENTIFIER" : "TOKEN";
      tokens.push({
        type,
        text: tokText,
        startPosition: { row, column: m.index },
      });
    }
    if (tokens.length > 0) {
      result.push({ row, tokens });
    }
  }
  return result;
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
    const tree = parser ? parser.parse(text) : null;
    const lines = tree?.rootNode ? groupCstLeavesByLine(tree.rootNode) : scanFortranLinesFallback(text);
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
        code: d.id ?? String(d.code),
        rule: d.rule ?? "fortran-lint",
        severity: d.severity,
        message: d.message,
        line: d.line,
        column: d.column,
        endLine: d.endLine,
        endColumn: d.endColumn,
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
