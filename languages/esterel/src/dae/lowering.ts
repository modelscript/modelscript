// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Direct Mealy FSM / Clocked DAE Arena Lowering for Esterel Modules.
 *
 * Translates Esterel reactive control points (Berry's constructive circuit translation)
 * and signal emission guards directly into `@modelscript/runtime`'s `IDaeBuilder`
 * linear-memory representation without intermediate AST wrapper allocations.
 */

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  type IDaeBuilder,
  UnaryOp,
  VarType,
  Variability,
} from "@modelscript/runtime";
import { ensureBuiltInEsterelLibraryRegistered } from "../catalog/library-package-adapter.js";
import { parseEsterel } from "../parser/esterel-parser.js";
import type { EsterelModule, EsterelProgram, EsterelSignalExpr, EsterelStatement } from "../types.js";

export interface EsterelDaeLoweringResult {
  moduleName: string;
  stateVarIndices: number[];
  signalVarIndices: number[];
  equationCount: number;
  variableMap: Map<string, number>;
  controlRegisters: string[];
}

export interface EsterelToDaeOptions {
  moduleName?: string | undefined;
}

interface WireResult {
  /** Expression ID for instantaneous termination (0-tick completion). */
  terminated: number;
  /** Expression ID indicating at least one register inside this subtree is selected/active. */
  selected: number;
}

/**
 * Lowers an Esterel module into clocked discrete equations in `IDaeBuilder`.
 */
