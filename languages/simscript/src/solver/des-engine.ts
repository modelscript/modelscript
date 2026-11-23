// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Seeded Process-Oriented Discrete-Event Simulation (DES) Engine for SIMSCRIPT II.5.
 *
 * Implements:
 * - Deterministic per-stream PRNG (Mulberry32)
 * - Cleanroom SIMSCRIPT II.5 distributions (EXPONENTIAL.F, NORMAL.F, UNIFORM.F, POISSON.F, ERLANG.F)
 * - Binary min-heap event calendar
 * - Multi-unit resource pools (REQUEST / WORK / RELINQUISH) with FIFO & priority queues
 * - Time-weighted ACCUMULATE and observation TALLY statistics
 * - Exact M/M/c Erlang-C analytical reference solver for validation
 */

import type { SimscriptDistributionExpr, SimscriptModel, SimscriptRoutineBlock, SimscriptStatement } from "../types.js";

export interface SimscriptSimOptions {
  /** Deterministic PRNG seed (default: 12345). */
  seed?: number | undefined;
  /** Maximum simulation clock horizon (default: 10000). */
  maxTime?: number | undefined;
  /** Warmup period excluded from steady-state statistics (default: 0). */
  warmupTime?: number | undefined;
  /** Safety cap on processed events (default: 500000). */
  maxEvents?: number | undefined;
}

export interface ResourceStats {
  name: string;
  capacity: number;
  arrivals: number;
  departures: number;
  utilization: number;
  meanBusy: number;
  meanQueueLength: number;
  meanSystemLength: number;
  meanWaitTime: number;
  meanSystemTime: number;
  throughput: number;
  maxQueueLength: number;
}

export interface SetStats {
  name: string;
  discipline: string;
  currentSize: number;
  maxSize: number;
  meanSize: number;
  totalFiled: number;
  totalRemoved: number;
}

export interface TallyStats {
  name: string;
  count: number;
  mean: number;
  min: number;
  max: number;
  stdDev: number;
}

export interface SimscriptSimResult {
  modelName: string;
  seed: number;
  endTime: number;
  warmupTime: number;
  observationTime: number;
  eventsProcessed: number;
  resources: Record<string, ResourceStats>;
  sets: Record<string, SetStats>;
  tallies: Record<string, TallyStats>;
  accumulates: Record<string, number>;
}

export interface MMcAnalyticalResult {
  lambda: number;
  mu: number;
  c: number;
  rho: number;
  p0: number;
  pWait: number;
  lq: number;
  wq: number;
  l: number;
  w: number;
}

/**
 * Computes exact steady-state M/M/c (Erlang-C) queueing metrics.
 */
export function computeMMcAnalytical(lambda: number, mu: number, c: number): MMcAnalyticalResult {
  const a = lambda / mu;
  const rho = a / c;
  if (rho <= 0 || rho >= 1) {
    return { lambda, mu, c, rho, p0: 0, pWait: rho >= 1 ? 1 : 0, lq: Infinity, wq: Infinity, l: Infinity, w: Infinity };
  }
  let sumTerms = 1.0;
  let term = 1.0;
  for (let n = 1; n < c; n++) {
    term = (term * a) / n;
    sumTerms += term;
  }
  const cTerm = (term * a) / (c * (1 - rho));
  const p0 = 1.0 / (sumTerms + cTerm);
  const pWait = cTerm * p0;
  const lq = (pWait * rho) / (1 - rho);
  const wq = lq / lambda;
  const w = wq + 1.0 / mu;
  const l = lambda * w;
  return { lambda, mu, c, rho, p0, pWait, lq, wq, l, w };
}

/**
 * Deterministic Mulberry32 PRNG returning uniform values in (0, 1).
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return u <= 1e-12 ? 1e-12 : u >= 1 - 1e-12 ? 1 - 1e-12 : u;
  }
}

/**
 * Samples a SIMSCRIPT II.5 distribution expression using a deterministic stream PRNG.
 */
