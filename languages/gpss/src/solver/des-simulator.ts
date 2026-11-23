// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Deterministic Seeded Discrete-Event Simulation (DES) Engine for GPSS.
 *
 * Implements a binary min-heap Future Events Chain (FEC) and transaction
 * scheduler supporting GPSS blocks (`GENERATE`, `SEIZE`, `RELEASE`, `ADVANCE`,
 * `QUEUE`, `DEPART`, `ENTER`, `LEAVE`, `TRANSFER`, `SPLIT`, `ASSEMBLE`, `ASSIGN`,
 * `TEST`, `GATE`, `TABULATE`, `TERMINATE`) and Standard Numerical Attributes
 * (`Q$`, `F$`, `S$`, `R$`, `FR$`, `SR$`, `FN$`, `C1`, `RN1`, `M1`, `P1`..`Pn`).
 */

import type { GpssFunctionDef, GpssModel, GpssStatement } from "../types.js";

export interface GpssSimulateOptions {
  /** Deterministic PRNG seed (overrides `RMULT` if provided). */
  seed?: number | undefined;
  /** Override termination counter from `START A`. */
  terminationCount?: number | undefined;
  /** Optional warm-up time after which time-integrated statistics reset. */
  warmupTime?: number | undefined;
  /** Hard safety limit on processed events (default 2_000_000). */
  maxEvents?: number | undefined;
}

export interface GpssFacilityStats {
  name: string;
  entries: number;
  utilization: number;
  /** GPSS `FR$` utilization in parts per thousand (0–1000). */
  frPermille: number;
  meanServiceTime: number;
  busyTime: number;
  currentlyBusy: boolean;
}

export interface GpssQueueStats {
  name: string;
  entries: number;
  departures: number;
  zeroEntries: number;
  maxContent: number;
  currentContent: number;
  meanQueueLength: number;
  meanWaitTime: number;
  meanNonZeroWaitTime: number;
}

export interface GpssStorageStats {
  name: string;
  capacity: number;
  entries: number;
  maxContents: number;
  currentContents: number;
  averageContents: number;
  utilization: number;
  /** GPSS `SR$` utilization in parts per thousand (0–1000). */
  srPermille: number;
}

export interface GpssTableStats {
  name: string;
  entries: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
}

export interface GpssSimulationResult {
  modelName: string;
  seed: number;
  /** Final simulation clock `C1`. */
  clock: number;
  /** Effective observation window (`clock - statsStartTime`). */
  observationTime: number;
  /** Total transactions terminated during observation window. */
  completedTransactions: number;
  /** Total events processed by the FEC scheduler. */
  eventsProcessed: number;
  /** Observed throughput $\lambda_{\text{obs}} = N / T$. */
  throughput: number;
  /** Observed mean number of active transactions in the system $L$. */
  meanSystemCount: number;
  /** Observed mean transit time in the system $W$. */
  meanSystemTime: number;
  facilities: Record<string, GpssFacilityStats>;
  queues: Record<string, GpssQueueStats>;
  storages: Record<string, GpssStorageStats>;
  tables: Record<string, GpssTableStats>;
}

/**
 * Deterministic Mulberry32 PRNG returning $U \in (0, 1)$.
 */
function createPrng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    // Clamp strictly inside (1e-12, 1 - 1e-12) so -ln(1 - u) is always finite
    return u <= 1e-12 ? 1e-12 : u >= 1 - 1e-12 ? 1 - 1e-12 : u;
  };
}

interface Transaction {
  id: number;
  familyId: number;
  priority: number;
  markTime: number;
  nextBlock: number;
  params: Map<string, number>;
  queueEnterTimes: Map<string, number>;
  /** Generator block index if this transaction was created by a GENERATE block. */
  generatorBlock?: number | undefined;
}

interface ScheduledEvent {
  time: number;
  seq: number;
  priority: number;
  xact: Transaction;
}

/**
 * Binary min-heap Future Events Chain (FEC) ordered by `(time asc, priority desc, seq asc)`.
 */
class EventMinHeap {
  private items: ScheduledEvent[] = [];

  get size(): number {
    return this.items.length;
  }

  push(ev: ScheduledEvent): void {
    this.items.push(ev);
    this.siftUp(this.items.length - 1);
  }

