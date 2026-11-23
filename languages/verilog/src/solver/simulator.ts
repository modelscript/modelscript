// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 1364 Stratified Event-Driven 4-State (`0/1/X/Z`) RTL Simulator.
 *
 * Implements:
 * - Active region (continuous `assign`, gate primitives, combinational `always`, blocking `=`)
 * - Non-blocking Assignment (NBA) update region (`<=`)
 * - Delta-cycle convergence up to `maxDeltaCycles`
 * - Edge detection (`posedge`: 0 -> 1, `negedge`: 1 -> 0)
 * - Hierarchical module instantiation
 * - Waveform trace recording per simulation step
 */

import type { LogicVal, VerilogDesign, VerilogExpr, VerilogModule, VerilogStmt } from "../types.js";
import {
  LogicVector,
  bitAnd,
  bitNot,
  bitOr,
  bitXor,
  evalGatePrimitive,
  vecAdd,
  vecBitwise,
  vecCompare,
  vecConcat,
  vecEqual,
  vecLogicalNot,
  vecMul,
  vecNot,
  vecShiftLeft,
  vecShiftRight,
  vecSub,
} from "./logic4.js";

export type StimulusValue = number | string | LogicVector;

export interface SimulationStepStimulus {
  time?: number | undefined;
  inputs: Record<string, StimulusValue>;
}

export interface SimulationSnapshot {
  step: number;
  time: number;
  signals: Record<string, string>;
  values: Record<string, number | undefined>;
}

export interface SimulationOptions {
  topModule?: string | undefined;
  maxDeltaCycles?: number | undefined;
}

interface PendingNBA {
  target: VerilogExpr;
  value: LogicVector;
}

interface ModuleInstanceState {
  mod: VerilogModule;
  prefix: string;
  signals: Map<string, LogicVector>;
  widths: Map<string, number>;
  lsbOffsets: Map<string, number>;
  params: Map<string, LogicVector>;
  prevSignals: Map<string, LogicVector>;
  children: Array<{
    instName: string;
    state: ModuleInstanceState;
    portBindings: Array<{ childPort: string; parentExpr: VerilogExpr; direction: "input" | "output" | "inout" }>;
  }>;
}

function toLogicVector(val: StimulusValue, width: number): LogicVector {
  if (val instanceof LogicVector) return val.resize(width);
  if (typeof val === "number") return LogicVector.fromInt(val, width);
  return LogicVector.fromBitString(val, width);
}

/**
 * Interactive & batch IEEE 1364 4-state RTL simulator.
 */
export class VerilogSimulator {
  private readonly modulesByName = new Map<string, VerilogModule>();
  private readonly root: ModuleInstanceState;
  private readonly maxDeltaCycles: number;
  private currentTime = 0;
  private stepCount = 0;
  private readonly trace: SimulationSnapshot[] = [];

  constructor(design: VerilogDesign, options?: SimulationOptions) {
    for (const m of design.modules) {
      this.modulesByName.set(m.name, m);
    }
    const topName = options?.topModule ?? design.modules[design.modules.length - 1]?.name;
    const topMod = topName ? this.modulesByName.get(topName) : undefined;
    if (!topMod) {
      throw new Error(`Top module '${topName ?? "(none)"}' not found in Verilog design.`);
    }
    this.maxDeltaCycles = options?.maxDeltaCycles ?? 64;
    this.root = this.instantiateModule(topMod, "");
    this.runInitialBlocks(this.root);
    this.converge(false);
  }

