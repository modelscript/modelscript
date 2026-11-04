// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Modelica 3.x & SBML Level 3 Cross-Language Projections.
 *
 * - cellmlToModelica(doc): Projects CellML components, variables, ODEs, algebraic equations,
 *   and cross-component connections into a Modelica 3.x physical/electrophysiology model.
 * - cellmlToSbml(doc): Projects CellML ODEs, algebraic rules, parameters, and compartments
 *   into SBML Level 3 Version 2 XML.
 */

import { resolveCellmlConnections } from "../solvers/index.js";
import type { CellmlComponent, CellmlDocument } from "../types.js";

function sanitizeIdent(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_]/g, "_");
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned || "CellmlModel";
}

function qualifyComponentExpression(
  rhs: string,
  comp: CellmlComponent,
  independentVars: Set<string>,
  forModelica: boolean,
): string {
  let out = "";
  let i = 0;
  const n = rhs.length;

  while (i < n) {
    const ch = rhs[i] ?? "";
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < n && /[a-zA-Z0-9_]/.test(rhs[i] ?? "")) {
        id += rhs[i] ?? "";
        i++;
      }
      let lookahead = i;
      while (lookahead < n && /\s/.test(rhs[lookahead] ?? "")) lookahead++;
      const isCall = rhs[lookahead] === "(";

      if (isCall) {
        if (forModelica && id === "ln") {
          out += "log";
        } else {
          out += id;
        }
      } else if (comp.variables.has(id)) {
        const qual = `${comp.name}.${id}`;
        if (independentVars.has(qual) || id === "time" || id === "t") {
          out += "time";
        } else {
          out += sanitizeIdent(`${comp.name}_${id}`);
        }
      } else {
        out += id;
      }
    } else if (/[0-9.]/.test(ch)) {
      while (i < n && /[0-9.eE+-]/.test(rhs[i] ?? "")) {
        if ((rhs[i] === "+" || rhs[i] === "-") && !/[eE]/.test(rhs[i - 1] ?? "")) {
          break;
        }
        out += rhs[i] ?? "";
        i++;
      }
    } else {
      out += ch;
      i++;
    }
  }

  return out;
}

/**
 * Projects a CellML document into a standalone Modelica 3.x model.
 */
