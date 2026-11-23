// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lookupCeaSpecies, parseCeaDeck, solveCeaDeck } from "../src/index.js";

function relErr(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));
}

function rmse(actuals: number[], expecteds: number[]): number {
  let sumSq = 0;
  for (let i = 0; i < actuals.length; i++) {
    const diff = actuals[i]! - expecteds[i]!;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / Math.max(1, actuals.length));
}

describe("@modelscript/cea — NASA CEA Thermochemical & Propulsion Benchmarks", () => {
  it("matches SSME-class LOX/LH2 rocket benchmark (Pc=200 bar, O/F=6.0, eps=77.5)", () => {
    const src = `
problem case=SSME rocket equilibrium p,bar=200 o/f=6.0 supar=77.5
reactants
  fuel=H2(L) wt%=100 t(k)=20.27
  oxid=O2(L) wt%=100 t(k)=90.17
end
`;
    const deck = parseCeaDeck(src);
    const res = solveCeaDeck(deck);
    assert.ok(res.rocket, "Expected rocket performance result");
    const r = res.rocket;

    const Tc = r.chamber.state.temperatureK;
    const cStar = r.cStarMS;
    const ispVac = r.ispVacS;
    const gamma = r.chamber.state.gamma;
    const mw = r.chamber.state.molarMassGMol;

    // NASA CEA theoretical shifting-equilibrium SSME: Tc ~ 3600 K, c* ~ 2300 m/s, Isp,vac ~ 465 s (~450 s hardware)
    assert.ok(relErr(Tc, 3600) < 0.03, `Expected Tc ~ 3600 K (±3%), got ${Tc.toFixed(2)} K`);
    assert.ok(relErr(cStar, 2300) < 0.03, `Expected c* ~ 2300 m/s (±3%), got ${cStar.toFixed(2)} m/s`);
    assert.ok(relErr(ispVac, 450) < 0.04, `Expected Isp,vac ~ 450 s (±4%), got ${ispVac.toFixed(2)} s`);
    assert.ok(
      relErr(ispVac, 465) < 0.02,
      `Expected ideal equilibrium Isp,vac ~ 465 s (±2%), got ${ispVac.toFixed(2)} s`,
    );
    assert.ok(gamma > 1.1 && gamma < 1.3, `Expected shifting equilibrium gamma in (1.1, 1.3), got ${gamma.toFixed(4)}`);
    assert.ok(mw > 12.0 && mw < 15.0, `Expected chamber molar mass in (12, 15) g/mol, got ${mw.toFixed(3)} g/mol`);
    assert.ok(r.ispSlS > 300 && r.ispSlS < r.ispVacS, `Expected 300 < Isp,sl < Isp,vac, got ${r.ispSlS.toFixed(2)} s`);
    assert.ok(r.cfVac > 1.8 && r.cfVac < 2.1, `Expected CF_vac in (1.8, 2.1), got ${r.cfVac.toFixed(4)}`);

    // Normalized benchmark RMSE across [Tc/3600, c*/2300, Isp_vac/450]
    const normRmse = rmse([Tc / 3600, cStar / 2300, ispVac / 450], [1, 1, 1]);
    assert.ok(normRmse < 0.03, `Expected normalized SSME benchmark RMSE < 0.03, got ${normRmse.toFixed(4)}`);
  });

  it("computes stoichiometric CH4/O2 adiabatic flame temperature at 1 bar", () => {
    const src = `
problem case=CH4_O2_HP hp p,bar=1.0 phi=1.0
reactants
  fuel=CH4 wt%=100 t(k)=298.15
  oxid=O2 wt%=100 t(k)=298.15
end
`;
    const deck = parseCeaDeck(src);
    const res = solveCeaDeck(deck);
    assert.ok(res.equilibrium, "Expected HP equilibrium state");
    const eq = res.equilibrium;

    // Stoichiometric CH4/O2 adiabatic flame temperature at 1 bar is ~3053 K (NASA CEA)
    assert.ok(
      relErr(eq.temperatureK, 3053) < 0.02,
      `Expected CH4/O2 Tad ~ 3053 K (±2%), got ${eq.temperatureK.toFixed(2)} K`,
    );
    assert.ok((eq.moleFractions["H2O"] ?? 0) > 0.3, "Expected significant H2O product");
    assert.ok((eq.moleFractions["CO"] ?? 0) > 0.1, "Expected significant CO dissociation at >3000 K");
    assert.ok((eq.moleFractions["CO2"] ?? 0) > 0.1, "Expected significant CO2 product");
  });

  it("enforces element mass conservation to machine precision across all elements", () => {
    const src = `
problem case=N2O4_MMH hp p,bar=10.0 o/f=1.65
reactants
  fuel=MMH wt%=100 t(k)=298.15
  oxid=N2O4 wt%=100 t(k)=298.15
end
`;
    const deck = parseCeaDeck(src);
    const res = solveCeaDeck(deck);
    assert.ok(res.equilibrium);
    const eq = res.equilibrium;
    assert.equal(eq.converged, true, "Expected Gibbs minimizer convergence");
    assert.ok(eq.elementResidualMax < 1e-8, `Expected max element residual < 1e-8, got ${eq.elementResidualMax}`);

    // Explicitly recompute elemental totals from species moles and verify RMSE
    const expectedB: number[] = [];
    const actualB: number[] = [];
    for (const [el, b0] of Object.entries(eq.elementMolesPerKg)) {
      let sum = 0;
      for (const [spName, nj] of Object.entries(eq.speciesMolesPerKg)) {
        const sp = lookupCeaSpecies(spName);
        sum += (sp?.formula[el] ?? 0) * nj;
      }
      expectedB.push(b0);
      actualB.push(sum);
      assert.ok(relErr(sum, b0) < 1e-8, `Element ${el} conservation relErr=${relErr(sum, b0)}`);
    }
    assert.ok(rmse(actualB, expectedB) < 1e-7, `Element balance RMSE=${rmse(actualB, expectedB)}`);
  });

  it("solves stoichiometric H2/O2 Chapman-Jouguet detonation velocity", () => {
    const src = `
problem case=H2_O2_CJ deton p,bar=1.01325 t,k=298.15 phi=1.0
reactants
  fuel=H2 wt%=100 t(k)=298.15
  oxid=O2 wt%=100 t(k)=298.15
end
`;
    const deck = parseCeaDeck(src);
    const res = solveCeaDeck(deck);
    assert.ok(res.detonation, "Expected detonation result");
    const det = res.detonation;
    // Stoichiometric 2H2 + O2 at 1 atm, 298 K: NASA CEA D_CJ ~ 2837 m/s, P2/P1 ~ 18.8, T2 ~ 3680 K
    assert.ok(
      relErr(det.detonationVelocityMS, 2837) < 0.05,
      `Expected D_CJ ~ 2837 m/s (±5%), got ${det.detonationVelocityMS.toFixed(1)} m/s`,
    );
    assert.ok(
      det.pressureRatio > 15 && det.pressureRatio < 22,
      `Expected P2/P1 in (15, 22), got ${det.pressureRatio.toFixed(2)}`,
    );
    assert.ok(det.cjState.temperatureK > 3300 && det.cjState.temperatureK < 4000);
  });
});
