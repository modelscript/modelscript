// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Projection to Modelica 3.x Bateman Depletion Model.
 */

import { BARN_TO_CM2, SCALE_NUCLIDE_DATA, normalizeNuclideId } from "../catalog/scale-std-schemas.js";
import { expandNuclideNetwork } from "../solver/bateman-solver.js";
import type { ScaleDeck } from "../types.js";

const MEV_TO_JOULES = 1.602176634e-13;
const AVOGADRO = 6.02214076e23;

function sanitize(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "");
  return clean.length > 0 && /^[a-zA-Z]/.test(clean) ? clean : `Scale_${clean || "Model"}`;
}

/**
 * Projects a parsed SCALE / ORIGEN deck to a valid Modelica 3.x Bateman isotope depletion model.
 */
export function scaleToModelica(deck: ScaleDeck, modelNameOverride?: string): string {
  const modelName = sanitize(modelNameOverride ?? deck.title ?? "ScaleBatemanModel");

  const initialAtoms: Record<string, number> = {};
  let nominalFlux = 0;

  if (deck.origenCases.length > 0) {
    const oc = deck.origenCases[0]!;
    if (oc.flux.length > 0) nominalFlux = oc.flux[0]!;
    else if (oc.power.length > 0) nominalFlux = oc.power[0]! * 1.0e12;
    for (const nuc of oc.nuclides) {
      const norm = normalizeNuclideId(nuc.nuclide);
      const mass = SCALE_NUCLIDE_DATA[norm]?.atomicMass ?? 235.0;
      let atoms = nuc.amount;
      if (nuc.unit === "moles") atoms = nuc.amount * AVOGADRO;
      else if (nuc.unit === "grams") atoms = (nuc.amount / mass) * AVOGADRO;
      else if (nuc.unit === "kg") atoms = ((nuc.amount * 1000.0) / mass) * AVOGADRO;
      initialAtoms[norm] = (initialAtoms[norm] ?? 0) + atoms;
    }
  } else {
    for (const comp of deck.compositions) {
      for (const [iso, pct] of Object.entries(comp.isotopes)) {
        const norm = normalizeNuclideId(iso);
        initialAtoms[norm] = (initialAtoms[norm] ?? 0) + pct * 1e20;
      }
    }
    if (Object.keys(initialAtoms).length > 0) nominalFlux = 3.0e13;
  }

  if (Object.keys(initialAtoms).length === 0) {
    initialAtoms["U-235"] = 1.0e21;
  }

  const nuclides = expandNuclideNetwork(Object.keys(initialAtoms), nominalFlux > 0);
  const lines: string[] = [];

  lines.push(`model ${modelName} "Projected from ORNL SCALE (${deck.sequence || "origen"}): ${deck.title}"`);
  lines.push(`  parameter Real phi = ${nominalFlux.toExponential(6)} "Thermal neutron flux [n/(cm2*s)]";`);
  for (const id of nuclides) {
    const rec = SCALE_NUCLIDE_DATA[id];
    const sid = sanitize(id);
    const lam = rec?.decayConstant ?? 0;
    const sig = (rec?.sigmaAbsorptionBarns ?? 0) * BARN_TO_CM2;
    lines.push(`  parameter Real lambda_${sid} = ${lam.toExponential(6)} "Decay constant of ${id} [1/s]";`);
    lines.push(`  parameter Real sigma_${sid} = ${sig.toExponential(6)} "Absorption cross-section of ${id} [cm2]";`);
  }
  lines.push("");
  for (const id of nuclides) {
    const sid = sanitize(id);
    const n0 = initialAtoms[id] ?? 0;
    lines.push(`  Real N_${sid}(start = ${n0.toExponential(6)}, fixed = true) "Atom inventory of ${id}";`);
  }
  lines.push(`  output Real P_decay "Total radioactive decay heat [W]";`);
  lines.push(`  output Real A_total "Total radioactive activity [Bq]";`);
  lines.push("equation");

  for (const id of nuclides) {
    const sid = sanitize(id);
    const rec = SCALE_NUCLIDE_DATA[id];
    const prodTerms: string[] = [];
    for (const pId of nuclides) {
      if (pId === id) continue;
      const pRec = SCALE_NUCLIDE_DATA[pId];
      if (!pRec) continue;
      const psid = sanitize(pId);
      if (pRec.decayDaughter === id && pRec.decayConstant > 0) {
        prodTerms.push(`lambda_${psid} * N_${psid}`);
      }
      if (pRec.captureProduct === id && pRec.sigmaCaptureBarns > 0) {
        const cCm2 = (pRec.sigmaCaptureBarns * BARN_TO_CM2).toExponential(6);
        prodTerms.push(`${cCm2} * phi * N_${psid}`);
      }
      if (pId === "U-235" && rec?.u235FissionYield && rec.u235FissionYield > 0 && pRec.sigmaFissionBarns > 0) {
        const yCm2 = (rec.u235FissionYield * pRec.sigmaFissionBarns * BARN_TO_CM2).toExponential(6);
        prodTerms.push(`${yCm2} * phi * N_${psid}`);
      }
    }
    const lossExpr = `(lambda_${sid} + sigma_${sid} * phi) * N_${sid}`;
    const rhs = prodTerms.length > 0 ? `${prodTerms.join(" + ")} - ${lossExpr}` : `-${lossExpr}`;
    lines.push(`  der(N_${sid}) = ${rhs};`);
  }

  const heatTerms: string[] = [];
  const actTerms: string[] = [];
  for (const id of nuclides) {
    const rec = SCALE_NUCLIDE_DATA[id];
    if (!rec || rec.decayConstant <= 0) continue;
    const sid = sanitize(id);
    actTerms.push(`lambda_${sid} * N_${sid}`);
    const eJ = (rec.decayEnergyMeV * MEV_TO_JOULES).toExponential(6);
    heatTerms.push(`lambda_${sid} * N_${sid} * ${eJ}`);
  }
  lines.push(`  P_decay = ${heatTerms.length > 0 ? heatTerms.join(" + ") : "0.0"};`);
  lines.push(`  A_total = ${actTerms.length > 0 ? actTerms.join(" + ") : "0.0"};`);
  lines.push(`end ${modelName};`);

  return lines.join("\n") + "\n";
}
