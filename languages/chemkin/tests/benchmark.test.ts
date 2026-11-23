// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GAS_CONSTANT_R,
  STANDARD_PRESSURE_PA,
  getElementAtomicWeight,
  getStdThermoRecord,
  parseChemkin,
  solveChemkinReactor,
} from "../src/index.js";

function computeRmse(actual: number[], expected: number[]): number {
  const n = Math.min(actual.length, expected.length);
  if (n === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = actual[i]! - expected[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / n);
}

describe("@modelscript/chemkin — Analytical & Combustion Benchmarks", () => {
  it("Benchmark 1: First-order Arrhenius decay A => B matches exact analytical exponential solution", () => {
    const deck = `
ELEMENTS H END
SPECIES A B END
REACTIONS JOULES/MOLE MOLES
  A => B  1.0E+6  0.0  83144.6261815324
END
`;
    const T = 1000.0;
    const A0 = 1.0e6;
    const Ea = 83144.6261815324; // Ea / (R*T) = 10.0 exactly
    const kExact = A0 * Math.exp(-Ea / (GAS_CONSTANT_R * T)); // ~45.39992976 s^-1
    const tEnd = 0.08; // ~3.63 decay time constants

    const doc = parseChemkin(deck, "arrhenius_decay.inp");
    const traj = solveChemkinReactor(doc, {
      mode: "constant-volume",
      isothermal: true,
      temperature: T,
      pressure: STANDARD_PRESSURE_PA,
      massFractions: { A: 1.0, B: 0.0 },
      tEnd,
      numPoints: 81,
      rtol: 1e-8,
      atol: 1e-12,
    });

    const yA = traj.massFractions["A"]!;
    const yB = traj.massFractions["B"]!;
    const exactA = traj.time.map((t) => Math.exp(-kExact * t));
    const exactB = traj.time.map((t) => 1.0 - Math.exp(-kExact * t));

    const rmseA = computeRmse(yA, exactA);
    const rmseB = computeRmse(yB, exactB);
    const finalExactA = exactA[exactA.length - 1]!;
    const finalRelErr = Math.abs(yA[yA.length - 1]! - finalExactA) / finalExactA;

    assert.ok(rmseA < 1e-5, `Expected RMSE(Y_A) < 1e-5, got ${rmseA}`);
    assert.ok(rmseB < 1e-5, `Expected RMSE(Y_B) < 1e-5, got ${rmseB}`);
    assert.ok(finalRelErr < 1e-4, `Expected final relErr < 1e-4, got ${finalRelErr}`);
  });

  it("Benchmark 2: Reversible A <=> B equilibrium constant Kc = kf / kr analytical parity", () => {
    const deck = `
ELEMENTS H END
SPECIES A B END
REACTIONS JOULES/MOLE MOLES
  A <=> B  30.0  0.0  0.0
    REV / 10.0 0.0 0.0 /
END
`;
    const kf = 30.0;
    const kr = 10.0;
    const kcExact = kf / kr; // 3.0
    const yA0 = 0.9;
    const yAeq = kr / (kf + kr); // 0.25
    const yBeq = kf / (kf + kr); // 0.75

    const doc = parseChemkin(deck, "reversible_eq.inp");
    const traj = solveChemkinReactor(doc, {
      mode: "constant-volume",
      isothermal: true,
      temperature: 1000.0,
      pressure: STANDARD_PRESSURE_PA,
      massFractions: { A: yA0, B: 1.0 - yA0 },
      tEnd: 0.4, // 16 relaxation time constants
      numPoints: 81,
      rtol: 1e-8,
      atol: 1e-12,
    });

    const yA = traj.massFractions["A"]!;
    const yB = traj.massFractions["B"]!;
    const exactA = traj.time.map((t) => yAeq + (yA0 - yAeq) * Math.exp(-(kf + kr) * t));
    const exactB = exactA.map((a) => 1.0 - a);

    const rmse = computeRmse(yA, exactA);
    assert.ok(rmse < 1e-5, `Expected reversible trajectory RMSE < 1e-5, got ${rmse}`);

    const lastIdx = traj.time.length - 1;
    const cAeq = traj.concentrations["A"]![lastIdx]!;
    const cBeq = traj.concentrations["B"]![lastIdx]!;
    const kcMeasured = cBeq / cAeq;
    const relErrKc = Math.abs(kcMeasured - kcExact) / kcExact;

    assert.ok(relErrKc < 1e-4, `Expected Kc = kf/kr relErr < 1e-4, got ${relErrKc} (Kc=${kcMeasured})`);
    assert.ok(Math.abs(yB[lastIdx]! - yBeq) < 1e-5, `Expected Y_B(eq) ~ ${yBeq}, got ${yB[lastIdx]}`);
  });

  it("Benchmark 3: Stoichiometric H2/O2/N2 auto-ignition conserves total mass, elements, and adiabatic enthalpy/energy", () => {
    // Classic Sandia/Ó Conaire-style H2/O2/N2 chain-branching + Troe recombination mechanism
    const h2O2Deck = `
ELEMENTS
  H O N
END
SPECIES
  H2 O2 H2O OH H O HO2 H2O2 N2
END
REACTIONS CAL/MOLE MOLES
  ! Initiation & chain branching
  H2 + O2 <=> HO2 + H             7.400E+05   2.433   53502.0
  H + O2 <=> O + OH               1.915E+14   0.000   16440.0
  O + H2 <=> H + OH               5.080E+04   2.670    6290.0
  OH + H2 <=> H2O + H             2.160E+08   1.510    3430.0
  O + H2O <=> OH + OH             2.970E+06   2.020   13400.0
  ! Recombination & HO2 / H2O2 chemistry
  H + O2 (+M) <=> HO2 (+M)        1.475E+12   0.600       0.0
    LOW / 6.366E+20 -1.720 524.8 /
    TROE / 0.8 1.0E-30 1.0E+30 1.0E+100 /
    H2/2.0/ H2O/11.0/ O2/0.78/ N2/1.0/
  HO2 + H <=> OH + OH             7.079E+13   0.000     295.0
  HO2 + H <=> H2 + O2             1.660E+13   0.000     823.0
  HO2 + OH <=> H2O + O2           2.890E+13   0.000    -497.0
  HO2 + HO2 <=> H2O2 + O2         4.200E+14   0.000   11982.0
  H2O2 (+M) <=> OH + OH (+M)      2.951E+14   0.000   48430.0
    LOW / 1.202E+17 0.000 45500.0 /
    TROE / 0.5 1.0E-30 1.0E+30 /
    H2/2.5/ H2O/12.0/
  H + OH + M <=> H2O + M          3.800E+22  -2.000       0.0
    H2/2.5/ H2O/12.0/
  H + H + M <=> H2 + M            1.300E+18  -1.000       0.0
    H2/2.5/ H2O/12.0/
END
`;

    const doc = parseChemkin(h2O2Deck, "h2_o2_n2_autoignition.inp");

    // 1. Constant-pressure adiabatic auto-ignition (stoichiometric H2/air: 2 H2 + O2 + 3.76 N2)
    const cpTraj = solveChemkinReactor(doc, {
      mode: "constant-pressure",
      temperature: 1200.0,
      pressure: STANDARD_PRESSURE_PA,
      moleFractions: { H2: 2.0, O2: 1.0, N2: 3.76 },
      tEnd: 5e-4,
      numPoints: 101,
      rtol: 1e-6,
      atol: 1e-10,
    });

    const tInit = cpTraj.temperature[0]!;
    const tFinal = cpTraj.temperature[cpTraj.temperature.length - 1]!;
    assert.ok(tFinal > 2200.0, `Expected adiabatic H2/air flame temperature > 2200 K, got ${tFinal.toFixed(1)} K`);
    assert.ok(
      cpTraj.ignitionDelayTime !== undefined && cpTraj.ignitionDelayTime > 0 && cpTraj.ignitionDelayTime < 5e-4,
      `Expected finite ignition delay time in (0, 5e-4) s, got ${cpTraj.ignitionDelayTime}`,
    );

    // Total mass conservation: sum_k Y_k(t) == 1.0
    let maxMassErr = 0;
    for (let i = 0; i < cpTraj.time.length; i++) {
      let sumY = 0;
      for (const sp of cpTraj.species) {
        sumY += cpTraj.massFractions[sp]![i]!;
      }
      maxMassErr = Math.max(maxMassErr, Math.abs(sumY - 1.0));
    }
    assert.ok(maxMassErr < 1e-5, `Expected total mass conservation error < 1e-5, got ${maxMassErr}`);

    // Elemental H, O, N conservation
    const awH = getElementAtomicWeight("H")!;
    const awO = getElementAtomicWeight("O")!;
    const awN = getElementAtomicWeight("N")!;
    const elemMassAt = (idx: number, el: "H" | "O" | "N", aw: number): number => {
      let total = 0;
      for (const sp of cpTraj.species) {
        const rec = getStdThermoRecord(sp)!;
        const count = rec.composition[el] ?? 0;
        if (count === 0) continue;
        let mwSp = 0;
        for (const [e, c] of Object.entries(rec.composition)) {
          mwSp += (getElementAtomicWeight(e) ?? 0) * c;
        }
        total += cpTraj.massFractions[sp]![idx]! * ((count * aw) / mwSp);
      }
      return total;
    };

    const h0 = elemMassAt(0, "H", awH);
    const o0 = elemMassAt(0, "O", awO);
    const n0 = elemMassAt(0, "N", awN);
    const last = cpTraj.time.length - 1;
    assert.ok(Math.abs(elemMassAt(last, "H", awH) - h0) / h0 < 1e-5, "H elemental mass must be conserved");
    assert.ok(Math.abs(elemMassAt(last, "O", awO) - o0) / o0 < 1e-5, "O elemental mass must be conserved");
    assert.ok(Math.abs(elemMassAt(last, "N", awN) - n0) / n0 < 1e-5, "N elemental mass must be conserved");

    // Adiabatic constant-pressure enthalpy conservation: h(t) == h(0)
    const hSpec0 = cpTraj.specificEnthalpy[0]!;
    const hScale = Math.max(Math.abs(hSpec0), 1e6); // J/kg reference scale (~1 MJ/kg)
    const hRef = cpTraj.specificEnthalpy.map(() => hSpec0);
    const hRmseNorm = computeRmse(cpTraj.specificEnthalpy, hRef) / hScale;
    const hMaxRelErr = Math.max(...cpTraj.specificEnthalpy.map((h) => Math.abs(h - hSpec0))) / hScale;

    assert.ok(hRmseNorm < 1e-3, `Expected normalized enthalpy RMSE < 1e-3, got ${hRmseNorm}`);
    assert.ok(hMaxRelErr < 2e-3, `Expected max relative enthalpy drift < 2e-3, got ${hMaxRelErr}`);

    // 2. Constant-volume adiabatic auto-ignition: internal energy conservation u(t) == u(0) & pressure rise
    const cvTraj = solveChemkinReactor(doc, {
      mode: "constant-volume",
      temperature: 1200.0,
      pressure: STANDARD_PRESSURE_PA,
      moleFractions: { H2: 2.0, O2: 1.0, N2: 3.76 },
      tEnd: 5e-4,
      numPoints: 61,
      rtol: 1e-6,
      atol: 1e-10,
    });
    const tCvFinal = cvTraj.temperature[cvTraj.temperature.length - 1]!;
    const pCvFinal = cvTraj.pressure[cvTraj.pressure.length - 1]!;
    assert.ok(
      tCvFinal > tInit + 1300.0,
      `Expected constant-volume T_final > ${tInit + 1300} K, got ${tCvFinal.toFixed(1)} K`,
    );
    assert.ok(
      pCvFinal > 1.8 * STANDARD_PRESSURE_PA,
      `Expected pressure rise > 1.8 atm, got ${(pCvFinal / STANDARD_PRESSURE_PA).toFixed(2)} atm`,
    );

    const uSpec0 = cvTraj.specificInternalEnergy[0]!;
    const uScale = Math.max(Math.abs(uSpec0), 1e6);
    const uMaxRelErr = Math.max(...cvTraj.specificInternalEnergy.map((u) => Math.abs(u - uSpec0))) / uScale;
    assert.ok(uMaxRelErr < 2e-3, `Expected constant-volume internal energy drift < 2e-3, got ${uMaxRelErr}`);
  });
});
