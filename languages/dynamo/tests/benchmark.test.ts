// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDynamo, simulateDynamo } from "../src/index.js";

function computeErrorMetrics(actual: number[], expected: number[]): { rmse: number; maxRelErr: number } {
  let sumSq = 0;
  let maxRelErr = 0;
  const n = Math.min(actual.length, expected.length);
  for (let i = 0; i < n; i++) {
    const a = actual[i]!;
    const e = expected[i]!;
    const diff = a - e;
    sumSq += diff * diff;
    const denom = Math.max(Math.abs(e), 1e-9);
    const rel = Math.abs(diff) / denom;
    if (rel > maxRelErr) maxRelErr = rel;
  }
  return { rmse: Math.sqrt(sumSq / Math.max(n, 1)), maxRelErr };
}

describe("@modelscript/dynamo System Dynamics Benchmark Suite", () => {
  it("Benchmark 1: Exponential Growth & Decay matches analytical solution within relErr & rmse tolerances", () => {
    const src = `
NOTE EXPONENTIAL GROWTH AND DECAY
L GROW.K=GROW.J+(DT)*(GRATE.JK)
N GROW=100
R GRATE.KL=GROW.K*R
L DECAY.K=DECAY.J+(DT)*(-DRATE.JK)
N DECAY=100
R DRATE.KL=DECAY.K*K
C R=0.1, K=0.15
SPEC DT=0.05/LENGTH=10
RUN
`;
    const model = parseDynamo(src);
    const simEuler = simulateDynamo(model, { integrator: "euler" });
    const simRk2 = simulateDynamo(model, { integrator: "rk2" });

    const exactGrow = simRk2.times.map((t) => 100 * Math.exp(0.1 * t));
    const exactDecay = simRk2.times.map((t) => 100 * Math.exp(-0.15 * t));

    const eulerGrowMetrics = computeErrorMetrics(simEuler.series["GROW"]!, exactGrow);
    const rk2GrowMetrics = computeErrorMetrics(simRk2.series["GROW"]!, exactGrow);
    const rk2DecayMetrics = computeErrorMetrics(simRk2.series["DECAY"]!, exactDecay);

    // Classic Euler at DT=0.05 has O(DT) accuracy (~0.25% relErr)
    assert.ok(eulerGrowMetrics.maxRelErr < 0.005, `Euler growth maxRelErr=${eulerGrowMetrics.maxRelErr}`);
    // RK2 has O(DT^2) accuracy (< 1e-4 relErr)
    assert.ok(rk2GrowMetrics.maxRelErr < 1e-4, `RK2 growth maxRelErr=${rk2GrowMetrics.maxRelErr}`);
    assert.ok(rk2GrowMetrics.rmse < 0.02, `RK2 growth rmse=${rk2GrowMetrics.rmse}`);
    assert.ok(rk2DecayMetrics.maxRelErr < 1e-4, `RK2 decay maxRelErr=${rk2DecayMetrics.maxRelErr}`);
    assert.ok(rk2DecayMetrics.rmse < 0.005, `RK2 decay rmse=${rk2DecayMetrics.rmse}`);
  });

  it("Benchmark 2: Logistic Population Growth matches Verhulst closed-form solution", () => {
    const src = `
NOTE LOGISTIC POPULATION GROWTH
L POP.K=POP.J+(DT)*(NETGR.JK)
N POP=50
R NETGR.KL=R*POP.K*(1-POP.K/CAP)
C R=0.2, CAP=1000
SPEC DT=0.05/LENGTH=30
RUN
`;
    const model = parseDynamo(src);
    const sim = simulateDynamo(model, { integrator: "rk2" });
    const exact = sim.times.map((t) => 1000 / (1 + ((1000 - 50) / 50) * Math.exp(-0.2 * t)));

    const { rmse, maxRelErr } = computeErrorMetrics(sim.series["POP"]!, exact);
    assert.ok(maxRelErr < 1e-3, `Logistic maxRelErr=${maxRelErr}`);
    assert.ok(rmse < 0.1, `Logistic rmse=${rmse}`);
    assert.ok(sim.finalValues["POP"]! > 950 && sim.finalValues["POP"]! <= 1000);
  });

  it("Benchmark 3: Forrester Inventory-Workforce Oscillation matches damped harmonic oscillator", () => {
    // Classic 2-stock Forrester inventory-workforce feedback loop:
    //   d(INV)/dt = WF - DEMAND
    //   d(WF)/dt  = (DESINV - INV) / (TAUI * TAUW) - (WF - DEMAND) / TAUW
    // With step in DEMAND from 100 to 120 at t=0, starting at INV=300, WF=100, DESINV=300:
    //   Let x = INV - 300, v = WF - 120.
    //   dx/dt = v, dv/dt = -omega0^2 * x - 2*zeta*omega0 * v
    //   omega0 = 1/sqrt(TAUI*TAUW), 2*zeta*omega0 = 1/TAUW
    const src = `
NOTE FORRESTER INVENTORY WORKFORCE OSCILLATION
L INV.K=INV.J+(DT)*(PROD.JK-SHIP.JK)
N INV=300
L WF.K=WF.J+(DT)*(HIRE.JK)
N WF=100
R PROD.KL=WF.K
R SHIP.KL=DEMAND
R HIRE.KL=(DESINV-INV.K)/(TAUI*TAUW)-(WF.K-DEMAND)/TAUW
C DEMAND=120, DESINV=300, TAUI=2, TAUW=8
SPEC DT=0.05/LENGTH=40
RUN
`;
    const model = parseDynamo(src);
    const sim = simulateDynamo(model, { integrator: "rk2" });

    // Analytical damped harmonic solution for x(t) = INV(t) - 300:
    // x(0) = 0, x'(0) = WF(0) - DEMAND = -20
    // omega0 = 1/sqrt(16) = 0.25, alpha = 1/(2*8) = 0.0625, wd = sqrt(omega0^2 - alpha^2)
    const alpha = 1 / 16;
    const omega0 = 0.25;
    const wd = Math.sqrt(omega0 * omega0 - alpha * alpha);
    const exactInv = sim.times.map((t) => 300 + (-20 / wd) * Math.exp(-alpha * t) * Math.sin(wd * t));

    const { rmse, maxRelErr } = computeErrorMetrics(sim.series["INV"]!, exactInv);
    assert.ok(maxRelErr < 1e-3, `Forrester oscillation maxRelErr=${maxRelErr}`);
    assert.ok(rmse < 0.05, `Forrester oscillation rmse=${rmse}`);

    // Verify oscillatory overshoot below 300 and rebound above 300
    const invSeries = sim.series["INV"]!;
    const minInv = Math.min(...invSeries);
    const maxInv = Math.max(...invSeries);
    assert.ok(minInv < 245, `Expected inventory trough < 245, got ${minInv}`);
    assert.ok(maxInv > 310, `Expected inventory rebound > 310, got ${maxInv}`);
  });

  it("Benchmark 4: Simplified World2/World3 Population-Resource-Pollution Overshoot Loop", () => {
    const src = `
NOTE SIMPLIFIED WORLD2 POPULATION RESOURCE POLLUTION LOOP
L POP.K=POP.J+(DT)*(BR.JK-DR.JK)
N POP=1.65
L NR.K=NR.J+(DT)*(-NRUR.JK)
N NR=900
L POL.K=POL.J+(DT)*(POLG.JK-POLA.JK)
N POL=0.2
A NRFR.K=NR.K/NRI
A NRM.K=TABHL(NRMT,NRFR.K,0,1,0.25)
A POLR.K=POL.K/POLS
A DRPM.K=TABHL(DRPMT,POLR.K,0,4,1)
A BRC.K=BRN*NRM.K
R BR.KL=POP.K*BRC.K
R DR.KL=POP.K*DRN*DRPM.K
R NRUR.KL=POP.K*NRUN*NRM.K
R POLG.KL=POP.K*POLN*NRM.K
R POLA.KL=POL.K/POLAT
C NRI=900, BRN=0.04, DRN=0.02, NRUN=1.0, POLN=0.1, POLS=1.0, POLAT=2.0
T NRMT=0/0.3/0.65/0.9/1.0
T DRPMT=0.9/1.0/1.4/2.2/3.5
SPEC DT=0.1/LENGTH=200
RUN WORLD2
`;
    const model = parseDynamo(src);
    const simFine = simulateDynamo(model, { integrator: "rk2", dt: 0.05 });
    const simCoarse = simulateDynamo(model, { integrator: "euler", dt: 0.1 });

    // Subsample fine RK2 trajectory onto coarse Euler grid (every 2 steps) to check convergence
    const finePopOnCoarse = simCoarse.times.map((_, i) => simFine.series["POP"]![i * 2]!);
    const coarsePop = simCoarse.series["POP"]!;
    const { rmse, maxRelErr } = computeErrorMetrics(coarsePop, finePopOnCoarse);

    assert.ok(maxRelErr < 0.02, `World2 Euler vs RK2 maxRelErr=${maxRelErr}`);
    assert.ok(rmse < 0.1, `World2 Euler vs RK2 rmse=${rmse}`);

    // Verify classic World2 overshoot-and-decline behavior:
    // Population grows significantly above initial 1.65, peaks, then declines as resources deplete
    const peakPop = Math.max(...finePopOnCoarse);
    const finalPop = simFine.finalValues["POP"]!;
    const finalNr = simFine.finalValues["NR"]!;
    assert.ok(peakPop > 4.0, `Expected World2 population overshoot peak > 4.0, got ${peakPop}`);
    assert.ok(finalPop < peakPop * 0.85, `Expected World2 decline after peak: peak=${peakPop}, final=${finalPop}`);
    assert.ok(finalNr < 300, `Expected significant resource depletion: final NR=${finalNr}`);
  });
});
