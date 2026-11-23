// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Combined Discrete-Continuous Hybrid Simulation Engine for SLAM II.
 *
 * Integrates:
 *   1. 4th-order Runge-Kutta (RK4) continuous ODE solver for `DD(i)` and `SS(i)`.
 *   2. Priority-queue Discrete-Event Simulation (DES) scheduler for SLAM II network
 *      nodes (`CREATE`, `QUEUE`, `ACTIVITY`, `ASSIGN`, `AWAIT`, `FREE`, `RESOURCE`,
 *      `GATE`, `OPEN`, `CLOSE`, `COLCT`, `TERMINATE`).
 *   3. `DETECT` threshold-crossing root-finder with bisection refinement to exact
 *      crossing time within specified tolerance `TOL`.
 */

import { parseSlamExpr } from "../parser/slam-parser.js";
import type { SlamExprNode, SlamModel, SlamNetworkNode } from "../types.js";

export interface SlamSolverOptions {
  /** Override simulation start time (default: INITIALIZE.ttbeg or 0) */
  tStart?: number | undefined;
  /** Override simulation end time (default: INITIALIZE.ttfin or 100) */
  tEnd?: number | undefined;
  /** Override integration step size (default: CONTINUOUS.dtmax or 0.05) */
  dt?: number | undefined;
  /** Deterministic PRNG seed (default: 12345) */
  seed?: number | undefined;
  /** Maximum discrete events safety cap (default: 200000) */
  maxEvents?: number | undefined;
}

export interface SlamTrajectoryPoint {
  t: number;
  ss: Record<number, number>;
  dd: Record<number, number>;
  xx: Record<number, number>;
}

export interface SlamDetectedCrossing {
  nodeId: string;
  variable: string;
  direction: string;
  threshold: number;
  time: number;
  value: number;
}

export interface SlamColctStats {
  id: string;
  count: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
}

export interface SlamResourceStats {
  name: string;
  capacity: number;
  avgUtilization: number;
  avgBusy: number;
  maxBusy: number;
  seizes: number;
}

export interface SlamQueueStats {
  fileNumber: number;
  avgLength: number;
  maxLength: number;
  avgWaitTime: number;
  totalEntries: number;
  currentLength: number;
}

export interface SlamSimulationResult {
  tStart: number;
  tEnd: number;
  tFinal: number;
  trajectory: SlamTrajectoryPoint[];
  finalSS: Record<number, number>;
  finalDD: Record<number, number>;
  finalXX: Record<number, number>;
  detectedCrossings: SlamDetectedCrossing[];
  colctStats: Record<string, SlamColctStats>;
  resourceStats: Record<string, SlamResourceStats>;
  queueStats: Record<number, SlamQueueStats>;
  entitiesCreated: number;
  entitiesTerminated: number;
  eventsProcessed: number;
}

interface Entity {
  id: number;
  atrib: Map<number, number>;
}

interface QueuedEntity {
  entity: Entity;
  enqueueTime: number;
  awaitNodeIndex?: number | undefined;
  unitsRequested?: number | undefined;
}

interface DesEvent {
  time: number;
  seq: number;
  kind: "CREATE" | "ARRIVE_NODE";
  nodeIndex: number;
  entity?: Entity | undefined;
}

/** Deterministic Mulberry32 PRNG */
function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return u <= 0 ? 1e-12 : u >= 1 ? 1 - 1e-12 : u;
  };
}

interface EvalContext {
  t: number;
  ss: Map<number, number>;
  dd: Map<number, number>;
  xx: Map<number, number>;
  atrib?: Map<number, number> | undefined;
  rng: () => number;
  queueLengths: Map<number, number>;
  resourceFree: Map<string, number>;
}

