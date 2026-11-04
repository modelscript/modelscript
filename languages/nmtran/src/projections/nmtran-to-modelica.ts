// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Modelica 3.x Projection for Pharmacometric PK/PD Models.
 *
 * Synthesizes standalone Modelica 3.x pharmacokinetic and pharmacodynamic compartment
 * models from NONMEM / NMTRAN control streams.
 */

import { inferMaxCompartments } from "../lints/nmtran-linter.js";
import type { NmtranDocument } from "../types.js";

function translateNmtranExprToModelica(expr: string): string {
  return expr
    .replace(/\bTHETA\s*\(\s*(\d+)\s*\)/gi, "THETA_$1")
    .replace(/\bETA\s*\(\s*(\d+)\s*\)/gi, "ETA_$1")
    .replace(/\b(?:EPS|ERR)\s*\(\s*(\d+)\s*\)/gi, "EPS_$1")
    .replace(/\bA\s*\(\s*(\d+)\s*\)/gi, "A_$1")
    .replace(/\*\*/g, "^")
    .replace(/\bEXP\s*\(/gi, "exp(")
    .replace(/\b(?:LOG|LN)\s*\(/gi, "log(")
    .replace(/\bSQRT\s*\(/gi, "sqrt(")
    .replace(/\bABS\s*\(/gi, "abs(");
}

export function nmtranToModelica(doc: NmtranDocument, modelName = "PharmacokineticModel"): string {
  const cs = doc.controlStream;
  const safeModelName = modelName.replace(/[^a-zA-Z0-9_]/g, "_");
  const lines: string[] = [];

  lines.push(`model ${safeModelName}`);
  lines.push(`  "NMTRAN PK/PD Control Stream: ${cs.problem || safeModelName}"`);
  lines.push(``);

  // 1. Fixed-effect parameters ($THETA)
  if (cs.thetas.length > 0) {
    lines.push(`  // --- Fixed-Effect Parameters ($THETA) ---`);
    for (const th of cs.thetas) {
      const desc = th.name ? `${th.name}${th.units ? ` [${th.units}]` : ""}` : `THETA(${th.index})`;
      lines.push(`  parameter Real THETA_${th.index} = ${th.init.toFixed(4)} "${desc}";`);
    }
    lines.push(``);
  }

  // 2. Inter-individual & residual variability parameters ($OMEGA / $SIGMA)
  if (cs.omegas.length > 0 || cs.sigmas.length > 0) {
    lines.push(`  // --- Random Effects ($OMEGA / $SIGMA) ---`);
    for (const om of cs.omegas) {
      lines.push(`  parameter Real ETA_${om.index} = 0.0 "IIV random effect (variance = ${om.variance.toFixed(4)})";`);
    }
    for (const sg of cs.sigmas) {
      lines.push(`  parameter Real EPS_${sg.index} = 0.0 "Residual error (variance = ${sg.variance.toFixed(4)})";`);
    }
    lines.push(``);
  }

  // 3. Compartment state variables A_1 .. A_N
  let maxDesCmt = 0;
  for (const eq of cs.desEquations) {
    if (eq.compartmentIndex > maxDesCmt) maxDesCmt = eq.compartmentIndex;
    for (const r of eq.compartmentRefs) {
      if (r > maxDesCmt) maxDesCmt = r;
    }
  }
  const compartmentCount = Math.max(1, inferMaxCompartments(cs) ?? 1, maxDesCmt);

  const initAmounts = new Array<number>(compartmentCount).fill(0.0);
  if (cs.dosingRecords.length > 0) {
    for (const d of cs.dosingRecords) {
      if (d.evid !== 0 && d.amt > 0 && d.rate === 0 && Math.abs(d.time) <= 1e-9) {
        const idx = Math.min(compartmentCount, Math.max(1, d.cmt)) - 1;
        initAmounts[idx] = (initAmounts[idx] ?? 0) + d.amt;
      }
    }
  } else {
    initAmounts[0] = 100.0;
  }

  lines.push(`  // --- Compartment Amounts ---`);
  for (let i = 1; i <= compartmentCount; i++) {
    const cmtName = cs.compartments[i - 1]?.name ?? `Compartment ${i}`;
    const startAmt = initAmounts[i - 1] ?? 0.0;
    lines.push(`  Real A_${i}(start = ${startAmt.toFixed(4)}, fixed = true) "Amount in ${cmtName}";`);
  }
  lines.push(``);

  // 4. Declared PK, DES intermediate, and ERROR variables
  const declaredVars = new Set<string>();
  lines.push(`  // --- Pharmacokinetic & Prediction Variables ---`);
  for (const st of cs.pkStatements) {
    const key = st.lhs.toUpperCase();
    if (!declaredVars.has(key)) {
      declaredVars.add(key);
      lines.push(`  Real ${st.lhs} "PK parameter ${st.lhs}";`);
    }
  }
  for (const eq of cs.desEquations) {
    if (!eq.isDerivative) {
      const key = eq.lhs.toUpperCase();
      if (!declaredVars.has(key)) {
        declaredVars.add(key);
        lines.push(`  Real ${eq.lhs} "DES intermediate ${eq.lhs}";`);
      }
    }
  }
  if (!declaredVars.has("F")) {
    declaredVars.add("F");
    lines.push(`  Real F "Central compartment concentration prediction";`);
  }
  for (const st of cs.errorStatements) {
    const key = st.lhs.toUpperCase();
    if (!declaredVars.has(key)) {
      declaredVars.add(key);
      lines.push(`  Real ${st.lhs} "Error model variable ${st.lhs}";`);
    }
  }
  lines.push(``);

  lines.push(`equation`);

  // 5. $PK Equations
  for (const st of cs.pkStatements) {
    lines.push(`  ${st.lhs} = ${translateNmtranExprToModelica(st.rhs)};`);
  }

  // 6. $DES or built-in PREDPP ODEs
  const hasCustomDes = cs.desEquations.some((e) => e.isDerivative);
  const assignedCmts = new Set<number>();

  if (hasCustomDes) {
    for (const eq of cs.desEquations) {
      const rhsMo = translateNmtranExprToModelica(eq.rhs);
      if (eq.isDerivative) {
        assignedCmts.add(eq.compartmentIndex);
        lines.push(`  der(A_${eq.compartmentIndex}) = ${rhsMo};`);
      } else {
        lines.push(`  ${eq.lhs} = ${rhsMo};`);
      }
    }
  } else {
    const advan = (cs.subroutines.advan || "ADVAN1").toUpperCase();
    const pickVar = (candidates: string[], fallback: string): string => {
      for (const c of candidates) {
        if (declaredVars.has(c.toUpperCase())) return c;
      }
      return fallback;
    };

    if (advan === "ADVAN1") {
      const vSym = pickVar(["V", "V1", "S1"], "1.0");
      const rateExpr = declaredVars.has("K") ? "K" : `(CL / ${vSym})`;
      assignedCmts.add(1);
      lines.push(`  der(A_1) = -${rateExpr} * A_1;`);
    } else if (advan === "ADVAN2" && compartmentCount >= 2) {
      const vSym = pickVar(["V", "V2", "V1", "S2"], "1.0");
      const rateExpr = declaredVars.has("K") ? "K" : `(CL / ${vSym})`;
      assignedCmts.add(1);
      assignedCmts.add(2);
      lines.push(`  der(A_1) = -KA * A_1;`);
      lines.push(`  der(A_2) = KA * A_1 - ${rateExpr} * A_2;`);
    } else if (advan === "ADVAN3" && compartmentCount >= 2) {
      const v1Sym = pickVar(["V1", "V", "S1"], "1.0");
      const v2Sym = pickVar(["V2", "VSS"], "1.0");
      const kSym = declaredVars.has("K") ? "K" : `(CL / ${v1Sym})`;
      const k12Sym = declaredVars.has("K12") ? "K12" : `(Q / ${v1Sym})`;
      const k21Sym = declaredVars.has("K21") ? "K21" : `(Q / ${v2Sym})`;
      assignedCmts.add(1);
      assignedCmts.add(2);
      lines.push(`  der(A_1) = -(${kSym} + ${k12Sym}) * A_1 + ${k21Sym} * A_2;`);
      lines.push(`  der(A_2) = ${k12Sym} * A_1 - ${k21Sym} * A_2;`);
    } else if (advan === "ADVAN4" && compartmentCount >= 3) {
      const v2Sym = pickVar(["V2", "V1", "V", "S2"], "1.0");
      const v3Sym = pickVar(["V3", "V2", "VSS"], "1.0");
      const kSym = declaredVars.has("K") ? "K" : `(CL / ${v2Sym})`;
      const k23Sym = declaredVars.has("K23") ? "K23" : `(Q / ${v2Sym})`;
      const k32Sym = declaredVars.has("K32") ? "K32" : `(Q / ${v3Sym})`;
      assignedCmts.add(1);
      assignedCmts.add(2);
      assignedCmts.add(3);
      lines.push(`  der(A_1) = -KA * A_1;`);
      lines.push(`  der(A_2) = KA * A_1 - (${kSym} + ${k23Sym}) * A_2 + ${k32Sym} * A_3;`);
      lines.push(`  der(A_3) = ${k23Sym} * A_2 - ${k32Sym} * A_3;`);
    }
  }

  for (let i = 1; i <= compartmentCount; i++) {
    if (!assignedCmts.has(i)) {
      lines.push(`  der(A_${i}) = 0.0;`);
    }
  }

  // 7. Central Prediction F and $ERROR equations
  const advan = (cs.subroutines.advan || "ADVAN1").toUpperCase();
  const centralIdx = (advan === "ADVAN2" || advan === "ADVAN4" || advan === "ADVAN12") && compartmentCount >= 2 ? 2 : 1;
  const scaleSym = [`S${centralIdx}`, `V${centralIdx}`, "V", "V1", "V2"].find((s) => declaredVars.has(s));
  lines.push(`  F = ${scaleSym ? `A_${centralIdx} / ${scaleSym}` : `A_${centralIdx}`};`);

  for (const st of cs.errorStatements) {
    lines.push(`  ${st.lhs} = ${translateNmtranExprToModelica(st.rhs)};`);
  }

  lines.push(`end ${safeModelName};`);
  return lines.join("\n");
}
