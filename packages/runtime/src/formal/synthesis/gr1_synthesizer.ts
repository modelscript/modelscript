// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — GR(1) Reactive Controller Synthesizer (Piterman-Pnueli-Sa'ar).
 *
 * Solves Generalized Reactivity(1) two-player turn-based safety/liveness games:
 *   Env chooses input `e`, Sys responds with action `s` transitioning to `nextState`.
 *   Winning condition: (forall i, GF envJustice[i]) -> (forall j, GF sysJustice[j])
 *   while staying within safe states.
 *
 * Returns realizability, winning region, and a memory-indexed Mealy supervisor strategy
 * suitable for code generation into Modelica state machines, PLCopen ST, or AUTOSAR.
 */

export interface Gr1GameSpec {
  readonly numStates: number;
  readonly initialStates: readonly number[];
  /** Allowed safety states (defaults to all states). */
  readonly safeStates?: readonly number[] | undefined;
  /**
   * Transitions: for each state `q`, a list of environment moves;
   * each environment move is a list of possible system next states (choices).
   * Sys wins the 1-step controllable predecessor `CPre(T)` from `q` iff
   * for EVERY env move available at `q`, there EXISTS a system choice leading into `T`.
   */
  readonly transitions: readonly (readonly (readonly number[])[])[];
  /** Environment liveness assumptions (sets of states visited infinitely often). */
  readonly envJustice: readonly (readonly number[])[];
  /** System liveness guarantees (sets of states to visit infinitely often). */
  readonly sysJustice: readonly (readonly number[])[];
}

export interface Gr1SynthesisResult {
  readonly realizable: boolean;
  readonly winningRegion: number[];
  /** Strategy: strategy[goalIdx][state][envMoveIdx] = chosen nextState. */
  readonly strategy: number[][][];
  readonly fixedPointIterations: number;
}

/**
 * Synthesizes a winning GR(1) reactive supervisor strategy via the canonical
 * nu Z . bigcap_j mu Y . bigcup_i nu X fixed-point computation.
 */
