// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `msx algo <task> [input]` — Unified CLI entrypoint for ModelScript's 8 advanced algorithm domains:
 *   spectral | vector-fit | dmd | mor | fault-tree | ctmc | gr1 | cbf-qp | nash |
 *   rcpsp | stn | max-flow | min-cost-flow | partition | topopt | lvs | pcb-route |
 *   fba | gibbs | ray-optics | dose
 */

import { checkLvsNetlistEquivalence, routePcbTraceAStar } from "@modelscript/cad";
import {
  BddFaultTreeEngine,
  checkCtmcBoundedReachability,
  dinicMaxFlow,
  minCostMaxFlow,
  partitionGraphKWay,
  solveRcpsp,
  solveStn,
  synthesizeGr1,
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
import fs from "node:fs";
import type { ArgumentsCamelCase, Argv, CommandModule } from "yargs";

interface AlgoArgs {
  task: string;
  input?: string | undefined;
  json?: string | undefined;
}

function loadPayload(args: ArgumentsCamelCase<AlgoArgs>): Record<string, unknown> {
  if (args.json) {
    return JSON.parse(args.json) as Record<string, unknown>;
  }
  if (args.input) {
    return JSON.parse(fs.readFileSync(args.input, "utf8")) as Record<string, unknown>;
  }
  const stdin = fs.readFileSync(0, "utf8").trim();
  return stdin ? (JSON.parse(stdin) as Record<string, unknown>) : {};
}

export function executeAlgoTask(task: string, p: Record<string, unknown>): unknown {
  switch (task) {
    case "spectral": {
      const psd = welchPsd(p["signal"] as number[], (p["sampleRateHz"] as number) ?? 1000);
      const prony = p["pronyOrder"]
        ? pronyRingdownAnalysis(
            p["signal"] as number[],
            (p["sampleRateHz"] as number) ?? 1000,
            p["pronyOrder"] as number,
          )
        : undefined;
      return {
        frequenciesHz: Array.from(psd.frequenciesHz),
        psd: Array.from(psd.psd),
        numSegments: psd.numSegments,
        ...(prony ? { modes: prony.modes } : {}),
      };
    }
    case "vector-fit": {
      const fit = vectorFit(
        p["frequenciesHz"] as number[],
        p["responseReal"] as number[],
        p["responseImag"] as number[],
        { order: p["order"] as number | undefined, enforcePassivity: p["enforcePassivity"] as boolean | undefined },
      );
      return {
        poles: Array.from(fit.poles),
        residues: Array.from(fit.residues),
        d: fit.d,
        rmsError: fit.rmsError,
        isPassive: fit.isPassive,
        maxMagnitude: fit.maxMagnitude,
      };
    }
    case "dmd":
      return computeDmd(p["snapshots"] as number[][], p["rank"] as number | undefined);
    case "mor":
      return balancedTruncation(
        p["A"] as number[][],
        p["B"] as number[][],
        p["C"] as number[][],
        p["D"] as number[][] | undefined,
        (p["targetOrder"] as number) ?? 2,
      );
    case "fault-tree":
      return new BddFaultTreeEngine().analyze(p["tree"] as never);
    case "ctmc": {
      const res = checkCtmcBoundedReachability(p["model"] as never, (p["horizon"] as number) ?? 1.0);
      return {
        reachProbability: res.reachProbability,
        truncationError: res.truncationError,
        uniformizationRate: res.uniformizationRate,
        stepsComputed: res.stepsComputed,
      };
    }
    case "gr1":
      return synthesizeGr1(p as never);
    case "cbf-qp": {
      const res = solveCbfClfQp(p["uNom"] as number[], p["barriers"] as never);
      return { ...res, uSafe: Array.from(res.uSafe) };
    }
    case "nash":
      return solveBimatrixNash(p["payoffA"] as number[][], p["payoffB"] as number[][]);
    case "rcpsp":
      return solveRcpsp(p["tasks"] as never, (p["resourceCapacities"] as number[]) ?? []);
    case "stn": {
      const res = solveStn(p["numTimepoints"] as number, p["constraints"] as never);
      return {
        consistent: res.consistent,
        earliestTimes: Array.from(res.earliestTimes),
        latestTimes: Array.from(res.latestTimes),
      };
    }
    case "max-flow": {
      const res = dinicMaxFlow(
        p["numNodes"] as number,
        p["edges"] as never,
        p["source"] as number,
        p["sink"] as number,
      );
      return { maxFlow: res.maxFlow, edgeFlows: Array.from(res.edgeFlows) };
    }
    case "min-cost-flow": {
      const res = minCostMaxFlow(
        p["numNodes"] as number,
        p["edges"] as never,
        p["source"] as number,
        p["sink"] as number,
      );
      return { flow: res.flow, cost: res.cost, edgeFlows: Array.from(res.edgeFlows) };
    }
    case "partition": {
      const res = partitionGraphKWay(p["numNodes"] as number, p["edges"] as never, (p["numPartitions"] as number) ?? 2);
      return {
        edgeCut: res.edgeCut,
        partitions: Array.from(res.partitions),
        partitionSizes: Array.from(res.partitionSizes),
      };
    }
    case "topopt": {
      const res = runSimpTopologyOptimization({
        nelx: (p["nelx"] as number) ?? 8,
        nely: (p["nely"] as number) ?? 4,
        volumeFraction: (p["volumeFraction"] as number) ?? 0.5,
        maxIterations: (p["maxIterations"] as number) ?? 15,
      });
      return {
        compliance: res.compliance,
        complianceHistory: res.complianceHistory,
        volumeFractionAchieved: res.volumeFractionAchieved,
        iterations: res.iterations,
      };
    }
    case "lvs":
      return checkLvsNetlistEquivalence(p["schematic"] as never, p["layout"] as never);
    case "pcb-route": {
      const w = (p["width"] as number) ?? 10;
      const h = (p["height"] as number) ?? 10;
      const blocked = new Uint8Array(w * h);
      for (const cell of (p["blockedCells"] as Array<{ x: number; y: number }>) ?? []) {
        blocked[cell.y * w + cell.x] = 1;
      }
      return routePcbTraceAStar(w, h, p["start"] as never, p["goal"] as never, blocked);
    }
    case "fba": {
      const res = solveFluxBalanceAnalysis(
        p["stoichiometry"] as number[][],
        p["lowerBounds"] as number[],
        p["upperBounds"] as number[],
        p["objective"] as number[],
      );
      return { feasible: res.feasible, objectiveValue: res.objectiveValue, fluxes: Array.from(res.fluxes) };
    }
    case "gibbs": {
      const res = solveGibbsEquilibrium(
        p["elementMatrix"] as number[][],
        p["elementTotals"] as number[],
        p["standardGibbsRT"] as number[],
      );
      return {
        converged: res.converged,
        totalGibbsRT: res.totalGibbsRT,
        moles: Array.from(res.moles),
        moleFractions: Array.from(res.moleFractions),
      };
    }
    case "ray-optics":
      return traceParaxialRay((p["y0"] as number) ?? 1, (p["theta0"] as number) ?? 0, p["elements"] as never);
    case "dose": {
      const grid = computePencilBeamDose(p["shape"] as never, p["voxelSpacingMm"] as never, p["beams"] as never);
      const roi = new Uint8Array(grid.doseGy.length).fill(1);
      return { shape: grid.shape, maxDoseGy: grid.maxDoseGy, dvh: computeDvhMetrics(grid.doseGy, roi) };
    }
    default:
      throw new Error(`Unknown algo task '${task}'.`);
  }
}

export const AlgoCommand: CommandModule<Record<string, unknown>, AlgoArgs> = {
  command: "algo <task> [input]",
  describe:
    "Run ModelScript advanced algorithm kernels (spectral, vector-fit, mor, fault-tree, ctmc, gr1, cbf-qp, nash, rcpsp, stn, max-flow, partition, topopt, lvs, pcb-route, fba, gibbs, ray-optics, dose)",
  builder: (y: Argv) =>
    y
      .positional("task", {
        type: "string",
        demandOption: true,
        describe: "Algorithm task name",
      })
      .positional("input", {
        type: "string",
        describe: "Path to JSON input specification file",
      })
      .option("json", {
        type: "string",
        describe: "Inline JSON payload string",
      }) as Argv<AlgoArgs>,
  handler: (args) => {
    const payload = loadPayload(args);
    const result = executeAlgoTask(args.task, payload);
    console.log(JSON.stringify(result, null, 2));
  },
};