  private instantiateModule(
    mod: VerilogModule,
    prefix: string,
    paramOverrides?: Map<string, LogicVector>,
  ): ModuleInstanceState {
    const signals = new Map<string, LogicVector>();
    const widths = new Map<string, number>();
    const lsbOffsets = new Map<string, number>();
    const params = new Map<string, LogicVector>();

    const state: ModuleInstanceState = {
      mod,
      prefix,
      signals,
      widths,
      lsbOffsets,
      params,
      prevSignals: new Map(),
      children: [],
    };

    // Evaluate parameters
    for (const [pName, pDecl] of mod.parameters) {
      const override = paramOverrides?.get(pName);
      if (override) {
        params.set(pName, override);
      } else {
        params.set(pName, this.evalExpr(pDecl.value, state));
      }
    }

    // Initialize ports (default X for inputs/regs, Z for undriven wires)
    for (const [pName, pDecl] of mod.ports) {
      const w = pDecl.range ? Math.abs(pDecl.range.msb - pDecl.range.lsb) + 1 : 1;
      const lsb = pDecl.range ? Math.min(pDecl.range.msb, pDecl.range.lsb) : 0;
      widths.set(pName, w);
      lsbOffsets.set(pName, lsb);
      const initVal: LogicVal = pDecl.netKind === "reg" || pDecl.direction === "input" ? "X" : "Z";
      signals.set(pName, LogicVector.filled(w, initVal));
    }

    // Initialize nets/regs
    for (const [nName, nDecl] of mod.nets) {
      const w = nDecl.range ? Math.abs(nDecl.range.msb - nDecl.range.lsb) + 1 : nDecl.kind === "integer" ? 32 : 1;
      const lsb = nDecl.range ? Math.min(nDecl.range.msb, nDecl.range.lsb) : 0;
      widths.set(nName, w);
      lsbOffsets.set(nName, lsb);
      if (nDecl.initialValue) {
        signals.set(nName, this.evalExpr(nDecl.initialValue, state).resize(w));
      } else if (!signals.has(nName)) {
        const initVal: LogicVal = nDecl.kind === "reg" || nDecl.kind === "integer" ? "X" : "Z";
        signals.set(nName, LogicVector.filled(w, initVal));
      }
    }

    for (const [k, v] of signals) {
      state.prevSignals.set(k, new LogicVector([...v.bits]));
    }

    // Instantiate child modules
    for (const item of mod.items) {
      if (item.kind === "instantiation") {
        const childMod = this.modulesByName.get(item.moduleType);
        if (!childMod) continue;
        const childParams = new Map<string, LogicVector>();
        const childParamNames = Array.from(childMod.parameters.keys());
        item.paramOverrides.forEach((ov, idx) => {
          const name = ov.name ?? childParamNames[idx];
          if (name) childParams.set(name, this.evalExpr(ov.expr, state));
        });
        const childState = this.instantiateModule(
          childMod,
          prefix ? `${prefix}.${item.instanceName}` : item.instanceName,
          childParams,
        );
        const portBindings: Array<{
          childPort: string;
          parentExpr: VerilogExpr;
          direction: "input" | "output" | "inout";
        }> = [];
        item.connections.forEach((conn, idx) => {
          const childPort = conn.portName ?? childMod.portOrder[idx];
          if (!childPort) return;
          const pDecl = childMod.ports.get(childPort);
          portBindings.push({
            childPort,
            parentExpr: conn.expr,
            direction: pDecl?.direction ?? "input",
          });
        });
        state.children.push({ instName: item.instanceName, state: childState, portBindings });
      }
    }

    return state;
  }

  private runInitialBlocks(state: ModuleInstanceState): void {
    const nbaQueue: PendingNBA[] = [];
    for (const item of state.mod.items) {
      if (item.kind === "initial") {
        this.execStmt(item.body, state, nbaQueue);
      }
    }
    this.commitNBA(state, nbaQueue);
    for (const child of state.children) {
      this.runInitialBlocks(child.state);
    }
  }

  /**
   * Drives a top-level input signal without advancing time.
   */
  setInput(name: string, value: StimulusValue): void {
    const w = this.root.widths.get(name) ?? 1;
    this.root.signals.set(name, toLogicVector(value, w));
  }

  /**
   * Returns the current 4-state `LogicVector` of a top-level signal.
   */
  getSignal(name: string): LogicVector {
    return this.root.signals.get(name) ?? LogicVector.filled(1, "X");
  }

  /**
   * Returns the current unsigned integer value of a top-level signal (or `undefined` if X/Z).
   */
  getInt(name: string): number | undefined {
    return this.getSignal(name).toUnsignedInt();
  }

  /**
   * Applies input stimulus, runs stratified Active + NBA delta-cycle convergence, and records a snapshot.
   */
  step(inputs: Record<string, StimulusValue> = {}, time?: number): SimulationSnapshot {
    this.snapshotPrevSignals(this.root);

    for (const [name, val] of Object.entries(inputs)) {
      this.setInput(name, val);
    }

    this.currentTime = time ?? this.currentTime + 1;
    this.stepCount += 1;

    this.converge(true);

    const signalsOut: Record<string, string> = {};
    const valuesOut: Record<string, number | undefined> = {};
    for (const [k, v] of this.root.signals) {
      signalsOut[k] = v.toBitString();
      valuesOut[k] = v.toUnsignedInt();
    }

    const snap: SimulationSnapshot = {
      step: this.stepCount,
      time: this.currentTime,
      signals: signalsOut,
      values: valuesOut,
    };
    this.trace.push(snap);
    return snap;
  }