export function synthesizeGr1(spec: Gr1GameSpec): Gr1SynthesisResult {
  const n = spec.numStates;
  const safeMask = new Uint8Array(n);
  if (spec.safeStates) {
    for (const s of spec.safeStates) {
      if (s >= 0 && s < n) safeMask[s] = 1;
    }
  } else {
    safeMask.fill(1);
  }

  const sysGoals = spec.sysJustice.length > 0 ? spec.sysJustice : [Array.from({ length: n }, (_, i) => i)];
  const envAssumps = spec.envJustice.length > 0 ? spec.envJustice : [Array.from({ length: n }, (_, i) => i)];
  const numGoals = sysGoals.length;
  const numAssumps = envAssumps.length;

  const sysGoalMasks = sysGoals.map((g) => {
    const m = new Uint8Array(n);
    for (const s of g) if (s >= 0 && s < n) m[s] = 1;
    return m;
  });
  const envAssumpMasks = envAssumps.map((a) => {
    const m = new Uint8Array(n);
    for (const s of a) if (s >= 0 && s < n) m[s] = 1;
    return m;
  });

  /** Controllable predecessor CPre(target): safe states where for every env move, some sys choice lands in target. */
  const cpre = (target: Uint8Array): Uint8Array => {
    const out = new Uint8Array(n);
    for (let q = 0; q < n; q++) {
      if (!safeMask[q]) continue;
      const envMoves = spec.transitions[q] ?? [];
      if (envMoves.length === 0) continue;
      let allEnvHandled = true;
      for (let e = 0; e < envMoves.length; e++) {
        const sysChoices = envMoves[e]!;
        let hasWinChoice = false;
        for (let c = 0; c < sysChoices.length; c++) {
          const nextQ = sysChoices[c]!;
          if (safeMask[nextQ] && target[nextQ]) {
            hasWinChoice = true;
            break;
          }
        }
        if (!hasWinChoice) {
          allEnvHandled = false;
          break;
        }
      }
      if (allEnvHandled) out[q] = 1;
    }
    return out;
  };

  const equalMasks = (a: Uint8Array, b: Uint8Array): boolean => {
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  // Greatest fixed point Z (initialized to all safe states)
  let Z = new Uint8Array(safeMask);
  // Store Y-ranks per goal for strategy extraction
  let yRanks: Uint8Array[][] = Array.from({ length: numGoals }, () => []);
  let iterations = 0;

  while (iterations < n * numGoals + 10) {
    iterations++;
    const Zprev = new Uint8Array(Z);
    yRanks = Array.from({ length: numGoals }, () => []);

    for (let j = 0; j < numGoals; j++) {
      const startSet = new Uint8Array(n);
      const cpreZ = cpre(Z);
      for (let q = 0; q < n; q++) {
        startSet[q] = sysGoalMasks[j]![q]! && cpreZ[q]! ? 1 : 0;
      }

      // Least fixed point Y
      let Y = new Uint8Array(n);
      const ranksForJ: Uint8Array[] = [];

      while (true) {
        const Yprev = new Uint8Array(Y);
        const cpreY = cpre(Y);
        const nextY = new Uint8Array(n);

        for (let i = 0; i < numAssumps; i++) {
          // Greatest fixed point X (states that can avoid envAssump[i] while staying in Z)
          let X = new Uint8Array(Z);
          while (true) {
            const Xprev = new Uint8Array(X);
            const cpreX = cpre(X);
            for (let q = 0; q < n; q++) {
              const inStartOrY = startSet[q]! || cpreY[q]!;
              const stayAvoidingEnv = !envAssumpMasks[i]![q]! && cpreX[q]!;
              X[q] = Z[q]! && (inStartOrY || stayAvoidingEnv) ? 1 : 0;
            }
            if (equalMasks(X, Xprev)) break;
          }
          for (let q = 0; q < n; q++) {
            if (X[q]) nextY[q] = 1;
          }
        }

        Y = nextY;
        ranksForJ.push(new Uint8Array(Y));
        if (equalMasks(Y, Yprev)) break;
      }

      yRanks[j] = ranksForJ;
      for (let q = 0; q < n; q++) {
        Z[q] = Z[q]! && Y[q]! ? 1 : 0;
      }
    }

    if (equalMasks(Z, Zprev)) break;
  }

  const winningRegion: number[] = [];
  for (let q = 0; q < n; q++) {
    if (Z[q]) winningRegion.push(q);
  }

  const realizable = spec.initialStates.length > 0 && spec.initialStates.every((q) => Z[q] === 1);

  // Extract Mealy strategy minimizing Y-rank toward current goal j (and advancing j when reached)
  const strategy: number[][][] = Array.from({ length: numGoals }, () => Array.from({ length: n }, () => []));

  if (realizable) {
    for (let j = 0; j < numGoals; j++) {
      const ranks = yRanks[j]!;
      for (let q = 0; q < n; q++) {
        if (!Z[q]) continue;
        const envMoves = spec.transitions[q] ?? [];
        const choicesForQ: number[] = new Array(envMoves.length).fill(-1);
        for (let e = 0; e < envMoves.length; e++) {
          const sysChoices = envMoves[e]!;
          let bestNext = -1;
          let bestRank = Infinity;
          for (const nextQ of sysChoices) {
            if (!Z[nextQ]) continue;
            let r = ranks.length;
            for (let ri = 0; ri < ranks.length; ri++) {
              if (ranks[ri]![nextQ]) {
                r = ri;
                break;
              }
            }
            if (r < bestRank) {
              bestRank = r;
              bestNext = nextQ;
            }
          }
          choicesForQ[e] = bestNext;
        }
        strategy[j]![q] = choicesForQ;
      }
    }
  }

  return {
    realizable,
    winningRegion,
    strategy,
    fixedPointIterations: iterations,
  };
}
