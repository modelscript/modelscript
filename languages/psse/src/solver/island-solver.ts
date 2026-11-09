// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Multi-Island Topological Partitioning & AC Power Flow Solver
 *
 * Decomposes complex interconnected bulk power grids (e.g. 70,000+ bus Eastern Interconnection)
 * into independent synchronous electrical islands following branch outages, bus splitting,
 * or cascading trips. Automatically designates island swing/slack buses, executes
 * under-frequency load shedding (UFLS) or generation curtailment to balance active power,
 * and solves non-linear AC power flows concurrently or sequentially across all sub-grids.
 */

import type {
  BranchRecord,
  BusRecord,
  FixedShuntRecord,
  GeneratorRecord,
  LoadRecord,
  PsseCase,
  SwitchedShuntRecord,
  TransformerRecord,
} from "../types.js";
import { BusType } from "../types.js";
import {
  solvePowerFlow,
  type BranchPowerFlowResult,
  type BusPowerFlowResult,
  type PowerFlowOptions,
  type PowerFlowSolution,
} from "./ac-powerflow.js";

/**
 * Disjoint Set Union (Union-Find) with path compression and rank optimization.
 */
export class DisjointSetUnion {
  private readonly parent = new Map<number, number>();
  private readonly rank = new Map<number, number>();

  constructor(elements: Iterable<number>) {
    for (const elem of elements) {
      this.parent.set(elem, elem);
      this.rank.set(elem, 0);
    }
  }

  find(x: number): number {
    let root = x;
    while (this.parent.get(root) !== root) {
      const p = this.parent.get(root);
      if (p === undefined) return x;
      root = p;
    }
    // Path compression
    let curr = x;
    while (curr !== root) {
      const next = this.parent.get(curr)!;
      this.parent.set(curr, root);
      curr = next;
    }
    return root;
  }

  union(x: number, y: number): boolean {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return false;

    const rankX = this.rank.get(rootX) ?? 0;
    const rankY = this.rank.get(rootY) ?? 0;

    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
    return true;
  }
}

export interface ElectricalIsland {
  /** Unique 1-based island identifier. */
  id: number;
  /** Set of bus numbers belonging to this island. */
  busNumbers: Set<number>;
  /** In-service generators connected within this island. */
  generators: GeneratorRecord[];
  /** In-service loads connected within this island. */
  loads: LoadRecord[];
  /** In-service branches entirely internal to this island. */
  branches: BranchRecord[];
  /** In-service transformers entirely internal to this island. */
  transformers: TransformerRecord[];
  /** Total active power generation in MW. */
  totalGenMw: number;
  /** Total reactive power generation in Mvar. */
  totalGenMvar: number;
  /** Total active power load in MW. */
  totalLoadMw: number;
  /** Total reactive power load in Mvar. */
  totalLoadMvar: number;
  /** Maximum generator active capacity in MW. */
  totalGenCapacityMw: number;
  /** Designated or auto-elected swing/slack bus number. */
  slackBusNumber?: number | undefined;
  /** True if island has no generation or is de-energized. */
  isDead: boolean;
}

export interface MultiIslandPowerFlowOptions extends PowerFlowOptions {
  /** Automatically balance island generation/load via UFLS or generator redispatch (default: true). */
  autoBalanceIslands?: boolean | undefined;
  /** Filter function to dynamically omit branches or transformers (e.g. for contingency evaluation). */
  activeBranchFilter?: ((br: BranchRecord | TransformerRecord) => boolean) | undefined;
}

export interface IslandPowerFlowSummary {
  islandId: number;
  busCount: number;
  converged: boolean;
  isDead: boolean;
  slackBusNumber?: number | undefined;
  totalGenMw: number;
  totalLoadMw: number;
  totalLossMw: number;
  iterations: number;
  maxMismatchPu: number;
}

export interface MultiIslandPowerFlowSolution extends PowerFlowSolution {
  /** Summary of each detected electrical island. */
  islands: IslandPowerFlowSummary[];
  /** Total number of electrical islands detected. */
  totalIslands: number;
  /** Number of energized, active islands. */
  activeIslands: number;
  /** Number of de-energized/dead islands. */
  deadIslands: number;
}

/**
 * Detects all electrically connected components (islands) in a PSS/E base case.
 */
