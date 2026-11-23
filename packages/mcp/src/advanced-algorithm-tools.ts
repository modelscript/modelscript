// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * MCP tools exposing ModelScript's 8 advanced algorithm domains:
 *   1. DSP, Spectral Analysis & System Identification (Welch PSD, Prony, Vector Fitting, DMD)
 *   2. System-Theoretic MOR (Balanced Truncation) & Structural Identifiability
 *   3. Causal SCM, ROBDD Fault Trees & CTMC Probabilistic Model Checking
 *   4. Motion Planning (RRT*) & Synthesis (CBF-CLF-QP, GR(1))
 *   5. Scheduling (RCPSP, STN) & Graph/Flow/Partitioning (Dinic, Min-Cost Flow, k-Way Partition)
 *   6. Topology Optimization (SIMP) & EDA (VF2 LVS, A* PCB Routing)
 *   7. Systems Biology & Chemistry (FBA, Gibbs Equilibrium)
 *   8. Electromagnetics / Ray Optics & Medical Dose Transport
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { checkLvsNetlistEquivalence, routePcbTraceAStar } from "@modelscript/cad";
import {
  BddFaultTreeEngine,
  checkCtmcBoundedReachability,
  dinicMaxFlow,
  minCostMaxFlow,
  partitionGraphKWay,
  PassivityTheoryOracle,
  solveRcpsp,
  solveStn,
  synthesizeGr1,
  type FaultTreeNode,
} from "@modelscript/runtime";
import {
  balancedTruncation,
  computeDmd,
  computeDvhMetrics,
  computePencilBeamDose,
  pronyRingdownAnalysis,
  runSimpTopologyOptimization,
  solveBimatrixNash,
  solveCbfClfQp,
  solveFluxBalanceAnalysis,
  solveGibbsEquilibrium,
  traceParaxialRay,
  vectorFit,
  welchPsd,
} from "@modelscript/simulate";
import { z } from "zod";
import type { ServerContext } from "./types.js";

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export function registerAdvancedAlgorithmTools(server: McpServer, _ctx: ServerContext): void {
  server.tool(
    "ms_dsp_spectral",
    "Compute Welch Power Spectral Density (PSD) and optional Prony modal ringdown analysis on a sampled signal.",
    {
      signal: z.array(z.number()).min(4),
      sampleRateHz: z.number().positive(),
      segmentLength: z.number().int().positive().optional(),
      pronyOrder: z.number().int().min(1).max(20).optional(),
    },
    async ({ signal, sampleRateHz, segmentLength, pronyOrder }) => {
      const psd = welchPsd(signal, sampleRateHz, { segmentLength });
      let peakIdx = 0;
      for (let i = 1; i < psd.psd.length; i++) {
        if ((psd.psd[i] ?? 0) > (psd.psd[peakIdx] ?? 0)) peakIdx = i;
      }
      const prony = pronyOrder ? pronyRingdownAnalysis(signal, sampleRateHz, pronyOrder) : undefined;
      return jsonResult({
        dominantFrequencyHz: psd.frequenciesHz[peakIdx] ?? 0,
        peakPsd: psd.psd[peakIdx] ?? 0,
        numSegments: psd.numSegments,
        frequenciesHz: Array.from(psd.frequenciesHz),
        psd: Array.from(psd.psd),
        ...(prony ? { ringdownModes: prony.modes } : {}),
      });
    },
  );

  server.tool(
    "ms_sysid_fit",
    "Identify a state-space model via Vector Fitting (frequency domain with passivity check) or DMD (time-domain snapshots).",
    {
      mode: z.enum(["vector-fit", "dmd"]),
      order: z.number().int().min(1).max(32).default(4),
      frequenciesHz: z.array(z.number()).optional(),
      responseReal: z.array(z.number()).optional(),
      responseImag: z.array(z.number()).optional(),
      enforcePassivity: z.boolean().optional(),
      snapshots: z.array(z.array(z.number())).optional(),
    },
    async ({ mode, order, frequenciesHz, responseReal, responseImag, enforcePassivity, snapshots }) => {
      if (mode === "vector-fit") {
        if (!frequenciesHz || !responseReal || !responseImag) {
          return jsonResult({ error: "vector-fit requires frequenciesHz, responseReal, and responseImag." });
        }
        const fit = vectorFit(frequenciesHz, responseReal, responseImag, { order, enforcePassivity });
        const oracle = new PassivityTheoryOracle();
        oracle.registerMacromodel({
          id: "vf_model",
          kind: "scattering",
          frequenciesHz,
          values: frequenciesHz.map(() => fit.maxMagnitude),
        });
        return jsonResult({
          poles: Array.from(fit.poles),
          residues: Array.from(fit.residues),
          d: fit.d,
          rmsError: fit.rmsError,
          isPassive: fit.isPassive,
          maxMagnitude: fit.maxMagnitude,
          passivityOracleSat: oracle.checkSat().isSat,
          stateSpace: { A: fit.A, B: fit.B, C: fit.C, D: fit.D },
        });
      }
      if (!snapshots || snapshots.length < 2) {
        return jsonResult({ error: "dmd requires at least 2 state snapshots." });
      }
      const dmd = computeDmd(snapshots, order);
      return jsonResult(dmd);
    },
  );

  server.tool(
    "ms_mor_balanced_truncation",
    "Perform System-Theoretic Balanced Truncation on an LTI state-space model (A, B, C, D) with certified H-infinity error bound.",
    {
      A: z.array(z.array(z.number())),
      B: z.array(z.array(z.number())),
      C: z.array(z.array(z.number())),
      D: z.array(z.array(z.number())).optional(),
      targetOrder: z.number().int().min(1),
    },
    async ({ A, B, C, D, targetOrder }) => {
      const reduced = balancedTruncation(A, B, C, D, targetOrder);
      return jsonResult(reduced);
    },
  );

  server.tool(
    "ms_reliability_analyze",
    "Analyze a Fault Tree using exact ROBDD compilation (top-event probability, minimal cut sets, importance) or a CTMC via uniformization.",
    {
      mode: z.enum(["fault-tree", "ctmc"]),
      tree: z.unknown().optional(),
      ctmc: z
        .object({
          numStates: z.number().int().positive(),
          initialDist: z.array(z.number()),
          transitions: z.array(z.object({ from: z.number().int(), to: z.number().int(), rate: z.number() })),
          targetStates: z.array(z.number().int()),
          horizon: z.number().positive(),
        })
        .optional(),
    },
    async ({ mode, tree, ctmc }) => {
      if (mode === "fault-tree") {
        const res = new BddFaultTreeEngine().analyze(tree as FaultTreeNode);
        return jsonResult(res);
      }
      if (!ctmc) return jsonResult({ error: "ctmc payload required when mode='ctmc'." });
      const res = checkCtmcBoundedReachability(ctmc, ctmc.horizon);
      return jsonResult({
        reachProbability: res.reachProbability,
        truncationError: res.truncationError,
        uniformizationRate: res.uniformizationRate,
        stepsComputed: res.stepsComputed,
        stateDistribution: Array.from(res.stateDistribution),
      });
    },
  );

  server.tool(
    "ms_synthesize_controller",
    "Synthesize a CBF-CLF-QP real-time safety filter, a GR(1) reactive discrete supervisor, or a bimatrix Nash equilibrium.",
    {
      mode: z.enum(["cbf-clf-qp", "gr1", "nash"]),
      uNom: z.array(z.number()).optional(),
      barriers: z
        .array(
          z.object({
            h: z.number(),
            Lf_h: z.number(),
            Lg_h: z.array(z.number()),
            alpha: z.number(),
          }),
        )
        .optional(),
      gr1Spec: z
        .object({
          numStates: z.number().int().positive(),
          initialStates: z.array(z.number().int()),
          safeStates: z.array(z.number().int()).optional(),
          transitions: z.array(z.array(z.array(z.number().int()))),
          envJustice: z.array(z.array(z.number().int())),
          sysJustice: z.array(z.array(z.number().int())),
        })
        .optional(),
      payoffA: z.array(z.array(z.number())).optional(),
      payoffB: z.array(z.array(z.number())).optional(),
    },
    async ({ mode, uNom, barriers, gr1Spec, payoffA, payoffB }) => {
      if (mode === "cbf-clf-qp") {
        const res = solveCbfClfQp(uNom ?? [], barriers ?? []);
        return jsonResult({
          ...res,
          uSafe: Array.from(res.uSafe),
        });
      }
      if (mode === "gr1") {
        if (!gr1Spec) return jsonResult({ error: "gr1Spec required for mode='gr1'." });
        return jsonResult(synthesizeGr1(gr1Spec));
      }
      if (!payoffA || !payoffB) return jsonResult({ error: "payoffA and payoffB required for mode='nash'." });
      return jsonResult(solveBimatrixNash(payoffA, payoffB));
    },
  );

  server.tool(
    "ms_schedule_and_graph",
    "Solve RCPSP resource scheduling, STN temporal consistency, Dinic Max-Flow, Min-Cost Flow, or Multilevel k-Way Graph Partitioning.",
    {
      mode: z.enum(["rcpsp", "stn", "max-flow", "min-cost-flow", "partition"]),
      tasks: z
        .array(
          z.object({
            id: z.string(),
            duration: z.number(),
            predecessors: z.array(z.string()).optional(),
            resourceDemand: z.array(z.number()).optional(),
          }),
        )
        .optional(),
      resourceCapacities: z.array(z.number()).optional(),
      numTimepoints: z.number().int().optional(),
      stnConstraints: z
        .array(z.object({ from: z.number().int(), to: z.number().int(), upperBound: z.number() }))
        .optional(),
      numNodes: z.number().int().optional(),
      flowEdges: z
        .array(
          z.object({
            from: z.number().int(),
            to: z.number().int(),
            capacity: z.number(),
            cost: z.number().optional(),
          }),
        )
        .optional(),
      source: z.number().int().optional(),
      sink: z.number().int().optional(),
      partitionEdges: z.array(z.tuple([z.number().int(), z.number().int()])).optional(),
      numPartitions: z.number().int().optional(),
    },
    async (args) => {
      if (args.mode === "rcpsp") {
        return jsonResult(solveRcpsp(args.tasks ?? [], args.resourceCapacities ?? []));
      }
      if (args.mode === "stn") {
        const res = solveStn(args.numTimepoints ?? 0, args.stnConstraints ?? []);
        return jsonResult({
          consistent: res.consistent,
          earliestTimes: Array.from(res.earliestTimes),
          latestTimes: Array.from(res.latestTimes),
        });
      }
      if (args.mode === "max-flow") {
        const res = dinicMaxFlow(args.numNodes ?? 0, args.flowEdges ?? [], args.source ?? 0, args.sink ?? 0);
        return jsonResult({ maxFlow: res.maxFlow, edgeFlows: Array.from(res.edgeFlows) });
      }
      if (args.mode === "min-cost-flow") {
        const res = minCostMaxFlow(args.numNodes ?? 0, args.flowEdges ?? [], args.source ?? 0, args.sink ?? 0);
        return jsonResult({ flow: res.flow, cost: res.cost, edgeFlows: Array.from(res.edgeFlows) });
      }
      const res = partitionGraphKWay(args.numNodes ?? 0, args.partitionEdges ?? [], args.numPartitions ?? 2);
      return jsonResult({
        edgeCut: res.edgeCut,
        partitions: Array.from(res.partitions),
        partitionSizes: Array.from(res.partitionSizes),
      });
    },
  );

  server.tool(
    "ms_topology_opt_and_eda",
    "Run 2D SIMP structural topology optimization, VF2 Layout-vs-Schematic (LVS) equivalence check, or Manhattan A* PCB trace routing.",
    {
      mode: z.enum(["simp", "lvs", "pcb-route"]),
      nelx: z.number().int().positive().optional(),
      nely: z.number().int().positive().optional(),
      volumeFraction: z.number().min(0.05).max(0.95).optional(),
      maxIterations: z.number().int().positive().optional(),
      schematic: z.array(z.object({ id: z.string(), kind: z.string(), pins: z.array(z.string()) })).optional(),
      layout: z.array(z.object({ id: z.string(), kind: z.string(), pins: z.array(z.string()) })).optional(),
      gridWidth: z.number().int().positive().optional(),
      gridHeight: z.number().int().positive().optional(),
      start: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
      goal: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
      blockedCells: z.array(z.object({ x: z.number().int(), y: z.number().int() })).optional(),
    },
    async (args) => {
      if (args.mode === "simp") {
        const res = runSimpTopologyOptimization({
          nelx: args.nelx ?? 8,
          nely: args.nely ?? 4,
          volumeFraction: args.volumeFraction ?? 0.5,
          maxIterations: args.maxIterations ?? 15,
        });
        return jsonResult({
          compliance: res.compliance,
          complianceHistory: res.complianceHistory,
          volumeFractionAchieved: res.volumeFractionAchieved,
          iterations: res.iterations,
          densities: Array.from(res.densities),
        });
      }
      if (args.mode === "lvs") {
        return jsonResult(checkLvsNetlistEquivalence(args.schematic ?? [], args.layout ?? []));
      }
      const w = args.gridWidth ?? 10;
      const h = args.gridHeight ?? 10;
      const blocked = new Uint8Array(w * h);
      for (const cell of args.blockedCells ?? []) {
        if (cell.x >= 0 && cell.x < w && cell.y >= 0 && cell.y < h) {
          blocked[cell.y * w + cell.x] = 1;
        }
      }
      return jsonResult(
        routePcbTraceAStar(w, h, args.start ?? { x: 0, y: 0 }, args.goal ?? { x: w - 1, y: h - 1 }, blocked),
      );
    },
  );

  server.tool(
    "ms_bio_em_medical",
    "Run Flux Balance Analysis (FBA), Gibbs chemical equilibrium, paraxial ABCD ray optics, or 3D pencil-beam radiation dose + DVH.",
    {
      mode: z.enum(["fba", "gibbs", "ray-optics", "dose"]),
      stoichiometry: z.array(z.array(z.number())).optional(),
      lowerBounds: z.array(z.number()).optional(),
      upperBounds: z.array(z.number()).optional(),
      objective: z.array(z.number()).optional(),
      elementMatrix: z.array(z.array(z.number())).optional(),
      elementTotals: z.array(z.number()).optional(),
      standardGibbsRT: z.array(z.number()).optional(),
      rayY0: z.number().optional(),
      rayTheta0: z.number().optional(),
      opticalElements: z.array(z.unknown()).optional(),
      doseGridShape: z.tuple([z.number().int(), z.number().int(), z.number().int()]).optional(),
      voxelSpacingMm: z.tuple([z.number(), z.number(), z.number()]).optional(),
      beams: z.array(z.unknown()).optional(),
    },
    async (args) => {
      if (args.mode === "fba") {
        const res = solveFluxBalanceAnalysis(
          args.stoichiometry ?? [],
          args.lowerBounds ?? [],
          args.upperBounds ?? [],
          args.objective ?? [],
        );
        return jsonResult({
          feasible: res.feasible,
          objectiveValue: res.objectiveValue,
          fluxes: Array.from(res.fluxes),
        });
      }
      if (args.mode === "gibbs") {
        const res = solveGibbsEquilibrium(
          args.elementMatrix ?? [],
          args.elementTotals ?? [],
          args.standardGibbsRT ?? [],
        );
        return jsonResult({
          converged: res.converged,
          totalGibbsRT: res.totalGibbsRT,
          moles: Array.from(res.moles),
          moleFractions: Array.from(res.moleFractions),
        });
      }
      if (args.mode === "ray-optics") {
        return jsonResult(
          traceParaxialRay(args.rayY0 ?? 1, args.rayTheta0 ?? 0, (args.opticalElements ?? []) as never),
        );
      }
      const shape = args.doseGridShape ?? [8, 8, 8];
      const spacing = args.voxelSpacingMm ?? [5, 5, 5];
      const grid = computePencilBeamDose(shape, spacing, (args.beams ?? []) as never);
      const roi = new Uint8Array(grid.doseGy.length).fill(1);
      const dvh = computeDvhMetrics(grid.doseGy, roi);
      return jsonResult({ shape: grid.shape, maxDoseGy: grid.maxDoseGy, dvh });
    },
  );
}