  /**
   * Convenience helper to run a sequence of stimulus steps.
   */
  run(steps: SimulationStepStimulus[]): SimulationSnapshot[] {
    const out: SimulationSnapshot[] = [];
    for (const s of steps) {
      out.push(this.step(s.inputs, s.time));
    }
    return out;
  }

  getTrace(): readonly SimulationSnapshot[] {
    return this.trace;
  }

  private snapshotPrevSignals(state: ModuleInstanceState): void {
    for (const [k, v] of state.signals) {
      state.prevSignals.set(k, new LogicVector([...v.bits]));
    }
    for (const child of state.children) {
      this.snapshotPrevSignals(child.state);
    }
  }

  private converge(triggerSequential: boolean): void {
    // 1. Propagate inputs into children before edge detection
    this.propagateChildInputs(this.root);

    // 2. Evaluate sequential edge-triggered always blocks once per step (NBA queued)
    const nbaByState = new Map<ModuleInstanceState, PendingNBA[]>();
    if (triggerSequential) {
      this.evalSequentialTree(this.root, nbaByState);
    }

    // 3. Commit all NBAs simultaneously (IEEE 1364 NBA region)
    for (const [st, queue] of nbaByState) {
      this.commitNBA(st, queue);
    }

    // 4. Combinational delta-cycle fixed-point loop (assign, gates, comb always, hierarchy)
    for (let delta = 0; delta < this.maxDeltaCycles; delta++) {
      const changed = this.evalCombinationalTree(this.root);
      if (!changed) break;
    }
  }

  private propagateChildInputs(state: ModuleInstanceState): void {
    for (const child of state.children) {
      for (const b of child.portBindings) {
        if (b.direction === "input" || b.direction === "inout") {
          const val = this.evalExpr(b.parentExpr, state);
          const cw = child.state.widths.get(b.childPort) ?? val.width;
          child.state.signals.set(b.childPort, val.resize(cw));
        }
      }
      this.propagateChildInputs(child.state);
    }
  }

  private evalSequentialTree(state: ModuleInstanceState, nbaByState: Map<ModuleInstanceState, PendingNBA[]>): void {
    const queue: PendingNBA[] = [];
    for (const item of state.mod.items) {
      if (item.kind !== "always") continue;
      const isSeq = item.sensitivity.some((s) => s.kind === "posedge" || s.kind === "negedge");
      if (!isSeq) continue;

      let triggered = false;
      for (const sens of item.sensitivity) {
        if (sens.kind === "posedge" || sens.kind === "negedge") {
          const prev = state.prevSignals.get(sens.signal)?.bitAt(0) ?? "X";
          const curr = state.signals.get(sens.signal)?.bitAt(0) ?? "X";
          if (sens.kind === "posedge" && prev === "0" && curr === "1") triggered = true;
          if (sens.kind === "negedge" && prev === "1" && curr === "0") triggered = true;
        }
      }
      if (triggered) {
        this.execStmt(item.body, state, queue);
      }
    }
    if (queue.length > 0) {
      nbaByState.set(state, queue);
    }
    for (const child of state.children) {
      this.evalSequentialTree(child.state, nbaByState);
    }
  }