export function detectElectricalIslands(
  psCase: PsseCase,
  activeBranchFilter?: (br: BranchRecord | TransformerRecord) => boolean,
): ElectricalIsland[] {
  // 1. Gather all in-service buses (excluding explicit BusType.Isolated unless energized)
  const allBusNumbers: number[] = [];
  for (const [bNum, bRec] of psCase.buses.entries()) {
    if (bRec.ide !== BusType.Isolated) {
      allBusNumbers.push(bNum);
    }
  }

  const dsu = new DisjointSetUnion(allBusNumbers);

  // 2. Connect buses through in-service transmission branches
  for (const br of psCase.branches) {
    if (br.st === 0) continue;
    if (activeBranchFilter && !activeBranchFilter(br)) continue;
    if (psCase.buses.has(br.i) && psCase.buses.has(br.j)) {
      dsu.union(br.i, br.j);
    }
  }

  // 3. Connect buses through in-service transformers
  for (const tr of psCase.transformers) {
    if (tr.stat === 0) continue;
    if (activeBranchFilter && !activeBranchFilter(tr)) continue;
    if (psCase.buses.has(tr.i) && psCase.buses.has(tr.j)) {
      dsu.union(tr.i, tr.j);
    }
    if (tr.k > 0 && psCase.buses.has(tr.k)) {
      dsu.union(tr.i, tr.k);
    }
  }

  // 4. Group bus numbers by root representative
  const rootToBuses = new Map<number, Set<number>>();
  for (const bNum of allBusNumbers) {
    const root = dsu.find(bNum);
    let set = rootToBuses.get(root);
    if (!set) {
      set = new Set<number>();
      rootToBuses.set(root, set);
    }
    set.add(bNum);
  }

  // 5. Index equipment by bus
  const gensByBus = new Map<number, GeneratorRecord[]>();
  for (const gen of psCase.generators) {
    if (gen.stat === 0) continue;
    const list = gensByBus.get(gen.i) ?? [];
    list.push(gen);
    gensByBus.set(gen.i, list);
  }

  const loadsByBus = new Map<number, LoadRecord[]>();
  for (const load of psCase.loads) {
    if (load.status === 0) continue;
    const list = loadsByBus.get(load.i) ?? [];
    list.push(load);
    loadsByBus.set(load.i, list);
  }

  // 6. Build ElectricalIsland objects sorted by bus count descending
  const islands: ElectricalIsland[] = [];
  let nextId = 1;

  for (const busSet of rootToBuses.values()) {
    const generators: GeneratorRecord[] = [];
    const loads: LoadRecord[] = [];
    let totalGenMw = 0;
    let totalGenMvar = 0;
    let totalGenCapacityMw = 0;
    let totalLoadMw = 0;
    let totalLoadMvar = 0;

    for (const bNum of busSet) {
      const gList = gensByBus.get(bNum);
      if (gList) {
        for (const g of gList) {
          generators.push(g);
          totalGenMw += g.pg;
          totalGenMvar += g.qg;
          totalGenCapacityMw += g.pt > 0 ? g.pt : g.mbase > 0 ? g.mbase : g.pg * 1.25;
        }
      }
      const lList = loadsByBus.get(bNum);
      if (lList) {
        for (const l of lList) {
          loads.push(l);
          totalLoadMw += l.pl;
          totalLoadMvar += l.ql;
        }
      }
    }

    // Collect branches internal to this island
    const branches: BranchRecord[] = [];
    for (const br of psCase.branches) {
      if (br.st !== 0 && busSet.has(br.i) && busSet.has(br.j)) {
        if (!activeBranchFilter || activeBranchFilter(br)) {
          branches.push(br);
        }
      }
    }

    // Collect transformers internal to this island
    const transformers: TransformerRecord[] = [];
    for (const tr of psCase.transformers) {
      if (tr.stat !== 0 && busSet.has(tr.i) && busSet.has(tr.j)) {
        if (tr.k <= 0 || busSet.has(tr.k)) {
          if (!activeBranchFilter || activeBranchFilter(tr)) {
            transformers.push(tr);
          }
        }
      }
    }

    const isDead = generators.length === 0;

    // Elect slack bus:
    let slackBusNumber: number | undefined;
    if (!isDead) {
      // First check if any bus is already marked as Swing in the original case
      for (const bNum of busSet) {
        const bRec = psCase.buses.get(bNum);
        if (bRec && bRec.ide === BusType.Swing) {
          slackBusNumber = bNum;
          break;
        }
      }

      // If no swing bus exists in this island, auto-elect generator bus with highest capacity
      if (slackBusNumber === undefined) {
        let bestCap = -1;
        let bestBus: number | undefined;
        for (const gen of generators) {
          const cap = gen.pt > 0 ? gen.pt : gen.mbase > 0 ? gen.mbase : gen.pg;
          if (cap > bestCap) {
            bestCap = cap;
            bestBus = gen.i;
          }
        }
        slackBusNumber = bestBus;
      }
    }

    islands.push({
      id: nextId++,
      busNumbers: busSet,
      generators,
      loads,
      branches,
      transformers,
      totalGenMw,
      totalGenMvar,
      totalLoadMw,
      totalLoadMvar,
      totalGenCapacityMw,
      slackBusNumber,
      isDead,
    });
  }

  // Sort islands by bus count descending (largest main grid first)
  islands.sort((a, b) => b.busNumbers.size - a.busNumbers.size);
  // Re-number IDs 1, 2, ...
  for (let i = 0; i < islands.length; i++) {
    islands[i]!.id = i + 1;
  }

  return islands;
}

