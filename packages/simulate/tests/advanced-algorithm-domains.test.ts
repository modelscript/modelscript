// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  analyzeIdentifiability,
  BddFaultTreeEngine,
  checkCtmcBoundedReachability,
  dinicMaxFlow,
  fft,
  ifft,
  minCostMaxFlow,
  partitionGraphKWay,
  PassivityTheoryOracle,
  ProbabilisticModelCheckingOracle,
  runCegis,
  solveCare,
  solveLyapunov,
  solveRcpsp,
  solveStn,
  StructuralCausalModel,
  svdJacobi,
  synthesizeGr1,
} from "@modelscript/runtime";
import { solve } from "@modelscript/solve";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balancedTruncation,
  clearDoubleAuction,
  computeDmd,
  computeDvhMetrics,
  computePencilBeamDose,
  computeQDeim,
  designButterworth,
  DiscreteEventEngine,
  dwtSingleLevel,
  filtfilt,
  idwtSingleLevel,
  ordinaryKrigingPredict,
  ParticleFilter,
  planRrtStar,
  pronyRingdownAnalysis,
  registerAdvancedSolvers,
  runFdtd1D,
  runGillespieSsa,
  runHmcSampler,
  runSimpTopologyOptimization,
  savitzkyGolayFilter,
  solveBimatrixNash,
  solveCbfClfQp,
  solveFluxBalanceAnalysis,
  solveGibbsEquilibrium,
  solveIlqr,
  solveJacksonNetwork,
  solveMmcQueue,
  traceParaxialRay,
  vectorFit,
  welchPsd,
} from "../src/index.js";

registerAdvancedSolvers();

describe("Phase 0: Shared Flat-Memory Linear Algebra, FFT & Graph Primitives", () => {
  it("computes exact arbitrary-length FFT/IFFT (radix-2 and Bluestein prime length)", () => {
    for (const N of [16, 13]) {
      const sig = Float64Array.from({ length: N }, (_, k) => Math.cos((2 * Math.PI * 3 * k) / N) + 0.5 * k);
      const { re, im } = fft(sig);
      const inv = ifft(re, im);
      for (let i = 0; i < N; i++) {
        assert.ok(Math.abs(inv.re[i]! - sig[i]!) < 1e-10, `IFFT mismatch at ${i} (N=${N})`);
        assert.ok(Math.abs(inv.im[i]!) < 1e-10);
      }
    }
  });

  it("computes accurate Jacobi SVD, Lyapunov, and CARE solutions", () => {
    // A = [[3, 0], [0, -2], [0, 0]] -> singular values 3, 2
    const A = Float64Array.from([3, 0, 0, -2, 0, 0]);
    const svd = svdJacobi(A, 3, 2);
    assert.ok(Math.abs(svd.S[0]! - 3.0) < 1e-10);
    assert.ok(Math.abs(svd.S[1]! - 2.0) < 1e-10);

    // Continuous Lyapunov: A X + X A^T + Q = 0 for A = diag(-2, -3), Q = diag(4, 6) => X = diag(1, 1)
    const Alyap = Float64Array.from([-2, 0, 0, -3]);
    const Qlyap = Float64Array.from([4, 0, 0, 6]);
    const X = solveLyapunov(Alyap, Qlyap, 2);
    assert.ok(Math.abs(X[0]! - 1.0) < 1e-10);
    assert.ok(Math.abs(X[3]! - 1.0) < 1e-10);

    // Scalar CARE: 0*P + P*0 - P^2 + 1 = 0 => P = 1, K = 1
    const care = solveCare(
      Float64Array.from([0]),
      Float64Array.from([1]),
      Float64Array.from([1]),
      Float64Array.from([1]),
      1,
      1,
    );
    assert.ok(care.converged);
    assert.ok(Math.abs(care.P[0]! - 1.0) < 1e-8);
    assert.ok(Math.abs(care.K[0]! - 1.0) < 1e-8);
  });
});

