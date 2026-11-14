// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  findIncludeCycle,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { lintFortranSource } from "./index.js";

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

  for (const [uri, text] of entries) {
    for (const m of text.matchAll(/^\s*MODULE\s+(?!PROCEDURE\b)([A-Za-z_][A-Za-z0-9_]*)/gim)) {
      const modName = m[1]?.toLowerCase();
      if (modName) moduleToUri.set(modName, uri);
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

    for (const m of text.matchAll(/^\s*(?:#\s*include|INCLUDE)\s+["']([^"'\r\n]+)["']/gim)) {
      const inc = m[1]?.trim();
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
    }

    for (const m of text.matchAll(
      /^\s*USE(?:\s*,\s*(?:INTRINSIC|NON_INTRINSIC)\s*::|\s+)([A-Za-z_][A-Za-z0-9_]*)/gim,
    )) {
      const modName = m[1]?.toLowerCase();
      if (!modName || BUILTIN_FORTRAN_MODULES.has(modName)) continue;
      const targetUri = moduleToUri.get(modName);
      if (!targetUri) {
        diagnostics.push({
          uri,
          code: "F3002",
          rule: "unresolved-fortran-module",
          severity: "error",
          message: `Fortran USE module '${m[1]}' is not defined in the workspace.`,
        });
      } else if (targetUri !== uri) {
        outEdges.push(targetUri);
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