/**
 * Balances generation and load within an island to ensure power flow convergence.
 * - Under-frequency load shedding (UFLS): scales loads down if generation capacity is insufficient.
 * - Generation curtailment: scales generator active power down if generation exceeds load + losses.
 */
export function balanceIslandActivePower(island: ElectricalIsland, _psCase?: PsseCase): void {
  if (island.isDead || island.loads.length === 0) return;

  const targetLossFactor = 1.03; // Expected 3% transmission loss
  const totalGen = island.totalGenMw;
  const totalCap = island.totalGenCapacityMw;
  const totalLoad = island.totalLoadMw;

  if (totalLoad <= 0) return;

  // Case 1: Generation deficit (Load > Generation capacity) -> Shed load (UFLS)
  if (totalLoad * targetLossFactor > totalCap && totalCap > 0) {
    const shedRatio = (totalCap * 0.95) / (totalLoad * targetLossFactor);
    for (const load of island.loads) {
      load.pl *= shedRatio;
      load.ql *= shedRatio;
    }
    island.totalLoadMw *= shedRatio;
    island.totalLoadMvar *= shedRatio;
  }
  // Case 2: Extreme generation excess (Gen > 1.25 * Load) -> Curtail generation
  else if (totalGen > totalLoad * 1.25 && totalGen > 0) {
    const targetGen = totalLoad * targetLossFactor;
    const redispatchRatio = targetGen / totalGen;
    for (const gen of island.generators) {
      if (gen.i !== island.slackBusNumber) {
        gen.pg = Math.max(gen.pb, gen.pg * redispatchRatio);
      }
    }
  }
}

/**
 * Clones a sub-case for a specific electrical island.
 */
function createIslandSubCase(island: ElectricalIsland, fullCase: PsseCase): PsseCase {
  const islandBuses = new Map<number, BusRecord>();
  for (const bNum of island.busNumbers) {
    const bRec = fullCase.buses.get(bNum);
    if (bRec) {
      // Ensure the designated slack bus has ide === BusType.Swing
      const ide = bNum === island.slackBusNumber ? BusType.Swing : bRec.ide === BusType.Swing ? BusType.PV : bRec.ide;
      islandBuses.set(bNum, {
        ...bRec,
        ide,
      });
    }
  }

  const islandLoads: LoadRecord[] = island.loads.map((l) => ({ ...l }));
  const islandGens: GeneratorRecord[] = island.generators.map((g) => ({ ...g }));
  const islandBranches: BranchRecord[] = island.branches.map((b) => ({ ...b }));
  const islandTransformers: TransformerRecord[] = island.transformers.map((t) => ({ ...t }));

  const islandFixedShunts: FixedShuntRecord[] = fullCase.fixedShunts
    .filter((s) => island.busNumbers.has(s.i))
    .map((s) => ({ ...s }));

  const islandSwitchedShunts: SwitchedShuntRecord[] = fullCase.switchedShunts
    .filter((s) => island.busNumbers.has(s.i))
    .map((s) => ({ ...s }));

  return {
    header: { ...fullCase.header },
    title1: `${fullCase.title1} (Island ${island.id})`,
    title2: fullCase.title2,
    buses: islandBuses,
    loads: islandLoads,
    fixedShunts: islandFixedShunts,
    generators: islandGens,
    branches: islandBranches,
    transformers: islandTransformers,
    areas: fullCase.areas,
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: islandSwitchedShunts,
  };
}

/**
 * Solves AC power flow across all independent electrical islands in the network.
 */