  pop(): ScheduledEvent | undefined {
    const n = this.items.length;
    if (n === 0) return undefined;
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (n > 1) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private less(a: ScheduledEvent, b: ScheduledEvent): boolean {
    if (a.time !== b.time) return a.time < b.time;
    if (a.priority !== b.priority) return a.priority > b.priority;
    return a.seq < b.seq;
  }

  private siftUp(idx: number): void {
    let i = idx;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.less(this.items[i]!, this.items[parent]!)) {
        const tmp = this.items[i]!;
        this.items[i] = this.items[parent]!;
        this.items[parent] = tmp;
        i = parent;
      } else {
        break;
      }
    }
  }

  private siftDown(idx: number): void {
    let i = idx;
    const n = this.items.length;
    while (true) {
      let best = i;
      const left = (i << 1) + 1;
      const right = left + 1;
      if (left < n && this.less(this.items[left]!, this.items[best]!)) best = left;
      if (right < n && this.less(this.items[right]!, this.items[best]!)) best = right;
      if (best === i) break;
      const tmp = this.items[i]!;
      this.items[i] = this.items[best]!;
      this.items[best] = tmp;
      i = best;
    }
  }
}

interface FacilityState {
  name: string;
  ownerId: number | null;
  lastChange: number;
  busyTime: number;
  entries: number;
  waitQueue: Transaction[];
}

interface QueueState {
  name: string;
  current: number;
  maxContent: number;
  lastChange: number;
  area: number;
  entries: number;
  departures: number;
  zeroEntries: number;
  totalWaitTime: number;
}

interface StorageState {
  name: string;
  capacity: number;
  occupied: number;
  maxContents: number;
  lastChange: number;
  area: number;
  entries: number;
  waitQueue: Array<{ xact: Transaction; units: number }>;
}

interface TableState {
  name: string;
  argument: string;
  count: number;
  sum: number;
  sumSq: number;
  min: number;
  max: number;
}

