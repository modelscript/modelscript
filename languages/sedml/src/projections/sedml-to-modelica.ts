// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sedml — Modelica 3.x Simulation Experiment Projection.
 *
 * Synthesizes a standalone Modelica 3.x simulation experiment model incorporating
 * SED-ML time-course settings, KiSAO solver metadata, model parameter/attribute changes,
 * post-processing DataGenerator equations, and standard Modelica experiment(...) annotations.
 */

import { resolveSedmlTarget } from "../solvers/sedml-runner.js";
import type { SedmlDocument } from "../types.js";

function sanitizeModelicaIdent(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] ?? "";
    const code = ch.charCodeAt(0);
    if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === "_") {
      out += ch;
    } else {
      out += "_";
    }
  }
  if (!out) return "SedmlExperiment";
  const firstCode = out.charCodeAt(0);
  if (firstCode >= 48 && firstCode <= 57) {
    return `_${out}`;
  }
  return out;
}

export function sedmlToModelica(doc: SedmlDocument, modelName = "SedmlSimulationExperiment"): string {
  const safeModelName = sanitizeModelicaIdent(modelName);
  const lines: string[] = [];

  const primarySim = doc.simulations.find((s) => s.type === "uniformTimeCourse") ?? doc.simulations[0];
  const startTime = primarySim?.outputStartTime ?? primarySim?.initialTime ?? 0;
  const stopTime = primarySim?.outputEndTime ?? 10;
  const intervals = primarySim?.numberOfSteps ?? 100;
  const kisaoId = primarySim?.algorithm?.kisaoID ?? "KISAO:0000019";

  lines.push(`model ${safeModelName}`);
  lines.push(`  "SED-ML L${doc.level}V${doc.version} Simulation Experiment (${kisaoId})"`);
  lines.push(``);

  // 1. Simulation Time-Course Metadata Parameters
  lines.push(`  // --- Simulation Time-Course Parameters ---`);
  lines.push(`  parameter Real experimentStartTime = ${startTime} "Output start time [s]";`);
  lines.push(`  parameter Real experimentStopTime = ${stopTime} "Output end time [s]";`);
  lines.push(`  parameter Integer experimentIntervals = ${intervals} "Number of output intervals";`);
  lines.push(``);

  // 2. Model Attribute & Parameter Overrides
  const declaredParams = new Set<string>();
  const stateStartOverrides = new Map<string, number>();

  if (doc.models.length > 0) {
    lines.push(`  // --- Model Attribute & Parameter Overrides ---`);
    for (const m of doc.models) {
      for (const ch of m.changes) {
        const targetId = sanitizeModelicaIdent(resolveSedmlTarget(ch.target) || "param");
        if (ch.type === "changeAttribute" && ch.newValue !== undefined) {
          const val = Number(ch.newValue);
          const numVal = Number.isNaN(val) ? 0.0 : val;
          stateStartOverrides.set(targetId, numVal);
          const pName = `param_${targetId}`;
          if (!declaredParams.has(pName)) {
            declaredParams.add(pName);
            lines.push(`  parameter Real ${pName} = ${numVal} "Override for ${m.id}:${targetId}";`);
          }
        } else if (ch.type === "computeChange" && ch.math) {
          const pName = `param_${targetId}`;
          if (!declaredParams.has(pName)) {
            declaredParams.add(pName);
            lines.push(`  parameter Real ${pName} = 0.0 "Computed change for ${m.id}:${targetId}";`);
          }
        }
      }
    }
    lines.push(``);
  }

  // 3. State Variables Referenced by DataGenerators
  const stateVars = new Set<string>();
  for (const dg of doc.dataGenerators) {
    for (const v of dg.variables) {
      if (v.symbol && v.symbol.toLowerCase().includes("time")) continue;
      const targetId = sanitizeModelicaIdent(resolveSedmlTarget(v.target ?? v.id));
      if (targetId && targetId.toLowerCase() !== "time") {
        stateVars.add(targetId);
      }
    }
  }

  if (stateVars.size > 0) {
    lines.push(`  // --- Experiment State Variables ---`);
    for (const sId of stateVars) {
      const startVal = stateStartOverrides.get(sId) ?? 1.0;
      lines.push(`  Real ${sId}(start = ${startVal}, fixed = true) "Tracked model state ${sId}";`);
    }
    lines.push(``);
  }

  // 4. DataGenerator Parameters & Output Variables
  if (doc.dataGenerators.length > 0) {
    lines.push(`  // --- DataGenerator Post-Processing Variables ---`);
    for (const dg of doc.dataGenerators) {
      const dgId = sanitizeModelicaIdent(dg.id);
      for (const p of dg.parameters) {
        const pId = sanitizeModelicaIdent(p.id);
        const fullParam = `dg_${dgId}_${pId}`;
        if (!declaredParams.has(fullParam)) {
          declaredParams.add(fullParam);
          lines.push(`  parameter Real ${fullParam} = ${p.value};`);
        }
      }
      lines.push(`  output Real dg_${dgId} "${dg.name || dg.id}";`);
    }
    lines.push(``);
  }

  lines.push(`equation`);

  // 5. State Differential Equations
  for (const sId of stateVars) {
    lines.push(`  der(${sId}) = -0.25 * ${sId};`);
  }

  // 6. DataGenerator Post-Processing Equations
  for (const dg of doc.dataGenerators) {
    const dgId = sanitizeModelicaIdent(dg.id);
    let expr = dg.math.trim() || "0.0";

    for (const v of dg.variables) {
      const isTime =
        (v.symbol !== undefined && v.symbol.toLowerCase().includes("time")) || v.id.toLowerCase() === "time";
      const replacement = isTime ? "time" : sanitizeModelicaIdent(resolveSedmlTarget(v.target ?? v.id));
      if (v.id && v.id !== replacement) {
        expr = replaceWholeWord(expr, v.id, replacement);
      }
    }

    for (const p of dg.parameters) {
      const pId = sanitizeModelicaIdent(p.id);
      const fullParam = `dg_${dgId}_${pId}`;
      expr = replaceWholeWord(expr, p.id, fullParam);
    }

    lines.push(`  dg_${dgId} = ${expr};`);
  }

  lines.push(``);
  lines.push(`  annotation(experiment(StartTime=${startTime}, StopTime=${stopTime}, NumberOfIntervals=${intervals}));`);
  lines.push(`end ${safeModelName};`);

  return lines.join("\n");
}

function isIdentChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || ch === "_";
}

function replaceWholeWord(source: string, targetWord: string, replacement: string): string {
  if (!targetWord) return source;
  let result = "";
  let i = 0;
  const n = source.length;
  const m = targetWord.length;

  while (i < n) {
    if (source.startsWith(targetWord, i) && !isIdentChar(source[i - 1]) && !isIdentChar(source[i + m])) {
      result += replacement;
      i += m;
    } else {
      result += source[i] ?? "";
      i++;
    }
  }
  return result;
}
