// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  collectWorkspaceDocuments,
  type PolyglotModelSource,
  type WorkspaceDocumentInput,
  type WorkspaceLintDiagnostic,
} from "@modelscript/runtime";
import { verifyPssePolyglotDrift } from "../analysis/advanced-formal-checks.js";
import { PsseErrorCode } from "../errors.js";
import { isLikelyConContent, parseCon, parseMon, parseSub } from "../parser/con-parser.js";
import { isLikelyDyrContent, parseDyr } from "../parser/dyr-parser.js";
import { parseIdv } from "../parser/idv-interpreter.js";
import { parseRaw } from "../parser/raw-parser.js";
import { parseSeq } from "../parser/seq-parser.js";
import { lintPsse } from "./index.js";

/**
 * Performs multi-file PSS/E workspace linting across `.raw`, `.dyr`, `.seq`, `.con`, `.mon`, `.sub`, and `.idv`
 * files, checking `.dyr` dynamic machine `(bus, id)`, `.seq` bus references,
 * `.con` contingency targets, `.mon`/`.sub` monitoring targets, and `.idv` script mutation hazards against the `.raw` base case.
 */
export function lintPsseWorkspace(
  workspace: WorkspaceDocumentInput,
  rootUri?: string,
  options?: { tier?: "fast" | "deep" | "formal" },
): WorkspaceLintDiagnostic[] {
  const docs = collectWorkspaceDocuments(workspace);
  const diagnostics: WorkspaceLintDiagnostic[] = [];
  const entries = Array.from(docs.entries());
  if (entries.length === 0) return diagnostics;

  let rawUri: string | undefined;
  let rawCase: ReturnType<typeof parseRaw> | undefined;
  const dyrEntries: Array<[string, string]> = [];
  const seqEntries: Array<[string, string]> = [];
  const conEntries: Array<[string, string]> = [];
  const monEntries: Array<[string, string]> = [];
  const subEntries: Array<[string, string]> = [];
  const idvEntries: Array<[string, string]> = [];

  const PSSE_EXTS = new Set([".raw", ".dyr", ".seq", ".con", ".mon", ".sub", ".idv", ".psse", ".txt"]);
  const isPsseCandidateUri = (uri: string): boolean => {
    if (uri === rootUri || entries.length === 1) return true;
    const lower = uri.toLowerCase();
    const lastSlash = Math.max(lower.lastIndexOf("/"), lower.lastIndexOf("\\"));
    const base = lastSlash >= 0 ? lower.slice(lastSlash + 1) : lower;
    const dot = base.lastIndexOf(".");
    if (dot === -1) return true;
    return PSSE_EXTS.has(base.slice(dot));
  };

  for (const [uri, text] of entries) {
    if (!isPsseCandidateUri(uri)) continue;
    const lower = uri.toLowerCase();
    if (lower.endsWith(".idv")) {
      idvEntries.push([uri, text]);
    } else if (lower.endsWith(".mon")) {
      monEntries.push([uri, text]);
    } else if (lower.endsWith(".sub")) {
      subEntries.push([uri, text]);
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
      try {
        rawCase = parseRaw(text);
      } catch {
        // Ignore unparseable/non-RAW buffer
      }
    }
  }

  if (!rawCase) {
    const firstRaw = entries.find(
      ([u]) =>
        isPsseCandidateUri(u) &&
        !u.toLowerCase().endsWith(".dyr") &&
        !u.toLowerCase().endsWith(".seq") &&
        !u.toLowerCase().endsWith(".con") &&
        !u.toLowerCase().endsWith(".mon") &&
        !u.toLowerCase().endsWith(".sub") &&
        !u.toLowerCase().endsWith(".idv"),
    );
    if (firstRaw) {
      rawUri = firstRaw[0];
      try {
        rawCase = parseRaw(firstRaw[1]);
      } catch {
        // Ignore unparseable/non-RAW buffer
      }
    }
  }

  // Parse .dyr files first and attach merged DYR records to rawCase so all DYR lints
  // (P5001–P5020, P7001, P7004, P6003/P6005/P6006, P8001) run across split .raw + .dyr workspaces.
  const parsedDyrs: Array<{ uri: string; dyr: ReturnType<typeof parseDyr> }> = [];
  for (const [uri, dyrText] of dyrEntries) {
    parsedDyrs.push({ uri, dyr: parseDyr(dyrText) });
  }

  if (rawCase && rawUri) {
    const primaryDyrUri = parsedDyrs[0]?.uri;
    let mergedDyr = rawCase.dyr;
    if (!mergedDyr && parsedDyrs.length === 1) {
      mergedDyr = parsedDyrs[0]!.dyr;
    } else if (!mergedDyr && parsedDyrs.length > 1) {
      const records = parsedDyrs.flatMap((p) => p.dyr.records);
      const generatorsByBusId = new Map<string, (typeof records)[number]>();
      const excitersByBusId = new Map<string, (typeof records)[number]>();
      const governorsByBusId = new Map<string, (typeof records)[number]>();
      const stabilizersByBusId = new Map<string, (typeof records)[number]>();
      for (const p of parsedDyrs) {
        for (const [k, v] of p.dyr.generatorsByBusId) generatorsByBusId.set(k, v);
        for (const [k, v] of p.dyr.excitersByBusId) excitersByBusId.set(k, v);
        for (const [k, v] of p.dyr.governorsByBusId) governorsByBusId.set(k, v);
        for (const [k, v] of p.dyr.stabilizersByBusId) stabilizersByBusId.set(k, v);
      }
      mergedDyr = { records, generatorsByBusId, excitersByBusId, governorsByBusId, stabilizersByBusId };
    }
    const caseToLint = mergedDyr ? { ...rawCase, dyr: mergedDyr } : rawCase;
    for (const d of lintPsse(caseToLint, options)) {
      const isDyrCode = d.code.startsWith("P50") || d.code === "P3004" || d.code === "P7004";
      diagnostics.push({
        uri: isDyrCode && primaryDyrUri ? primaryDyrUri : rawUri,
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
  const branchXfmrKeys = new Set<string>();
  if (rawCase) {
    for (const g of rawCase.generators) {
      genKeys.add(`${g.i}:${g.id.trim() || "1"}`);
    }
    for (const b of rawCase.branches) {
      const jAbs = Math.abs(b.j);
      const lo = Math.min(b.i, jAbs);
      const hi = Math.max(b.i, jAbs);
      branchXfmrKeys.add(`${lo}:${hi}:${b.ckt.trim()}`);
    }
    for (const t of rawCase.transformers) {
      const lo = Math.min(t.i, t.j);
      const hi = Math.max(t.i, t.j);
      branchXfmrKeys.add(`${lo}:${hi}:${t.ckt.trim()}`);
    }
  }

  for (const { uri, dyr } of parsedDyrs) {
    if (!rawCase) continue;
    for (const rec of dyr.records) {
      // Device-named HVDC/FACTS models (e.g. 'DC1' 'CDC4T') use deviceName instead of ibus
      if (rec.deviceName) continue;
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
        String(rec.id).trim() !== "*" &&
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
      if (!rawCase.buses.has(br.i)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_BUS_NOT_FOUND.code,
          rule: PsseErrorCode.SEQ_BUS_NOT_FOUND.rule,
          severity: PsseErrorCode.SEQ_BUS_NOT_FOUND.severity,
          message: PsseErrorCode.SEQ_BUS_NOT_FOUND.message(br.i, rawUri ?? "raw"),
          line: br.span?.line,
        });
      }
      if (!rawCase.buses.has(br.j)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_BUS_NOT_FOUND.code,
          rule: PsseErrorCode.SEQ_BUS_NOT_FOUND.rule,
          severity: PsseErrorCode.SEQ_BUS_NOT_FOUND.severity,
          message: PsseErrorCode.SEQ_BUS_NOT_FOUND.message(br.j, rawUri ?? "raw"),
          line: br.span?.line,
        });
      }
      if (Math.abs(br.x0) < 1e-6 && Math.abs(br.r0) < 1e-6) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_IMPEDANCE_GAP.code,
          rule: PsseErrorCode.SEQ_IMPEDANCE_GAP.rule,
          severity: PsseErrorCode.SEQ_IMPEDANCE_GAP.severity,
          message: PsseErrorCode.SEQ_IMPEDANCE_GAP.message(`branch ${br.i}-${br.j} CKT '${br.ckt}' has Z0 = 0`),
          line: br.span?.line,
        });
      }
    }
    for (const xf of seq.transformers) {
      if (!rawCase.buses.has(xf.i)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_BUS_NOT_FOUND.code,
          rule: PsseErrorCode.SEQ_BUS_NOT_FOUND.rule,
          severity: PsseErrorCode.SEQ_BUS_NOT_FOUND.severity,
          message: PsseErrorCode.SEQ_BUS_NOT_FOUND.message(xf.i, rawUri ?? "raw"),
          line: xf.span?.line,
        });
      }
      if (!rawCase.buses.has(xf.j)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_BUS_NOT_FOUND.code,
          rule: PsseErrorCode.SEQ_BUS_NOT_FOUND.rule,
          severity: PsseErrorCode.SEQ_BUS_NOT_FOUND.severity,
          message: PsseErrorCode.SEQ_BUS_NOT_FOUND.message(xf.j, rawUri ?? "raw"),
          line: xf.span?.line,
        });
      }
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
          line: xf.span?.line,
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
          line: xf.span?.line,
        });
      }
    }
    for (const sh of seq.shunts) {
      if (!rawCase.buses.has(sh.i)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.SEQ_BUS_NOT_FOUND.code,
          rule: PsseErrorCode.SEQ_BUS_NOT_FOUND.rule,
          severity: PsseErrorCode.SEQ_BUS_NOT_FOUND.severity,
          message: PsseErrorCode.SEQ_BUS_NOT_FOUND.message(sh.i, rawUri ?? "raw"),
        });
      }
    }
  }

  // P5022: Validate .sub subsystem definitions and .mon monitored elements against RAW base case
  const declaredSubsystems = new Set<string>();
  const declaredAreas = new Set<number>(rawCase ? rawCase.areas.map((a) => a.i) : []);
  if (rawCase && declaredAreas.size === 0) {
    for (const b of rawCase.buses.values()) {
      if (b.area > 0) declaredAreas.add(b.area);
    }
  }
  for (const [uri, subText] of subEntries) {
    const subCase = parseSub(subText);
    for (const [subName, subDef] of subCase.subsystems) {
      declaredSubsystems.add(subName.toUpperCase());
      if (!rawCase) continue;
      for (const bId of subDef.buses) {
        if (!rawCase.buses.has(bId)) {
          diagnostics.push({
            uri,
            code: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.code,
            rule: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.rule,
            severity: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.severity,
            message: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.message(".sub", `subsystem '${subDef.name}' bus ${bId}`),
          });
        }
      }
      for (const aId of subDef.areas) {
        if (declaredAreas.size > 0 && !declaredAreas.has(aId)) {
          diagnostics.push({
            uri,
            code: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.code,
            rule: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.rule,
            severity: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.severity,
            message: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.message(".sub", `subsystem '${subDef.name}' area ${aId}`),
          });
        }
      }
    }
  }
  for (const [uri, monText] of monEntries) {
    const monCase = parseMon(monText);
    for (const vr of monCase.voltageRanges) {
      if (vr.vMin >= vr.vMax) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.code,
          rule: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.rule,
          severity: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.severity,
          message: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.message(
            ".mon",
            `inverted voltage range [${vr.vMin}, ${vr.vMax}] pu for bus ${vr.busStart}`,
          ),
        });
      }
      if (rawCase && vr.busStart === vr.busEnd && !rawCase.buses.has(vr.busStart)) {
        diagnostics.push({
          uri,
          code: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.code,
          rule: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.rule,
          severity: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.severity,
          message: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.message(".mon", `monitored voltage bus ${vr.busStart}`),
        });
      }
    }
    if (rawCase) {
      for (const br of monCase.monitoredBranches) {
        if (!rawCase.buses.has(br.fromBus) || !rawCase.buses.has(br.toBus)) {
          diagnostics.push({
            uri,
            code: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.code,
            rule: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.rule,
            severity: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.severity,
            message: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.message(
              ".mon",
              `monitored branch ${br.fromBus}-${br.toBus}`,
            ),
          });
        }
      }
    }
    if (declaredSubsystems.size > 0) {
      for (const subName of monCase.monitoredSubsystems) {
        if (!declaredSubsystems.has(subName.toUpperCase())) {
          diagnostics.push({
            uri,
            code: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.code,
            rule: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.rule,
            severity: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.severity,
            message: PsseErrorCode.MON_SUB_TARGET_NOT_FOUND.message(".mon", `undeclared subsystem '${subName}'`),
          });
        }
      }
    }
  }

  for (const [uri, conText] of conEntries) {
    if (!rawCase) continue;
    const con = parseCon(conText);
    for (const cDef of con.contingencies) {
      for (const act of cDef.actions) {
        if (act.type === "open_branch" || act.type === "close_branch" || act.type === "change_rating") {
          const lo = Math.min(act.fromBus, act.toBus);
          const hi = Math.max(act.fromBus, act.toBus);
          const exists = branchXfmrKeys.has(`${lo}:${hi}:${act.ckt.trim()}`);
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
        if (rawCase && c.args.length > 0) {
          // Extract only positional bus-number arguments (avoid mistaking circuit IDs like '2'/'3' for bus numbers)
          const targetKind = (c.args[0] ?? "").toUpperCase();
          const busArgIndices =
            targetKind === "BRANCH" || targetKind === "LINE"
              ? [1, 2]
              : targetKind === "BUS" || targetKind === "GENERATOR" || targetKind === "MACHINE" || targetKind === "LOAD"
                ? [1]
                : [0];
          for (const argIdx of busArgIndices) {
            const tok = c.args[argIdx];
            if (!tok) continue;
            const n = Number(tok);
            if (Number.isInteger(n) && n > 0 && tok === String(n) && !rawCase.buses.has(n)) {
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

  // Formal tier: Cross-file parameter drift check (P8010) when multiple .raw cases exist in the workspace
  if (options?.tier === "formal" && rawCase && rawUri) {
    const extraRawSources: PolyglotModelSource[] = [];
    for (const [uri, text] of entries) {
      if (uri === rawUri || !uri.toLowerCase().endsWith(".raw")) continue;
      const otherCase = parseRaw(text);
      for (const br of otherCase.branches) {
        const comp = `branch_${br.i}_${br.j}_${br.ckt.trim() || "1"}`;
        extraRawSources.push(
          { lang: "psse_alt", uri, component: comp, param: "r", value: br.r },
          { lang: "psse_alt", uri, component: comp, param: "x", value: br.x },
        );
      }
    }
    if (extraRawSources.length > 0) {
      for (const d of verifyPssePolyglotDrift(rawCase, extraRawSources)) {
        diagnostics.push({
          uri: rawUri,
          code: d.code,
          rule: PsseErrorCode.POLYGLOT_PARAMETER_DRIFT.rule,
          severity: d.severity,
          message: d.message,
        });
      }
    }
  }

  return diagnostics;
}
