// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Exact analytical queuing formulas for M/M/1 and M/M/c (Erlang-C) systems
 * and Little's Law ($L = \lambda W$) verification helpers.
 */

export interface ErlangCResult {
  /** Number of parallel servers $c$. */
  servers: number;
  /** Arrival rate $\lambda$. */
  arrivalRate: number;
  /** Service rate per server $\mu$. */
  serviceRate: number;
  /** Offered traffic intensity $a = \lambda / \mu$ (Erlangs). */
  offeredLoad: number;
  /** Server utilization $\rho = \lambda / (c \mu)$. */
  utilization: number;
  /** Probability system is empty $P_0$. */
  p0: number;
  /** Erlang-C probability that an arriving customer must wait $C(c, a)$. */
  erlangC: number;
  /** Mean number of customers waiting in queue $L_q$. */
  meanQueueLength: number;
  /** Mean waiting time in queue $W_q$. */
  meanWaitTime: number;
  /** Mean total time in system $W = W_q + 1/\mu$. */
  meanSystemTime: number;
  /** Mean total number of customers in system $L = \lambda W = L_q + a$. */
  meanSystemCount: number;
}

/**
 * Computes exact steady-state Erlang-C metrics for an M/M/c queuing system.
 * Throws if the system is unstable ($\rho \ge 1$) or parameters are non-positive.
 */
export function computeErlangC(arrivalRate: number, serviceRate: number, servers: number = 1): ErlangCResult {
  if (servers < 1 || !Number.isInteger(servers)) {
    throw new Error(`Number of servers must be a positive integer, got ${servers}`);
  }
  if (arrivalRate <= 0 || serviceRate <= 0) {
    throw new Error(`Arrival rate (${arrivalRate}) and service rate (${serviceRate}) must be > 0`);
  }

  const offeredLoad = arrivalRate / serviceRate;
  const utilization = offeredLoad / servers;
  if (utilization >= 1.0) {
    throw new Error(`Unstable M/M/${servers} queue: utilization rho = ${utilization.toFixed(4)} >= 1`);
  }

  let sum = 1.0;
  let term = 1.0;
  for (let n = 1; n < servers; n++) {
    term *= offeredLoad / n;
    sum += term;
  }
  const cTerm = (term * offeredLoad) / servers;
  const tail = cTerm / (1.0 - utilization);
  const p0 = 1.0 / (sum + tail);
  const erlangC = tail * p0;

  const meanQueueLength = erlangC * (utilization / (1.0 - utilization));
  const meanWaitTime = meanQueueLength / arrivalRate;
  const meanSystemTime = meanWaitTime + 1.0 / serviceRate;
  const meanSystemCount = arrivalRate * meanSystemTime;

  return {
    servers,
    arrivalRate,
    serviceRate,
    offeredLoad,
    utilization,
    p0,
    erlangC,
    meanQueueLength,
    meanWaitTime,
    meanSystemTime,
    meanSystemCount,
  };
}

/**
 * Convenience wrapper for single-server M/M/1 exact analytical queuing metrics.
 */
export function computeMM1(arrivalRate: number, serviceRate: number): ErlangCResult {
  return computeErlangC(arrivalRate, serviceRate, 1);
}