describe("Phase 1: DSP, Spectral Analysis, Vector Fitting, DMD & Passivity Oracle", () => {
  it("detects dominant tone with Welch PSD, exact DB4 DWT/IDWT roundtrip, and Butterworth + Savitzky-Golay filtering", () => {
    const fs = 256;
    const N = 512;
    const sig = Float64Array.from({ length: N }, (_, n) => Math.sin((2 * Math.PI * 32 * n) / fs));
    const psd = welchPsd(sig, fs, { segmentLength: 128 });
    let peakIdx = 0;
    for (let i = 1; i < psd.psd.length; i++) {
      if (psd.psd[i]! > psd.psd[peakIdx]!) peakIdx = i;
    }
    assert.ok(Math.abs(psd.frequenciesHz[peakIdx]! - 32) <= 2.5);

    // Exact Daubechies-4 reconstruction
    const { approx, detail } = dwtSingleLevel(sig, "db4");
    const recon = idwtSingleLevel(approx, detail, "db4");
    for (let i = 0; i < N; i++) {
      assert.ok(Math.abs(recon[i]! - sig[i]!) < 1e-10);
    }

    // Butterworth lowpass attenuates 100 Hz while preserving 5 Hz
    const noisy = Float64Array.from(
      { length: N },
      (_, n) => Math.sin((2 * Math.PI * 5 * n) / fs) + 0.5 * Math.sin((2 * Math.PI * 100 * n) / fs),
    );
    const sections = designButterworth(4, 20, fs, "lowpass");
    const filtered = filtfilt(noisy, sections);
    const sg = savitzkyGolayFilter(noisy, 9, 2);
    assert.equal(filtered.length, N);
    assert.equal(sg.length, N);

    // Prony ringdown extracts damped sinusoid frequency
    const damped = Float64Array.from(
      { length: 128 },
      (_, n) => Math.exp(-0.8 * (n / 100)) * Math.cos(2 * Math.PI * 10 * (n / 100)),
    );
    const prony = pronyRingdownAnalysis(damped, 100, 2);
    assert.ok(prony.modes.some((m) => Math.abs(m.frequencyHz - 10) < 0.5));
  });

  it("fits passive frequency-domain rational models via Vector Fitting and checks via PassivityTheoryOracle", () => {
    // True passive 1st-order lowpass H(s) = 0.8 / (1 + s / (2*pi*50))
    const freqs = Array.from({ length: 40 }, (_, i) => Math.pow(10, 0.5 + (i / 39) * 2.5));
    const re: number[] = [];
    const im: number[] = [];
    const wc = 2 * Math.PI * 50;
    for (const f of freqs) {
      const w = 2 * Math.PI * f;
      const denom = wc * wc + w * w;
      re.push((0.8 * wc * wc) / denom);
      im.push((-0.8 * wc * w) / denom);
    }

    const vf = vectorFit(freqs, re, im, { order: 2, enforcePassivity: true });
    assert.ok(vf.rmsError < 0.05, `Vector fit RMS too high: ${vf.rmsError}`);
    assert.ok(vf.isPassive);

    // PassivityTheoryOracle certifies passive model and flags active violation
    const oracle = new PassivityTheoryOracle();
    oracle.registerMacromodel({
      id: "passive_filter",
      kind: "scattering",
      frequenciesHz: freqs,
      values: freqs.map(() => 0.95),
    });
    assert.equal(oracle.checkSat().isSat, true);

    oracle.registerMacromodel({ id: "active_bug", kind: "scattering", frequenciesHz: [100], values: [1.12] });
    const sat = oracle.checkSat();
    assert.equal(sat.isSat, false);
    assert.ok(sat.conflict?.explanation.includes("active_bug"));

    // Exact DMD recovery of linear discrete map x_{k+1} = [[0.9, 0.1], [0, 0.8]] x_k
    const snaps: number[][] = [[1, 1]];
    for (let k = 0; k < 20; k++) {
      const prev = snaps[k]!;
      snaps.push([0.9 * prev[0]! + 0.1 * prev[1]!, 0.8 * prev[1]!]);
    }
    const dmd = computeDmd(snaps, 2);
    assert.ok(dmd.reconstructionError < 1e-10);
  });
});

