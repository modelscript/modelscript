// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync } from "@modelscript/ampl/wasm-parser";
import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import {
  collectWorkspaceDocuments,
  groupCstLeavesByLine,
  resolveRelativeUri,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parseAmplData } from "../parser/ampl-dat-parser.js";
import { parseAmplModel } from "../parser/ampl-mod-parser.js";
import { lintAmpl } from "./ampl-linter.js";

function getAmplWasmParser() {
  return getOrLoadLanguageWasmParser("ampl", import.meta.url, createWasmParserSync);
}

const AMPL_RUN_FILE_COMMANDS = new Set(["model", "data", "include", "commands"]);

/**
 * Performs multi-file AMPL workspace linting across `.mod` (model), `.dat` (data),
 * and `.run` (command) files, checking `.run` references and verifying `.dat`
 * `param`/`set` assignments against `.mod` declarations.
 */
export function lintAmplWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const declaredSymbols = new Set<string>();
  const datEntries: Array<[string, string]> = [];
  const runEntries: Array<[string, string]> = [];

  for (const [uri, text] of entries) {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".dat")) {
      datEntries.push([uri, text]);
    } else if (lower.endsWith(".run")) {
      runEntries.push([uri, text]);
    } else if (lower.endsWith(".mod") || uri === rootUri || entries.length === 1) {
      const mod = parseAmplModel(text);
      for (const [name] of mod.sets ?? []) declaredSymbols.add(name);
      for (const [name] of mod.params ?? []) declaredSymbols.add(name);
      for (const [name] of mod.vars ?? []) declaredSymbols.add(name);
      for (const d of lintAmpl(mod)) {
        diagnostics.push({
          uri,
          code: String(d.code),
          rule: d.rule ?? "ampl-lint",
          severity: d.severity,
          message: d.message,
          line: d.range?.start.line,
          column: d.range?.start.column,
          endLine: d.range?.end.line,
          endColumn: d.range?.end.column,
        });
      }
    }
  }

  for (const [uri, text] of datEntries) {
    const dat = parseAmplData(text);
    if (declaredSymbols.size > 0) {
      for (const setName of dat.sets?.keys() ?? []) {
        if (!declaredSymbols.has(setName)) {
          diagnostics.push({
            uri,
            code: "AMPL3001",
            rule: "undeclared-ampl-dat-symbol",
            severity: "error",
            message: `AMPL .dat assigns set '${setName}', which is not declared in any .mod file.`,
          });
        }
      }
      for (const paramName of dat.params?.keys() ?? []) {
        if (!declaredSymbols.has(paramName)) {
          diagnostics.push({
            uri,
            code: "AMPL3001",
            rule: "undeclared-ampl-dat-symbol",
            severity: "error",
            message: `AMPL .dat assigns param '${paramName}', which is not declared in any .mod file.`,
          });
        }
      }
    }
  }

  const parser = getAmplWasmParser();
  for (const [uri, text] of runEntries) {
    const tree = parser.parse(text);
    for (const { tokens } of groupCstLeavesByLine(tree?.rootNode)) {
      const cmd = tokens[0]?.text.toLowerCase();
      if (!cmd || !AMPL_RUN_FILE_COMMANDS.has(cmd)) continue;
      const targetTok = tokens[1];
      if (!targetTok || targetTok.text === ";") continue;
      const ref = targetTok.text.replace(/^["']|["']$/g, "");
      if (ref && !resolveRelativeUri(uri, ref, docs)) {
        diagnostics.push({
          uri,
          code: "AMPL3002",
          rule: "unresolved-ampl-run-target",
          severity: "error",
          message: `AMPL .run file references '${ref}', which was not found in the workspace.`,
          line: (targetTok.startPosition?.row ?? 0) + 1,
          column: (targetTok.startPosition?.column ?? 0) + 1,
          endLine: (targetTok.startPosition?.row ?? 0) + 1,
          endColumn: (targetTok.startPosition?.column ?? 0) + targetTok.text.length + 1,
        });
      }
    }
  }

  return diagnostics;
}