export function solveMultiIslandPowerFlow(
  psCase: PsseCase,
  options: MultiIslandPowerFlowOptions = {},
): MultiIslandPowerFlowSolution {
  const autoBalance = options.autoBalanceIslands ?? true;
  const islands = detectElectricalIslands(psCase, options.activeBranchFilter);

  const islandSummaries: IslandPowerFlowSummary[] = [];
  const allBusResults: BusPowerFlowResult[] = [];
  const allBranchResults: BranchPowerFlowResult[] = [];

  let overallConverged = true;
  let totalGenMw = 0;
  let totalGenMvar = 0;
  let totalLoadMw = 0;
  let totalLoadMvar = 0;
  let totalLossMw = 0;
  let totalLossMvar = 0;
  let maxMismatch = 0;
  let maxIterations = 0;

  for (const island of islands) {
    if (island.isDead) {
      // De-energized island: zero voltages and flows
      for (const bNum of island.busNumbers) {
        const bRec = psCase.buses.get(bNum);
        allBusResults.push({
          busNumber: bNum,
          name: bRec?.name ?? `BUS_${bNum}`,
          baseKv: bRec?.baseKv ?? 138.0,
          type: "PQ",
          vm: 0.0,
          va: 0.0,
          pgMw: 0.0,
          qgMvar: 0.0,
          plMw: 0.0,
          qlMvar: 0.0,
        });
      }

      for (const br of island.branches) {
        allBranchResults.push({
          fromBus: br.i,
          toBus: br.j,
          ckt: br.ckt,
          pFromMw: 0.0,
          qFromMvar: 0.0,
          pToMw: 0.0,
          qToMvar: 0.0,
          lossMw: 0.0,
          lossMvar: 0.0,
          mvaFlow: 0.0,
          rateMva: br.rateA,
          loadingPercent: 0.0,
        });
      }

      islandSummaries.push({
        islandId: island.id,
        busCount: island.busNumbers.size,
        converged: true,
        isDead: true,
        totalGenMw: 0.0,
        totalLoadMw: 0.0,
        totalLossMw: 0.0,
        iterations: 0,
        maxMismatchPu: 0.0,
      });
      continue;
    }

    // Energized island: auto-balance if requested
    if (autoBalance) {
      balanceIslandActivePower(island, psCase);
    }

    const subCase = createIslandSubCase(island, psCase);
    const sol = solvePowerFlow(subCase, options);

    if (!sol.converged) {
      overallConverged = false;
    }

    totalGenMw += sol.totalGenMw;
    totalGenMvar += sol.totalGenMvar;
    totalLoadMw += sol.totalLoadMw;
    totalLoadMvar += sol.totalLoadMvar;
    totalLossMw += sol.totalLossMw;
    totalLossMvar += sol.totalLossMvar;
    maxMismatch = Math.max(maxMismatch, sol.maxMismatchPu);
    maxIterations = Math.max(maxIterations, sol.iterations);

    allBusResults.push(...sol.buses);
    allBranchResults.push(...sol.branches);

    islandSummaries.push({
      islandId: island.id,
      busCount: island.busNumbers.size,
      converged: sol.converged,
      isDead: false,
      slackBusNumber: island.slackBusNumber,
      totalGenMw: sol.totalGenMw,
      totalLoadMw: sol.totalLoadMw,
      totalLossMw: sol.totalLossMw,
      iterations: sol.iterations,
      maxMismatchPu: sol.maxMismatchPu,
    });
  }

  // Also include inter-island branches that are in-service but cross island boundaries
  // (In an islanded network, flow on cut branches is 0.0)
  const evaluatedBranchKeys = new Set(allBranchResults.map((b) => `${b.fromBus}_${b.toBus}_${b.ckt}`));
  for (const br of psCase.branches) {
    const key1 = `${br.i}_${br.j}_${br.ckt}`;
    const key2 = `${br.j}_${br.i}_${br.ckt}`;
    if (!evaluatedBranchKeys.has(key1) && !evaluatedBranchKeys.has(key2)) {
      allBranchResults.push({
        fromBus: br.i,
        toBus: br.j,
        ckt: br.ckt,
        pFromMw: 0.0,
        qFromMvar: 0.0,
        pToMw: 0.0,
        qToMvar: 0.0,
        lossMw: 0.0,
        lossMvar: 0.0,
        mvaFlow: 0.0,
        rateMva: br.rateA,
        loadingPercent: 0.0,
      });
    }
  }

  return {
    converged: overallConverged,
    iterations: maxIterations,
    maxMismatchPu: maxMismatch,
    algorithm: options.algorithm ?? "newton_raphson",
    totalGenMw,
    totalGenMvar,
    totalLoadMw,
    totalLoadMvar,
    totalLossMw,
    totalLossMvar,
    buses: allBusResults,
    branches: allBranchResults,
    islands: islandSummaries,
    totalIslands: islands.length,
    activeIslands: islands.filter((is) => !is.isDead).length,
    deadIslands: islands.filter((is) => is.isDead).length,
  };
}