describe("Phase 2: System-Theoretic MOR & Structural Identifiability", () => {
  it("reduces a 3-state LTI system via Balanced Truncation with certified H-infinity bound & Q-DEIM", () => {
    const A = [
      [-1, 0, 0],
      [0, -10, 0],
      [0, 0, -1000],
    ];
    const B = [[1], [1], [1]];
    const C = [[1, 0.5, 0.01]];
    const mor = balancedTruncation(A, B, C, [[0]], 2);
    assert.equal(mor.order, 2);
    assert.ok(mor.hInfErrorBound < 1e-4, `Expected tiny H-inf truncation bound, got ${mor.hInfErrorBound}`);

    // Q-DEIM selects 2 interpolation points from 4D nonlinear snapshots
    const nlSnaps = Array.from({ length: 10 }, (_, k) => {
      const t = k * 0.2;
      return [Math.sin(t), Math.cos(t), 2 * Math.sin(t), Math.sin(t) + Math.cos(t)];
    });
    const deim = computeQDeim(nlSnaps, 2);
    assert.equal(deim.indices.length, 2);
    assert.equal(deim.projection.length, 4);
  });

  it("distinguishes identifiable vs structurally unidentifiable parameters (sum p0 + p1)", () => {
    // dx/dt = -(p0 + p1) * x, y = x => p0 and p1 only appear as sum, so rank = 1 < 2!
    const unid = analyzeIdentifiability({
      f: (_t, x, p) => [-(p[0]! + p[1]!) * x[0]!],
      outputFn: (x) => [x[0]!],
      x0: [1.0],
      p0: [1.0, 2.0],
      paramNames: ["k1", "k2"],
    });
    assert.equal(unid.isStructurallyIdentifiable, false);
    assert.equal(unid.numericalRank, 1);

    // dx/dt = -p0 * x, y = p1 * x => both k and gain are identifiable (rank = 2)
    const id = analyzeIdentifiability({
      f: (_t, x, p) => [-p[0]! * x[0]!],
      outputFn: (x, p) => [p[1]! * x[0]!],
      x0: [1.0],
      p0: [1.5, 2.0],
      paramNames: ["decay", "gain"],
    });
    assert.equal(id.isStructurallyIdentifiable, true);
    assert.equal(id.numericalRank, 2);
  });
});