export function cellmlToModelica(doc: CellmlDocument): string {
  const modelName = sanitizeIdent(doc.name || "CellmlElectrophysiologyModel");
  const { targetToSource } = resolveCellmlConnections(doc);

  const odeTargetQuals = new Set<string>();
  const algTargetQuals = new Set<string>();
  const independentQuals = new Set<string>();

  for (const comp of doc.components.values()) {
    for (const eq of comp.equations) {
      if (!eq.targetVariable) continue;
      const qual = `${comp.name}.${eq.targetVariable}`;
      if (eq.isOde) {
        odeTargetQuals.add(qual);
        if (eq.independentVariable) {
          independentQuals.add(`${comp.name}.${eq.independentVariable}`);
        }
      } else {
        algTargetQuals.add(qual);
      }
    }
  }

  const lines: string[] = [];
  lines.push(`model ${modelName}`);
  lines.push(`  "CellML ${doc.version} Model: ${doc.name || modelName}"`);
  lines.push(``);

  // 1. Emit component variables and parameters
  for (const comp of doc.components.values()) {
    lines.push(`  // --- Component: ${comp.name} ---`);
    for (const v of comp.variables.values()) {
      const qual = `${comp.name}.${v.name}`;
      if (
        independentQuals.has(qual) ||
        ((v.name === "time" || v.name === "t") &&
          v.initialValue === undefined &&
          !targetToSource.has(qual) &&
          !odeTargetQuals.has(qual) &&
          !algTargetQuals.has(qual))
      ) {
        independentQuals.add(qual);
        continue;
      }

      const varIdent = sanitizeIdent(`${comp.name}_${v.name}`);
      const isConnectedInput = targetToSource.has(qual);
      const isOde = odeTargetQuals.has(qual);
      const isAlg = algTargetQuals.has(qual);
      const isParameter = !isConnectedInput && !isOde && !isAlg;

      const unitAttr = v.units
        ? `(unit = "${v.units}"${isOde && v.initialValue !== undefined ? `, start = ${v.initialValue}, fixed = true` : v.initialValue !== undefined && !isParameter ? `, start = ${v.initialValue}` : ""})`
        : v.initialValue !== undefined && !isParameter
          ? `(start = ${v.initialValue}${isOde ? ", fixed = true" : ""})`
          : "";

      if (isParameter) {
        lines.push(
          `  parameter Real ${varIdent}${v.units ? `(unit = "${v.units}")` : ""} = ${v.initialValue ?? 0.0} "${comp.name}.${v.name}";`,
        );
      } else {
        lines.push(`  Real ${varIdent}${unitAttr} "${comp.name}.${v.name}";`);
      }
    }
    lines.push(``);
  }

  lines.push(`equation`);

  // 2. Emit cross-component connection equations
  if (targetToSource.size > 0) {
    lines.push(`  // --- Cross-Component Connections ---`);
    for (const [targetQual, sourceQual] of targetToSource.entries()) {
      if (independentQuals.has(targetQual) || independentQuals.has(sourceQual)) continue;
      if (odeTargetQuals.has(targetQual) || algTargetQuals.has(targetQual)) continue;
      const targetIdent = sanitizeIdent(targetQual.replace(".", "_"));
      const sourceIdent = sanitizeIdent(sourceQual.replace(".", "_"));
      lines.push(`  ${targetIdent} = ${sourceIdent};`);
    }
    lines.push(``);
  }

  // 3. Emit component ODEs and algebraic equations
  for (const comp of doc.components.values()) {
    if (comp.equations.length === 0) continue;
    lines.push(`  // --- Equations: ${comp.name} ---`);
    for (const eq of comp.equations) {
      if (!eq.targetVariable) continue;
      const targetIdent = sanitizeIdent(`${comp.name}_${eq.targetVariable}`);
      const rhsMo = qualifyComponentExpression(eq.rhsExpression, comp, independentQuals, true);
      if (eq.isOde) {
        lines.push(`  der(${targetIdent}) = ${rhsMo};`);
      } else {
        lines.push(`  ${targetIdent} = ${rhsMo};`);
      }
    }
    lines.push(``);
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n");
}

function escapeXmlAttr(raw: string): string {
  return raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Projects a CellML document into SBML Level 3 Version 2 XML.
 */
export function cellmlToSbml(doc: CellmlDocument): string {
  const modelId = sanitizeIdent(doc.name || "CellmlModel");
  const { targetToSource } = resolveCellmlConnections(doc);

  const odeTargetQuals = new Set<string>();
  const algTargetQuals = new Set<string>();
  const independentQuals = new Set<string>();

  for (const comp of doc.components.values()) {
    for (const eq of comp.equations) {
      if (!eq.targetVariable) continue;
      const qual = `${comp.name}.${eq.targetVariable}`;
      if (eq.isOde) {
        odeTargetQuals.add(qual);
        if (eq.independentVariable) {
          independentQuals.add(`${comp.name}.${eq.independentVariable}`);
        }
      } else {
        algTargetQuals.add(qual);
      }
    }
  }

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">`);
  lines.push(`  <model id="${escapeXmlAttr(modelId)}" name="${escapeXmlAttr(doc.name || modelId)}">`);

  // 1. Compartments (one compartment per CellML component, or default 'cell')
  lines.push(`    <listOfCompartments>`);
  if (doc.components.size > 0) {
    for (const comp of doc.components.values()) {
      const compId = sanitizeIdent(comp.name);
      lines.push(
        `      <compartment id="${escapeXmlAttr(compId)}" name="${escapeXmlAttr(comp.name)}" size="1.0" spatialDimensions="3" constant="true"/>`,
      );
    }
  } else {
    lines.push(`      <compartment id="cell" size="1.0" spatialDimensions="3" constant="true"/>`);
  }
  lines.push(`    </listOfCompartments>`);

  // 2. Species (for ODE state variables) and Parameters (for constants & algebraic variables)
  const speciesLines: string[] = [];
  const paramLines: string[] = [];

  for (const comp of doc.components.values()) {
    const compId = sanitizeIdent(comp.name);
    for (const v of comp.variables.values()) {
      const qual = `${comp.name}.${v.name}`;
      if (
        independentQuals.has(qual) ||
        ((v.name === "time" || v.name === "t") &&
          v.initialValue === undefined &&
          !targetToSource.has(qual) &&
          !odeTargetQuals.has(qual) &&
          !algTargetQuals.has(qual))
      ) {
        independentQuals.add(qual);
        continue;
      }

      const varId = sanitizeIdent(`${comp.name}_${v.name}`);
      const isOde = odeTargetQuals.has(qual);
      const isAlg = algTargetQuals.has(qual);
      const isConnected = targetToSource.has(qual);
      const initVal = v.initialValue ?? 0.0;

      if (isOde) {
        speciesLines.push(
          `      <species id="${escapeXmlAttr(varId)}" name="${escapeXmlAttr(`${comp.name}.${v.name}`)}" compartment="${escapeXmlAttr(compId)}" initialConcentration="${initVal}" hasOnlySubstanceUnits="false" boundaryCondition="false" constant="false"/>`,
        );
      } else {
        const isConst = !isAlg && !isConnected;
        paramLines.push(
          `      <parameter id="${escapeXmlAttr(varId)}" name="${escapeXmlAttr(`${comp.name}.${v.name}`)}" value="${initVal}"${v.units ? ` units="${escapeXmlAttr(v.units)}"` : ""} constant="${isConst}"/>`,
        );
      }
    }
  }

  if (speciesLines.length > 0) {
    lines.push(`    <listOfSpecies>`);
    lines.push(...speciesLines);
    lines.push(`    </listOfSpecies>`);
  }

  if (paramLines.length > 0) {
    lines.push(`    <listOfParameters>`);
    lines.push(...paramLines);
    lines.push(`    </listOfParameters>`);
  }

  // 3. Rules (<rateRule> for ODEs, <assignmentRule> for algebraic equations and connections)
  const ruleLines: string[] = [];

  for (const [targetQual, sourceQual] of targetToSource.entries()) {
    if (independentQuals.has(targetQual) || independentQuals.has(sourceQual)) continue;
    if (odeTargetQuals.has(targetQual) || algTargetQuals.has(targetQual)) continue;
    const targetId = sanitizeIdent(targetQual.replace(".", "_"));
    const sourceId = sanitizeIdent(sourceQual.replace(".", "_"));
    ruleLines.push(
      `      <assignmentRule variable="${escapeXmlAttr(targetId)}" formula="${escapeXmlAttr(sourceId)}"/>`,
    );
  }

  for (const comp of doc.components.values()) {
    for (const eq of comp.equations) {
      if (!eq.targetVariable) continue;
      const targetId = sanitizeIdent(`${comp.name}_${eq.targetVariable}`);
      const rhsExpr = qualifyComponentExpression(eq.rhsExpression, comp, independentQuals, false);
      if (eq.isOde) {
        ruleLines.push(`      <rateRule variable="${escapeXmlAttr(targetId)}" formula="${escapeXmlAttr(rhsExpr)}"/>`);
      } else {
        ruleLines.push(
          `      <assignmentRule variable="${escapeXmlAttr(targetId)}" formula="${escapeXmlAttr(rhsExpr)}"/>`,
        );
      }
    }
  }

  if (ruleLines.length > 0) {
    lines.push(`    <listOfRules>`);
    lines.push(...ruleLines);
    lines.push(`    </listOfRules>`);
  }

  lines.push(`  </model>`);
  lines.push(`</sbml>`);
  return lines.join("\n");
}