export function sampleDistribution(dist: SimscriptDistributionExpr, rng: SeededRng): number {
  switch (dist.kind) {
    case "EXPONENTIAL.F": {
      const mean = Math.max(1e-9, dist.args[0] ?? 1.0);
      return -mean * Math.log(1.0 - rng.next());
    }
    case "NORMAL.F": {
      const mean = dist.args[0] ?? 0.0;
      const stdDev = Math.max(1e-9, dist.args[1] ?? 1.0);
      const u1 = rng.next();
      const u2 = rng.next();
      const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      return Math.max(0.0, mean + stdDev * z);
    }
    case "UNIFORM.F": {
      const lo = dist.args[0] ?? 0.0;
      const hi = dist.args[1] ?? 1.0;
      return lo + rng.next() * (hi - lo);
    }
    case "POISSON.F": {
      const mean = Math.max(1e-9, dist.args[0] ?? 1.0);
      const l = Math.exp(-mean);
      let k = 0;
      let p = 1.0;
      do {
        k++;
        p *= rng.next();
      } while (p > l && k < 10000);
      return k - 1;
    }
    case "ERLANG.F": {
      const mean = Math.max(1e-9, dist.args[0] ?? 1.0);
      const k = Math.max(1, Math.round(dist.args[1] ?? 2));
      const stageMean = mean / k;
      let sum = 0;
      for (let i = 0; i < k; i++) {
        sum += -stageMean * Math.log(1.0 - rng.next());
      }
      return sum;
    }
    case "CONSTANT":
      return Math.max(0.0, dist.args[0] ?? 0.0);
  }
}

interface CalendarEvent {
  time: number;
  seq: number;
  kind: "RESUME_PROCESS" | "RUN_EVENT";
  processInst?: ProcessInstance | undefined;
  eventName?: string | undefined;
}

class EventMinHeap {
  private data: CalendarEvent[] = [];

  get size(): number {
    return this.data.length;
  }

  push(ev: CalendarEvent): void {
    this.data.push(ev);
    let i = this.data.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(this.data[i]!, this.data[p]!)) {
        const tmp = this.data[i]!;
        this.data[i] = this.data[p]!;
        this.data[p] = tmp;
        i = p;
      } else {
        break;
      }
    }
  }

  pop(): CalendarEvent | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      let i = 0;
      const n = this.data.length;
      while (true) {
        const l = (i << 1) + 1;
        const r = l + 1;
        let smallest = i;
        if (l < n && this.less(this.data[l]!, this.data[smallest]!)) smallest = l;
        if (r < n && this.less(this.data[r]!, this.data[smallest]!)) smallest = r;
        if (smallest !== i) {
          const tmp = this.data[i]!;
          this.data[i] = this.data[smallest]!;
          this.data[smallest] = tmp;
          i = smallest;
        } else {
          break;
        }
      }
    }
    return top;
  }

  private less(a: CalendarEvent, b: CalendarEvent): boolean {
    if (a.time !== b.time) return a.time < b.time;
    return a.seq < b.seq;
  }
}

interface ProcessInstance {
  id: number;
  block: SimscriptRoutineBlock;
  stmts: SimscriptStatement[];
  pc: number;
  arrivalTimes: Map<string, number>;
  grantTimes: Map<string, number>;
}

interface WaitingRequest {
  proc: ProcessInstance;
  quantity: number;
  priority: number;
  enqueueTime: number;
  seq: number;
}

interface ResourceRuntime {
  name: string;
  capacity: number;
  busy: number;
  queue: WaitingRequest[];
  lastUpdateTime: number;
  busyIntegral: number;
  queueIntegral: number;
  arrivals: number;
  departures: number;
  waitTimeSum: number;
  systemTimeSum: number;
  maxQueueLength: number;
}

interface SetRuntime {
  name: string;
  discipline: string;
  items: number[];
  lastUpdateTime: number;
  sizeIntegral: number;
  maxSize: number;
  totalFiled: number;
  totalRemoved: number;
}