  private evalCombinationalTree(state: ModuleInstanceState): boolean {
    let changed = false;

    // Continuous assigns
    for (const item of state.mod.items) {
      if (item.kind === "assign") {
        const val = this.evalExpr(item.rhs, state);
        if (this.assignLValue(item.lhs, val, state)) changed = true;
      } else if (item.kind === "gate") {
        const outExpr = item.ports[0];
        if (!outExpr) continue;
        const inVals = item.ports.slice(1).map((p) => this.evalExpr(p, state).bitAt(0));
        const res = evalGatePrimitive(item.gateType, inVals);
        if (this.assignLValue(outExpr, new LogicVector([res]), state)) changed = true;
      } else if (item.kind === "always") {
        const isSeq = item.sensitivity.some((s) => s.kind === "posedge" || s.kind === "negedge");
        if (isSeq) continue;
        const before = new Map<string, LogicVector>();
        for (const [k, v] of state.signals) before.set(k, new LogicVector([...v.bits]));
        const nbaQueue: PendingNBA[] = [];
        this.execStmt(item.body, state, nbaQueue);
        this.commitNBA(state, nbaQueue);
        for (const [k, v] of state.signals) {
          const prev = before.get(k);
          if (!prev || !prev.equalsExact(v)) changed = true;
        }
      }
    }

    // Propagate child inputs -> evaluate children -> propagate child outputs
    for (const child of state.children) {
      for (const b of child.portBindings) {
        if (b.direction === "input" || b.direction === "inout") {
          const val = this.evalExpr(b.parentExpr, state);
          const cw = child.state.widths.get(b.childPort) ?? val.width;
          const next = val.resize(cw);
          const prev = child.state.signals.get(b.childPort);
          if (!prev || !prev.equalsExact(next)) {
            child.state.signals.set(b.childPort, next);
            changed = true;
          }
        }
      }

      if (this.evalCombinationalTree(child.state)) changed = true;

      for (const b of child.portBindings) {
        if (b.direction === "output" || b.direction === "inout") {
          const childVal = child.state.signals.get(b.childPort);
          if (childVal && this.assignLValue(b.parentExpr, childVal, state)) {
            changed = true;
          }
        }
      }
    }

    return changed;
  }

  private commitNBA(state: ModuleInstanceState, queue: PendingNBA[]): void {
    for (const item of queue) {
      this.assignLValue(item.target, item.value, state);
    }
  }

  private execStmt(stmt: VerilogStmt, state: ModuleInstanceState, nbaQueue: PendingNBA[]): void {
    switch (stmt.kind) {
      case "empty":
        break;
      case "block":
        for (const s of stmt.statements) this.execStmt(s, state, nbaQueue);
        break;
      case "blocking_assign": {
        const val = this.evalExpr(stmt.rhs, state);
        this.assignLValue(stmt.lhs, val, state);
        break;
      }
      case "nonblocking_assign": {
        const val = this.evalExpr(stmt.rhs, state);
        nbaQueue.push({ target: stmt.lhs, value: val });
        break;
      }
      case "if": {
        const cond = this.evalExpr(stmt.condition, state);
        if (cond.isTruthy()) {
          this.execStmt(stmt.consequent, state, nbaQueue);
        } else if (stmt.alternate) {
          this.execStmt(stmt.alternate, state, nbaQueue);
        }
        break;
      }
      case "case": {
        const sel = this.evalExpr(stmt.expression, state);
        let matched = false;
        let defaultItem: (typeof stmt.items)[number] | undefined;
        for (const ci of stmt.items) {
          if (ci.isDefault) {
            defaultItem = ci;
            continue;
          }
          for (const pat of ci.patterns) {
            const pVal = this.evalExpr(pat, state);
            const eq = vecEqual(sel, pVal, stmt.variant === "case");
            if (eq.bitAt(0) === "1") {
              this.execStmt(ci.statement, state, nbaQueue);
              matched = true;
              break;
            }
          }
          if (matched) break;
        }
        if (!matched && defaultItem) {
          this.execStmt(defaultItem.statement, state, nbaQueue);
        }
        break;
      }
    }
  }

