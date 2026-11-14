// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { isLikelyDyrContent, parseDyr } from "../parser/dyr-parser.js";
import { parseRaw } from "../parser/raw-parser.js";
import { parseSeq } from "../parser/seq-parser.js";
import { lintPsse } from "./index.js";

/**
 * Performs multi-file PSS/E workspace linting across `.raw`, `.dyr`, and `.seq`
 * files, checking `.dyr` dynamic machine `(bus, id)` and `.seq` bus references
 * against the `.raw` power-flow base case.
 */
export function lintPsseWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  let rawUri: string | undefined;
  let rawCase: ReturnType<typeof parseRaw> | undefined;
  const dyrEntries: Array<[string, string]> = [];
  const seqEntries: Array<[string, string]> = [];

  for (const [uri, text] of entries) {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".dyr") || (!lower.endsWith(".raw") && !lower.endsWith(".seq") && isLikelyDyrContent(text))) {
      dyrEntries.push([uri, text]);
    } else if (lower.endsWith(".seq")) {
      seqEntries.push([uri, text]);
    } else if (!rawCase && (uri === rootUri || lower.endsWith(".raw") || entries.length === 1)) {
      rawUri = uri;
      rawCase = parseRaw(text);
    }
  }

  if (!rawCase) {
    const firstRaw = entries.find(([u]) => !u.toLowerCase().endsWith(".dyr") && !u.toLowerCase().endsWith(".seq"));
    if (firstRaw) {
      rawUri = firstRaw[0];
      rawCase = parseRaw(firstRaw[1]);
    }
  }

  if (rawCase && rawUri) {
    for (const d of lintPsse(rawCase)) {
      diagnostics.push({
        uri: rawUri,
        code: d.code,
        rule: "psse-base",
        severity: d.severity,
        message: d.message,
        line: d.line,
        column: d.column,
      });
    }
  }

  const genKeys = new Set<string>();
  if (rawCase) {
    for (const g of rawCase.generators) {
      genKeys.add(`${g.i}:${g.id.trim()}`);
    }
  }

  for (const [uri, dyrText] of dyrEntries) {
    const dyr = parseDyr(dyrText);
    if (!rawCase) continue;
    for (const rec of dyr.records) {
      if (!rawCase.buses.has(rec.ibus)) {
        diagnostics.push({
          uri,
          code: "P3001",
          rule: "dyr-bus-not-found",
          severity: "error",
          message: `DYR model '${rec.model}' references bus ${rec.ibus}, which does not exist in RAW case '${rawUri}'.`,
        });
      } else if (
        (rec.category === "generator" ||
          rec.category === "exciter" ||
          rec.category === "governor" ||
          rec.category === "stabilizer") &&
        genKeys.size > 0 &&
        !genKeys.has(`${rec.ibus}:${String(rec.id).trim()}`)
      ) {
        diagnostics.push({
          uri,
          code: "P3002",
          rule: "dyr-machine-not-found",
          severity: "warning",
          message: `DYR model '${rec.model}' references machine (${rec.ibus}, '${rec.id}') not present in RAW generators.`,
        });
      }
    }
  }

  for (const [uri, seqText] of seqEntries) {
    const seq = parseSeq(seqText) as { generatorImpedances?: Array<{ bus?: number; i?: number }> };
    if (!rawCase || !Array.isArray(seq.generatorImpedances)) continue;
    for (const g of seq.generatorImpedances) {
      const busNum = g.bus ?? g.i;
      if (typeof busNum === "number" && !rawCase.buses.has(busNum)) {
        diagnostics.push({
          uri,
          code: "P3003",
          rule: "seq-bus-not-found",
          severity: "error",
          message: `SEQ record references bus ${busNum}, which does not exist in RAW case '${rawUri}'.`,
        });
      }
    }
  }

  return diagnostics;
}