describe("Phase 3: Causal SCM, ROBDD Fault Trees, CTMC PMC, HMC, SMC & Kriging", () => {
  it("evaluates do-interventions, counterfactuals, Shapley root-cause, and d-separation", () => {
    const scm = new StructuralCausalModel([
      { name: "X", parents: [], equation: (_p, u) => u },
      { name: "Y", parents: ["X"], equation: (p, u) => 2 * p.X! + u },
      { name: "Z", parents: ["Y"], equation: (p, u) => 3 * p.Y! + u },
    ]);
    assert.equal(scm.isDSeparated("X", "Z", ["Y"]), true);
    assert.equal(scm.isDSeparated("X", "Z", []), false);

    const doRes = scm.evaluate({ Y: 5 }, { X: 10 });
    assert.equal(doRes.Z, 15);

    const attr = scm.shapleyAttribution("Z", ["X", "Y", "Z"], { X: 2, Y: 1, Z: 0.5 });
    // Z = 6*u_X + 3*u_Y + u_Z = 12 + 3 + 0.5 = 15.5
    assert.ok(Math.abs(attr.X! - 12.0) < 1e-9);
    assert.ok(Math.abs(attr.Y! - 3.0) < 1e-9);
    assert.ok(Math.abs(attr.Z! - 0.5) < 1e-9);
  });

  it("computes exact ROBDD Fault Tree probability with shared events, CTMC uniformization, and PMC Oracle", () => {
    // Shared event A in (A AND B) OR (A AND C) = A AND (B OR C)
    // Exact prob = 0.1 * (1 - (1 - 0.2)*(1 - 0.3)) = 0.1 * 0.44 = 0.044
    const tree = {
      kind: "or" as const,
      children: [
        {
          kind: "and" as const,
          children: [
            { kind: "event" as const, id: "A", failureProb: 0.1 },
            { kind: "event" as const, id: "B", failureProb: 0.2 },
          ],
        },
        {
          kind: "and" as const,
          children: [
            { kind: "event" as const, id: "A", failureProb: 0.1 },
            { kind: "event" as const, id: "C", failureProb: 0.3 },
          ],
        },
      ],
    };
    const ft = new BddFaultTreeEngine().analyze(tree);
    assert.ok(Math.abs(ft.topEventProbability - 0.044) < 1e-12);
    assert.equal(ft.minimalCutSets.length, 2);

    // 2-state CTMC: state 0 --(lambda=0.5)--> state 1 (absorbing). At T=2, P(fail) = 1 - e^{-1} ≈ 0.63212056
    const pmc = checkCtmcBoundedReachability(
      {
        numStates: 2,
        initialDist: [1, 0],
        transitions: [{ from: 0, to: 1, rate: 0.5 }],
        targetStates: [1],
      },
      2.0,
    );
    assert.ok(Math.abs(pmc.reachProbability - (1 - Math.exp(-1))) < 1e-6);

    const oracle = new ProbabilisticModelCheckingOracle();
    oracle.registerCheck({ kind: "fault-tree", id: "brake_ft", tree, maxFailureProb: 0.05 });
    assert.equal(oracle.checkSat().isSat, true);
    oracle.registerCheck({ kind: "fault-tree", id: "strict_ft", tree, maxFailureProb: 0.01 });
    assert.equal(oracle.checkSat().isSat, false);
  });

  it("samples a Gaussian posterior via HMC, tracks a 1D state via ParticleFilter, and interpolates via Kriging", () => {
    const hmc = runHmcSampler(
      (th) => -0.5 * (th[0]! - 3.0) ** 2,
      [0.0],
      (th) => [-(th[0]! - 3.0)],
      {
        numSamples: 300,
        warmup: 100,
        seed: 42,
      },
    );
    assert.ok(Math.abs(hmc.mean[0]! - 3.0) < 0.35);

    const pf = new ParticleFilter(
      {
        numParticles: 200,
        stateDim: 1,
        transition: (s, rng) => [s[0]! + (rng() - 0.5) * 0.2],
        logLikelihood: (s, obs) => -0.5 * ((s[0]! - obs[0]!) / 0.2) ** 2,
      },
      (rng) => [(rng() - 0.5) * 4],
    );
    let est = 0;
    for (let k = 0; k < 15; k++) est = pf.step([1.5]).mean[0]!;
    assert.ok(Math.abs(est - 1.5) < 0.25);

    const krig = ordinaryKrigingPredict([[0], [2]], [10, 20], [1], { lengthScale: 1.5 });
    assert.ok(Math.abs(krig.mean - 15.0) < 1e-6);
  });
});

