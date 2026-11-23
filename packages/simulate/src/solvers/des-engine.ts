// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Discrete-Event Simulation (DES) & Analytical Queueing Networks.
 *
 * Provides:
 *   1. High-throughput binary-heap event-calendar DES kernel (`DiscreteEventEngine`)
 *   2. Exact analytical M/M/c (Erlang-C) queueing solver
 *   3. Open Jackson queueing network steady-state solver
 */

import { IndexedMinHeap, solveDenseLinear } from "@modelscript/runtime";

export interface DesEvent<TPayload = unknown> {
  readonly id: number;
  readonly time: number;
  readonly type: string;
  readonly payload?: TPayload | undefined;
}

export type DesEventHandler<TPayload = unknown> = (
  event: DesEvent<TPayload>,
  engine: DiscreteEventEngine<TPayload>,
) => void;

export class DiscreteEventEngine<TPayload = unknown> {
  private readonly heap = new IndexedMinHeap(128);
  private readonly events = new Map<number, DesEvent<TPayload>>();
  private readonly handlers = new Map<string, DesEventHandler<TPayload>>();
  private nextId = 1;
  public currentTime = 0;
  public processedEvents = 0;

  public on(eventType: string, handler: DesEventHandler<TPayload>): void {
    this.handlers.set(eventType, handler);
  }

  public schedule(time: number, type: string, payload?: TPayload): number {
    if (time < this.currentTime) {
      throw new Error(`Cannot schedule event '${type}' in the past (${time} < ${this.currentTime}).`);
    }
    const id = this.nextId++;
    this.events.set(id, { id, time, type, payload });
    this.heap.push(id, time);
    return id;
  }

  public runUntil(horizon: number, maxEvents = 1_000_000): { finalTime: number; processedEvents: number } {
    while (this.heap.length > 0 && this.processedEvents < maxEvents) {
      const next = this.heap.pop();
      if (next.key > horizon) break;
      const ev = this.events.get(next.id);
      this.events.delete(next.id);
      if (!ev) continue;
      this.currentTime = ev.time;
      this.processedEvents++;
      const handler = this.handlers.get(ev.type);
      if (handler) handler(ev, this);
    }
    return { finalTime: this.currentTime, processedEvents: this.processedEvents };
  }
}

export interface MmcQueueResult {
  readonly stable: boolean;
  readonly utilization: number;
  readonly probWait: number;
  readonly meanQueueLength: number;
  readonly meanSystemLength: number;
  readonly meanWaitTime: number;
  readonly meanResponseTime: number;
}

/** Exact analytical M/M/c (Erlang-C) queue metrics. */
export function solveMmcQueue(arrivalRate: number, serviceRate: number, servers: number): MmcQueueResult {
  const c = Math.max(1, Math.floor(servers));
  const a = arrivalRate / serviceRate;
  const rho = a / c;
  if (rho >= 1.0) {
    return {
      stable: false,
      utilization: rho,
      probWait: 1,
      meanQueueLength: Infinity,
      meanSystemLength: Infinity,
      meanWaitTime: Infinity,
      meanResponseTime: Infinity,
    };
  }

  let sumTerms = 0;
  let fact = 1;
  for (let n = 0; n < c; n++) {
    if (n > 1) fact *= n;
    sumTerms += Math.pow(a, n) / fact;
  }
  const cFact = fact * (c > 1 ? c : 1);
  const lastTerm = Math.pow(a, c) / (cFact * (1.0 - rho));
  const p0 = 1.0 / (sumTerms + lastTerm);
  const probWait = lastTerm * p0;
  const lq = (probWait * rho) / (1.0 - rho);
  const l = lq + a;
  const wq = lq / arrivalRate;
  const w = wq + 1.0 / serviceRate;

  return {
    stable: true,
    utilization: rho,
    probWait,
    meanQueueLength: lq,
    meanSystemLength: l,
    meanWaitTime: wq,
    meanResponseTime: w,
  };
}

/**
 * Open Jackson Queueing Network solver:
 * Solves traffic equations lambda = gamma + P^T * lambda and computes per-node M/M/c metrics.
 */
export function solveJacksonNetwork(
  externalArrivals: readonly number[],
  routingMatrix: readonly (readonly number[])[],
  serviceRates: readonly number[],
  servers?: readonly number[],
): { stable: boolean; effectiveArrivals: Float64Array; nodes: MmcQueueResult[] } {
  const n = externalArrivals.length;
  // (I - P^T) * lambda = gamma
  const A = new Float64Array(n * n);
  const b = Float64Array.from(externalArrivals);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      A[i * n + j] = (i === j ? 1.0 : 0.0) - routingMatrix[j]![i]!;
    }
  }
  const effectiveArrivals = solveDenseLinear(A, b, n);
  const nodes: MmcQueueResult[] = [];
  let stable = true;
  for (let i = 0; i < n; i++) {
    const res = solveMmcQueue(effectiveArrivals[i]!, serviceRates[i]!, servers?.[i] ?? 1);
    if (!res.stable) stable = false;
    nodes.push(res);
  }
  return { stable, effectiveArrivals, nodes };
}
