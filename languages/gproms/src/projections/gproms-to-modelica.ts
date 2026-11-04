// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gproms — Modelica 3.x Projection for gPROMS Process Models.
 *
 * Translates gPROMS DECLARE TYPE bounds, MODEL parameters, lumped & Method-of-Lines
 * discretized DISTRIBUTION_DOMAIN variables, $x time derivatives, and PARTIAL spatial
 * derivatives into standalone Modelica 3.x models.
 */

import { normalizeGpromsExprForEval } from "../solvers/gproms-solver.js";
import type { GpromsDocument } from "../types.js";

export function gpromsToModelica(doc: GpromsDocument, customModelName?: string): string {
  const proc = doc.processes.values().next().value;
  let model = doc.models.values().next().value;
  if (proc && proc.units.size > 0) {
    const uModelName = proc.units.values().next().value;
    if (uModelName && doc.models.has(uModelName)) {
      model = doc.models.get(uModelName);
    }
  }

  const rawName = customModelName ?? model?.name ?? "GpromsProcessModel";
  const safeModelName = rawName.replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`model ${safeModelName}`);
  lines.push(`  "gPROMS Process Model: ${model?.name ?? safeModelName}"`);
  lines.push(``);

  if (!model) {
    lines.push(`equation`);
    lines.push(`end ${safeModelName};`);
    return lines.join("\n");
  }

  // 1. Parameters
  if (model.parameters.size > 0) {
    lines.push(`  // --- Parameters ---`);
    for (const [pName, pDef] of model.parameters) {
      const val = proc?.sets.get(pName) ?? pDef.defaultValue ?? 0.0;
      const moType = pDef.dataType === "INTEGER" ? "Integer" : "Real";
      const valStr = pDef.dataType === "INTEGER" ? `${Math.round(val)}` : val.toFixed(4);
      lines.push(`  parameter ${moType} ${pName} = ${valStr} "Parameter ${pName}";`);
    }
    lines.push(``);
  }

  // 2. Spatial domain step sizes
  const domainGridPoints = new Map<string, number>();
  const domainDelta = new Map<string, number>();
  const domainNames = new Set<string>(model.domains.keys());

  if (model.domains.size > 0) {
    lines.push(`  // --- Distribution Domain Discretization ---`);
    for (const [dName, dom] of model.domains) {
      const nPts = Math.max(2, dom.gridPoints);
      const dz = (dom.upperBound - dom.lowerBound) / (nPts - 1);
      domainGridPoints.set(dName, nPts);
      domainDelta.set(dName, dz);
      lines.push(`  parameter Real dz_${dName} = ${dz.toFixed(6)} "Grid spacing for domain ${dName}";`);
    }
    lines.push(``);
  }

  // 3. Variables
  const distributedVars = new Set<string>();
  lines.push(`  // --- Process Variables ---`);
  for (const [vName, vDef] of model.variables) {
    const vt = doc.variableTypes.get(vDef.typeName);
    const startVal = proc?.initials.get(vName) ?? proc?.assigns.get(vName) ?? vt?.defaultValue ?? 0.0;
    const minStr = vt ? `, min = ${vt.lowerBound}` : "";
    const maxStr = vt ? `, max = ${vt.upperBound}` : "";

    if (vDef.domains.length > 0) {
      distributedVars.add(vName);
      const dName = vDef.domains[0]!;
      const nPts = domainGridPoints.get(dName) ?? 10;
      for (let i = 0; i < nPts; i++) {
        lines.push(`  Real ${vName}_${i}(start = ${startVal.toFixed(4)}${minStr}${maxStr}) "${vName} at node ${i}";`);
      }
      lines.push(`  Real ${vName}(start = ${startVal.toFixed(4)}${minStr}${maxStr}) "Outlet value of ${vName}";`);
    } else {
      lines.push(
        `  Real ${vName}(start = ${startVal.toFixed(4)}${minStr}${maxStr}) "Variable ${vName} (${vDef.typeName})";`,
      );
    }
  }
  lines.push(``);

  lines.push(`equation`);

  // Map boundary equations
  const boundaryMap = new Map<string, string>();
  for (const beq of model.boundaryEquations) {
    const parenIdx = beq.lhs.indexOf("(");
    const varName = (parenIdx > 0 ? beq.lhs.slice(0, parenIdx) : beq.lhs).replace("$", "").trim();
    boundaryMap.set(varName, beq.rhs);
  }

  const definedVars = new Set<string>();

  for (const eq of model.equations) {
    const cleanLhs = eq.lhs.trim();
    const isTimeDeriv = cleanLhs.startsWith("$");
    const rawVar = isTimeDeriv ? cleanLhs.slice(1).trim() : cleanLhs;
    const parenIdx = rawVar.indexOf("(");
    const targetVar = (parenIdx > 0 ? rawVar.slice(0, parenIdx) : rawVar).trim();

    if (distributedVars.has(targetVar)) {
      definedVars.add(targetVar);
      const vDef = model.variables.get(targetVar)!;
      const dName = vDef.domains[0]!;
      const nPts = domainGridPoints.get(dName) ?? 10;
      const bRhs = boundaryMap.get(targetVar);

      if (bRhs !== undefined) {
        lines.push(`  ${targetVar}_0 = ${bRhs};`);
      } else {
        lines.push(`  der(${targetVar}_0) = 0.0;`);
      }

      const normRhs = normalizeGpromsExprForEval(eq.rhs, distributedVars, domainNames);
      for (let i = 1; i < nPts; i++) {
        let nodeRhs = normRhs;
        for (const dv of distributedVars) {
          const nextIdx = i < nPts - 1 ? i + 1 : i;
          nodeRhs = nodeRhs.replace(
            new RegExp(`\\b__d1_${dv}_${dName}\\b`, "g"),
            `((${dv}_${i} - ${dv}_${i - 1}) / dz_${dName})`,
          );
          nodeRhs = nodeRhs.replace(
            new RegExp(`\\b__d2_${dv}_${dName}\\b`, "g"),
            `((${dv}_${nextIdx} - 2.0 * ${dv}_${i} + ${dv}_${i - 1}) / (dz_${dName} * dz_${dName}))`,
          );
          nodeRhs = nodeRhs.replace(new RegExp(`\\b${dv}\\b`, "g"), `${dv}_${i}`);
        }
        const lhsMo = isTimeDeriv ? `der(${targetVar}_${i})` : `${targetVar}_${i}`;
        lines.push(`  ${lhsMo} = ${nodeRhs};`);
      }
      lines.push(`  ${targetVar} = ${targetVar}_${nPts - 1};`);
    } else {
      definedVars.add(targetVar);
      const lhsMo = isTimeDeriv ? `der(${targetVar})` : targetVar;
      const rhsMo = eq.rhs.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, "der($1)");
      lines.push(`  ${lhsMo} = ${rhsMo};`);
    }
  }

  // Emit equations for ASSIGNed input variables
  for (const [vName, vDef] of model.variables) {
    if (!definedVars.has(vName) && vDef.domains.length === 0) {
      const val =
        proc?.assigns.get(vName) ??
        proc?.initials.get(vName) ??
        doc.variableTypes.get(vDef.typeName)?.defaultValue ??
        0.0;
      lines.push(`  ${vName} = ${val.toFixed(4)};`);
    }
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}