  private assignLValue(lhs: VerilogExpr, value: LogicVector, state: ModuleInstanceState): boolean {
    if (lhs.kind === "identifier") {
      const w = state.widths.get(lhs.name) ?? value.width;
      const resized = value.resize(w);
      const prev = state.signals.get(lhs.name);
      if (prev && prev.equalsExact(resized)) return false;
      state.signals.set(lhs.name, resized);
      return true;
    }

    if (lhs.kind === "index" && lhs.target.kind === "identifier") {
      const idx = this.evalExpr(lhs.index, state).toUnsignedInt();
      if (idx === undefined) return false;
      const lsb = state.lsbOffsets.get(lhs.target.name) ?? 0;
      const bitPos = idx - lsb;
      const cur = state.signals.get(lhs.target.name);
      if (!cur || bitPos < 0 || bitPos >= cur.width) return false;
      const nextBit = value.bitAt(0);
      if (cur.bits[bitPos] === nextBit) return false;
      const copy = [...cur.bits];
      copy[bitPos] = nextBit;
      state.signals.set(lhs.target.name, new LogicVector(copy));
      return true;
    }

    if (lhs.kind === "slice" && lhs.target.kind === "identifier") {
      const msb = this.evalExpr(lhs.msb, state).toUnsignedInt();
      const lsbVal = this.evalExpr(lhs.lsb, state).toUnsignedInt();
      if (msb === undefined || lsbVal === undefined) return false;
      const baseLsb = state.lsbOffsets.get(lhs.target.name) ?? 0;
      const hi = Math.max(msb, lsbVal) - baseLsb;
      const lo = Math.min(msb, lsbVal) - baseLsb;
      const cur = state.signals.get(lhs.target.name);
      if (!cur) return false;
      const copy = [...cur.bits];
      let changed = false;
      for (let i = lo; i <= hi; i++) {
        if (i >= 0 && i < copy.length) {
          const nb = value.bitAt(i - lo);
          if (copy[i] !== nb) {
            copy[i] = nb;
            changed = true;
          }
        }
      }
      if (changed) state.signals.set(lhs.target.name, new LogicVector(copy));
      return changed;
    }

    if (lhs.kind === "concat") {
      // Assign from LSB (last element) to MSB (first element)
      let bitOffset = 0;
      let changed = false;
      for (let i = lhs.elements.length - 1; i >= 0; i--) {
        const el = lhs.elements[i]!;
        const elW = this.getLValueWidth(el, state);
        const sliceBits: LogicVal[] = [];
        for (let k = 0; k < elW; k++) {
          sliceBits.push(value.bitAt(bitOffset + k));
        }
        bitOffset += elW;
        if (this.assignLValue(el, new LogicVector(sliceBits), state)) changed = true;
      }
      return changed;
    }

    return false;
  }

  private getLValueWidth(lhs: VerilogExpr, state: ModuleInstanceState): number {
    if (lhs.kind === "identifier") return state.widths.get(lhs.name) ?? 1;
    if (lhs.kind === "index") return 1;
    if (lhs.kind === "slice") {
      const msb = this.evalExpr(lhs.msb, state).toUnsignedInt() ?? 0;
      const lsb = this.evalExpr(lhs.lsb, state).toUnsignedInt() ?? 0;
      return Math.abs(msb - lsb) + 1;
    }
    if (lhs.kind === "concat") {
      return lhs.elements.reduce((acc, el) => acc + this.getLValueWidth(el, state), 0);
    }
    return 1;
  }