export function lowerEsterelToDae(
  builder: IDaeBuilder,
  programOrSource: EsterelProgram | EsterelModule | string,
  options: EsterelToDaeOptions = {},
): EsterelDaeLoweringResult {
  ensureBuiltInEsterelLibraryRegistered();

  let mod: EsterelModule | undefined;
  if (typeof programOrSource === "string") {
    const prog = parseEsterel(programOrSource);
    mod = options.moduleName ? prog.modules.find((m) => m.name === options.moduleName) : prog.modules[0];
  } else if ("modules" in programOrSource) {
    mod = options.moduleName
      ? programOrSource.modules.find((m) => m.name === options.moduleName)
      : programOrSource.modules[0];
  } else {
    mod = programOrSource;
  }

  if (!mod) {
    throw new Error(
      options.moduleName
        ? `Esterel module '${options.moduleName}' not found for DAE lowering.`
        : "No Esterel module found for DAE lowering.",
    );
  }

  const variableMap = new Map<string, number>();
  const stateVarIndices: number[] = [];
  const signalVarIndices: number[] = [];
  const controlRegisters: string[] = [];
  const signalEmitGuards = new Map<string, number[]>();
  let equationCount = 0;
  let regCounter = 0;

  const FALSE_EXPR = builder.addBoolLiteral(false);
  const TRUE_EXPR = builder.addBoolLiteral(true);

  function addOr(a: number, b: number): number {
    if (a === FALSE_EXPR) return b;
    if (b === FALSE_EXPR) return a;
    if (a === TRUE_EXPR || b === TRUE_EXPR) return TRUE_EXPR;
    return builder.addBinaryExpr(BinOp.Or, a, b);
  }

  function addAnd(a: number, b: number): number {
    if (a === FALSE_EXPR || b === FALSE_EXPR) return FALSE_EXPR;
    if (a === TRUE_EXPR) return b;
    if (b === TRUE_EXPR) return a;
    return builder.addBinaryExpr(BinOp.And, a, b);
  }

  function addNot(a: number): number {
    if (a === FALSE_EXPR) return TRUE_EXPR;
    if (a === TRUE_EXPR) return FALSE_EXPR;
    return builder.addUnaryExpr(UnaryOp.Not, a);
  }

  function addSignalVar(name: string, causality: Causality): number {
    const existing = variableMap.get(name);
    if (existing !== undefined) return existing;
    const idx = builder.addVariable(name, VarType.Boolean, Variability.Discrete, causality, 0.0);
    variableMap.set(name, idx);
    signalVarIndices.push(idx);
    return idx;
  }

  function allocRegister(label: string, startVal = 0.0): number {
    const name = `reg_${label}_${regCounter++}`;
    const idx = builder.addVariable(name, VarType.Boolean, Variability.Discrete, Causality.Local, startVal);
    variableMap.set(name, idx);
    stateVarIndices.push(idx);
    controlRegisters.push(name);
    return idx;
  }

  // Boot register: true on initial instant (tick 0), false thereafter
  const bootReg = allocRegister("boot", 1.0);
  const bootExpr = builder.addName(bootReg);

  // 1. Register interface signals
  for (const sig of mod.signals) {
    const causality =
      sig.direction === "input" || sig.direction === "sensor"
        ? Causality.Input
        : sig.direction === "output"
          ? Causality.Output
          : Causality.Local;
    addSignalVar(sig.name, causality);
    if (sig.direction === "output" || sig.direction === "inputoutput") {
      signalEmitGuards.set(sig.name, []);
    }
  }

  function recordEmission(sigName: string, guardExpr: number): void {
    if (!variableMap.has(sigName)) {
      addSignalVar(sigName, Causality.Local);
    }
    const list = signalEmitGuards.get(sigName) ?? [];
    list.push(guardExpr);
    signalEmitGuards.set(sigName, list);
  }

  function lowerSignalExpr(expr: EsterelSignalExpr): number {
    switch (expr.kind) {
      case "tick":
        return TRUE_EXPR;
      case "signal": {
        const idx = variableMap.get(expr.name) ?? addSignalVar(expr.name, Causality.Local);
        return builder.addName(idx);
      }
      case "not":
        return addNot(lowerSignalExpr(expr.operand));
      case "and":
        return addAnd(lowerSignalExpr(expr.left), lowerSignalExpr(expr.right));
      case "or":
        return addOr(lowerSignalExpr(expr.left), lowerSignalExpr(expr.right));
    }
  }

  /**
   * Berry's constructive circuit lowering:
   * - `go`: expression true when this statement is entered in the current instant
   * - `res`: expression true when this statement is resumed from a paused register
   * - `kill`: expression true when an enclosing preemption kills this statement
   */
  function lowerStmt(stmt: EsterelStatement, go: number, res: number, kill: number): WireResult {
    const alive = addNot(kill);

    switch (stmt.kind) {
      case "nothing":
        return { terminated: go, selected: FALSE_EXPR };

      case "emit": {
        recordEmission(stmt.signal, addAnd(go, alive));
        return { terminated: go, selected: FALSE_EXPR };
      }

      case "pause": {
        const reg = allocRegister("pause", 0.0);
        const regName = builder.addName(reg);
        // Next register state: entered now and not killed
        const nextReg = addAnd(go, alive);
        builder.addEquation(EqKind.Simple, regName, nextReg);
        equationCount++;
        const resumed = addAnd(regName, res);
        return { terminated: addAnd(resumed, alive), selected: regName };
      }

      case "halt": {
        const reg = allocRegister("halt", 0.0);
        const regName = builder.addName(reg);
        const stayActive = addAnd(addOr(go, addAnd(regName, res)), alive);
        builder.addEquation(EqKind.Simple, regName, stayActive);
        equationCount++;
        return { terminated: FALSE_EXPR, selected: regName };
      }

      case "sustain": {
        const reg = allocRegister(`sustain_${stmt.signal}`, 0.0);
        const regName = builder.addName(reg);
        const active = addAnd(addOr(go, addAnd(regName, res)), alive);
        recordEmission(stmt.signal, active);
        builder.addEquation(EqKind.Simple, regName, active);
        equationCount++;
        return { terminated: FALSE_EXPR, selected: regName };
      }

      case "present": {
        const cond = lowerSignalExpr(stmt.expr);
        const thenWire = lowerStmt(stmt.thenBranch, addAnd(go, cond), res, kill);
        const elseWire = stmt.elseBranch
          ? lowerStmt(stmt.elseBranch, addAnd(go, addNot(cond)), res, kill)
          : { terminated: addAnd(go, addNot(cond)), selected: FALSE_EXPR };
        return {
          terminated: addOr(thenWire.terminated, elseWire.terminated),
          selected: addOr(thenWire.selected, elseWire.selected),
        };
      }

      case "await": {
        const reg = allocRegister("await", 0.0);
        const regName = builder.addName(reg);
        const trig = lowerSignalExpr(stmt.expr);
        const waiting = addAnd(regName, res);
        const fire = stmt.immediate ? addAnd(addOr(go, waiting), trig) : addAnd(waiting, trig);
        const stayWaiting = addAnd(addAnd(addOr(go, waiting), addNot(fire)), alive);
        builder.addEquation(EqKind.Simple, regName, stayWaiting);
        equationCount++;

        if (stmt.body) {
          const bodyWire = lowerStmt(stmt.body, addAnd(fire, alive), res, kill);
          return {
            terminated: bodyWire.terminated,
            selected: addOr(regName, bodyWire.selected),
          };
        }
        return { terminated: addAnd(fire, alive), selected: regName };
      }

      case "seq": {
        let curGo = go;
        let selected = FALSE_EXPR;
        for (const s of stmt.statements) {
          const w = lowerStmt(s, curGo, res, kill);
          curGo = w.terminated;
          selected = addOr(selected, w.selected);
        }
        return { terminated: curGo, selected };
      }

      case "par": {
        const wires = stmt.branches.map((b) => lowerStmt(b, go, res, kill));
        let allTerm = TRUE_EXPR;
        let anySel = FALSE_EXPR;
        for (const w of wires) {
          allTerm = addAnd(allTerm, w.terminated);
          anySel = addOr(anySel, w.selected);
        }
        return { terminated: allTerm, selected: anySel };
      }

      case "loop": {
        if (stmt.eachExpr) {
          const resetSig = lowerSignalExpr(stmt.eachExpr);
          const reg = allocRegister("loop_each", 0.0);
          const regName = builder.addName(reg);
          const restart = addAnd(addAnd(regName, res), resetSig);
          const bodyKill = addOr(kill, restart);
          const bodyWire = lowerStmt(stmt.body, addOr(go, restart), res, bodyKill);
          const keepLoop = addAnd(addOr(go, addAnd(regName, res)), alive);
          builder.addEquation(EqKind.Simple, regName, keepLoop);
          equationCount++;
          return { terminated: FALSE_EXPR, selected: addOr(regName, bodyWire.selected) };
        }
        const bodyWire = lowerStmt(stmt.body, go, res, kill);
        return { terminated: FALSE_EXPR, selected: bodyWire.selected };
      }

      case "every": {
        const reg = allocRegister("every", 0.0);
        const regName = builder.addName(reg);
        const trig = lowerSignalExpr(stmt.expr);
        const active = addAnd(regName, res);
        const triggerNow = stmt.immediate ? addAnd(addOr(go, active), trig) : addAnd(active, trig);
        const bodyWire = lowerStmt(stmt.body, triggerNow, res, addOr(kill, triggerNow));
        builder.addEquation(EqKind.Simple, regName, addAnd(addOr(go, active), alive));
        equationCount++;
        return { terminated: FALSE_EXPR, selected: addOr(regName, bodyWire.selected) };
      }

      case "abort": {
        const trig = lowerSignalExpr(stmt.expr);
        const abortActive = stmt.immediate ? addOr(go, res) : res;
        const preempt = addAnd(abortActive, trig);
        const bodyKill = stmt.weak ? kill : addOr(kill, preempt);
        const bodyWire = lowerStmt(stmt.body, go, res, bodyKill);
        if (stmt.handler) {
          const hWire = lowerStmt(stmt.handler, addAnd(preempt, alive), res, kill);
          return {
            terminated: addOr(bodyWire.terminated, hWire.terminated),
            selected: addOr(bodyWire.selected, hWire.selected),
          };
        }
        return {
          terminated: addOr(bodyWire.terminated, addAnd(preempt, alive)),
          selected: bodyWire.selected,
        };
      }

      case "suspend": {
        const trig = lowerSignalExpr(stmt.expr);
        const suspActive = stmt.immediate ? addOr(go, res) : res;
        const frozen = addAnd(suspActive, trig);
        const bodyRes = addAnd(res, addNot(frozen));
        return lowerStmt(stmt.body, go, bodyRes, kill);
      }

      case "trap": {
        const bodyWire = lowerStmt(stmt.body, go, res, kill);
        let term = bodyWire.terminated;
        let sel = bodyWire.selected;
        for (const h of stmt.handlers) {
          const hw = lowerStmt(h.body, FALSE_EXPR, res, kill);
          term = addOr(term, hw.terminated);
          sel = addOr(sel, hw.selected);
        }
        return { terminated: term, selected: sel };
      }

      case "exit":
        return { terminated: go, selected: FALSE_EXPR };

      case "signal": {
        for (const s of stmt.signals) {
          addSignalVar(s.name, Causality.Local);
          if (!signalEmitGuards.has(s.name)) {
            signalEmitGuards.set(s.name, []);
          }
        }
        return lowerStmt(stmt.body, go, res, kill);
      }

      case "run":
        return { terminated: go, selected: FALSE_EXPR };
    }
  }

  // Lower module body driven by boot / resume
  const resExpr = addNot(bootExpr);
  lowerStmt(mod.body, bootExpr, resExpr, FALSE_EXPR);

  // Boot register resets to false after initial instant
  builder.addEquation(EqKind.Simple, bootExpr, FALSE_EXPR);
  equationCount++;

  // Emit clocked status equations for all output and local signals
  for (const [sigName, guards] of signalEmitGuards) {
    const sigIdx = variableMap.get(sigName);
    if (sigIdx === undefined) continue;
    let combined = FALSE_EXPR;
    for (const g of guards) {
      combined = addOr(combined, g);
    }
    builder.addEquation(EqKind.Simple, builder.addName(sigIdx), combined);
    equationCount++;
  }

  return {
    moduleName: mod.name,
    stateVarIndices,
    signalVarIndices,
    equationCount,
    variableMap,
    controlRegisters,
  };
}

/**
 * Convenience entry point: creates a `DAEBuilder` and lowers an Esterel module into it.
 */
export function esterelToDae(
  programOrSource: EsterelProgram | EsterelModule | string,
  options: EsterelToDaeOptions = {},
): { builder: DAEBuilder; result: EsterelDaeLoweringResult } {
  const prog = typeof programOrSource === "string" ? parseEsterel(programOrSource) : programOrSource;
  const modName = options.moduleName ?? ("modules" in prog ? prog.modules[0]?.name : prog.name) ?? "EsterelModule";
  const safeName = modName.replace(/[^A-Za-z0-9_]/g, "_");
  const builder = new DAEBuilder(undefined, safeName);
  const result = lowerEsterelToDae(builder, prog, { moduleName: modName });
  return { builder, result };
}