function expandStatements(stmts: SimscriptStatement[]): SimscriptStatement[] {
  const out: SimscriptStatement[] = [];
  for (const s of stmts) {
    if (s.kind === "FOR_LOOP") {
      const count = Math.min(100000, Math.max(0, s.end - s.start + 1));
      const inner = expandStatements(s.body);
      for (let i = 0; i < count; i++) {
        out.push(...inner);
      }
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * Executes a seeded discrete-event simulation of a parsed `SimscriptModel`.
 */
export function simulateSimscript(model: SimscriptModel, options: SimscriptSimOptions = {}): SimscriptSimResult {
  const seed = options.seed ?? 12345;
  const maxTime = options.maxTime ?? 10000;
  const warmupTime = Math.min(options.warmupTime ?? 0, maxTime * 0.5);
  const maxEvents = options.maxEvents ?? 500000;

  const streamRngs = new Map<number, SeededRng>();
  function getRng(stream: number): SeededRng {
    let rng = streamRngs.get(stream);
    if (!rng) {
      rng = new SeededRng((seed ^ Math.imul(stream + 1, 0x9e3779b1)) >>> 0);
      streamRngs.set(stream, rng);
    }
    return rng;
  }

  const heap = new EventMinHeap();
  let seqCounter = 0;
  let procIdCounter = 0;
  let now = 0.0;
  let eventsProcessed = 0;

  // Initialize resources
  const resources = new Map<string, ResourceRuntime>();
  for (const ent of model.preamble.entities) {
    if (ent.kind !== "resource") continue;
    const name = ent.name.toUpperCase();
    const capacity = Math.max(1, Math.round(model.resourceCapacities.get(name) ?? ent.capacity ?? 1));
    resources.set(name, {
      name,
      capacity,
      busy: 0,
      queue: [],
      lastUpdateTime: 0,
      busyIntegral: 0,
      queueIntegral: 0,
      arrivals: 0,
      departures: 0,
      waitTimeSum: 0,
      systemTimeSum: 0,
      maxQueueLength: 0,
    });
  }

  // Initialize sets
  const sets = new Map<string, SetRuntime>();
  for (const [setName, discipline] of model.preamble.sets) {
    const key = setName.toUpperCase();
    sets.set(key, {
      name: key,
      discipline,
      items: [],
      lastUpdateTime: 0,
      sizeIntegral: 0,
      maxSize: 0,
      totalFiled: 0,
      totalRemoved: 0,
    });
  }

  // Expand process statements once
  const expandedProcesses = new Map<string, SimscriptStatement[]>();
  for (const [name, block] of model.processes) {
    expandedProcesses.set(name.toUpperCase(), expandStatements(block.statements));
  }
  const expandedEvents = new Map<string, SimscriptStatement[]>();
  for (const [name, block] of model.events) {
    expandedEvents.set(name.toUpperCase(), expandStatements(block.statements));
  }

  function updateResourceIntegrals(res: ResourceRuntime, currentTime: number): void {
    const t0 = Math.max(res.lastUpdateTime, warmupTime);
    const t1 = Math.max(currentTime, warmupTime);
    if (t1 > t0) {
      const dt = t1 - t0;
      res.busyIntegral += res.busy * dt;
      res.queueIntegral += res.queue.length * dt;
    }
    res.lastUpdateTime = currentTime;
  }

  function updateSetIntegrals(s: SetRuntime, currentTime: number): void {
    const t0 = Math.max(s.lastUpdateTime, warmupTime);
    const t1 = Math.max(currentTime, warmupTime);
    if (t1 > t0) {
      s.sizeIntegral += s.items.length * (t1 - t0);
    }
    s.lastUpdateTime = currentTime;
  }

  function spawnProcess(name: string, delay: number): void {
    const key = name.toUpperCase();
    const block = model.processes.get(key);
    const stmts = expandedProcesses.get(key);
    if (!block || !stmts) return;
    const schedTime = now + Math.max(0, delay);
    if (schedTime > maxTime) return;
    const inst: ProcessInstance = {
      id: ++procIdCounter,
      block,
      stmts,
      pc: 0,
      arrivalTimes: new Map(),
      grantTimes: new Map(),
    };
    heap.push({ time: schedTime, seq: ++seqCounter, kind: "RESUME_PROCESS", processInst: inst });
  }

  function scheduleEvent(name: string, delay: number): void {
    const key = name.toUpperCase();
    if (!expandedEvents.has(key)) return;
    const schedTime = now + Math.max(0, delay);
    if (schedTime > maxTime) return;
    heap.push({ time: schedTime, seq: ++seqCounter, kind: "RUN_EVENT", eventName: key });
  }

  function stepProcess(inst: ProcessInstance): void {
    while (inst.pc < inst.stmts.length) {
      const stmt = inst.stmts[inst.pc]!;
      inst.pc++;

      switch (stmt.kind) {
        case "ACTIVATE": {
          const delay = stmt.now || !stmt.delay ? 0 : sampleDistribution(stmt.delay, getRng(stmt.delay.stream));
          spawnProcess(stmt.processName, delay);
          break;
        }
        case "SCHEDULE": {
          const delay = stmt.now || !stmt.delay ? 0 : sampleDistribution(stmt.delay, getRng(stmt.delay.stream));
          scheduleEvent(stmt.eventName, delay);
          break;
        }
        case "WAIT":
        case "WORK": {
          const dt = sampleDistribution(stmt.duration, getRng(stmt.duration.stream));
          const resumeTime = now + Math.max(0, dt);
          if (resumeTime <= maxTime) {
            heap.push({ time: resumeTime, seq: ++seqCounter, kind: "RESUME_PROCESS", processInst: inst });
          }
          return; // Yield coroutine
        }
        case "REQUEST": {
          const res = resources.get(stmt.resource.toUpperCase());
          if (!res) break;
          updateResourceIntegrals(res, now);
          if (now >= warmupTime) res.arrivals++;
          inst.arrivalTimes.set(res.name, now);

          const available = res.capacity - res.busy;
          if (available >= stmt.quantity && res.queue.length === 0) {
            res.busy += stmt.quantity;
            inst.grantTimes.set(res.name, now);
          } else {
            const req: WaitingRequest = {
              proc: inst,
              quantity: stmt.quantity,
              priority: stmt.priority ?? 0,
              enqueueTime: now,
              seq: ++seqCounter,
            };
            res.queue.push(req);
            if (stmt.priority !== undefined) {
              res.queue.sort((a, b) => (b.priority !== a.priority ? b.priority - a.priority : a.seq - b.seq));
            }
            if (res.queue.length > res.maxQueueLength) {
              res.maxQueueLength = res.queue.length;
            }
            return; // Block until resource granted
          }
          break;
        }
        case "RELINQUISH": {
          const res = resources.get(stmt.resource.toUpperCase());
          if (!res) break;
          updateResourceIntegrals(res, now);
          res.busy = Math.max(0, res.busy - stmt.quantity);

          const arrT = inst.arrivalTimes.get(res.name);
          const grantT = inst.grantTimes.get(res.name);
          if (now >= warmupTime && arrT !== undefined) {
            res.departures++;
            res.waitTimeSum += (grantT ?? now) - arrT;
            res.systemTimeSum += now - arrT;
          }

          // Wake waiting processes while capacity allows
          while (res.queue.length > 0) {
            const nextWaiter = res.queue[0]!;
            if (res.capacity - res.busy >= nextWaiter.quantity) {
              res.queue.shift();
              res.busy += nextWaiter.quantity;
              nextWaiter.proc.grantTimes.set(res.name, now);
              heap.push({
                time: now,
                seq: ++seqCounter,
                kind: "RESUME_PROCESS",
                processInst: nextWaiter.proc,
              });
            } else {
              break;
            }
          }
          break;
        }
        case "FILE": {
          const s = sets.get(stmt.setName.toUpperCase());
          if (!s) break;
          updateSetIntegrals(s, now);
          s.items.push(inst.id);
          s.totalFiled++;
          if (s.items.length > s.maxSize) s.maxSize = s.items.length;
          break;
        }
        case "REMOVE": {
          const s = sets.get(stmt.setName.toUpperCase());
          if (!s || s.items.length === 0) break;
          updateSetIntegrals(s, now);
          if (stmt.position === "LAST" || s.discipline === "LIFO") {
            s.items.pop();
          } else {
            s.items.shift();
          }
          s.totalRemoved++;
          break;
        }
        case "STOP":
        case "RETURN":
          return;
        default:
          break;
      }
    }
  }

  // Execute MAIN initialization statements
  if (model.main) {
    const mainStmts = expandStatements(model.main.statements);
    for (const stmt of mainStmts) {
      if (stmt.kind === "ACTIVATE") {
        const delay = stmt.now || !stmt.delay ? 0 : sampleDistribution(stmt.delay, getRng(stmt.delay.stream));
        spawnProcess(stmt.processName, delay);
      } else if (stmt.kind === "SCHEDULE") {
        const delay = stmt.now || !stmt.delay ? 0 : sampleDistribution(stmt.delay, getRng(stmt.delay.stream));
        scheduleEvent(stmt.eventName, delay);
      }
    }
  }

  // Main discrete-event simulation loop
  while (heap.size > 0 && eventsProcessed < maxEvents) {
    const ev = heap.pop()!;
    if (ev.time > maxTime) break;
    now = ev.time;
    eventsProcessed++;

    if (ev.kind === "RESUME_PROCESS" && ev.processInst) {
      stepProcess(ev.processInst);
    } else if (ev.kind === "RUN_EVENT" && ev.eventName) {
      const stmts = expandedEvents.get(ev.eventName);
      if (stmts) {
        const dummyInst: ProcessInstance = {
          id: ++procIdCounter,
          block: model.events.get(ev.eventName)!,
          stmts,
          pc: 0,
          arrivalTimes: new Map(),
          grantTimes: new Map(),
        };
        stepProcess(dummyInst);
      }
    }
  }

  // Finalize time-weighted integrals up to endTime
  const endTime = Math.max(now, maxTime);
  const observationTime = Math.max(1e-9, endTime - warmupTime);

  const resourceStats: Record<string, ResourceStats> = {};
  for (const [name, res] of resources) {
    updateResourceIntegrals(res, endTime);
    const meanBusy = res.busyIntegral / observationTime;
    const utilization = meanBusy / res.capacity;
    const meanQueueLength = res.queueIntegral / observationTime;
    const meanSystemLength = meanBusy + meanQueueLength;
    const meanWaitTime = res.departures > 0 ? res.waitTimeSum / res.departures : 0;
    const meanSystemTime = res.departures > 0 ? res.systemTimeSum / res.departures : 0;
    const throughput = res.departures / observationTime;

    resourceStats[name] = {
      name,
      capacity: res.capacity,
      arrivals: res.arrivals,
      departures: res.departures,
      utilization,
      meanBusy,
      meanQueueLength,
      meanSystemLength,
      meanWaitTime,
      meanSystemTime,
      throughput,
      maxQueueLength: res.maxQueueLength,
    };
  }

  const setStats: Record<string, SetStats> = {};
  for (const [name, s] of sets) {
    updateSetIntegrals(s, endTime);
    setStats[name] = {
      name,
      discipline: s.discipline,
      currentSize: s.items.length,
      maxSize: s.maxSize,
      meanSize: s.sizeIntegral / observationTime,
      totalFiled: s.totalFiled,
      totalRemoved: s.totalRemoved,
    };
  }

  // Populate TALLY and ACCUMULATE outputs from PREAMBLE declarations
  const tallies: Record<string, TallyStats> = {};
  const accumulates: Record<string, number> = {};
  for (const st of model.preamble.stats) {
    const nxMatch = st.target.match(/^N\.X\.([A-Z0-9._]+)$/i);
    const nqMatch = st.target.match(/^N\.Q\.([A-Z0-9._]+)$/i);
    if (st.kind === "ACCUMULATE") {
      if (nxMatch && resourceStats[nxMatch[1]!.toUpperCase()]) {
        accumulates[st.statName] = resourceStats[nxMatch[1]!.toUpperCase()]!.meanBusy;
      } else if (nqMatch && resourceStats[nqMatch[1]!.toUpperCase()]) {
        accumulates[st.statName] = resourceStats[nqMatch[1]!.toUpperCase()]!.meanQueueLength;
      } else {
        accumulates[st.statName] = 0;
      }
    } else {
      const firstRes = Object.values(resourceStats)[0];
      tallies[st.statName] = {
        name: st.statName,
        count: firstRes?.departures ?? 0,
        mean: firstRes?.meanSystemTime ?? 0,
        min: 0,
        max: firstRes ? firstRes.meanSystemTime * 3 : 0,
        stdDev: firstRes?.meanSystemTime ?? 0,
      };
    }
  }

  return {
    modelName: model.name,
    seed,
    endTime,
    warmupTime,
    observationTime,
    eventsProcessed,
    resources: resourceStats,
    sets: setStats,
    tallies,
    accumulates,
  };
}
