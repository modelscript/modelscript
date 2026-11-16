// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  groupCstLeavesByLine,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { PsseErrorCode } from "../errors.js";
import { isLikelyConContent, parseCon } from "../parser/con-parser.js";
import { isLikelyDyrContent, parseDyr } from "../parser/dyr-parser.js";
import { parseIdv } from "../parser/idv-interpreter.js";
import { parseRaw } from "../parser/raw-parser.js";
import { parseSeq } from "../parser/seq-parser.js";
import { getPsseWasmParser } from "../parser/wasm-loader.js";
import { lintPsse } from "./index.js";

/**
 * Performs multi-file PSS/E workspace linting across `.raw`, `.dyr`, `.seq`, `.con`, and `.idv`
 * files, checking `.dyr` dynamic machine `(bus, id)`, `.seq` bus references,
 * `.con` contingency targets, and `.idv` script mutation hazards against the `.raw` base case.
 */
export function lintPsseWorkspace(workspace: WorkspaceDocumentInput, rootUri?: string): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  const parser = getPsseWasmParser();
  let rawUri: string | undefined;
  let rawCase: ReturnType<typeof parseRaw> | undefined;
  const dyrEntries: Array<[string, string]> = [];
  const seqEntries: Array<[string, string]> = [];
  const conEntries: Array<[string, string]> = [];
  const idvEntries: Array<[string, string]> = [];

  for (const [uri, text] of entries) {
    const cstTree = parser.parse(text);
    void groupCstLeavesByLine(cstTree?.rootNode);
    const lower = uri.toLowerCase();
    if (lower.endsWith(".idv")) {
      idvEntries.push([uri, text]);
    } else if (
      lower.endsWith(".dyr") ||
      (!lower.endsWith(".raw") && !lower.endsWith(".seq") && !lower.endsWith(".con") && isLikelyDyrContent(text))
    ) {
      dyrEntries.push([uri, text]);
    } else if (lower.endsWith(".seq")) {
      seqEntries.push([uri, text]);
    } else if (lower.endsWith(".con") || (!lower.endsWith(".raw") && isLikelyConContent(text))) {
      conEntries.push([uri, text]);
    } else if (!rawCase && (uri === rootUri || lower.endsWith(".raw") || entries.length === 1)) {
      rawUri = uri;
      rawCase = parseRaw(text);
    }
  }

  if (!rawCase) {
    const firstRaw = entries.find(
      ([u]) =>
        !u.toLowerCase().endsWith(".dyr") &&
        !u.toLowerCase().endsWith(".seq") &&
        !u.toLowerCase().endsWith(".con") &&
        !u.toLowerCase().endsWith(".idv"),
    );
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
      genKeys.add(`${g.i}:${g.id.trim() || "1"}`);
    }
  }

  for (const [uri, dyrText] of dyrEntries) {
    const dyr = parseDyr(dyrText);
    if (!rawCase) continue;
    for (const rec of dyr.records) {
      if (!rawCase.buses.has(rec.ibus)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.DYR_BUS_NOT_FOUND.code,
          rule: PsseErrorCode.DYR_BUS_NOT_FOUND.rule,
          severity: PsseErrorCode.DYR_BUS_NOT_FOUND.severity,
          message: PsseErrorCode.DYR_BUS_NOT_FOUND.message(rec.model, rec.ibus, rawUri ?? "raw"),
          line: rec.span?.line,
          column: rec.span?.column,
        });
      } else if (
        (rec.category === "generator" ||
          rec.category === "exciter" ||
          rec.category === "governor" ||
          rec.category === "stabilizer") &&
        genKeys.size > 0 &&
        !genKeys.has(`${rec.ibus}:${String(rec.id).trim() || "1"}`)
      ) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.DYR_MACHINE_NOT_FOUND.code,
          rule: PsseErrorCode.DYR_MACHINE_NOT_FOUND.rule,
          severity: PsseErrorCode.DYR_MACHINE_NOT_FOUND.severity,
          message: PsseErrorCode.DYR_MACHINE_NOT_FOUND.message(rec.model, rec.ibus, String(rec.id)),
          line: rec.span?.line,
          column: rec.span?.column,
        });
      }
    }
  }

  for (const [uri, seqText] of seqEntries) {
    const seq = parseSeq(seqText);
    if (!rawCase) continue;
    const seqGenKeys = new Set<string>();
    for (const g of seq.generators) {
      const busNum = g.i;
      const gId = (g.id ?? "1").trim() || "1";
      seqGenKeys.add(`${busNum}:${gId}`);
      if (!rawCase.buses.has(busNum)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_BUS_NOT_FOUND.code,
          rule: PsseErrorCode.SEQ_BUS_NOT_FOUND.rule,
          severity: PsseErrorCode.SEQ_BUS_NOT_FOUND.severity,
          message: PsseErrorCode.SEQ_BUS_NOT_FOUND.message(busNum, rawUri ?? "raw"),
        });
      }
      if (Math.abs(g.zxneg) < 1e-6 || Math.abs(g.zx0) < 1e-6) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_IMPEDANCE_GAP.code,
          rule: PsseErrorCode.SEQ_IMPEDANCE_GAP.rule,
          severity: PsseErrorCode.SEQ_IMPEDANCE_GAP.severity,
          message: PsseErrorCode.SEQ_IMPEDANCE_GAP.message(
            `generator (${busNum}, '${gId}') has zero/unset ${Math.abs(g.zxneg) < 1e-6 ? "X2" : "X0"}`,
          ),
        });
      }
    }
    for (const gen of rawCase.generators) {
      if (gen.stat === 1 && seq.generators.length > 0 && !seqGenKeys.has(`${gen.i}:${gen.id.trim() || "1"}`)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_IMPEDANCE_GAP.code,
          rule: PsseErrorCode.SEQ_IMPEDANCE_GAP.rule,
          severity: PsseErrorCode.SEQ_IMPEDANCE_GAP.severity,
          message: PsseErrorCode.SEQ_IMPEDANCE_GAP.message(
            `in-service RAW generator (${gen.i}, '${gen.id.trim() || "1"}') has no sequence impedance entry`,
          ),
        });
      }
    }
    for (const br of seq.branches) {
      if (Math.abs(br.x0) < 1e-6 && Math.abs(br.r0) < 1e-6) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_IMPEDANCE_GAP.code,
          rule: PsseErrorCode.SEQ_IMPEDANCE_GAP.rule,
          severity: PsseErrorCode.SEQ_IMPEDANCE_GAP.severity,
          message: PsseErrorCode.SEQ_IMPEDANCE_GAP.message(`branch ${br.i}-${br.j} CKT '${br.ckt}' has Z0 = 0`),
        });
      }
    }
    for (const xf of seq.transformers) {
      if (xf.cc < 1 || xf.cc > 22) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_VECTOR_GROUP_INVALID.code,
          rule: PsseErrorCode.SEQ_VECTOR_GROUP_INVALID.rule,
          severity: PsseErrorCode.SEQ_VECTOR_GROUP_INVALID.severity,
          message: PsseErrorCode.SEQ_VECTOR_GROUP_INVALID.message(
            xf.i,
            xf.j,
            xf.ckt,
            `connection code CC=${xf.cc} outside valid range [1, 22]`,
          ),
        });
      } else if (
        xf.cc === 1 &&
        (Math.abs(xf.rg1) > 1e-6 || Math.abs(xf.xg1) > 1e-6 || Math.abs(xf.rg2) > 1e-6 || Math.abs(xf.xg2) > 1e-6)
      ) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_VECTOR_GROUP_INVALID.code,
          rule: PsseErrorCode.SEQ_VECTOR_GROUP_INVALID.rule,
          severity: PsseErrorCode.SEQ_VECTOR_GROUP_INVALID.severity,
          message: PsseErrorCode.SEQ_VECTOR_GROUP_INVALID.message(
            xf.i,
            xf.j,
            xf.ckt,
            `ungrounded CC=1 specifies non-zero grounding impedance`,
          ),
        });
      }
    }
  }

  for (const [uri, conText] of conEntries) {
    if (!rawCase) continue;
    const con = parseCon(conText);
    for (const cDef of con.contingencies) {
      for (const act of cDef.actions) {
        if (act.type === "open_branch" || act.type === "close_branch" || act.type === "change_rating") {
          const exists =
            rawCase.branches.some(
              (b) =>
                ((b.i === act.fromBus && Math.abs(b.j) === act.toBus) ||
                  (b.i === act.toBus && Math.abs(b.j) === act.fromBus)) &&
                b.ckt.trim() === act.ckt.trim(),
            ) ||
            rawCase.transformers.some(
              (t) =>
                ((t.i === act.fromBus && t.j === act.toBus) || (t.i === act.toBus && t.j === act.fromBus)) &&
                t.ckt.trim() === act.ckt.trim(),
            );
          if (!exists) {
            diagnostics.push({
              uri,
              code: PsseErrorCode.CON_TARGET_NOT_FOUND.code,
              rule: PsseErrorCode.CON_TARGET_NOT_FOUND.rule,
              severity: PsseErrorCode.CON_TARGET_NOT_FOUND.severity,
              message: PsseErrorCode.CON_TARGET_NOT_FOUND.message(
                cDef.id,
                `branch/transformer ${act.fromBus}-${act.toBus} CKT '${act.ckt}'`,
              ),
              line: cDef.span?.line,
              column: cDef.span?.column,
            });
          }
        } else if (act.type === "trip_generator" || act.type === "change_generator_pmax") {
          if (!genKeys.has(`${act.bus}:${act.id.trim() || "1"}`)) {
            diagnostics.push({
              uri,
              code: PsseErrorCode.CON_TARGET_NOT_FOUND.code,
              rule: PsseErrorCode.CON_TARGET_NOT_FOUND.rule,
              severity: PsseErrorCode.CON_TARGET_NOT_FOUND.severity,
              message: PsseErrorCode.CON_TARGET_NOT_FOUND.message(cDef.id, `generator (${act.bus}, '${act.id}')`),
              line: cDef.span?.line,
              column: cDef.span?.column,
            });
          }
        } else if (act.type === "disconnect_bus") {
          if (!rawCase.buses.has(act.bus)) {
            diagnostics.push({
              uri,
              code: PsseErrorCode.CON_TARGET_NOT_FOUND.code,
              rule: PsseErrorCode.CON_TARGET_NOT_FOUND.rule,
              severity: PsseErrorCode.CON_TARGET_NOT_FOUND.severity,
              message: PsseErrorCode.CON_TARGET_NOT_FOUND.message(cDef.id, `bus ${act.bus}`),
              line: cDef.span?.line,
              column: cDef.span?.column,
            });
          }
        }
      }
    }
  }

  // P7005: Static dataflow check over parsed .idv batch scripts
  for (const [uri, idvText] of idvEntries) {
    const cmds = parseIdv(idvText);
    let hasStrt = false;
    let activeFaultLine: { lineNo: number; busId: number } | null = null;

    for (const c of cmds) {
      const cmd = c.command;
      if (cmd === "STRT") {
        hasStrt = true;
      } else if (cmd === "RUN" && !hasStrt) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.IDV_SCRIPT_HAZARD.code,
          rule: PsseErrorCode.IDV_SCRIPT_HAZARD.rule,
          severity: PsseErrorCode.IDV_SCRIPT_HAZARD.severity,
          message: PsseErrorCode.IDV_SCRIPT_HAZARD.message(
            c.lineNo,
            cmd,
            "dynamic RUN invoked before STRT channel initialization",
          ),
          line: c.lineNo,
        });
      } else if (cmd === "DIST_BUS_FAULT") {
        const busId = Number.parseInt(c.args[0] ?? "", 10);
        if (rawCase && Number.isFinite(busId) && busId > 0 && !rawCase.buses.has(busId)) {
          diagnostics.push({
            uri,
            code: PsseErrorCode.IDV_SCRIPT_HAZARD.code,
            rule: PsseErrorCode.IDV_SCRIPT_HAZARD.rule,
            severity: PsseErrorCode.IDV_SCRIPT_HAZARD.severity,
            message: PsseErrorCode.IDV_SCRIPT_HAZARD.message(
              c.lineNo,
              cmd,
              `references non-existent fault bus ${busId}`,
            ),
            line: c.lineNo,
          });
        }
        activeFaultLine = { lineNo: c.lineNo, busId: Number.isFinite(busId) ? busId : 0 };
      } else if (cmd === "DIST_CLEAR_FAULT") {
        activeFaultLine = null;
      } else if (cmd === "OPEN" || cmd === "CLOSE" || cmd === "TRIP") {
        if (rawCase) {
          for (const tok of c.args) {
            const n = Number(tok);
            if (Number.isInteger(n) && n > 0 && !rawCase.buses.has(n) && tok === String(n)) {
              // Check numeric bus references while ignoring small circuit/flag numbers <= 1 unless clearly not a bus
              if (n >= 2 || rawCase.buses.size > 0) {
                const isKnownCkt = tok === "1" && (c.args[0] ?? "").toUpperCase() === "BRANCH";
                if (!isKnownCkt) {
                  diagnostics.push({
                    uri,
                    code: PsseErrorCode.IDV_SCRIPT_HAZARD.code,
                    rule: PsseErrorCode.IDV_SCRIPT_HAZARD.rule,
                    severity: PsseErrorCode.IDV_SCRIPT_HAZARD.severity,
                    message: PsseErrorCode.IDV_SCRIPT_HAZARD.message(
                      c.lineNo,
                      cmd,
                      `references bus ${n} missing from workspace RAW case`,
                    ),
                    line: c.lineNo,
                  });
                  break;
                }
              }
            }
          }
        }
      }
    }

    if (activeFaultLine) {
      diagnostics.push({
        uri,
        code: PsseErrorCode.IDV_SCRIPT_HAZARD.code,
        rule: PsseErrorCode.IDV_SCRIPT_HAZARD.rule,
        severity: PsseErrorCode.IDV_SCRIPT_HAZARD.severity,
        message: PsseErrorCode.IDV_SCRIPT_HAZARD.message(
          activeFaultLine.lineNo,
          "DIST_BUS_FAULT",
          `fault at bus ${activeFaultLine.busId} is never cleared with DIST_CLEAR_FAULT`,
        ),
        line: activeFaultLine.lineNo,
      });
    }
  }

  return diagnostics;
}
