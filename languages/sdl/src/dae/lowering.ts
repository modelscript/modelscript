// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct DAE Arena Lowering for ITU-T Z.100 SDL-88 Extended Finite State Machines & Timers.
 *
 * Lowers SDL processes, state encodings, DCL variables, signal queues, and timer
 * countdown dynamics directly into `@modelscript/runtime`'s `IDaeBuilder` linear memory
 * without allocating intermediate AST wrapper objects.
 */

import { BinOp, Causality, EqKind, type IDaeBuilder, VarType, Variability } from "@modelscript/runtime";
import { ensureBuiltInSdlLibraryRegistered } from "../catalog/library-package-adapter.js";
import type { SdlProcessDecl, SdlSystemModel } from "../types.js";

export interface SdlDaeLoweringResult {
  stateVarIndices: number[];
  timerVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  stateEncoding: Map<string, Map<string, number>>;
}

function mapSortToVarType(sort: string): VarType {
  switch (sort.toUpperCase()) {
    case "BOOLEAN":
      return VarType.Boolean;
    case "INTEGER":
    case "NATURAL":
    case "PID":
      return VarType.Integer;
    case "CHARSTRING":
    case "CHARACTER":
      return VarType.String;
    case "REAL":
    case "DURATION":
    case "TIME":
    default:
      return VarType.Real;
  }
}

function parseNumericInit(raw: string | undefined, varType: VarType): number {
  if (!raw) return 0;
  const trimmed = raw.trim().toUpperCase();
  if (varType === VarType.Boolean) {
    return trimmed === "TRUE" || trimmed === "1" ? 1 : 0;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : 0;
}

function buildStateIndexMap(proc: SdlProcessDecl): Map<string, number> {
  const map = new Map<string, number>();
  let idx = 1;
  for (const st of proc.states) {
    for (const name of st.names) {
      if (name === "*") continue;
      const up = name.toUpperCase();
      if (!map.has(up)) {
        map.set(up, idx++);
      }
    }
  }
  return map;
}

/**
 * Lowers an SDL-88 `SdlSystemModel` directly into an `IDaeBuilder` linear-memory arena.
 */
export function lowerSdlToDae(builder: IDaeBuilder, model: SdlSystemModel): SdlDaeLoweringResult {
  ensureBuiltInSdlLibraryRegistered();
  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const timerVarIndices: number[] = [];
  const stateEncoding = new Map<string, Map<string, number>>();
  let equationCount = 0;

  function addVar(
    name: string,
    varType: VarType,
    variability: Variability,
    causality: Causality = Causality.Local,
    startVal = 0.0,
  ): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const lookup = builder.lookupVariable(name);
    if (lookup !== -1) {
      variableMap.set(name, lookup);
      return lookup;
    }
    const idx = builder.addVariable(name, varType, variability, causality, startVal);
    variableMap.set(name, idx);
    return idx;
  }

  // 1. Lower channels as propagation delay parameters & traffic counters
  for (const ch of model.channels) {
    const delayVal = ch.noDelay ? 0.0 : (ch.delaySeconds ?? 0.01);
    const delayVar = addVar(`ch_${ch.name}_delay`, VarType.Real, Variability.Parameter, Causality.Local, delayVal);
    builder.addEquation(EqKind.Simple, builder.addName(delayVar), builder.addRealLiteral(delayVal));
    equationCount++;
  }

  // 2. Lower blocks and processes
  for (const block of model.blocks) {
    for (const proc of block.processes) {
      const prefix = `${block.name}_${proc.name}`;
      const stateMap = buildStateIndexMap(proc);
      stateEncoding.set(prefix, stateMap);

      // Initial state from START transition
      let initStateCode = 1;
      if (proc.start?.terminator?.kind === "nextstate") {
        initStateCode = stateMap.get(proc.start.terminator.targetState.toUpperCase()) ?? 1;
      }

      // Discrete EFSM state variable
      const stateVar = addVar(`${prefix}_state`, VarType.Integer, Variability.Discrete, Causality.Local, initStateCode);
      stateVarIndices.push(stateVar);

      // Active flag (1 while running, 0 when STOP reached)
      const activeVar = addVar(`${prefix}_active`, VarType.Integer, Variability.Discrete, Causality.Local, 1);

      // Per-state one-hot indicator equations: active_S = (state == code ? 1 : 0) approximated linearly for DAE
      const stateCountVar = addVar(
        `${prefix}_state_count`,
        VarType.Integer,
        Variability.Parameter,
        Causality.Local,
        stateMap.size,
      );
      builder.addEquation(EqKind.Simple, builder.addName(stateCountVar), builder.addIntLiteral(stateMap.size));
      equationCount++;

      // Process FIFO queue depth discrete variable
      const queueVar = addVar(`${prefix}_queue_len`, VarType.Integer, Variability.Discrete, Causality.Local, 0);
      builder.addEquation(
        EqKind.Simple,
        builder.addName(queueVar),
        builder.addBinaryExpr(BinOp.Mul, builder.addName(activeVar), builder.addIntLiteral(0)),
      );
      equationCount++;

      // Lower DCL local variables
      for (const v of proc.variables) {
        const vt = mapSortToVarType(v.sort);
        const initVal = parseNumericInit(v.initialValue, vt);
        const varIdx = addVar(`${prefix}_${v.name}`, vt, Variability.Discrete, Causality.Local, initVal);
        if (vt === VarType.Real) {
          builder.addEquation(EqKind.Simple, builder.addName(varIdx), builder.addRealLiteral(initVal));
          equationCount++;
        } else if (vt === VarType.Integer || vt === VarType.Boolean) {
          builder.addEquation(EqKind.Simple, builder.addName(varIdx), builder.addIntLiteral(Math.trunc(initVal)));
          equationCount++;
        }
      }

      // Lower TIMER declarations as continuous countdown states:
      //   der(timer_rem) = -timer_active
      for (const t of proc.timers) {
        const dur = t.defaultDuration ?? 1.0;
        const durParam = addVar(
          `${prefix}_${t.name}_duration`,
          VarType.Real,
          Variability.Parameter,
          Causality.Local,
          dur,
        );
        const tActive = addVar(`${prefix}_${t.name}_active`, VarType.Real, Variability.Discrete, Causality.Local, 0.0);
        const tRem = addVar(`${prefix}_${t.name}_rem`, VarType.Real, Variability.Continuous, Causality.Local, 0.0);
        timerVarIndices.push(tRem);

        // Parameter binding equation
        builder.addEquation(EqKind.Simple, builder.addName(durParam), builder.addRealLiteral(dur));
        equationCount++;

        // Continuous countdown ODE: der(tRem) = -1.0 * tActive
        const derRem = builder.addDer(tRem);
        const negActive = builder.addBinaryExpr(BinOp.Mul, builder.addRealLiteral(-1.0), builder.addName(tActive));
        builder.addEquation(EqKind.Simple, derRem, negActive);
        equationCount++;
      }
    }
  }

  return {
    stateVarIndices,
    timerVarIndices,
    equationCount,
    variableMap,
    stateEncoding,
  };
}
