// SPDX-License-Identifier: AGPL-3.0-or-later

import { getOrLoadLanguageWasmParser } from "@modelscript/dsl";
import { createWasmParserSync } from "@modelscript/pslf/wasm-parser";
import {
  collectWorkspaceDocuments,
  groupCstLeavesByLine,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { parsePslfDyd } from "../parser/dyd-parser.js";
import { parsePslfEpc } from "../parser/epc-parser.js";
import { lintPslfDyd, lintPslfEpc } from "./index.js";

function getPslfWasmParser() {
  return getOrLoadLanguageWasmParser("pslf", import.meta.url, createWasmParserSync);
}

/**
 * Performs multi-file GE PSLF workspace linting across `.epc` power-flow and
 * `.dyd` dynamic data files, validating `.dyd` `(bus, id)` references against `.epc`.
 */
export function lintPslfWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const parser = getPslfWasmParser();
  let epcUri: string | undefined;
  let epc: ReturnType<typeof parsePslfEpc> | undefined;
  const dydEntries: Array<[string, string]> = [];

  for (const [uri, text] of entries) {
    const cstTree = parser.parse(text);
    void groupCstLeavesByLine(cstTree?.rootNode);
    if (uri.toLowerCase().endsWith(".dyd")) {
      dydEntries.push([uri, text]);
    } else if (!epc && (uri === rootUri || uri.toLowerCase().endsWith(".epc") || entries.length === 1)) {
      epcUri = uri;
      epc = parsePslfEpc(text);
    }
  }

  if (epc && epcUri) {
    for (const d of lintPslfEpc(epc)) {
      diagnostics.push({
        uri: epcUri,
        code: d.code,
        rule: "pslf-epc",
        severity: d.severity,
        message: d.message,
      });
    }
  }

  const busIds = new Set<number>(epc ? epc.buses.keys() : []);
  for (const [uri, text] of dydEntries) {
    const dyd = parsePslfDyd(text);
    for (const d of lintPslfDyd(dyd)) {
      diagnostics.push({
        uri,
        code: d.code,
        rule: "pslf-dyd",
        severity: d.severity,
        message: d.message,
      });
    }
    if (epc && busIds.size > 0) {
      for (const m of dyd.models) {
        if (typeof m.busNumber === "number" && !busIds.has(m.busNumber)) {
          diagnostics.push({
            uri,
            code: "PL3001",
            rule: "dyd-bus-not-found",
            severity: "error",
            message: `PSLF DYD model '${m.modelType}' references bus ${m.busNumber}, not found in EPC '${epcUri}'.`,
          });
        }
      }
    }
  }

  return diagnostics;
}
