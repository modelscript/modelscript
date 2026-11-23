// SPDX-License-Identifier: AGPL-3.0-or-later

import type { TrnsysDeck, TrnsysUnit, TrnsysValue } from "../types.js";

function numParam(unit: TrnsysUnit, idx: number, fallback: number): number {
  const p: TrnsysValue | undefined = unit.parameters[idx];
  return p && p.kind === "number" && Number.isFinite(p.value) ? p.value : fallback;
}

function numInit(unit: TrnsysUnit, idx: number, fallback: number): number {
  const v: TrnsysValue | undefined = unit.initialInputs[idx];
  return v && v.kind === "number" && Number.isFinite(v.value) ? v.value : fallback;
}

function sanitizeIdent(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `M_${cleaned}`;
}

/**
 * Projects a parsed `TrnsysDeck` into an equivalent Modelica model.
 */
export function trnsysToModelica(deck: TrnsysDeck): string {
  const modelName = sanitizeIdent(deck.name || "TrnsysSystem");
  const lines: string[] = [];

  lines.push(`model ${modelName}`);
  lines.push(`  "Projected from TRNSYS .dck simulation deck"`);

  if (deck.simulation) {
    lines.push(
      `  // SIMULATION tStart=${deck.simulation.tStart} h, tStop=${deck.simulation.tStop} h, dt=${deck.simulation.dt} h`,
    );
  }

  for (const c of deck.constants) {
    const val = c.value ?? 0.0;
    lines.push(`  parameter Real ${sanitizeIdent(c.name)} = ${val};`);
  }

  // Variable declarations per unit
  for (const unit of deck.units) {
    const u = `u${unit.unitNumber}`;
    lines.push(`  // UNIT ${unit.unitNumber} TYPE ${unit.typeNumber}${unit.label ? ` (${unit.label})` : ""}`);
    switch (unit.typeNumber) {
      case 1: {
        lines.push(`  parameter Real ${u}_area = ${numParam(unit, 0, 4.0)};`);
        lines.push(`  parameter Real ${u}_cp = ${numParam(unit, 1, 4.19)};`);
        lines.push(`  parameter Real ${u}_frTauAlpha = ${numParam(unit, 2, 0.75)};`);
        lines.push(`  parameter Real ${u}_frUl = ${numParam(unit, 3, 15.0)};`);
        lines.push(`  Real ${u}_in1, ${u}_in2, ${u}_in3, ${u}_in4;`);
        lines.push(`  Real ${u}_out1, ${u}_out2, ${u}_out3;`);
        break;
      }
      case 2: {
        lines.push(`  Real ${u}_in1, ${u}_in2, ${u}_in3, ${u}_in4, ${u}_in5, ${u}_in6;`);
        lines.push(`  Real ${u}_out1;`);
        break;
      }
      case 3: {
        lines.push(`  parameter Real ${u}_mDotMax = ${numParam(unit, 0, 200.0)};`);
        lines.push(`  parameter Real ${u}_pMax = ${numParam(unit, 2, 180.0)};`);
        lines.push(`  Real ${u}_in1, ${u}_in2, ${u}_in3;`);
        lines.push(`  Real ${u}_out1, ${u}_out2, ${u}_out3;`);
        break;
      }
      case 4: {
        const nNodes = Math.max(1, Math.min(6, Math.round(numParam(unit, 5, 3))));
        const vol = numParam(unit, 0, 0.3);
        const cp = numParam(unit, 1, 4.19);
        const rho = numParam(unit, 2, 1000.0);
        const uLoss = numParam(unit, 3, 1.5);
        const height = numParam(unit, 4, 1.5);
        lines.push(`  parameter Real ${u}_volume = ${vol};`);
        lines.push(`  parameter Real ${u}_cp = ${cp};`);
        lines.push(`  parameter Real ${u}_rho = ${rho};`);
        lines.push(`  parameter Real ${u}_uLoss = ${uLoss};`);
        lines.push(`  parameter Real ${u}_height = ${height};`);
        lines.push(`  Real ${u}_in1, ${u}_in2, ${u}_in3, ${u}_in4, ${u}_in5;`);
        for (let i = 0; i < nNodes; i++) {
          const d = unit.derivatives[i];
          const t0 = d && d.kind === "number" ? d.value : numParam(unit, 6, 20.0);
          lines.push(`  Real ${u}_T${i + 1}(start = ${t0});`);
        }
        lines.push(`  Real ${u}_out1, ${u}_out2, ${u}_out3, ${u}_out4, ${u}_out5, ${u}_out6;`);
        break;
      }
      case 14: {
        lines.push(`  Real ${u}_out1, ${u}_out2;`);
        break;
      }
      case 15: {
        lines.push(`  parameter Real ${u}_tAmbMean = ${numParam(unit, 0, 20.0)};`);
        lines.push(`  parameter Real ${u}_iPeak = ${numParam(unit, 2, 2880.0)};`);
        lines.push(`  Real ${u}_out1, ${u}_out2, ${u}_out3, ${u}_out4;`);
        break;
      }
      case 56: {
        const cap = numParam(unit, 0, 5000.0);
        const ua = numParam(unit, 1, 250.0);
        const solAp = numParam(unit, 2, 6.0);
        const tInit = numParam(unit, 3, 20.0);
        lines.push(`  parameter Real ${u}_C = ${cap};`);
        lines.push(`  parameter Real ${u}_UA = ${ua};`);
        lines.push(`  parameter Real ${u}_solarAperture = ${solAp};`);
        lines.push(`  Real ${u}_in1, ${u}_in2, ${u}_in3, ${u}_in4;`);
        lines.push(`  Real ${u}_Tzone(start = ${tInit});`);
        lines.push(`  Real ${u}_out1, ${u}_out2, ${u}_out3;`);
        break;
      }
      default:
        break;
    }
  }

  lines.push("equation");

  for (const unit of deck.units) {
    const u = `u${unit.unitNumber}`;
    switch (unit.typeNumber) {
      case 1: {
        lines.push(`  ${u}_out3 = ${u}_area * (${u}_frTauAlpha * ${u}_in4 - ${u}_frUl * (${u}_in1 - ${u}_in3));`);
        lines.push(`  ${u}_out2 = ${u}_in2;`);
        lines.push(`  ${u}_in2 * ${u}_cp * (${u}_out1 - ${u}_in1) = ${u}_out3;`);
        break;
      }
      case 2: {
        lines.push(`  ${u}_out1 = ${u}_in4;`);
        break;
      }
      case 3: {
        lines.push(`  ${u}_out2 = ${u}_in3 * ${u}_mDotMax;`);
        lines.push(`  ${u}_out3 = ${u}_in3 * ${u}_pMax;`);
        lines.push(`  ${u}_out1 = ${u}_in1;`);
        break;
      }
      case 4: {
        const nNodes = Math.max(1, Math.min(6, Math.round(numParam(unit, 5, 3))));
        const vol = numParam(unit, 0, 0.3);
        const height = numParam(unit, 4, 1.5);
        const radius = Math.sqrt(vol / (Math.PI * height));
        const sideAreaNode = (2.0 * Math.PI * radius * height) / nNodes;
        const capArea = Math.PI * radius * radius;
        const capNode = ((numParam(unit, 2, 1000.0) * vol) / nNodes) * numParam(unit, 1, 4.19);
        const lossTerms: string[] = [];
        const tTerms: string[] = [];

        for (let i = 0; i < nNodes; i++) {
          let areaNode = sideAreaNode;
          if (i === 0) areaNode += capArea;
          if (i === nNodes - 1) areaNode += capArea;
          const tAbove = i === 0 ? `${u}_in1` : `${u}_T${i}`;
          const tBelow = i === nNodes - 1 ? `${u}_in3` : `${u}_T${i + 2}`;
          const tCur = `${u}_T${i + 1}`;
          const lossExpr = `(${u}_uLoss * ${areaNode.toFixed(6)} * (${tCur} - ${u}_in5))`;
          lossTerms.push(lossExpr);
          tTerms.push(tCur);
          lines.push(
            `  ${capNode.toFixed(4)} * der(${tCur}) = ${u}_in2 * ${u}_cp * (${tAbove} - ${tCur}) + ${u}_in4 * ${u}_cp * (${tBelow} - ${tCur}) - ${lossExpr};`,
          );
        }
        lines.push(`  ${u}_out1 = ${u}_T${nNodes};`);
        lines.push(`  ${u}_out2 = ${u}_in2;`);
        lines.push(`  ${u}_out3 = ${u}_T1;`);
        lines.push(`  ${u}_out4 = ${u}_in4;`);
        lines.push(`  ${u}_out5 = ${lossTerms.join(" + ")};`);
        lines.push(`  ${u}_out6 = (${tTerms.join(" + ")}) / ${nNodes};`);
        break;
      }
      case 14: {
        const v0 = numParam(unit, 1, 0.0);
        lines.push(`  ${u}_out1 = ${v0};`);
        lines.push(`  ${u}_out2 = ${u}_out1;`);
        break;
      }
      case 15: {
        lines.push(`  ${u}_out1 = ${u}_tAmbMean;`);
        lines.push(`  ${u}_out2 = ${u}_iPeak;`);
        lines.push(`  ${u}_out3 = 50.0;`);
        lines.push(`  ${u}_out4 = 2.0;`);
        break;
      }
      case 56: {
        lines.push(
          `  ${u}_C * der(${u}_Tzone) = ${u}_solarAperture * ${u}_in2 + ${u}_in3 + ${u}_in4 - ${u}_UA * (${u}_Tzone - ${u}_in1);`,
        );
        lines.push(`  ${u}_out1 = ${u}_Tzone;`);
        lines.push(`  ${u}_out2 = ${u}_in4;`);
        lines.push(`  ${u}_out3 = ${u}_UA * (${u}_Tzone - ${u}_in1);`);
        break;
      }
      default:
        break;
    }
  }

  // Wiring equations
  for (const unit of deck.units) {
    if (unit.typeNumber === 25) continue;
    const u = `u${unit.unitNumber}`;
    for (let k = 0; k < unit.inputs.length; k++) {
      const inp = unit.inputs[k]!;
      if (inp.kind === "connection") {
        lines.push(`  ${u}_in${k + 1} = u${inp.unitNumber}_out${inp.outputIndex};`);
      } else if (inp.kind === "constant") {
        const val = inp.raw === "0,0" ? numInit(unit, k, inp.value) : inp.value;
        lines.push(`  ${u}_in${k + 1} = ${val};`);
      }
    }
  }

  lines.push(`end ${modelName};`);
  return lines.join("\n") + "\n";
}