  private evalExpr(expr: VerilogExpr, state: ModuleInstanceState): LogicVector {
    switch (expr.kind) {
      case "number":
        return LogicVector.fromSizedLiteral(expr.base ?? "d", expr.digits, expr.width);

      case "identifier": {
        const param = state.params.get(expr.name);
        if (param) return param;
        return state.signals.get(expr.name) ?? LogicVector.filled(1, "X");
      }

      case "index": {
        const target = this.evalExpr(expr.target, state);
        const idx = this.evalExpr(expr.index, state).toUnsignedInt();
        if (idx === undefined) return new LogicVector(["X"]);
        const lsb = expr.target.kind === "identifier" ? (state.lsbOffsets.get(expr.target.name) ?? 0) : 0;
        return new LogicVector([target.bitAt(idx - lsb)]);
      }

      case "slice": {
        const target = this.evalExpr(expr.target, state);
        const msb = this.evalExpr(expr.msb, state).toUnsignedInt();
        const lsbVal = this.evalExpr(expr.lsb, state).toUnsignedInt();
        if (msb === undefined || lsbVal === undefined) return new LogicVector(["X"]);
        const baseLsb = expr.target.kind === "identifier" ? (state.lsbOffsets.get(expr.target.name) ?? 0) : 0;
        return target.slice(msb - baseLsb, lsbVal - baseLsb);
      }

      case "unary": {
        const v = this.evalExpr(expr.operand, state);
        switch (expr.op) {
          case "+":
            return v;
          case "-": {
            const n = v.toUnsignedInt();
            return n === undefined ? LogicVector.filled(v.width, "X") : LogicVector.fromInt(-n, v.width);
          }
          case "~":
            return vecNot(v);
          case "!":
            return vecLogicalNot(v);
          case "&":
            return new LogicVector([v.bits.reduce((a, b) => bitAnd(a, b), "1" as LogicVal)]);
          case "~&":
            return new LogicVector([bitNot(v.bits.reduce((a, b) => bitAnd(a, b), "1" as LogicVal))]);
          case "|":
            return new LogicVector([v.bits.reduce((a, b) => bitOr(a, b), "0" as LogicVal)]);
          case "~|":
            return new LogicVector([bitNot(v.bits.reduce((a, b) => bitOr(a, b), "0" as LogicVal))]);
          case "^":
            return new LogicVector([v.bits.reduce((a, b) => bitXor(a, b), "0" as LogicVal)]);
          case "~^":
          case "^~":
            return new LogicVector([bitNot(v.bits.reduce((a, b) => bitXor(a, b), "0" as LogicVal))]);
        }
        return v;
      }

      case "binary": {
        const l = this.evalExpr(expr.left, state);
        const r = this.evalExpr(expr.right, state);
        switch (expr.op) {
          case "+":
            return vecAdd(l, r);
          case "-":
            return vecSub(l, r);
          case "*":
            return vecMul(l, r);
          case "/": {
            const vl = l.toUnsignedInt();
            const vr = r.toUnsignedInt();
            if (vl === undefined || vr === undefined || vr === 0) {
              return LogicVector.filled(Math.max(l.width, r.width), "X");
            }
            return LogicVector.fromInt(Math.trunc(vl / vr), Math.max(l.width, r.width));
          }
          case "%": {
            const vl = l.toUnsignedInt();
            const vr = r.toUnsignedInt();
            if (vl === undefined || vr === undefined || vr === 0) {
              return LogicVector.filled(Math.max(l.width, r.width), "X");
            }
            return LogicVector.fromInt(vl % vr, Math.max(l.width, r.width));
          }
          case "&":
          case "|":
          case "^":
          case "~^":
          case "^~":
            return vecBitwise(expr.op, l, r);
          case "&&": {
            const lb: LogicVal = l.isTruthy() ? "1" : l.hasUnknown() ? "X" : "0";
            const rb: LogicVal = r.isTruthy() ? "1" : r.hasUnknown() ? "X" : "0";
            return new LogicVector([bitAnd(lb, rb)]);
          }
          case "||": {
            const lb: LogicVal = l.isTruthy() ? "1" : l.hasUnknown() ? "X" : "0";
            const rb: LogicVal = r.isTruthy() ? "1" : r.hasUnknown() ? "X" : "0";
            return new LogicVector([bitOr(lb, rb)]);
          }
          case "==":
            return vecEqual(l, r, false);
          case "!=":
            return vecNot(vecEqual(l, r, false));
          case "===":
            return vecEqual(l, r, true);
          case "!==":
            return vecNot(vecEqual(l, r, true));
          case "<":
          case "<=":
          case ">":
          case ">=":
            return vecCompare(expr.op, l, r);
          case "<<":
          case "<<<":
            return vecShiftLeft(l, r);
          case ">>":
          case ">>>":
            return vecShiftRight(l, r);
        }
        return l;
      }

      case "ternary": {
        const c = this.evalExpr(expr.condition, state);
        if (c.isTruthy()) return this.evalExpr(expr.consequent, state);
        if (!c.hasUnknown()) return this.evalExpr(expr.alternate, state);
        // IEEE 1364 ambiguous condition: bit-by-bit merge
        const t = this.evalExpr(expr.consequent, state);
        const f = this.evalExpr(expr.alternate, state);
        const w = Math.max(t.width, f.width);
        const lt = t.resize(w);
        const lf = f.resize(w);
        return new LogicVector(lt.bits.map((b, i) => (b === lf.bits[i] ? b : "X")));
      }

      case "concat":
        return vecConcat(expr.elements.map((e) => this.evalExpr(e, state)));

      case "replicate": {
        const count = this.evalExpr(expr.count, state).toUnsignedInt() ?? 0;
        const inner = vecConcat(expr.elements.map((e) => this.evalExpr(e, state)));
        const repeated: LogicVector[] = [];
        for (let i = 0; i < count; i++) repeated.push(inner);
        return repeated.length > 0 ? vecConcat(repeated) : new LogicVector(["0"]);
      }
    }
  }
}

/**
 * Convenience function to simulate a `VerilogDesign` over a sequence of stimulus steps.
 */
export function simulateVerilog(
  design: VerilogDesign,
  steps: SimulationStepStimulus[],
  options?: SimulationOptions,
): SimulationSnapshot[] {
  const sim = new VerilogSimulator(design, options);
  return sim.run(steps);
}