function evalExpr(node: SlamExprNode, ctx: EvalContext): number {
  switch (node.kind) {
    case "number":
      return node.value;
    case "state":
      if (node.array === "SS") return ctx.ss.get(node.index) ?? 0;
      if (node.array === "DD") return ctx.dd.get(node.index) ?? 0;
      if (node.array === "XX") return ctx.xx.get(node.index) ?? 0;
      if (node.array === "ATRIB") return ctx.atrib?.get(node.index) ?? 0;
      return 0;
    case "ident":
      if (node.name === "TNOW" || node.name === "TIME") return ctx.t;
      if (node.name === "PI") return Math.PI;
      return 0;
    case "unary": {
      const v = evalExpr(node.operand, ctx);
      return node.op === "-" ? -v : v;
    }
    case "binary": {
      const l = evalExpr(node.left, ctx);
      const r = evalExpr(node.right, ctx);
      switch (node.op) {
        case "+":
          return l + r;
        case "-":
          return l - r;
        case "*":
          return l * r;
        case "/":
          return r === 0 ? 0 : l / r;
        case "^":
          return Math.pow(l, r);
        default:
          return 0;
      }
    }
    case "call": {
      const fn = node.callee.toUpperCase();
      const args = node.args.map((a) => evalExpr(a, ctx));
      switch (fn) {
        case "EXPON": {
          const mean = args[0] ?? 1.0;
          return -mean * Math.log(ctx.rng());
        }
        case "UNFRM": {
          const lo = args[0] ?? 0.0;
          const hi = args[1] ?? 1.0;
          return lo + (hi - lo) * ctx.rng();
        }
        case "RNORM": {
          const mu = args[0] ?? 0.0;
          const sigma = args[1] ?? 1.0;
          const u1 = ctx.rng();
          const u2 = ctx.rng();
          const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
          return mu + sigma * z;
        }
        case "TRIAG": {
          const a = args[0] ?? 0.0;
          const m = args[1] ?? 0.5;
          const b = args[2] ?? 1.0;
          const u = ctx.rng();
          const fc = (m - a) / Math.max(1e-12, b - a);
          return u < fc ? a + Math.sqrt(u * (b - a) * (m - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - m));
        }
        case "NNQ": {
          const ifl = Math.trunc(args[0] ?? 1);
          return ctx.queueLengths.get(ifl) ?? 0;
        }
        case "INT": {
          const ma = Math.trunc(args[0] ?? 1);
          return ctx.t - (ctx.atrib?.get(ma) ?? 0);
        }
        case "ABS":
          return Math.abs(args[0] ?? 0);
        case "SQRT":
          return Math.sqrt(Math.max(0, args[0] ?? 0));
        case "EXP":
          return Math.exp(args[0] ?? 0);
        case "LOG":
        case "ALOG":
          return Math.log(Math.max(1e-15, args[0] ?? 1));
        case "SIN":
          return Math.sin(args[0] ?? 0);
        case "COS":
          return Math.cos(args[0] ?? 0);
        case "MIN":
          return Math.min(...args);
        case "MAX":
          return Math.max(...args);
        default:
          return args[0] ?? 0;
      }
    }
  }
}

function evalCondition(condStr: string, ctx: EvalContext): boolean {
  const m = condStr.match(/^(.+?)\s*\.(EQ|NE|LT|LE|GT|GE)\.\s*(.+)$/i);
  if (m) {
    const l = evalExpr(parseSlamExpr(m[1]!), ctx);
    const r = evalExpr(parseSlamExpr(m[3]!), ctx);
    const op = m[2]!.toUpperCase();
    if (op === "EQ") return Math.abs(l - r) < 1e-9;
    if (op === "NE") return Math.abs(l - r) >= 1e-9;
    if (op === "LT") return l < r;
    if (op === "LE") return l <= r;
    if (op === "GT") return l > r;
    if (op === "GE") return l >= r;
  }
  const cmp = condStr.match(/^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/);
  if (cmp) {
    const l = evalExpr(parseSlamExpr(cmp[1]!), ctx);
    const r = evalExpr(parseSlamExpr(cmp[3]!), ctx);
    const op = cmp[2]!;
    if (op === "==") return Math.abs(l - r) < 1e-9;
    if (op === "!=") return Math.abs(l - r) >= 1e-9;
    if (op === "<") return l < r;
    if (op === "<=") return l <= r;
    if (op === ">") return l > r;
    if (op === ">=") return l >= r;
  }
  return true;
}

/**
 * Simulates a parsed `SlamModel` using combined RK4 continuous integration,
 * discrete-event network execution, and `DETECT` threshold-crossing root finding.
 */