function evaluateFunction(fn: GpssFunctionDef, x: number): number {
  const pts = fn.points;
  if (pts.length === 0) return x;
  if (x <= pts[0]![0]) return pts[0]![1];
  const last = pts[pts.length - 1]!;
  if (x >= last[0]) return last[1];

  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    if (x >= x0 && x <= x1) {
      if (fn.mode === "D") return y1;
      const span = x1 - x0;
      if (span <= 0) return y0;
      return y0 + ((x - x0) / span) * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * Runs a deterministic discrete-event simulation of a parsed `GpssModel`.
 */
export function simulateGpss(model: GpssModel, options: GpssSimulateOptions = {}): GpssSimulationResult {
  const seed = options.seed ?? model.rmultSeed ?? 42;
  const rng = createPrng(seed);
  const targetTerminations = options.terminationCount ?? model.startCount ?? 100;
  const warmupTime = options.warmupTime ?? 0;
  const maxEvents = options.maxEvents ?? 2_000_000;

  let clock = 0;
  let statsStartTime = 0;
  let warmupDone = warmupTime <= 0;
  let seqCounter = 0;
  let xactIdCounter = 0;
  let eventsProcessed = 0;

  // System-level Little's Law trackers
  let activeXacts = 0;
  let lastSystemChange = 0;
  let systemArea = 0;
  let completedTransactions = 0;
  let totalSystemTime = 0;
  let remainingTerminations = targetTerminations;

  const fec = new EventMinHeap();
  const facilities = new Map<string, FacilityState>();
  const queues = new Map<string, QueueState>();
  const storages = new Map<string, StorageState>();
  const tables = new Map<string, TableState>();
  const generatorCounts = new Map<number, number>();
  const assemblySets = new Map<string, number>();

  function getFacility(name: string): FacilityState {
    const key = name.toUpperCase();
    let f = facilities.get(key);
    if (!f) {
      f = { name: key, ownerId: null, lastChange: clock, busyTime: 0, entries: 0, waitQueue: [] };
      facilities.set(key, f);
    }
    return f;
  }

  function getQueue(name: string): QueueState {
    const key = name.toUpperCase();
    let q = queues.get(key);
    if (!q) {
      q = {
        name: key,
        current: 0,
        maxContent: 0,
        lastChange: clock,
        area: 0,
        entries: 0,
        departures: 0,
        zeroEntries: 0,
        totalWaitTime: 0,
      };
      queues.set(key, q);
    }
    return q;
  }

  function getStorage(name: string): StorageState {
    const key = name.toUpperCase();
    let s = storages.get(key);
    if (!s) {
      const def = model.storages.get(key);
      const cap = def && Number.isFinite(def.capacity) && def.capacity > 0 ? def.capacity : 1;
      s = {
        name: key,
        capacity: cap,
        occupied: 0,
        maxContents: 0,
        lastChange: clock,
        area: 0,
        entries: 0,
        waitQueue: [],
      };
      storages.set(key, s);
    }
    return s;
  }

  // Pre-initialize declared facilities, queues, storages, tables
  for (const fac of model.facilities) getFacility(fac);
  for (const q of model.queues) getQueue(q);
  for (const [sName] of model.storages) getStorage(sName);
  for (const [tName, tDef] of model.tables) {
    tables.set(tName, {
      name: tName,
      argument: tDef.argument,
      count: 0,
      sum: 0,
      sumSq: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    });
  }

  function updateSystemArea(): void {
    if (clock > lastSystemChange) {
      systemArea += activeXacts * (clock - lastSystemChange);
      lastSystemChange = clock;
    }
  }

  function resetStatistics(): void {
    statsStartTime = clock;
    lastSystemChange = clock;
    systemArea = 0;
    completedTransactions = 0;
    totalSystemTime = 0;
    for (const f of facilities.values()) {
      f.lastChange = clock;
      f.busyTime = 0;
      f.entries = 0;
    }
    for (const q of queues.values()) {
      q.lastChange = clock;
      q.area = 0;
      q.entries = 0;
      q.departures = 0;
      q.zeroEntries = 0;
      q.totalWaitTime = 0;
      q.maxContent = q.current;
    }
    for (const s of storages.values()) {
      s.lastChange = clock;
      s.area = 0;
      s.entries = 0;
      s.maxContents = s.occupied;
    }
    for (const t of tables.values()) {
      t.count = 0;
      t.sum = 0;
      t.sumSq = 0;
      t.min = Number.POSITIVE_INFINITY;
      t.max = Number.NEGATIVE_INFINITY;
    }
  }

  function evaluateSna(expr: string, xact?: Transaction): number {
    const raw = expr.trim().toUpperCase();
    if (!raw) return 0;

    // Numeric literal
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) return asNum;

    // EQU constant
    const eq = model.equs.get(raw);
    if (eq) return eq.value;

    // Clock & transit time
    if (raw === "C1" || raw === "AC1") return clock;
    if (raw === "M1") return xact ? clock - xact.markTime : 0;
    if (/^RN\d+$/.test(raw)) return rng();

    // Transaction parameter P1, P$NAME
    if (xact && raw.startsWith("P$")) {
      return xact.params.get(raw.slice(2)) ?? 0;
    }
    if (xact && /^P\d+$/.test(raw)) {
      return xact.params.get(raw) ?? 0;
    }

    // Function evaluation FN$name
    if (raw.startsWith("FN$")) {
      const fnName = raw.slice(3);
      const fnDef = model.functions.get(fnName);
      if (fnDef) {
        const argVal = evaluateSna(fnDef.argument, xact);
        return evaluateFunction(fnDef, argVal);
      }
      // Built-in unit exponential distribution for FN$EXPON / FN$EXP
      if (fnName === "EXPON" || fnName === "EXP" || fnName === "XPDIS") {
        return -Math.log(1.0 - rng());
      }
      return 1.0;
    }

    // Queue length Q$name
    if (raw.startsWith("Q$")) {
      return getQueue(raw.slice(2)).current;
    }
    // Facility status F$name
    if (raw.startsWith("F$")) {
      return getFacility(raw.slice(2)).ownerId !== null ? 1 : 0;
    }
    // Storage contents S$name
    if (raw.startsWith("S$")) {
      return getStorage(raw.slice(2)).occupied;
    }
    // Storage remaining capacity R$name
    if (raw.startsWith("R$")) {
      const st = getStorage(raw.slice(2));
      return Math.max(0, st.capacity - st.occupied);
    }
    // Facility utilization FR$name (permille)
    if (raw.startsWith("FR$")) {
      const f = getFacility(raw.slice(3));
      const obs = Math.max(1e-9, clock - statsStartTime);
      const busy = f.busyTime + (f.ownerId !== null ? clock - f.lastChange : 0);
      return (busy / obs) * 1000.0;
    }
    // Storage utilization SR$name (permille)
    if (raw.startsWith("SR$")) {
      const s = getStorage(raw.slice(3));
      const obs = Math.max(1e-9, clock - statsStartTime);
      const area = s.area + s.occupied * (clock - s.lastChange);
      return (area / (obs * s.capacity)) * 1000.0;
    }

    return 0;
  }

  /**
   * Samples a GPSS duration for `GENERATE A,B` or `ADVANCE A,B`.
   */
  function sampleDuration(opA: string, opB: string, xact?: Transaction): number {
    const aUpper = opA.trim().toUpperCase();
    const bUpper = opB.trim().toUpperCase();

    // Support EXP(mean) shorthand as well as classic GPSS `mean,FN$EXPON`
    const expMatch = /^EXP\(([^)]+)\)$/.exec(aUpper);
    if (expMatch && expMatch[1]) {
      const mean = Math.max(0, evaluateSna(expMatch[1], xact));
      return mean * -Math.log(1.0 - rng());
    }

    const mean = Math.max(0, evaluateSna(aUpper, xact));
    if (!bUpper) return mean;

    // If B is a function modifier (e.g. `FN$EXPON`), GPSS multiplies A * FN$...
    if (bUpper.startsWith("FN$")) {
      const mult = evaluateSna(bUpper, xact);
      return Math.max(0, mean * mult);
    }

    // Otherwise uniform [mean - spread, mean + spread]
    const spread = Math.max(0, evaluateSna(bUpper, xact));
    if (spread === 0) return mean;
    return Math.max(0, mean - spread + 2.0 * spread * rng());
  }

  function resolveBlockTarget(token: string, fallback: number): number {
    const clean = token.trim().toUpperCase();
    if (!clean) return fallback;
    const labelIdx = model.labels.get(clean);
    if (labelIdx !== undefined) return labelIdx;
    const asNum = parseInt(clean, 10);
    if (Number.isFinite(asNum) && asNum >= 0 && asNum < model.blocks.length) return asNum;
    return fallback;
  }

  function scheduleGeneratorArrival(genBlockIdx: number, isFirst: boolean): void {
    const stmt = model.blocks[genBlockIdx]!;
    const limitOp = (stmt.operands[3] ?? "").trim();
    const limit = limitOp ? evaluateSna(limitOp) : 0;
    const emitted = generatorCounts.get(genBlockIdx) ?? 0;
    if (limit > 0 && emitted >= limit) return;

    const opA = stmt.operands[0] ?? "1";
    const opB = stmt.operands[1] ?? "";
    const opC = stmt.operands[2] ?? "";
    const opE = stmt.operands[4] ?? "";

    const offset = isFirst && opC.trim() ? Math.max(0, evaluateSna(opC)) : sampleDuration(opA, opB);
    const arrivalTime = clock + offset;
    const priority = opE.trim() ? evaluateSna(opE) : 0;

    xactIdCounter++;
    generatorCounts.set(genBlockIdx, emitted + 1);
    const xact: Transaction = {
      id: xactIdCounter,
      familyId: xactIdCounter,
      priority,
      markTime: arrivalTime,
      nextBlock: genBlockIdx,
      params: new Map(),
      queueEnterTimes: new Map(),
      generatorBlock: genBlockIdx,
    };

    fec.push({
      time: arrivalTime,
      seq: ++seqCounter,
      priority,
      xact,
    });
  }

  // Seed initial arrivals for every GENERATE block
  for (let i = 0; i < model.blocks.length; i++) {
    if (model.blocks[i]!.opcode === "GENERATE") {
      scheduleGeneratorArrival(i, true);
    }
  }

  /**
   * Advances a transaction through consecutive blocks until it blocks, delays on FEC, or terminates.
   */
  function processTransaction(xact: Transaction): void {
    const maxStepsPerWakeup = Math.max(256, model.blocks.length * 8);
    let steps = 0;

    while (xact.nextBlock >= 0 && xact.nextBlock < model.blocks.length && steps < maxStepsPerWakeup) {
      steps++;
      const blockIdx = xact.nextBlock;
      const stmt: GpssStatement = model.blocks[blockIdx]!;
      const opA = (stmt.operands[0] ?? "").trim();
      const opB = (stmt.operands[1] ?? "").trim();
      const opC = (stmt.operands[2] ?? "").trim();

      switch (stmt.opcode) {
        case "GENERATE": {
          updateSystemArea();
          activeXacts++;
          xact.markTime = clock;
          // Schedule next arrival from this GENERATE block
          scheduleGeneratorArrival(blockIdx, false);
          xact.nextBlock = blockIdx + 1;
          break;
        }

        case "QUEUE": {
          const q = getQueue(opA || "Q1");
          const units = opB ? Math.max(1, Math.round(evaluateSna(opB, xact))) : 1;
          q.area += q.current * (clock - q.lastChange);
          q.lastChange = clock;
          q.current += units;
          q.entries += units;
          if (q.current > q.maxContent) q.maxContent = q.current;
          xact.queueEnterTimes.set(q.name, clock);
          xact.nextBlock = blockIdx + 1;
          break;
        }

        case "DEPART": {
          const q = getQueue(opA || "Q1");
          const units = opB ? Math.max(1, Math.round(evaluateSna(opB, xact))) : 1;
          q.area += q.current * (clock - q.lastChange);
          q.lastChange = clock;
          q.current = Math.max(0, q.current - units);
          q.departures += units;
          const enterTime = xact.queueEnterTimes.get(q.name);
          if (enterTime !== undefined) {
            const wait = Math.max(0, clock - enterTime);
            q.totalWaitTime += wait * units;
            if (wait <= 1e-12) q.zeroEntries += units;
            xact.queueEnterTimes.delete(q.name);
          }
          xact.nextBlock = blockIdx + 1;
          break;
        }

        case "SEIZE": {
          const f = getFacility(opA || "F1");
          if (f.ownerId === null) {
            f.busyTime += 0;
            f.lastChange = clock;
            f.ownerId = xact.id;
            f.entries++;
            xact.nextBlock = blockIdx + 1;
          } else {
            // Block transaction in facility FIFO queue
            f.waitQueue.push(xact);
            return;
          }
          break;
        }

        case "RELEASE": {
          const f = getFacility(opA || "F1");
          if (f.ownerId !== null) {
            f.busyTime += clock - f.lastChange;
            f.lastChange = clock;
            f.ownerId = null;
          }
          // Wake next waiting transaction immediately at current clock
          const nextWaiter = f.waitQueue.shift();
          if (nextWaiter) {
            fec.push({
              time: clock,
              seq: ++seqCounter,
              priority: nextWaiter.priority,
              xact: nextWaiter,
            });
          }
          xact.nextBlock = blockIdx + 1;
          break;
        }

        case "ENTER": {
          const s = getStorage(opA || "S1");
          const units = opB ? Math.max(1, Math.round(evaluateSna(opB, xact))) : 1;
          if (s.capacity - s.occupied >= units) {
            s.area += s.occupied * (clock - s.lastChange);
            s.lastChange = clock;
            s.occupied += units;
            s.entries += units;
            if (s.occupied > s.maxContents) s.maxContents = s.occupied;
            xact.nextBlock = blockIdx + 1;
          } else {
            s.waitQueue.push({ xact, units });
            return;
          }
          break;
        }

        case "LEAVE": {
          const s = getStorage(opA || "S1");
          const units = opB ? Math.max(1, Math.round(evaluateSna(opB, xact))) : 1;
          s.area += s.occupied * (clock - s.lastChange);
          s.lastChange = clock;
          s.occupied = Math.max(0, s.occupied - units);
          // Wake waiting transactions that now fit
          let avail = s.capacity - s.occupied;
          while (s.waitQueue.length > 0 && s.waitQueue[0]!.units <= avail) {
            const waiter = s.waitQueue.shift()!;
            avail -= waiter.units;
            fec.push({
              time: clock,
              seq: ++seqCounter,
              priority: waiter.xact.priority,
              xact: waiter.xact,
            });
          }
          xact.nextBlock = blockIdx + 1;
          break;
        }

        case "ADVANCE": {
          const delay = sampleDuration(opA, opB, xact);
          xact.nextBlock = blockIdx + 1;
          if (delay > 0) {
            fec.push({
              time: clock + delay,
              seq: ++seqCounter,
              priority: xact.priority,
              xact,
            });
            return;
          }
          break;
        }

        case "TRANSFER": {
          const modeUpper = opA.toUpperCase();
          if (!modeUpper) {
            // Unconditional transfer: `TRANSFER ,LABEL`
            xact.nextBlock = resolveBlockTarget(opB, blockIdx + 1);
          } else if (modeUpper === "BOTH") {
            // Try B; if blocked, try C (simplified: check facility/storage availability of B)
            const bIdx = resolveBlockTarget(opB, blockIdx + 1);
            const cIdx = resolveBlockTarget(opC, blockIdx + 1);
            const targetStmt = model.blocks[bIdx];
            let bAvailable = true;
            if (targetStmt?.opcode === "SEIZE") {
              bAvailable = getFacility(targetStmt.operands[0] ?? "F1").ownerId === null;
            } else if (targetStmt?.opcode === "ENTER") {
              const st = getStorage(targetStmt.operands[0] ?? "S1");
              const req = targetStmt.operands[1] ? evaluateSna(targetStmt.operands[1], xact) : 1;
              bAvailable = st.capacity - st.occupied >= req;
            }
            xact.nextBlock = bAvailable ? bIdx : cIdx;
          } else {
            // Statistical transfer: `TRANSFER .3,B,C` -> with prob p go to C, else B (GPSS convention)
            const prob = evaluateSna(modeUpper, xact);
            const bIdx = resolveBlockTarget(opB, blockIdx + 1);
            const cIdx = resolveBlockTarget(opC, blockIdx + 1);
            xact.nextBlock = rng() < prob ? cIdx : bIdx;
          }
          break;
        }

        case "ASSIGN": {
          const paramKey = opA.toUpperCase().startsWith("P") ? opA.toUpperCase() : `P${opA.toUpperCase()}`;
          const val = evaluateSna(opB, xact);
          xact.params.set(paramKey, val);
          xact.nextBlock = blockIdx + 1;
          break;
        }

        case "SPLIT": {
          const copies = Math.max(0, Math.round(evaluateSna(opA || "1", xact)));
          const targetIdx = resolveBlockTarget(opB, blockIdx + 1);
          for (let c = 0; c < copies; c++) {
            xactIdCounter++;
            updateSystemArea();
            activeXacts++;
            const clone: Transaction = {
              id: xactIdCounter,
              familyId: xact.familyId,
              priority: xact.priority,
              markTime: xact.markTime,
              nextBlock: targetIdx,
              params: new Map(xact.params),
              queueEnterTimes: new Map(),
            };
            fec.push({
              time: clock,
              seq: ++seqCounter,
              priority: clone.priority,
              xact: clone,
            });
          }
          xact.nextBlock = blockIdx + 1;
          break;
        }

        case "ASSEMBLE": {
          const needed = Math.max(1, Math.round(evaluateSna(opA || "2", xact)));
          const key = `${blockIdx}:${xact.familyId}`;
          const count = (assemblySets.get(key) ?? 0) + 1;
          if (count >= needed) {
            assemblySets.delete(key);
            xact.nextBlock = blockIdx + 1;
          } else {
            assemblySets.set(key, count);
            updateSystemArea();
            activeXacts = Math.max(0, activeXacts - 1);
            return;
          }
          break;
        }

        case "TEST": {
          const lhs = evaluateSna(opA, xact);
          const rhs = evaluateSna(opB, xact);
          let pass = false;
          switch (stmt.auxOperator) {
            case "E":
              pass = lhs === rhs;
              break;
            case "NE":
              pass = lhs !== rhs;
              break;
            case "G":
              pass = lhs > rhs;
              break;
            case "GE":
              pass = lhs >= rhs;
              break;
            case "L":
              pass = lhs < rhs;
              break;
            case "LE":
              pass = lhs <= rhs;
              break;
            default:
              pass = lhs === rhs;
          }
          xact.nextBlock = pass ? blockIdx + 1 : resolveBlockTarget(opC, blockIdx + 1);
          break;
        }

        case "GATE": {
          const entity = opA.toUpperCase();
          let pass = true;
          switch (stmt.auxOperator) {
            case "NU":
              pass = getFacility(entity).ownerId === null;
              break;
            case "U":
              pass = getFacility(entity).ownerId !== null;
              break;
            case "SNF": {
              const st = getStorage(entity);
              pass = st.occupied < st.capacity;
              break;
            }
            case "SF": {
              const st = getStorage(entity);
              pass = st.occupied >= st.capacity;
              break;
            }
            case "SE":
              pass = getStorage(entity).occupied === 0;
              break;
            case "SNE":
              pass = getStorage(entity).occupied > 0;
              break;
            default:
              pass = true;
          }
          xact.nextBlock = pass ? blockIdx + 1 : resolveBlockTarget(opB, blockIdx + 1);
          break;
        }

        case "TABULATE": {
          const tName = opA.toUpperCase();
          const t = tables.get(tName);
          if (t) {
            const obs = evaluateSna(t.argument, xact);
            t.count++;
            t.sum += obs;
            t.sumSq += obs * obs;
            if (obs < t.min) t.min = obs;
            if (obs > t.max) t.max = obs;
          }
          xact.nextBlock = blockIdx + 1;
          break;
        }

        case "TERMINATE": {
          updateSystemArea();
          activeXacts = Math.max(0, activeXacts - 1);
          if (warmupDone) {
            completedTransactions++;
            totalSystemTime += Math.max(0, clock - xact.markTime);
          }
          const dec = opA ? Math.max(0, Math.round(evaluateSna(opA, xact))) : 0;
          if (warmupDone && dec > 0) {
            remainingTerminations -= dec;
          }
          return;
        }

        default:
          xact.nextBlock = blockIdx + 1;
          break;
      }
    }
  }

  // Main discrete-event loop
  while (fec.size > 0 && remainingTerminations > 0 && eventsProcessed < maxEvents) {
    const ev = fec.pop()!;
    if (!warmupDone && ev.time >= warmupTime) {
      clock = warmupTime;
      resetStatistics();
      warmupDone = true;
    }
    clock = ev.time;
    eventsProcessed++;
    processTransaction(ev.xact);
  }

  // Flush final time integrals up to ending clock
  updateSystemArea();
  const obsTime = Math.max(1e-9, clock - statsStartTime);

  const facilityStats: Record<string, GpssFacilityStats> = {};
  for (const [name, f] of facilities) {
    const totalBusy = f.busyTime + (f.ownerId !== null ? clock - f.lastChange : 0);
    const util = Math.min(1.0, Math.max(0.0, totalBusy / obsTime));
    facilityStats[name] = {
      name,
      entries: f.entries,
      utilization: util,
      frPermille: util * 1000.0,
      meanServiceTime: f.entries > 0 ? totalBusy / f.entries : 0,
      busyTime: totalBusy,
      currentlyBusy: f.ownerId !== null,
    };
  }

  const queueStats: Record<string, GpssQueueStats> = {};
  for (const [name, q] of queues) {
    const totalArea = q.area + q.current * (clock - q.lastChange);
    const nonZeroCount = Math.max(0, q.departures - q.zeroEntries);
    queueStats[name] = {
      name,
      entries: q.entries,
      departures: q.departures,
      zeroEntries: q.zeroEntries,
      maxContent: q.maxContent,
      currentContent: q.current,
      meanQueueLength: totalArea / obsTime,
      meanWaitTime: q.departures > 0 ? q.totalWaitTime / q.departures : 0,
      meanNonZeroWaitTime: nonZeroCount > 0 ? q.totalWaitTime / nonZeroCount : 0,
    };
  }

  const storageStats: Record<string, GpssStorageStats> = {};
  for (const [name, s] of storages) {
    const totalArea = s.area + s.occupied * (clock - s.lastChange);
    const avgContents = totalArea / obsTime;
    const util = Math.min(1.0, Math.max(0.0, avgContents / s.capacity));
    storageStats[name] = {
      name,
      capacity: s.capacity,
      entries: s.entries,
      maxContents: s.maxContents,
      currentContents: s.occupied,
      averageContents: avgContents,
      utilization: util,
      srPermille: util * 1000.0,
    };
  }

  const tableStats: Record<string, GpssTableStats> = {};
  for (const [name, t] of tables) {
    const mean = t.count > 0 ? t.sum / t.count : 0;
    const variance = t.count > 1 ? Math.max(0, (t.sumSq - (t.sum * t.sum) / t.count) / (t.count - 1)) : 0;
    tableStats[name] = {
      name,
      entries: t.count,
      mean,
      stdDev: Math.sqrt(variance),
      min: t.count > 0 ? t.min : 0,
      max: t.count > 0 ? t.max : 0,
    };
  }

  const throughput = completedTransactions / obsTime;
  const meanSystemCount = systemArea / obsTime;
  const meanSystemTime = completedTransactions > 0 ? totalSystemTime / completedTransactions : 0;

  return {
    modelName: model.name,
    seed,
    clock,
    observationTime: obsTime,
    completedTransactions,
    eventsProcessed,
    throughput,
    meanSystemCount,
    meanSystemTime,
    facilities: facilityStats,
    queues: queueStats,
    storages: storageStats,
    tables: tableStats,
  };
}