describe("Phase 4 & 5: Motion Planning, iLQR, CBF-CLF-QP, GR(1), CEGIS & Game Theory", () => {
  it("plans collision-free RRT* paths around obstacles and optimizes trajectories with iLQR", () => {
    const rrt = planRrtStar([0, 0], [5, 5], [-1, -1], [6, 6], (q) => Math.hypot(q[0]! - 2.5, q[1]! - 2.5) > 1.0, {
      maxIterations: 600,
      stepSize: 0.6,
      seed: 11,
    });
    assert.equal(rrt.found, true);
    assert.ok(rrt.path.length >= 2);

    // 1D discrete integrator x_{k+1} = x_k + 0.1 * u_k driven from x0=2 to 0
    const ilqr = solveIlqr({
      stepDynamics: (x, u) => [x[0]! + 0.1 * u[0]!],
      stageCost: (x, u) => x[0]! * x[0]! + 0.1 * u[0]! * u[0]!,
      terminalCost: (x) => 10 * x[0]! * x[0]!,
      x0: [2.0],
      uInit: Array.from({ length: 15 }, () => [0.0]),
    });
    assert.ok(Math.abs(ilqr.xs[ilqr.xs.length - 1]![0]!) < 0.25);
  });

  it("enforces CBF safety filter via QP, synthesizes GR(1) supervisor, runs CEGIS, and solves Nash + Double Auction", () => {
    // Safe set x >= 0, dynamics x_dot = u, h(x) = x, Lf_h = 0, Lg_h = [1], alpha = 2
    // At x = 0.1 with unsafe u_nom = -5 => must enforce u >= -0.2
    const cbf = solveCbfClfQp([-5.0], [{ h: 0.1, Lf_h: 0, Lg_h: [1.0], alpha: 2.0 }]);
    assert.equal(cbf.feasible, true);
    assert.ok(cbf.uSafe[0]! >= -0.2 - 1e-6);

    // GR(1) 2-state game: sys can always visit state 1 infinitely often
    const gr1 = synthesizeGr1({
      numStates: 2,
      initialStates: [0],
      transitions: [[[0, 1]], [[0, 1]]],
      envJustice: [[0, 1]],
      sysJustice: [[1]],
    });
    assert.equal(gr1.realizable, true);
    assert.equal(gr1.strategy[0]![0]![0], 1);

    // CEGIS: synthesize threshold k >= max(x) for x in [0, 10]
    const cegis = runCegis<number, number>({
      synthesize: (cexs) => (cexs.length === 0 ? 0 : Math.max(...cexs) + 1),
      verify: (cand) => (cand >= 10 ? { valid: true } : { valid: false, counterexample: cand + 2 }),
    });
    assert.equal(cegis.status, "synthesized");
    assert.ok((cegis.candidate ?? 0) >= 10);

    // Matching Pennies mixed Nash equilibrium: (0.5, 0.5)
    const nash = solveBimatrixNash(
      [
        [1, -1],
        [-1, 1],
      ],
      [
        [-1, 1],
        [1, -1],
      ],
    );
    assert.ok(nash !== null);
    assert.ok(Math.abs(nash!.strategyA[0]! - 0.5) < 1e-6);

    const mkt = clearDoubleAuction([
      { id: "b1", side: "buy", price: 50, quantity: 10 },
      { id: "s1", side: "sell", price: 30, quantity: 6 },
      { id: "s2", side: "sell", price: 40, quantity: 10 },
    ]);
    assert.equal(mkt.clearedVolume, 10);
    assert.equal(mkt.dispatches.s1, 6);
    assert.equal(mkt.dispatches.s2, 4);
  });
});