export function simulateSlamModel(model: SlamModel, options: SlamSolverOptions = {}): SlamSimulationResult {
  const tStart = options.tStart ?? model.initialize?.ttbeg ?? 0.0;
  const tEnd = options.tEnd ?? model.initialize?.ttfin ?? 100.0;
  const dtMax = options.dt ?? model.continuous?.dtmax ?? 0.05;
  const dtsav = model.continuous?.dtsav ?? dtMax;
  const maxEvents = options.maxEvents ?? 200_000;
  const rng = createRng(options.seed ?? 12345);

  const ss = new Map<number, number>();
  const dd = new Map<number, number>();
  const xx = new Map<number, number>();

  // Initialize declared states to 0
  const nneqd = model.continuous?.nnequations ?? 0;
  const nneqs = model.continuous?.nnstates ?? 0;
  for (let i = 1; i <= nneqd + nneqs; i++) {
    ss.set(i, 0.0);
    dd.set(i, 0.0);
  }

  // Apply INTLC initial conditions
  const tempCtx: EvalContext = {
    t: tStart,
    ss,
    dd,
    xx,
    rng,
    queueLengths: new Map(),
    resourceFree: new Map(),
  };
  for (const init of model.intlc) {
    const val = init.numericValue ?? evalExpr(parseSlamExpr(init.valueExpr), tempCtx);
    if (init.kind === "SS" && init.index !== undefined) ss.set(init.index, val);
    else if (init.kind === "DD" && init.index !== undefined) dd.set(init.index, val);
    else if (init.kind === "XX" && init.index !== undefined) xx.set(init.index, val);
  }

  const diffEqs = model.stateEquations.filter((e) => e.lhsKind === "DD");
  const algEqs = model.stateEquations.filter((e) => e.lhsKind === "SS");
  const hasContinuous = diffEqs.length > 0 || algEqs.length > 0 || nneqd + nneqs > 0;

  // Map labels to node indices
  const labelToIndex = new Map<string, number>();
  for (let i = 0; i < model.nodes.length; i++) {
    const lbl = model.nodes[i]!.label;
    if (lbl) labelToIndex.set(lbl, i);
  }

  // Resources state & time-weighted tracking
  const resCap = new Map<string, number>();
  const resBusy = new Map<string, number>();
  const resMaxBusy = new Map<string, number>();
  const resBusyArea = new Map<string, number>();
  const resLastTime = new Map<string, number>();
  const resSeizes = new Map<string, number>();
  const resWaitFiles = new Map<string, number[]>();

  for (const [name, node] of model.resources) {
    resCap.set(name, node.resourceUnits ?? 1);
    resBusy.set(name, 0);
    resMaxBusy.set(name, 0);
    resBusyArea.set(name, 0);
    resLastTime.set(name, tStart);
    resSeizes.set(name, 0);
    resWaitFiles.set(name, []);
  }

  // Gates state
  const gateOpen = new Map<string, boolean>();
  const gateWaitFiles = new Map<string, number[]>();
  for (const [name, node] of model.gates) {
    gateOpen.set(name, node.gateInitialOpen ?? true);
    gateWaitFiles.set(name, []);
  }

  // Queues (files) state & statistics
  const queues = new Map<number, QueuedEntity[]>();
  const queueArea = new Map<number, number>();
  const queueLastTime = new Map<number, number>();
  const queueMaxLen = new Map<number, number>();
  const queueTotalWait = new Map<number, number>();
  const queueTotalEntries = new Map<number, number>();
  const queueDepartures = new Map<number, number>();
  // Implicit server busy tracking for QUEUE -> ACTIVITY (M/M/1 without explicit RESOURCE)
  const queueServiceBusy = new Map<number, boolean>();
  const queueNodeIndex = new Map<number, number>();

  for (let i = 0; i < model.nodes.length; i++) {
    const n = model.nodes[i]!;
    if (n.type === "QUEUE" || n.type === "AWAIT") {
      const ifl = n.fileNumber ?? 1;
      if (!queues.has(ifl)) {
        queues.set(ifl, []);
        queueArea.set(ifl, 0);
        queueLastTime.set(ifl, tStart);
        queueMaxLen.set(ifl, 0);
        queueTotalWait.set(ifl, 0);
        queueTotalEntries.set(ifl, 0);
        queueDepartures.set(ifl, 0);
      }
      if (n.type === "QUEUE") {
        queueNodeIndex.set(ifl, i);
        queueServiceBusy.set(ifl, false);
      }
      if (n.type === "AWAIT" && n.resourceName) {
        if (resWaitFiles.has(n.resourceName)) {
          const list = resWaitFiles.get(n.resourceName)!;
          if (!list.includes(ifl)) list.push(ifl);
        } else if (gateWaitFiles.has(n.resourceName)) {
          const list = gateWaitFiles.get(n.resourceName)!;
          if (!list.includes(ifl)) list.push(ifl);
        }
      }
    }
  }

  // COLCT accumulators
  const colctValues = new Map<string, number[]>();

  // DETECT nodes
  const detectNodes: Array<{ nodeIndex: number; node: SlamNetworkNode; varIndex: number; varKind: "SS" | "DD" }> = [];
  for (let i = 0; i < model.nodes.length; i++) {
    const n = model.nodes[i]!;
    if (n.type === "DETECT") {
      const m = (n.detectVar ?? "SS(1)").match(/^(SS|DD)\((\d+)\)$/i);
      const varKind = (m ? m[1]!.toUpperCase() : "SS") as "SS" | "DD";
      const varIndex = m ? Number.parseInt(m[2]!, 10) : 1;
      detectNodes.push({ nodeIndex: i, node: n, varIndex, varKind });
    }
  }

  // Event queue (sorted descending by time so pop() gives earliest event)
  const eventQueue: DesEvent[] = [];
  let seqCounter = 0;
  let entityIdCounter = 0;
  let entitiesCreated = 0;
  let entitiesTerminated = 0;
  let eventsProcessed = 0;
  let stopRequested = false;

  const createCounts = new Map<number, number>();
  const detectedCrossings: SlamDetectedCrossing[] = [];
  const trajectory: SlamTrajectoryPoint[] = [];

  function pushEvent(ev: Omit<DesEvent, "seq">): void {
    const full: DesEvent = { ...ev, seq: seqCounter++ };
    // Insert maintaining descending order of (time, seq)
    let lo = 0;
    let hi = eventQueue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const cur = eventQueue[mid]!;
      if (cur.time > full.time || (cur.time === full.time && cur.seq > full.seq)) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    eventQueue.splice(lo, 0, full);
  }

  function makeCtx(t: number, atrib?: Map<number, number>): EvalContext {
    const qLens = new Map<number, number>();
    for (const [ifl, q] of queues) qLens.set(ifl, q.length);
    const rFree = new Map<string, number>();
    for (const [name, cap] of resCap) rFree.set(name, cap - (resBusy.get(name) ?? 0));
    return { t, ss, dd, xx, atrib, rng, queueLengths: qLens, resourceFree: rFree };
  }

  function updateResourceArea(name: string, now: number): void {
    const last = resLastTime.get(name) ?? tStart;
    if (now > last) {
      resBusyArea.set(name, (resBusyArea.get(name) ?? 0) + (resBusy.get(name) ?? 0) * (now - last));
      resLastTime.set(name, now);
    }
  }

  function updateQueueArea(ifl: number, now: number): void {
    const last = queueLastTime.get(ifl) ?? tStart;
    const len = queues.get(ifl)?.length ?? 0;
    if (now > last) {
      queueArea.set(ifl, (queueArea.get(ifl) ?? 0) + len * (now - last));
      queueLastTime.set(ifl, now);
    }
  }

  function evaluateAlgebraicAndDerivatives(
    t: number,
    stateMap: Map<number, number>,
    derivMap: Map<number, number>,
  ): void {
    const ctx: EvalContext = {
      t,
      ss: stateMap,
      dd: derivMap,
      xx,
      rng,
      queueLengths: new Map(),
      resourceFree: new Map(),
    };
    for (const eq of algEqs) {
      stateMap.set(eq.index, evalExpr(eq.rhsExpr, ctx));
    }
    for (const eq of diffEqs) {
      derivMap.set(eq.index, evalExpr(eq.rhsExpr, ctx));
    }
  }

  function rk4Step(
    t: number,
    h: number,
    stateIn: Map<number, number>,
  ): { ssOut: Map<number, number>; ddOut: Map<number, number> } {
    const keys = diffEqs.map((e) => e.index);
    const s1 = new Map(stateIn);
    const k1 = new Map<number, number>();
    evaluateAlgebraicAndDerivatives(t, s1, k1);

    const s2 = new Map(stateIn);
    for (const idx of keys) s2.set(idx, (stateIn.get(idx) ?? 0) + 0.5 * h * (k1.get(idx) ?? 0));
    const k2 = new Map<number, number>();
    evaluateAlgebraicAndDerivatives(t + 0.5 * h, s2, k2);

    const s3 = new Map(stateIn);
    for (const idx of keys) s3.set(idx, (stateIn.get(idx) ?? 0) + 0.5 * h * (k2.get(idx) ?? 0));
    const k3 = new Map<number, number>();
    evaluateAlgebraicAndDerivatives(t + 0.5 * h, s3, k3);

    const s4 = new Map(stateIn);
    for (const idx of keys) s4.set(idx, (stateIn.get(idx) ?? 0) + h * (k3.get(idx) ?? 0));
    const k4 = new Map<number, number>();
    evaluateAlgebraicAndDerivatives(t + h, s4, k4);

    const ssOut = new Map(stateIn);
    for (const idx of keys) {
      const y0 = stateIn.get(idx) ?? 0;
      const dy = ((k1.get(idx) ?? 0) + 2 * (k2.get(idx) ?? 0) + 2 * (k3.get(idx) ?? 0) + (k4.get(idx) ?? 0)) / 6.0;
      ssOut.set(idx, y0 + h * dy);
    }
    const ddOut = new Map<number, number>();
    evaluateAlgebraicAndDerivatives(t + h, ssOut, ddOut);
    return { ssOut, ddOut };
  }

  function detectResidual(
    det: { node: SlamNetworkNode; varIndex: number; varKind: "SS" | "DD" },
    sMap: Map<number, number>,
    dMap: Map<number, number>,
  ): number {
    const val = det.varKind === "SS" ? (sMap.get(det.varIndex) ?? 0) : (dMap.get(det.varIndex) ?? 0);
    return val - (det.node.detectThreshold ?? 0);
  }

  function isCrossing(dir: string, g0: number, g1: number): boolean {
    const d = dir.toUpperCase();
    if (d === "XP" || d === "P" || d === "POSITIVE") {
      return g0 < 0 && g1 >= 0;
    }
    if (d === "XN" || d === "N" || d === "NEGATIVE") {
      return g0 > 0 && g1 <= 0;
    }
    return (g0 < 0 && g1 >= 0) || (g0 > 0 && g1 <= 0);
  }

  function snapshot(t: number): void {
    const ssObj: Record<number, number> = {};
    const ddObj: Record<number, number> = {};
    const xxObj: Record<number, number> = {};
    for (const [k, v] of ss) ssObj[k] = v;
    for (const [k, v] of dd) ddObj[k] = v;
    for (const [k, v] of xx) xxObj[k] = v;
    trajectory.push({ t, ss: ssObj, dd: ddObj, xx: xxObj });
  }

  /**
   * Dispatches an entity leaving `fromIndex` to outgoing ACTIVITY branches
   * or the next sequential executable node.
   */
  function routeFromNode(fromIndex: number, entity: Entity, now: number): void {
    // Collect consecutive ACTIVITY nodes immediately following `fromIndex`
    const activities: number[] = [];
    let j = fromIndex + 1;
    while (j < model.nodes.length && model.nodes[j]!.type === "ACTIVITY") {
      activities.push(j);
      j++;
    }

    if (activities.length > 0) {
      const maxM = model.nodes[fromIndex]!.maxBranches ?? activities.length;
      const ctx = makeCtx(now, entity.atrib);
      let taken = 0;

      // Check if probabilistic branching
      const hasProb = activities.some((idx) => model.nodes[idx]!.probability !== undefined);
      if (hasProb && maxM === 1) {
        const u = rng();
        let cum = 0;
        for (const actIdx of activities) {
          const act = model.nodes[actIdx]!;
          cum += act.probability ?? 1.0;
          if (u <= cum) {
            scheduleActivity(actIdx, entity, now);
            return;
          }
        }
        return;
      }

      for (const actIdx of activities) {
        if (taken >= maxM) break;
        const act = model.nodes[actIdx]!;
        if (act.conditionOrProb && act.probability === undefined) {
          if (!evalCondition(act.conditionOrProb, ctx)) continue;
        } else if (act.probability !== undefined && maxM > 1) {
          if (rng() > act.probability) continue;
        }
        scheduleActivity(actIdx, entity, now);
        taken++;
      }
      return;
    }

    // No explicit ACTIVITY: fall through to next non-declaration node
    let nextIdx = fromIndex + 1;
    while (
      nextIdx < model.nodes.length &&
      (model.nodes[nextIdx]!.type === "RESOURCE" ||
        model.nodes[nextIdx]!.type === "GATE" ||
        model.nodes[nextIdx]!.type === "DETECT")
    ) {
      nextIdx++;
    }
    if (nextIdx < model.nodes.length) {
      executeNode(nextIdx, entity, now);
    }
  }

  function scheduleActivity(actIdx: number, entity: Entity, now: number, sourceQueueIfl?: number): void {
    const act = model.nodes[actIdx]!;
    const ctx = makeCtx(now, entity.atrib);
    const dur = Math.max(0, evalExpr(parseSlamExpr(act.durationExpr ?? "0"), ctx));

    // Resolve destination node index
    let destIdx: number | undefined;
    if (act.targetLabel) {
      destIdx = labelToIndex.get(act.targetLabel);
    } else {
      // Next node after all contiguous ACTIVITY nodes
      let k = actIdx + 1;
      while (k < model.nodes.length && model.nodes[k]!.type === "ACTIVITY") k++;
      if (k < model.nodes.length) destIdx = k;
    }

    if (sourceQueueIfl !== undefined) {
      // Schedule completion that also releases the implicit QUEUE server
      const completionTime = now + dur;
      pushEvent({
        time: completionTime,
        kind: "ARRIVE_NODE",
        nodeIndex: destIdx ?? -1,
        entity: {
          id: entity.id,
          atrib: new Map([...entity.atrib, [-999, sourceQueueIfl]]),
        },
      });
    } else if (destIdx !== undefined) {
      pushEvent({
        time: now + dur,
        kind: "ARRIVE_NODE",
        nodeIndex: destIdx,
        entity,
      });
    }
  }

  function releaseImplicitQueueServer(ifl: number, now: number): void {
    const q = queues.get(ifl);
    const qIdx = queueNodeIndex.get(ifl);
    if (!q || qIdx === undefined) return;
    if (q.length > 0) {
      updateQueueArea(ifl, now);
      const next = q.shift()!;
      queueTotalWait.set(ifl, (queueTotalWait.get(ifl) ?? 0) + (now - next.enqueueTime));
      queueDepartures.set(ifl, (queueDepartures.get(ifl) ?? 0) + 1);
      // Start service for next entity on the following ACTIVITY
      const actIdx = qIdx + 1;
      if (actIdx < model.nodes.length && model.nodes[actIdx]!.type === "ACTIVITY") {
        scheduleActivity(actIdx, next.entity, now, ifl);
        return;
      }
    }
    queueServiceBusy.set(ifl, false);
  }

  function dispatchWaitingForResource(resName: string, now: number): void {
    const files = resWaitFiles.get(resName) ?? [];
    for (const ifl of files) {
      const q = queues.get(ifl);
      if (!q) continue;
      while (q.length > 0) {
        const head = q[0]!;
        const needed = head.unitsRequested ?? 1;
        const avail = (resCap.get(resName) ?? 1) - (resBusy.get(resName) ?? 0);
        if (avail < needed) break;
        updateQueueArea(ifl, now);
        q.shift();
        queueTotalWait.set(ifl, (queueTotalWait.get(ifl) ?? 0) + (now - head.enqueueTime));
        queueDepartures.set(ifl, (queueDepartures.get(ifl) ?? 0) + 1);

        updateResourceArea(resName, now);
        const nextBusy = (resBusy.get(resName) ?? 0) + needed;
        resBusy.set(resName, nextBusy);
        resSeizes.set(resName, (resSeizes.get(resName) ?? 0) + 1);
        if (nextBusy > (resMaxBusy.get(resName) ?? 0)) resMaxBusy.set(resName, nextBusy);

        if (head.awaitNodeIndex !== undefined) {
          routeFromNode(head.awaitNodeIndex, head.entity, now);
        }
      }
    }
  }

  function dispatchWaitingForGate(gName: string, now: number): void {
    if (!gateOpen.get(gName)) return;
    const files = gateWaitFiles.get(gName) ?? [];
    for (const ifl of files) {
      const q = queues.get(ifl);
      if (!q) continue;
      while (q.length > 0 && gateOpen.get(gName)) {
        updateQueueArea(ifl, now);
        const head = q.shift()!;
        queueTotalWait.set(ifl, (queueTotalWait.get(ifl) ?? 0) + (now - head.enqueueTime));
        queueDepartures.set(ifl, (queueDepartures.get(ifl) ?? 0) + 1);
        if (head.awaitNodeIndex !== undefined) {
          routeFromNode(head.awaitNodeIndex, head.entity, now);
        }
      }
    }
  }

  function executeNode(nodeIndex: number, entity: Entity, now: number): void {
    if (stopRequested || nodeIndex < 0 || nodeIndex >= model.nodes.length) return;
    const node = model.nodes[nodeIndex]!;

    switch (node.type) {
      case "CREATE": {
        if (node.markAttribute !== undefined) {
          entity.atrib.set(node.markAttribute, now);
        }
        routeFromNode(nodeIndex, entity, now);
        break;
      }

      case "QUEUE": {
        const ifl = node.fileNumber ?? 1;
        const q = queues.get(ifl) ?? [];
        queues.set(ifl, q);
        const nextNode = model.nodes[nodeIndex + 1];
        const hasServiceAct = nextNode !== undefined && nextNode.type === "ACTIVITY";

        queueTotalEntries.set(ifl, (queueTotalEntries.get(ifl) ?? 0) + 1);

        if (hasServiceAct && !queueServiceBusy.get(ifl)) {
          // Server is idle: start service immediately (zero wait time)
          queueServiceBusy.set(ifl, true);
          queueDepartures.set(ifl, (queueDepartures.get(ifl) ?? 0) + 1);
          scheduleActivity(nodeIndex + 1, entity, now, ifl);
        } else {
          // Check queue capacity / balking
          if (node.capacity !== undefined && q.length >= node.capacity) {
            if (node.targetLabel) {
              const balkIdx = labelToIndex.get(node.targetLabel);
              if (balkIdx !== undefined) executeNode(balkIdx, entity, now);
            }
            return;
          }
          updateQueueArea(ifl, now);
          q.push({ entity, enqueueTime: now });
          if (q.length > (queueMaxLen.get(ifl) ?? 0)) queueMaxLen.set(ifl, q.length);
        }
        break;
      }

      case "AWAIT": {
        const ifl = node.fileNumber ?? 1;
        const name = node.resourceName ?? "";
        const units = node.resourceUnits ?? 1;
        const q = queues.get(ifl) ?? [];
        queues.set(ifl, q);
        queueTotalEntries.set(ifl, (queueTotalEntries.get(ifl) ?? 0) + 1);

        if (resCap.has(name)) {
          const avail = (resCap.get(name) ?? 1) - (resBusy.get(name) ?? 0);
          if (avail >= units && q.length === 0) {
            updateResourceArea(name, now);
            const nextBusy = (resBusy.get(name) ?? 0) + units;
            resBusy.set(name, nextBusy);
            resSeizes.set(name, (resSeizes.get(name) ?? 0) + 1);
            if (nextBusy > (resMaxBusy.get(name) ?? 0)) resMaxBusy.set(name, nextBusy);
            queueDepartures.set(ifl, (queueDepartures.get(ifl) ?? 0) + 1);
            routeFromNode(nodeIndex, entity, now);
          } else {
            updateQueueArea(ifl, now);
            q.push({ entity, enqueueTime: now, awaitNodeIndex: nodeIndex, unitsRequested: units });
            if (q.length > (queueMaxLen.get(ifl) ?? 0)) queueMaxLen.set(ifl, q.length);
          }
        } else if (gateOpen.has(name)) {
          if (gateOpen.get(name)) {
            queueDepartures.set(ifl, (queueDepartures.get(ifl) ?? 0) + 1);
            routeFromNode(nodeIndex, entity, now);
          } else {
            updateQueueArea(ifl, now);
            q.push({ entity, enqueueTime: now, awaitNodeIndex: nodeIndex });
            if (q.length > (queueMaxLen.get(ifl) ?? 0)) queueMaxLen.set(ifl, q.length);
          }
        } else {
          routeFromNode(nodeIndex, entity, now);
        }
        break;
      }

      case "FREE": {
        const name = node.resourceName ?? "";
        const units = node.resourceUnits ?? 1;
        if (resCap.has(name)) {
          updateResourceArea(name, now);
          resBusy.set(name, Math.max(0, (resBusy.get(name) ?? 0) - units));
          dispatchWaitingForResource(name, now);
        }
        routeFromNode(nodeIndex, entity, now);
        break;
      }

      case "OPEN": {
        const gName = node.gateName ?? "";
        if (gateOpen.has(gName)) {
          gateOpen.set(gName, true);
          dispatchWaitingForGate(gName, now);
        }
        routeFromNode(nodeIndex, entity, now);
        break;
      }

      case "CLOSE": {
        const gName = node.gateName ?? "";
        if (gateOpen.has(gName)) {
          gateOpen.set(gName, false);
        }
        routeFromNode(nodeIndex, entity, now);
        break;
      }

      case "ASSIGN": {
        const ctx = makeCtx(now, entity.atrib);
        for (const pair of node.assignments ?? []) {
          const val = evalExpr(pair.rhsExpr, ctx);
          const m = pair.lhs.match(/^(SS|DD|XX|ATRIB)\((\d+)\)$/);
          if (m) {
            const arr = m[1]!;
            const idx = Number.parseInt(m[2]!, 10);
            if (arr === "SS") ss.set(idx, val);
            else if (arr === "DD") dd.set(idx, val);
            else if (arr === "XX") xx.set(idx, val);
            else if (arr === "ATRIB") entity.atrib.set(idx, val);
          }
        }
        if (hasContinuous) {
          evaluateAlgebraicAndDerivatives(now, ss, dd);
        }
        routeFromNode(nodeIndex, entity, now);
        break;
      }

      case "COLCT": {
        const id = node.collectId ?? node.id;
        const ctx = makeCtx(now, entity.atrib);
        const val = evalExpr(parseSlamExpr(node.collectVar ?? "TNOW"), ctx);
        const arr = colctValues.get(id) ?? [];
        arr.push(val);
        colctValues.set(id, arr);
        routeFromNode(nodeIndex, entity, now);
        break;
      }

      case "DETECT": {
        routeFromNode(nodeIndex, entity, now);
        break;
      }

      case "TERMINATE": {
        entitiesTerminated++;
        if (node.terminateCount !== undefined && entitiesTerminated >= node.terminateCount) {
          stopRequested = true;
        }
        break;
      }

      case "ACTIVITY": {
        scheduleActivity(nodeIndex, entity, now);
        break;
      }

      case "RESOURCE":
      case "GATE":
        break;
    }
  }

  // Schedule initial CREATE events
  for (let i = 0; i < model.nodes.length; i++) {
    const n = model.nodes[i]!;
    if (n.type === "CREATE") {
      const tf = n.firstCreation ?? tStart;
      if (tf <= tEnd) {
        pushEvent({ time: tf, kind: "CREATE", nodeIndex: i });
      }
    }
  }

  // Initial derivative evaluation & trajectory snapshot
  let tNow = tStart;
  if (hasContinuous) {
    evaluateAlgebraicAndDerivatives(tNow, ss, dd);
  }
  snapshot(tNow);
  let nextSaveTime = tStart + dtsav;

  // Main combined discrete-continuous simulation loop
  while (tNow < tEnd - 1e-12 && !stopRequested && eventsProcessed < maxEvents) {
    const nextEvent = eventQueue.length > 0 ? eventQueue[eventQueue.length - 1] : undefined;
    const tNextEvent = nextEvent ? Math.min(nextEvent.time, tEnd) : tEnd;

    // 1. Advance continuous state from tNow to tNextEvent in steps <= dtMax, checking DETECT crossings
    if (hasContinuous && tNextEvent > tNow + 1e-12) {
      while (tNow < tNextEvent - 1e-12 && !stopRequested) {
        const h = Math.min(dtMax, tNextEvent - tNow);
        const { ssOut, ddOut } = rk4Step(tNow, h, ss);

        // Check all DETECT nodes for threshold crossings over [tNow, tNow + h]
        let earliestCross: {
          det: (typeof detectNodes)[number];
          tCross: number;
          ssCross: Map<number, number>;
          ddCross: Map<number, number>;
        } | null = null;

        for (const det of detectNodes) {
          const g0 = detectResidual(det, ss, dd);
          const g1 = detectResidual(det, ssOut, ddOut);
          const dir = det.node.detectDirection ?? "XP";
          if (isCrossing(dir, g0, g1)) {
            // Bisection refinement to locate crossing time within TOL
            const tol = Math.max(1e-9, det.node.detectTolerance ?? 1e-4);
            let lo = 0.0;
            let hi = h;
            let bestSs = ssOut;
            let bestDd = ddOut;
            for (let iter = 0; iter < 30; iter++) {
              const mid = 0.5 * (lo + hi);
              const stepMid = rk4Step(tNow, mid, ss);
              const gMid = detectResidual(det, stepMid.ssOut, stepMid.ddOut);
              bestSs = stepMid.ssOut;
              bestDd = stepMid.ddOut;
              if (Math.abs(gMid) <= tol || hi - lo <= 1e-10) {
                hi = mid;
                break;
              }
              if (isCrossing(dir, g0, gMid)) {
                hi = mid;
              } else {
                lo = mid;
              }
            }
            const tCross = tNow + hi;
            if (!earliestCross || tCross < earliestCross.tCross) {
              earliestCross = { det, tCross, ssCross: bestSs, ddCross: bestDd };
            }
          }
        }

        if (earliestCross) {
          // Advance to exact crossing time, commit state, record & trigger DETECT node
          tNow = earliestCross.tCross;
          for (const [k, v] of earliestCross.ssCross) ss.set(k, v);
          for (const [k, v] of earliestCross.ddCross) dd.set(k, v);
          const val =
            earliestCross.det.varKind === "SS"
              ? (ss.get(earliestCross.det.varIndex) ?? 0)
              : (dd.get(earliestCross.det.varIndex) ?? 0);

          detectedCrossings.push({
            nodeId: earliestCross.det.node.id,
            variable: earliestCross.det.node.detectVar ?? `SS(${earliestCross.det.varIndex})`,
            direction: earliestCross.det.node.detectDirection ?? "XP",
            threshold: earliestCross.det.node.detectThreshold ?? 0,
            time: tNow,
            value: val,
          });
          snapshot(tNow);

          // Create an entity at the DETECT node and route it immediately
          const detEntity: Entity = { id: ++entityIdCounter, atrib: new Map() };
          eventsProcessed++;
          executeNode(earliestCross.det.nodeIndex, detEntity, tNow);
          // Break out to re-check eventQueue in case DETECT scheduled an earlier event
          break;
        } else {
          tNow += h;
          for (const [k, v] of ssOut) ss.set(k, v);
          for (const [k, v] of ddOut) dd.set(k, v);
          if (tNow >= nextSaveTime - 1e-9 || Math.abs(tNow - tEnd) < 1e-9) {
            snapshot(tNow);
            while (nextSaveTime <= tNow + 1e-9) nextSaveTime += dtsav;
          }
        }
      }
      // Re-check if an event was scheduled earlier than tNextEvent
      if (eventQueue.length > 0 && eventQueue[eventQueue.length - 1]!.time < tNextEvent - 1e-12) {
        continue;
      }
    } else {
      tNow = tNextEvent;
    }

    // 2. Process all discrete events at tNow
    while (
      eventQueue.length > 0 &&
      eventQueue[eventQueue.length - 1]!.time <= tNow + 1e-12 &&
      !stopRequested &&
      eventsProcessed < maxEvents
    ) {
      const ev = eventQueue.pop()!;
      tNow = ev.time;
      eventsProcessed++;

      if (ev.kind === "CREATE") {
        const node = model.nodes[ev.nodeIndex]!;
        const count = (createCounts.get(ev.nodeIndex) ?? 0) + 1;
        createCounts.set(ev.nodeIndex, count);
        entitiesCreated++;

        const entity: Entity = { id: ++entityIdCounter, atrib: new Map() };
        executeNode(ev.nodeIndex, entity, tNow);

        // Schedule next creation if below maxCreations
        if (node.maxCreations === undefined || count < node.maxCreations) {
          const ctx = makeCtx(tNow);
          const tbc = Math.max(1e-9, evalExpr(parseSlamExpr(node.interarrivalExpr ?? "1.0"), ctx));
          if (tNow + tbc <= tEnd) {
            pushEvent({ time: tNow + tbc, kind: "CREATE", nodeIndex: ev.nodeIndex });
          }
        }
      } else if (ev.kind === "ARRIVE_NODE" && ev.entity) {
        // Check if this arrival completes an implicit QUEUE service activity
        const releaseIfl = ev.entity.atrib.get(-999);
        if (releaseIfl !== undefined) {
          ev.entity.atrib.delete(-999);
          releaseImplicitQueueServer(releaseIfl, tNow);
        }
        if (ev.nodeIndex >= 0) {
          executeNode(ev.nodeIndex, ev.entity, tNow);
        }
      }
    }

    // If no more discrete events and no continuous equations, advance to tEnd
    if (!hasContinuous && eventQueue.length === 0) {
      tNow = tEnd;
    }
  }

  // Finalize time-weighted areas
  const totalDuration = Math.max(1e-12, tNow - tStart);
  const resourceStats: Record<string, SlamResourceStats> = {};
  for (const [name, cap] of resCap) {
    updateResourceArea(name, tNow);
    const avgBusy = (resBusyArea.get(name) ?? 0) / totalDuration;
    resourceStats[name] = {
      name,
      capacity: cap,
      avgUtilization: avgBusy / Math.max(1, cap),
      avgBusy,
      maxBusy: resMaxBusy.get(name) ?? 0,
      seizes: resSeizes.get(name) ?? 0,
    };
  }

  const queueStats: Record<number, SlamQueueStats> = {};
  for (const [ifl, q] of queues) {
    updateQueueArea(ifl, tNow);
    const deps = queueDepartures.get(ifl) ?? 0;
    queueStats[ifl] = {
      fileNumber: ifl,
      avgLength: (queueArea.get(ifl) ?? 0) / totalDuration,
      maxLength: queueMaxLen.get(ifl) ?? 0,
      avgWaitTime: deps > 0 ? (queueTotalWait.get(ifl) ?? 0) / deps : 0,
      totalEntries: queueTotalEntries.get(ifl) ?? 0,
      currentLength: q.length,
    };
  }

  const colctStats: Record<string, SlamColctStats> = {};
  for (const [id, vals] of colctValues) {
    const count = vals.length;
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = count > 0 ? sum / count : 0;
    let min = Infinity;
    let max = -Infinity;
    let sqSum = 0;
    for (const v of vals) {
      if (v < min) min = v;
      if (v > max) max = v;
      sqSum += (v - mean) * (v - mean);
    }
    colctStats[id] = {
      id,
      count,
      mean,
      min: count > 0 ? min : 0,
      max: count > 0 ? max : 0,
      stdDev: count > 1 ? Math.sqrt(sqSum / (count - 1)) : 0,
    };
  }

  const finalSS: Record<number, number> = {};
  const finalDD: Record<number, number> = {};
  const finalXX: Record<number, number> = {};
  for (const [k, v] of ss) finalSS[k] = v;
  for (const [k, v] of dd) finalDD[k] = v;
  for (const [k, v] of xx) finalXX[k] = v;

  return {
    tStart,
    tEnd,
    tFinal: tNow,
    trajectory,
    finalSS,
    finalDD,
    finalXX,
    detectedCrossings,
    colctStats,
    resourceStats,
    queueStats,
    entitiesCreated,
    entitiesTerminated,
    eventsProcessed,
  };
}
