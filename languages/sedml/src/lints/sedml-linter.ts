// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sedml — Pre-flight Simulation Experiment Diagnostics Linter.
 *
 * Implements OpenModelica-style diagnostic codes (M9151 - M9160) for SED-ML Level 1
 * Version 3 and Version 4 documents.
 */

import { type DiagnosticItem, SedmlErrorCode } from "../errors.js";
import type { SedmlDocument, SedmlModel, SedmlRange } from "../types.js";

const BUILTIN_MATH_SYMBOLS = new Set([
  "time",
  "t",
  "pi",
  "e",
  "true",
  "false",
  "inf",
  "nan",
  "exp",
  "log",
  "ln",
  "log10",
  "sqrt",
  "root",
  "pow",
  "abs",
  "min",
  "max",
  "sum",
  "product",
  "floor",
  "ceil",
  "ceiling",
  "sin",
  "cos",
  "tan",
  "asin",
  "acos",
  "atan",
  "sinh",
  "cosh",
  "tanh",
]);

function isValidKisaoId(kisaoId: string | undefined): boolean {
  if (!kisaoId) return false;
  const trimmed = kisaoId.trim();
  if (trimmed.length !== 13 || !trimmed.startsWith("KISAO:")) {
    return false;
  }
  for (let i = 6; i < 13; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

function isInternalModelReferenceCandidate(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("#")) return true;
  if (trimmed.includes(".") || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes(":")) {
    return false;
  }
  return true;
}

function normalizeModelRefId(source: string): string {
  const trimmed = source.trim();
  return trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
}

function extractMathIdentifiers(expr: string): string[] {
  const idents: string[] = [];
  const n = expr.length;
  let i = 0;

  while (i < n) {
    const ch = expr[i] ?? "";
    const code = ch.charCodeAt(0);
    const isAlphaOrUnder = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === "_";

    if (isAlphaOrUnder) {
      const prevCh = i > 0 ? (expr[i - 1] ?? "") : "";
      const prevCode = prevCh ? prevCh.charCodeAt(0) : 0;
      const precededByNum = (prevCode >= 48 && prevCode <= 57) || prevCh === ".";

      let id = "";
      while (i < n) {
        const c = expr[i] ?? "";
        const cc = c.charCodeAt(0);
        const isIdChar = (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122) || (cc >= 48 && cc <= 57) || c === "_";
        if (!isIdChar) break;
        id += c;
        i++;
      }

      if (!precededByNum && id) {
        idents.push(id);
      }
      continue;
    }
    i++;
  }

  return idents;
}

export function lintSedml(doc: SedmlDocument): DiagnosticItem[] {
  const diagnostics: DiagnosticItem[] = [];

  // M9159: Empty SED-ML experiment (no simulations or no tasks defined)
  if (doc.simulations.length === 0 || doc.tasks.length === 0) {
    diagnostics.push({
      code: SedmlErrorCode.EMPTY_SEDML_EXPERIMENT.code,
      rule: SedmlErrorCode.EMPTY_SEDML_EXPERIMENT.rule,
      severity: SedmlErrorCode.EMPTY_SEDML_EXPERIMENT.severity,
      message: SedmlErrorCode.EMPTY_SEDML_EXPERIMENT.message(),
      range: doc.range,
    });
  }

  // M9160: Duplicate SED-ML IDs across top-level elements and scoped child elements
  const seenGlobalIds = new Set<string>();
  const checkDuplicateId = (id: string, elementKind: string, range?: SedmlRange): void => {
    if (!id) return;
    if (seenGlobalIds.has(id)) {
      diagnostics.push({
        code: SedmlErrorCode.DUPLICATE_SEDML_ID.code,
        rule: SedmlErrorCode.DUPLICATE_SEDML_ID.rule,
        severity: SedmlErrorCode.DUPLICATE_SEDML_ID.severity,
        message: SedmlErrorCode.DUPLICATE_SEDML_ID.message(id, elementKind),
        range,
      });
    } else {
      seenGlobalIds.add(id);
    }
  };

  const simById = new Map<string, (typeof doc.simulations)[number]>();
  for (const sim of doc.simulations) {
    checkDuplicateId(sim.id, sim.type, sim.range);
    if (sim.id) simById.set(sim.id, sim);
  }

  const modelById = new Map<string, SedmlModel>();
  for (const model of doc.models) {
    checkDuplicateId(model.id, "model", model.range);
    if (model.id) modelById.set(model.id, model);
  }

  const taskById = new Map<string, (typeof doc.tasks)[number]>();
  for (const task of doc.tasks) {
    checkDuplicateId(task.id, task.type, task.range);
    if (task.id) taskById.set(task.id, task);
  }

  const dgById = new Map<string, (typeof doc.dataGenerators)[number]>();
  for (const dg of doc.dataGenerators) {
    checkDuplicateId(dg.id, "dataGenerator", dg.range);
    if (dg.id) dgById.set(dg.id, dg);
  }

  for (const out of doc.outputs) {
    checkDuplicateId(out.id, out.type, out.range);
    const seenOutputChildIds = new Set<string>();
    for (const c of out.curves) {
      if (c.id) {
        if (seenOutputChildIds.has(c.id)) {
          diagnostics.push({
            code: SedmlErrorCode.DUPLICATE_SEDML_ID.code,
            rule: SedmlErrorCode.DUPLICATE_SEDML_ID.rule,
            severity: SedmlErrorCode.DUPLICATE_SEDML_ID.severity,
            message: SedmlErrorCode.DUPLICATE_SEDML_ID.message(c.id, "curve"),
            range: c.range ?? out.range,
          });
        } else {
          seenOutputChildIds.add(c.id);
        }
      }
    }
    for (const ds of out.dataSets) {
      if (ds.id) {
        if (seenOutputChildIds.has(ds.id)) {
          diagnostics.push({
            code: SedmlErrorCode.DUPLICATE_SEDML_ID.code,
            rule: SedmlErrorCode.DUPLICATE_SEDML_ID.rule,
            severity: SedmlErrorCode.DUPLICATE_SEDML_ID.severity,
            message: SedmlErrorCode.DUPLICATE_SEDML_ID.message(ds.id, "dataSet"),
            range: ds.range ?? out.range,
          });
        } else {
          seenOutputChildIds.add(ds.id);
        }
      }
    }
  }

  // M9151 & M9152: Simulation time-course bounds and KiSAO algorithm validation
  for (const sim of doc.simulations) {
    if (sim.type === "uniformTimeCourse") {
      const initTime = sim.initialTime ?? 0;
      const outStart = sim.outputStartTime ?? initTime;
      const outEnd = sim.outputEndTime ?? 0;
      const steps = sim.numberOfSteps ?? 0;

      if (outStart < initTime) {
        diagnostics.push({
          code: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.code,
          rule: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.rule,
          severity: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.severity,
          message: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.message(
            sim.id,
            `outputStartTime (${outStart}) < initialTime (${initTime})`,
          ),
          range: sim.range,
        });
      } else if (outEnd <= outStart) {
        diagnostics.push({
          code: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.code,
          rule: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.rule,
          severity: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.severity,
          message: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.message(
            sim.id,
            `outputEndTime (${outEnd}) <= outputStartTime (${outStart})`,
          ),
          range: sim.range,
        });
      } else if (steps <= 0 || !Number.isInteger(steps)) {
        diagnostics.push({
          code: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.code,
          rule: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.rule,
          severity: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.severity,
          message: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.message(sim.id, `numberOfSteps (${steps}) <= 0`),
          range: sim.range,
        });
      }
    } else if (sim.type === "oneStep") {
      const step = sim.step ?? 0;
      if (step <= 0) {
        diagnostics.push({
          code: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.code,
          rule: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.rule,
          severity: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.severity,
          message: SedmlErrorCode.INVALID_TIME_COURSE_BOUNDS.message(sim.id, `step (${step}) <= 0`),
          range: sim.range,
        });
      }
    }

    // M9152: Validate algorithm kisaoID
    if (!sim.algorithm || !isValidKisaoId(sim.algorithm.kisaoID)) {
      diagnostics.push({
        code: SedmlErrorCode.INVALID_KISAO_ID.code,
        rule: SedmlErrorCode.INVALID_KISAO_ID.rule,
        severity: SedmlErrorCode.INVALID_KISAO_ID.severity,
        message: SedmlErrorCode.INVALID_KISAO_ID.message(sim.id, sim.algorithm?.kisaoID || "<missing>"),
        range: sim.algorithm?.range ?? sim.range,
      });
    } else {
      for (const ap of sim.algorithm.parameters) {
        if (!isValidKisaoId(ap.kisaoID)) {
          diagnostics.push({
            code: SedmlErrorCode.INVALID_KISAO_ID.code,
            rule: SedmlErrorCode.INVALID_KISAO_ID.rule,
            severity: SedmlErrorCode.INVALID_KISAO_ID.severity,
            message: SedmlErrorCode.INVALID_KISAO_ID.message(sim.id, ap.kisaoID || "<missing>"),
            range: ap.range ?? sim.algorithm.range ?? sim.range,
          });
        }
      }
    }
  }

  // M9153 (model source) & M9157 (circular model source chain)
  const reportedCycleModels = new Set<string>();
  for (const model of doc.models) {
    if (isInternalModelReferenceCandidate(model.source)) {
      const refId = normalizeModelRefId(model.source);
      if (!refId || !modelById.has(refId)) {
        diagnostics.push({
          code: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.code,
          rule: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.rule,
          severity: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.severity,
          message: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.message(model.id, model.source || "<empty>"),
          range: model.range,
        });
        continue;
      }
    }

    // Check for cycle in model.source chain
    const chain: string[] = [model.id];
    const visited = new Set<string>([model.id]);
    let curr: SedmlModel | undefined = model;

    while (curr) {
      const nextId = normalizeModelRefId(curr.source);
      if (!nextId || !modelById.has(nextId)) {
        break;
      }
      chain.push(nextId);
      if (visited.has(nextId)) {
        if (!reportedCycleModels.has(model.id)) {
          reportedCycleModels.add(model.id);
          diagnostics.push({
            code: SedmlErrorCode.CIRCULAR_MODEL_SOURCE.code,
            rule: SedmlErrorCode.CIRCULAR_MODEL_SOURCE.rule,
            severity: SedmlErrorCode.CIRCULAR_MODEL_SOURCE.severity,
            message: SedmlErrorCode.CIRCULAR_MODEL_SOURCE.message(model.id, chain.join(" -> ")),
            range: model.range,
          });
        }
        break;
      }
      visited.add(nextId);
      curr = modelById.get(nextId);
    }
  }

  // M9153, M9154, M9155 on Tasks
  for (const task of doc.tasks) {
    if (task.type === "task") {
      if (!task.modelReference || !modelById.has(task.modelReference)) {
        diagnostics.push({
          code: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.code,
          rule: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.rule,
          severity: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.severity,
          message: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.message(task.id, task.modelReference || "<empty>"),
          range: task.range,
        });
      }

      if (!task.simulationReference || !simById.has(task.simulationReference)) {
        diagnostics.push({
          code: SedmlErrorCode.UNRESOLVED_SIMULATION_REFERENCE.code,
          rule: SedmlErrorCode.UNRESOLVED_SIMULATION_REFERENCE.rule,
          severity: SedmlErrorCode.UNRESOLVED_SIMULATION_REFERENCE.severity,
          message: SedmlErrorCode.UNRESOLVED_SIMULATION_REFERENCE.message(
            task.id,
            task.simulationReference || "<empty>",
          ),
          range: task.range,
        });
      }
    } else if (task.type === "repeatedTask") {
      for (const sv of task.taskChanges ?? []) {
        if (!sv.modelReference || !modelById.has(sv.modelReference)) {
          diagnostics.push({
            code: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.code,
            rule: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.rule,
            severity: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.severity,
            message: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.message(task.id, sv.modelReference || "<empty>"),
            range: sv.range ?? task.range,
          });
        }
      }
      for (const st of task.subTasks ?? []) {
        if (!st.task || !taskById.has(st.task)) {
          diagnostics.push({
            code: SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.code,
            rule: SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.rule,
            severity: SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.severity,
            message: SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.message(task.id, st.task || "<empty>"),
            range: st.range ?? task.range,
          });
        }
      }
    }
  }

  // M9155 & M9158 on DataGenerators
  for (const dg of doc.dataGenerators) {
    const localDeclared = new Set<string>();

    for (const v of dg.variables) {
      if (v.id) localDeclared.add(v.id);
      if (v.taskReference !== undefined || !v.modelReference) {
        if (!v.taskReference || !taskById.has(v.taskReference)) {
          diagnostics.push({
            code: SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.code,
            rule: SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.rule,
            severity: SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.severity,
            message: SedmlErrorCode.UNRESOLVED_TASK_REFERENCE.message(dg.id, v.taskReference || "<empty>"),
            range: v.range ?? dg.range,
          });
        }
      } else if (v.modelReference && !modelById.has(v.modelReference)) {
        diagnostics.push({
          code: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.code,
          rule: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.rule,
          severity: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.severity,
          message: SedmlErrorCode.UNRESOLVED_MODEL_REFERENCE.message(dg.id, v.modelReference),
          range: v.range ?? dg.range,
        });
      }
    }

    for (const p of dg.parameters) {
      if (p.id) localDeclared.add(p.id);
    }

    // M9158: Undefined math variable in dataGenerator
    if (dg.math.trim().length > 0) {
      const seenUndefined = new Set<string>();
      for (const sym of extractMathIdentifiers(dg.math)) {
        if (seenUndefined.has(sym)) continue;
        if (BUILTIN_MATH_SYMBOLS.has(sym.toLowerCase())) continue;
        if (!localDeclared.has(sym)) {
          seenUndefined.add(sym);
          diagnostics.push({
            code: SedmlErrorCode.UNDEFINED_DATA_GENERATOR_MATH_VARIABLE.code,
            rule: SedmlErrorCode.UNDEFINED_DATA_GENERATOR_MATH_VARIABLE.rule,
            severity: SedmlErrorCode.UNDEFINED_DATA_GENERATOR_MATH_VARIABLE.severity,
            message: SedmlErrorCode.UNDEFINED_DATA_GENERATOR_MATH_VARIABLE.message(dg.id, sym),
            range: dg.range,
          });
        }
      }
    }
  }

  // M9156: Unresolved dataGenerator references in outputs (plot2D, plot3D, report)
  for (const out of doc.outputs) {
    for (const curve of out.curves) {
      if (!curve.xDataReference || !dgById.has(curve.xDataReference)) {
        diagnostics.push({
          code: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.code,
          rule: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.rule,
          severity: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.severity,
          message: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.message(
            out.id,
            curve.id,
            curve.xDataReference || "<empty>",
          ),
          range: curve.range ?? out.range,
        });
      }
      if (!curve.yDataReference || !dgById.has(curve.yDataReference)) {
        diagnostics.push({
          code: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.code,
          rule: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.rule,
          severity: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.severity,
          message: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.message(
            out.id,
            curve.id,
            curve.yDataReference || "<empty>",
          ),
          range: curve.range ?? out.range,
        });
      }
      if (curve.zDataReference !== undefined && (!curve.zDataReference || !dgById.has(curve.zDataReference))) {
        diagnostics.push({
          code: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.code,
          rule: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.rule,
          severity: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.severity,
          message: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.message(
            out.id,
            curve.id,
            curve.zDataReference || "<empty>",
          ),
          range: curve.range ?? out.range,
        });
      }
    }

    for (const ds of out.dataSets) {
      if (!ds.dataReference || !dgById.has(ds.dataReference)) {
        diagnostics.push({
          code: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.code,
          rule: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.rule,
          severity: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.severity,
          message: SedmlErrorCode.UNRESOLVED_DATA_GENERATOR_REFERENCE.message(
            out.id,
            ds.id,
            ds.dataReference || "<empty>",
          ),
          range: ds.range ?? out.range,
        });
      }
    }
  }

  return diagnostics;
}