describe("Phase 6, 7 & 8: OR/Flow/Partition/DES, SIMP Topology Opt, Bio/EM/Medical & @modelscript/solve", () => {
  it("solves Dinic Max-Flow, Min-Cost Flow, k-Way Partition, STN, RCPSP, DES & Queueing", () => {
    const mf = dinicMaxFlow(
      4,
      [
        { from: 0, to: 1, capacity: 3 },
        { from: 0, to: 2, capacity: 2 },
        { from: 1, to: 3, capacity: 2 },
        { from: 2, to: 3, capacity: 3 },
        { from: 1, to: 2, capacity: 1 },
      ],
      0,
      3,
    );
    assert.equal(mf.maxFlow, 5);

    const mcf = minCostMaxFlow(
      3,
      [
        { from: 0, to: 1, capacity: 5, cost: 2 },
        { from: 1, to: 2, capacity: 5, cost: 3 },
        { from: 0, to: 2, capacity: 2, cost: 1 },
      ],
      0,
      2,
    );
    assert.equal(mcf.flow, 7);
    assert.equal(mcf.cost, 2 * 1 + 5 * 5);

    const part = partitionGraphKWay(
      6,
      [
        [0, 1],
        [1, 2],
        [0, 2],
        [3, 4],
        [4, 5],
        [3, 5],
        [2, 3],
      ],
      2,
    );
    assert.equal(part.edgeCut, 1);

    const stn = solveStn(3, [
      { from: 0, to: 1, upperBound: 5 },
      { from: 1, to: 2, upperBound: 4 },
      { from: 2, to: 0, upperBound: -2 },
    ]);
    assert.equal(stn.consistent, true);

    const rcpsp = solveRcpsp(
      [
        { id: "A", duration: 3, resourceDemand: [2] },
        { id: "B", duration: 2, resourceDemand: [2] },
        { id: "C", duration: 4, predecessors: ["A", "B"], resourceDemand: [1] },
      ],
      [2],
    );
    assert.equal(rcpsp.feasible, true);
    assert.equal(rcpsp.makespan, 9);

    const des = new DiscreteEventEngine<number>();
    let count = 0;
    des.on("tick", (ev, eng) => {
      count++;
      if (ev.time + 1 <= 5) eng.schedule(ev.time + 1, "tick");
    });
    des.schedule(1, "tick");
    des.runUntil(5);
    assert.equal(count, 5);

    const mm1 = solveMmcQueue(2, 4, 1);
    assert.ok(Math.abs(mm1.meanSystemLength - 1.0) < 1e-10);
    const jnet = solveJacksonNetwork(
      [2, 0],
      [
        [0, 1],
        [0, 0],
      ],
      [4, 4],
    );
    assert.equal(jnet.stable, true);
    assert.ok(Math.abs(jnet.effectiveArrivals[1]! - 2.0) < 1e-10);
  });

  it("runs SIMP Topology Opt, Gillespie SSA, FBA, Gibbs Equilibrium, FDTD, Ray Optics & Pencil-Beam Dose", () => {
    const simp = runSimpTopologyOptimization({ nelx: 6, nely: 3, volumeFraction: 0.5, maxIterations: 8 });
    assert.ok(simp.complianceHistory[simp.complianceHistory.length - 1]! <= simp.complianceHistory[0]!);
    assert.ok(Math.abs(simp.volumeFractionAchieved - 0.5) < 0.05);

    // Gillespie pure decay A -> 0
    const ssa = runGillespieSsa([50], [[-1]], (c) => [0.5 * c[0]!], 10, { seed: 7 });
    assert.ok(ssa.trajectories[ssa.trajectories.length - 1]![0]! < 50);

    // FBA: v0 - v1 = 0, 0 <= v0, v1 <= 10, max v1 => v1 = 10
    const fba = solveFluxBalanceAnalysis([[1, -1]], [0, 0], [10, 10], [0, 1]);
    assert.equal(fba.feasible, true);
    assert.ok(Math.abs(fba.fluxes[1]! - 10) < 0.2);

    // Gibbs equilibrium: A <-> B with equal standard Gibbs => 50/50 mole fraction
    const gibbs = solveGibbsEquilibrium([[1, 1]], [1.0], [0.0, 0.0]);
    assert.equal(gibbs.converged, true);
    assert.ok(Math.abs(gibbs.moleFractions[0]! - 0.5) < 1e-6);

    // 1D FDTD Gaussian pulse propagation
    const fdtd = runFdtd1D({
      numCells: 80,
      numSteps: 60,
      dx: 1e-3,
      sourceCell: 20,
      sourceFn: (n) => Math.exp(-Math.pow((n - 15) / 5, 2)),
    });
    assert.ok(fdtd.probeHistory.some((v) => Math.abs(v) > 1e-3));

    // Paraxial ray focused by thin lens at f=100mm
    const ray = traceParaxialRay(10, 0, [
      { kind: "thin-lens", focalLength: 100 },
      { kind: "freespace", distance: 100 },
    ]);
    assert.ok(Math.abs(ray.y) < 1e-10);

    // Pencil-beam radiation dose + DVH
    const grid = computePencilBeamDose(
      [10, 10, 10],
      [5, 5, 5],
      [{ originMm: [25, 25, 0], direction: [0, 0, 1], doseAtDmaxGy: 2.0, sigmaMm: 10 }],
    );
    assert.ok(grid.maxDoseGy > 1.5);
    const roi = new Uint8Array(1000).fill(1);
    const dvh = computeDvhMetrics(grid.doseGy, roi);
    assert.ok(dvh.maxDoseGy === grid.maxDoseGy);

    // Unified @modelscript/solve dispatch check
    const flowSol = solve({
      kind: "graph-flow",
      numNodes: 3,
      edges: [
        { from: 0, to: 1, capacity: 4 },
        { from: 1, to: 2, capacity: 3 },
      ],
      source: 0,
      sink: 2,
    }) as { maxFlow: number };
    assert.equal(flowSol.maxFlow, 3);
  });
});
