// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Event-Driven Delta-Cycle 9-Value (`std_logic`) RTL Simulator for `@modelscript/vhdl`.
 *
 * Implements IEEE 1076 delta-cycle semantics:
 * - Signal assignments (`<=`) schedule updates for the end of the current delta cycle.
 * - Variable assignments (`:=`) take effect immediately inside a process.
 * - Multiple concurrent drivers on resolved signals (`std_logic`) use IEEE 1164 resolution.
 * - `rising_edge(clk)` / `falling_edge(clk)` / `clk'event` detect transitions across delta boundaries.
 * - Supports hierarchical component instantiation (`port map`).
 */

import { VhdlErrorCode } from "../errors.js";
import { computeRangeWidth, parseVhdl } from "../parser/vhdl-parser.js";
import type {
  StdLogic,
  VhdlArchitecture,
  VhdlConcStmt,
  VhdlDesignFile,
  VhdlEntity,
  VhdlExpr,
  VhdlSeqStmt,
  VhdlTypeRef,
} from "../types.js";
import {
  bitsToUnsigned,
  expandBitString,
  isHigh,
  isLow,
  resolveStdLogic,
  stdAnd,
  stdNand,
  stdNor,
  stdNot,
  stdOr,
  stdXnor,
  stdXor,
  toStdLogic,
  unsignedToBits,
} from "./std-logic.js";

export type VhdlRuntimeValue =
  | { kind: "logic"; value: StdLogic }
  | { kind: "vector"; value: string; left: number; direction: "downto" | "to"; right: number }
  | { kind: "int"; value: number }
  | { kind: "bool"; value: boolean }
  | { kind: "enum"; value: string };

interface SignalState {
  name: string;
  current: VhdlRuntimeValue;
  previous: VhdlRuntimeValue;
  event: boolean;
  type: VhdlTypeRef;
  drivers: Map<string, VhdlRuntimeValue>;
}

export interface VhdlSimulationStep {
  timeNs: number;
  deltaCycles: number;
  signals: Record<string, string | number | boolean>;
}

export interface VhdlSimulationOptions {
  entityName?: string | undefined;
  maxDeltaCycles?: number | undefined;
}

function runtimeValueEqual(a: VhdlRuntimeValue, b: VhdlRuntimeValue): boolean {
  if (a.kind !== b.kind) return false;
  return a.value === b.value;
}

function formatRuntimeValue(v: VhdlRuntimeValue): string | number | boolean {
  return v.value;
}

function makeDefaultValue(type: VhdlTypeRef, enumTypes: Map<string, string[]>): VhdlRuntimeValue {
  const lower = type.name.toLowerCase();
  if (lower === "integer" || lower === "natural" || lower === "positive") {
    return { kind: "int", value: 0 };
  }
  if (lower === "boolean") {
    return { kind: "bool", value: false };
  }
  const enumLits = enumTypes.get(lower);
  if (enumLits && enumLits.length > 0) {
    return { kind: "enum", value: enumLits[0]! };
  }
  if (type.range) {
    const w = type.width ?? computeRangeWidth(type.range) ?? 1;
    const left = type.range.left.kind === "intLiteral" ? type.range.left.value : w - 1;
    const right = type.range.right.kind === "intLiteral" ? type.range.right.value : 0;
    const initBit = lower.includes("bit") ? "0" : "U";
    return { kind: "vector", value: initBit.repeat(w), left, direction: type.range.direction, right };
  }
  if (lower === "bit") return { kind: "logic", value: "0" };
  return { kind: "logic", value: "U" };
}

function coerceToSignalType(val: VhdlRuntimeValue, target: SignalState): VhdlRuntimeValue {
  const cur = target.current;
  if (cur.kind === "vector") {
    const w = cur.value.length;
    if (val.kind === "vector") {
      const bits = val.value.length === w ? val.value : val.value.padStart(w, "0").slice(-w);
      return { ...cur, value: bits };
    }
    if (val.kind === "int") {
      return { ...cur, value: unsignedToBits(val.value, w) };
    }
    if (val.kind === "logic") {
      return { ...cur, value: val.value.repeat(w) };
    }
  }
  if (cur.kind === "logic") {
    if (val.kind === "logic") return val;
    if (val.kind === "int") return { kind: "logic", value: val.value ? "1" : "0" };
    if (val.kind === "bool") return { kind: "logic", value: val.value ? "1" : "0" };
    if (val.kind === "vector" && val.value.length >= 1) {
      return { kind: "logic", value: toStdLogic(val.value[val.value.length - 1]!) };
    }
  }
  if (cur.kind === "int") {
    if (val.kind === "int") return val;
    if (val.kind === "vector") return { kind: "int", value: bitsToUnsigned(val.value) };
  }
  return val;
}

function vectorIndexPos(vec: { left: number; direction: "downto" | "to"; right: number }, index: number): number {
  return vec.direction === "downto" ? vec.left - index : index - vec.left;
}

/**
 * Interactive event-driven delta-cycle VHDL RTL simulator.
 */
export class VhdlSimulator {
  private readonly design: VhdlDesignFile;
  private readonly entity: VhdlEntity;
  private readonly arch: VhdlArchitecture;
  private readonly maxDeltaCycles: number;
  private readonly signals = new Map<string, SignalState>();
  private readonly constants = new Map<string, VhdlRuntimeValue>();
  private readonly enumLiterals = new Set<string>();
  private readonly enumTypes = new Map<string, string[]>();
  private readonly processVars = new Map<number, Map<string, VhdlRuntimeValue>>();
  private readonly subInstances = new Map<
    string,
    { sim: VhdlSimulator; portBindings: Array<{ formal: string; actual: VhdlExpr; direction: string }> }
  >();

  private currentTimeNs = 0;
  private totalDeltaCycles = 0;

  constructor(input: VhdlDesignFile | string, options: VhdlSimulationOptions = {}) {
    this.design = typeof input === "string" ? parseVhdl(input) : input;
    this.maxDeltaCycles = options.maxDeltaCycles ?? 200;

    const targetEnt = options.entityName
      ? this.design.entities.find((e) => e.name.toLowerCase() === options.entityName!.toLowerCase())
      : this.design.entities[this.design.entities.length - 1];

    if (!targetEnt) {
      throw new Error(`No entity found${options.entityName ? ` matching '${options.entityName}'` : ""}`);
    }
    this.entity = targetEnt;

    const targetArch = this.design.architectures.find(
      (a) => a.entityName.toLowerCase() === this.entity.name.toLowerCase(),
    );
    if (!targetArch) {
      throw new Error(`No architecture found for entity '${this.entity.name}'`);
    }
    this.arch = targetArch;

    this.initializeState();
  }

  private initializeState(): void {
    // Register enum types from packages and architecture
    for (const pkg of this.design.packages) {
      for (const t of pkg.types) {
        if (t.kind === "enum" && t.enumLiterals) {
          this.enumTypes.set(t.name.toLowerCase(), t.enumLiterals);
          for (const lit of t.enumLiterals) this.enumLiterals.add(lit.toLowerCase());
        }
      }
      for (const c of pkg.constants) {
        this.constants.set(c.name.toLowerCase(), this.evalExpr(c.value, new Map()));
      }
    }
    for (const t of this.arch.types) {
      if (t.kind === "enum" && t.enumLiterals) {
        this.enumTypes.set(t.name.toLowerCase(), t.enumLiterals);
        for (const lit of t.enumLiterals) this.enumLiterals.add(lit.toLowerCase());
      }
    }
    for (const g of this.entity.generics) {
      if (g.defaultValue) {
        this.constants.set(g.name.toLowerCase(), this.evalExpr(g.defaultValue, new Map()));
      }
    }
    for (const c of this.arch.constants) {
      this.constants.set(c.name.toLowerCase(), this.evalExpr(c.value, new Map()));
    }

    // Register ports
    for (const p of this.entity.ports) {
      const def = p.defaultValue ? this.evalExpr(p.defaultValue, new Map()) : makeDefaultValue(p.type, this.enumTypes);
      const init = makeDefaultValue(p.type, this.enumTypes);
      const st: SignalState = {
        name: p.name,
        current: init,
        previous: init,
        event: false,
        type: p.type,
        drivers: new Map(),
      };
      if (p.defaultValue) {
        st.current = coerceToSignalType(def, st);
        st.previous = st.current;
      }
      this.signals.set(p.name.toLowerCase(), st);
    }

    // Register internal signals
    for (const s of this.arch.signals) {
      const init = makeDefaultValue(s.type, this.enumTypes);
      const st: SignalState = {
        name: s.name,
        current: init,
        previous: init,
        event: false,
        type: s.type,
        drivers: new Map(),
      };
      if (s.defaultValue) {
        const val = this.evalExpr(s.defaultValue, new Map());
        st.current = coerceToSignalType(val, st);
        st.previous = st.current;
      }
      this.signals.set(s.name.toLowerCase(), st);
    }

    // Initialize process-local variables
    this.arch.statements.forEach((stmt, idx) => {
      if (stmt.kind === "process") {
        const vars = new Map<string, VhdlRuntimeValue>();
        for (const v of stmt.variables) {
          const def = v.defaultValue
            ? this.evalExpr(v.defaultValue, new Map())
            : makeDefaultValue(v.type, this.enumTypes);
          vars.set(v.name.toLowerCase(), def);
        }
        this.processVars.set(idx, vars);
      } else if (stmt.kind === "componentInst") {
        const childEnt = this.design.entities.find((e) => e.name.toLowerCase() === stmt.componentName.toLowerCase());
        if (childEnt) {
          const childSim = new VhdlSimulator(this.design, {
            entityName: childEnt.name,
            maxDeltaCycles: this.maxDeltaCycles,
          });
          const portBindings: Array<{ formal: string; actual: VhdlExpr; direction: string }> = [];
          for (let i = 0; i < stmt.portMap.length; i++) {
            const assoc = stmt.portMap[i]!;
            const formalPort = assoc.formal
              ? childEnt.ports.find((p) => p.name.toLowerCase() === assoc.formal!.toLowerCase())
              : childEnt.ports[i];
            if (formalPort) {
              portBindings.push({
                formal: formalPort.name,
                actual: assoc.actual,
                direction: formalPort.direction,
              });
            }
          }
          this.subInstances.set(stmt.label, { sim: childSim, portBindings });
        }
      }
    });

    // Initial elaboration delta cycle
    this.runDeltaCycles(true);
  }

  /** Sets an external input port/signal value (takes effect at next delta cycle). */
  setInput(name: string, value: StdLogic | string | number | boolean): void {
    const key = name.toLowerCase();
    const sig = this.signals.get(key);
    if (!sig) throw new Error(`Unknown signal or port '${name}' in entity '${this.entity.name}'`);

    let rv: VhdlRuntimeValue;
    if (typeof value === "number") {
      rv = { kind: "int", value };
    } else if (typeof value === "boolean") {
      rv = { kind: "bool", value };
    } else if (sig.current.kind === "vector") {
      rv = { ...sig.current, value: value.toUpperCase() };
    } else if (sig.current.kind === "enum") {
      rv = { kind: "enum", value };
    } else {
      rv = { kind: "logic", value: toStdLogic(value) };
    }

    const next = coerceToSignalType(rv, sig);
    sig.previous = sig.current;
    sig.event = !runtimeValueEqual(sig.current, next);
    sig.current = next;
    sig.drivers.set("__ext__", next);
  }

  /** Reads the current value of a signal or port. */
  getSignal(name: string): string | number | boolean {
    const sig = this.signals.get(name.toLowerCase());
    if (!sig) throw new Error(`Unknown signal or port '${name}'`);
    return formatRuntimeValue(sig.current);
  }

  /** Returns a snapshot of all signals and ports. */
  getSnapshot(): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    for (const sig of this.signals.values()) {
      out[sig.name] = formatRuntimeValue(sig.current);
    }
    return out;
  }

  /** Runs delta cycles until quiescence, returning the number of delta cycles executed. */
  runDeltaCycles(initialRun = false): number {
    let deltas = 0;
    const activeSignals = new Set<string>();
    for (const [k, s] of this.signals) {
      if (s.event || initialRun) activeSignals.add(k);
    }

    while (deltas === 0 || activeSignals.size > 0) {
      if (deltas >= this.maxDeltaCycles) {
        throw new Error(VhdlErrorCode.DELTA_CYCLE_LIMIT.message(this.maxDeltaCycles));
      }
      deltas++;
      this.totalDeltaCycles++;

      const pendingUpdates = new Map<string, Array<{ driverId: string; value: VhdlRuntimeValue }>>();
      const schedule = (sigName: string, driverId: string, val: VhdlRuntimeValue): void => {
        const key = sigName.toLowerCase();
        const sig = this.signals.get(key);
        if (!sig) return;
        const coerced = coerceToSignalType(val, sig);
        const list = pendingUpdates.get(key) ?? [];
        list.push({ driverId, value: coerced });
        pendingUpdates.set(key, list);
      };

      // Evaluate all concurrent statements
      this.arch.statements.forEach((stmt, idx) => {
        this.evalConcurrentStmt(stmt, idx, activeSignals, initialRun && deltas === 1, schedule);
      });

      // Clear previous event flags and commit scheduled signal updates
      const nextActive = new Set<string>();
      for (const sig of this.signals.values()) {
        sig.event = false;
      }

      for (const [key, updates] of pendingUpdates) {
        const sig = this.signals.get(key)!;
        for (const u of updates) {
          sig.drivers.set(u.driverId, u.value);
        }
        const resolved = this.resolveSignalDrivers(sig);
        if (!runtimeValueEqual(sig.current, resolved)) {
          sig.previous = sig.current;
          sig.current = resolved;
          sig.event = true;
          nextActive.add(key);
        }
      }

      activeSignals.clear();
      for (const k of nextActive) activeSignals.add(k);
      if (activeSignals.size === 0) break;
    }

    return deltas;
  }

  /** Advances simulation by setting inputs, propagating delta cycles, and advancing simulation time. */
  step(inputs: Record<string, StdLogic | string | number | boolean>, advanceNs = 10): VhdlSimulationStep {
    for (const sig of this.signals.values()) {
      sig.event = false;
    }
    for (const [k, v] of Object.entries(inputs)) {
      this.setInput(k, v);
    }
    const deltaCycles = this.runDeltaCycles(false);
    this.currentTimeNs += advanceNs;
    return {
      timeNs: this.currentTimeNs,
      deltaCycles,
      signals: this.getSnapshot(),
    };
  }

  /**
   * Executes one full clock cycle (low phase -> rising edge -> high phase) for a synchronous design.
   */
  clockCycle(
    clkName: string,
    inputs: Record<string, StdLogic | string | number | boolean> = {},
    periodNs = 10,
  ): VhdlSimulationStep {
    this.step({ ...inputs, [clkName]: "0" }, periodNs / 2);
    return this.step({ ...inputs, [clkName]: "1" }, periodNs / 2);
  }

  private resolveSignalDrivers(sig: SignalState): VhdlRuntimeValue {
    const vals = [...sig.drivers.values()];
    if (vals.length === 0) return sig.current;
    if (vals.length === 1) return vals[0]!;

    if (sig.current.kind === "logic") {
      const logicVals = vals.map((v) => (v.kind === "logic" ? v.value : "X"));
      return { kind: "logic", value: resolveStdLogic(logicVals) };
    }
    if (sig.current.kind === "vector") {
      const w = sig.current.value.length;
      let resolvedBits = "";
      for (let i = 0; i < w; i++) {
        const bitDrivers: StdLogic[] = vals.map((v) => (v.kind === "vector" ? toStdLogic(v.value[i] ?? "X") : "X"));
        resolvedBits += resolveStdLogic(bitDrivers);
      }
      return { ...sig.current, value: resolvedBits };
    }
    return vals[vals.length - 1]!;
  }

  private evalConcurrentStmt(
    stmt: VhdlConcStmt,
    idx: number,
    activeSignals: Set<string>,
    isInitial: boolean,
    schedule: (sigName: string, driverId: string, val: VhdlRuntimeValue) => void,
  ): void {
    const driverId = `conc_${idx}`;
    if (stmt.kind === "condSignalAssign") {
      for (const br of stmt.branches) {
        if (!br.condition || this.isTruthy(this.evalExpr(br.condition, new Map()))) {
          const val = this.evalExpr(br.value, new Map());
          this.scheduleTarget(stmt.target, driverId, val, new Map(), schedule);
          break;
        }
      }
    } else if (stmt.kind === "selectedSignalAssign") {
      const sel = this.evalExpr(stmt.selector, new Map());
      const selStr = String(sel.value).toLowerCase();
      let matched = false;
      for (const alt of stmt.alternatives) {
        const ch = alt.choice.replace(/^['"]|['"]$/g, "").toLowerCase();
        if (ch === selStr) {
          this.scheduleTarget(stmt.target, driverId, this.evalExpr(alt.value, new Map()), new Map(), schedule);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const others = stmt.alternatives.find((a) => a.choice.toLowerCase() === "others");
        if (others) {
          this.scheduleTarget(stmt.target, driverId, this.evalExpr(others.value, new Map()), new Map(), schedule);
        }
      }
    } else if (stmt.kind === "process") {
      const triggered =
        isInitial || stmt.sensitivity.length === 0 || stmt.sensitivity.some((s) => activeSignals.has(s.toLowerCase()));
      if (!triggered) return;

      const vars = this.processVars.get(idx) ?? new Map<string, VhdlRuntimeValue>();
      this.execSeqStmts(stmt.body, driverId, vars, schedule);
    } else if (stmt.kind === "componentInst") {
      const inst = this.subInstances.get(stmt.label);
      if (!inst) return;
      // Push input bindings into child simulator
      for (const b of inst.portBindings) {
        if (b.direction === "in" || b.direction === "inout") {
          const v = this.evalExpr(b.actual, new Map());
          inst.sim.setInput(b.formal, formatRuntimeValue(v));
        }
      }
      inst.sim.runDeltaCycles(false);
      // Pull output bindings back to parent signals
      for (const b of inst.portBindings) {
        if (b.direction === "out" || b.direction === "inout") {
          const outVal = inst.sim.getSignal(b.formal);
          const rv: VhdlRuntimeValue =
            typeof outVal === "number"
              ? { kind: "int", value: outVal }
              : typeof outVal === "boolean"
                ? { kind: "bool", value: outVal }
                : outVal.length === 1
                  ? { kind: "logic", value: toStdLogic(outVal) }
                  : { kind: "vector", value: outVal, left: outVal.length - 1, direction: "downto", right: 0 };

          if (b.actual.kind === "ident") {
            schedule(b.actual.name, `${driverId}_${b.formal}`, rv);
          } else if (b.actual.kind === "index") {
            this.scheduleTarget(
              { name: b.actual.target, index: b.actual.index },
              `${driverId}_${b.formal}`,
              rv,
              new Map(),
              schedule,
            );
          }
        }
      }
    }
  }

  private execSeqStmts(
    stmts: VhdlSeqStmt[],
    driverId: string,
    vars: Map<string, VhdlRuntimeValue>,
    schedule: (sigName: string, driverId: string, val: VhdlRuntimeValue) => void,
  ): void {
    for (const s of stmts) {
      if (s.kind === "signalAssign") {
        const val = this.evalExpr(s.value, vars);
        this.scheduleTarget(s.target, driverId, val, vars, schedule);
      } else if (s.kind === "varAssign") {
        const val = this.evalExpr(s.value, vars);
        const key = s.target.name.toLowerCase();
        if (s.target.index) {
          const cur = vars.get(key);
          const idxVal = this.evalInt(s.target.index, vars);
          if (cur && cur.kind === "vector") {
            const pos = vectorIndexPos(cur, idxVal);
            if (pos >= 0 && pos < cur.value.length) {
              const bit = val.kind === "logic" ? val.value : (String(val.value)[0] ?? "X");
              const chars = cur.value.split("");
              chars[pos] = bit;
              vars.set(key, { ...cur, value: chars.join("") });
            }
          }
        } else {
          vars.set(key, val);
        }
      } else if (s.kind === "if") {
        if (this.isTruthy(this.evalExpr(s.condition, vars))) {
          this.execSeqStmts(s.thenBranch, driverId, vars, schedule);
        } else {
          let ran = false;
          for (const ei of s.elsifs) {
            if (this.isTruthy(this.evalExpr(ei.condition, vars))) {
              this.execSeqStmts(ei.body, driverId, vars, schedule);
              ran = true;
              break;
            }
          }
          if (!ran && s.elseBranch) {
            this.execSeqStmts(s.elseBranch, driverId, vars, schedule);
          }
        }
      } else if (s.kind === "case") {
        const sel = this.evalExpr(s.expr, vars);
        const selStr = String(sel.value).toLowerCase();
        let matched = false;
        for (const alt of s.alternatives) {
          const matches = alt.choices.some((c) => c.replace(/^['"]|['"]$/g, "").toLowerCase() === selStr);
          if (matches) {
            this.execSeqStmts(alt.body, driverId, vars, schedule);
            matched = true;
            break;
          }
        }
        if (!matched) {
          const others = s.alternatives.find((a) => a.choices.some((c) => c.toLowerCase() === "others"));
          if (others) this.execSeqStmts(others.body, driverId, vars, schedule);
        }
      } else if (s.kind === "forLoop") {
        const l = this.evalInt(s.range.left, vars);
        const r = this.evalInt(s.range.right, vars);
        const step = s.range.direction === "to" ? 1 : -1;
        const iterKey = s.iterator.toLowerCase();
        for (let i = l; step > 0 ? i <= r : i >= r; i += step) {
          vars.set(iterKey, { kind: "int", value: i });
          this.execSeqStmts(s.body, driverId, vars, schedule);
        }
        vars.delete(iterKey);
      }
    }
  }

  private scheduleTarget(
    target: { name: string; index?: VhdlExpr | undefined },
    driverId: string,
    val: VhdlRuntimeValue,
    vars: Map<string, VhdlRuntimeValue>,
    schedule: (sigName: string, driverId: string, val: VhdlRuntimeValue) => void,
  ): void {
    const key = target.name.toLowerCase();
    const sig = this.signals.get(key);
    if (!sig) return;

    if (target.index && sig.current.kind === "vector") {
      const idx = this.evalInt(target.index, vars);
      const pos = vectorIndexPos(sig.current, idx);
      const prevDriver = sig.drivers.get(driverId);
      const baseStr =
        prevDriver && prevDriver.kind === "vector" ? prevDriver.value : "Z".repeat(sig.current.value.length);
      const chars = baseStr.split("");
      if (pos >= 0 && pos < chars.length) {
        chars[pos] = val.kind === "logic" ? val.value : toStdLogic(String(val.value)[0] ?? "X");
      }
      const nextVec: VhdlRuntimeValue = { ...sig.current, value: chars.join("") };
      // Update driver incrementally for multiple bit assignments in the same delta
      sig.drivers.set(driverId, nextVec);
      schedule(target.name, driverId, nextVec);
      return;
    }

    schedule(target.name, driverId, val);
  }

  private evalInt(expr: VhdlExpr, vars: Map<string, VhdlRuntimeValue>): number {
    const v = this.evalExpr(expr, vars);
    if (v.kind === "int") return v.value;
    if (v.kind === "vector") return bitsToUnsigned(v.value);
    if (v.kind === "logic") return isHigh(v.value) ? 1 : 0;
    return 0;
  }

  private isTruthy(v: VhdlRuntimeValue): boolean {
    if (v.kind === "bool") return v.value;
    if (v.kind === "logic") return isHigh(v.value);
    if (v.kind === "int") return v.value !== 0;
    return false;
  }

  private evalExpr(expr: VhdlExpr, vars: Map<string, VhdlRuntimeValue>): VhdlRuntimeValue {
    switch (expr.kind) {
      case "intLiteral":
        return { kind: "int", value: expr.value };
      case "realLiteral":
        return { kind: "int", value: Math.trunc(expr.value) };
      case "boolLiteral":
        return { kind: "bool", value: expr.value };
      case "charLiteral":
        return { kind: "logic", value: toStdLogic(expr.value) };
      case "bitString": {
        const bits = expandBitString(expr.value, expr.base ?? "B");
        return { kind: "vector", value: bits, left: bits.length - 1, direction: "downto", right: 0 };
      }
      case "stringLiteral":
        return { kind: "enum", value: expr.value };
      case "others": {
        const inner = this.evalExpr(expr.value, vars);
        return inner;
      }
      case "ident": {
        const k = expr.name.toLowerCase();
        const v = vars.get(k);
        if (v) return v;
        const s = this.signals.get(k);
        if (s) return s.current;
        const c = this.constants.get(k);
        if (c) return c;
        if (this.enumLiterals.has(k)) return { kind: "enum", value: expr.name };
        return { kind: "enum", value: expr.name };
      }
      case "index": {
        const k = expr.target.toLowerCase();
        const base = vars.get(k) ?? this.signals.get(k)?.current;
        const idx = this.evalInt(expr.index, vars);
        if (base && base.kind === "vector") {
          const pos = vectorIndexPos(base, idx);
          const ch = base.value[pos] ?? "U";
          return { kind: "logic", value: toStdLogic(ch) };
        }
        return { kind: "logic", value: "U" };
      }
      case "slice": {
        const k = expr.target.toLowerCase();
        const base = vars.get(k) ?? this.signals.get(k)?.current;
        const l = this.evalInt(expr.range.left, vars);
        const r = this.evalInt(expr.range.right, vars);
        if (base && base.kind === "vector") {
          const p1 = vectorIndexPos(base, l);
          const p2 = vectorIndexPos(base, r);
          const lo = Math.min(p1, p2);
          const hi = Math.max(p1, p2);
          return {
            kind: "vector",
            value: base.value.slice(lo, hi + 1),
            left: l,
            direction: expr.range.direction,
            right: r,
          };
        }
        return { kind: "vector", value: "0", left: 0, direction: "downto", right: 0 };
      }
      case "attribute": {
        const s = this.signals.get(expr.target.toLowerCase());
        if (expr.attr.toLowerCase() === "event") {
          return { kind: "bool", value: s?.event ?? false };
        }
        if (expr.attr.toLowerCase() === "length" && s?.current.kind === "vector") {
          return { kind: "int", value: s.current.value.length };
        }
        return { kind: "bool", value: false };
      }
      case "call": {
        const fn = expr.name.toLowerCase();
        if (fn === "rising_edge" && expr.args[0]?.kind === "ident") {
          const s = this.signals.get(expr.args[0].name.toLowerCase());
          const rising =
            s !== undefined &&
            s.event &&
            s.previous.kind === "logic" &&
            s.current.kind === "logic" &&
            isLow(s.previous.value) &&
            isHigh(s.current.value);
          return { kind: "bool", value: rising };
        }
        if (fn === "falling_edge" && expr.args[0]?.kind === "ident") {
          const s = this.signals.get(expr.args[0].name.toLowerCase());
          const falling =
            s !== undefined &&
            s.event &&
            s.previous.kind === "logic" &&
            s.current.kind === "logic" &&
            isHigh(s.previous.value) &&
            isLow(s.current.value);
          return { kind: "bool", value: falling };
        }
        if ((fn === "unsigned" || fn === "signed" || fn === "std_logic_vector") && expr.args[0]) {
          return this.evalExpr(expr.args[0], vars);
        }
        if (fn === "to_integer" && expr.args[0]) {
          return { kind: "int", value: this.evalInt(expr.args[0], vars) };
        }
        if ((fn === "to_unsigned" || fn === "to_signed") && expr.args.length >= 2) {
          const val = this.evalInt(expr.args[0]!, vars);
          const w = this.evalInt(expr.args[1]!, vars);
          return { kind: "vector", value: unsignedToBits(val, w), left: w - 1, direction: "downto", right: 0 };
        }
        return { kind: "int", value: 0 };
      }
      case "unary": {
        const v = this.evalExpr(expr.operand, vars);
        if (expr.op === "not") {
          if (v.kind === "logic") return { kind: "logic", value: stdNot(v.value) };
          if (v.kind === "bool") return { kind: "bool", value: !v.value };
          if (v.kind === "vector") {
            return {
              ...v,
              value: v.value
                .split("")
                .map((c) => stdNot(toStdLogic(c)))
                .join(""),
            };
          }
        }
        if (expr.op === "-" && v.kind === "int") return { kind: "int", value: -v.value };
        if (expr.op === "abs" && v.kind === "int") return { kind: "int", value: Math.abs(v.value) };
        return v;
      }
      case "binary": {
        const l = this.evalExpr(expr.left, vars);
        const r = this.evalExpr(expr.right, vars);
        return this.evalBinary(expr.op, l, r);
      }
      default:
        return { kind: "logic", value: "U" };
    }
  }

  private evalBinary(op: string, l: VhdlRuntimeValue, r: VhdlRuntimeValue): VhdlRuntimeValue {
    // Boolean / Logic binary ops
    if (op === "and" || op === "or" || op === "nand" || op === "nor" || op === "xor" || op === "xnor") {
      if (l.kind === "bool" && r.kind === "bool") {
        if (op === "and") return { kind: "bool", value: l.value && r.value };
        if (op === "or") return { kind: "bool", value: l.value || r.value };
        if (op === "xor") return { kind: "bool", value: l.value !== r.value };
        if (op === "nand") return { kind: "bool", value: !(l.value && r.value) };
        if (op === "nor") return { kind: "bool", value: !(l.value || r.value) };
        return { kind: "bool", value: l.value === r.value };
      }
      const applyBit = (a: StdLogic, b: StdLogic): StdLogic => {
        if (op === "and") return stdAnd(a, b);
        if (op === "or") return stdOr(a, b);
        if (op === "nand") return stdNand(a, b);
        if (op === "nor") return stdNor(a, b);
        if (op === "xor") return stdXor(a, b);
        return stdXnor(a, b);
      };
      if (l.kind === "logic" && r.kind === "logic") {
        return { kind: "logic", value: applyBit(l.value, r.value) };
      }
      if (l.kind === "vector" && r.kind === "vector") {
        const w = Math.min(l.value.length, r.value.length);
        let out = "";
        for (let i = 0; i < w; i++) {
          out += applyBit(toStdLogic(l.value[i]!), toStdLogic(r.value[i]!));
        }
        return { ...l, value: out };
      }
    }

    // Concatenation
    if (op === "&") {
      const ls = l.kind === "logic" || l.kind === "vector" ? l.value : String(l.value);
      const rs = r.kind === "logic" || r.kind === "vector" ? r.value : String(r.value);
      const combined = ls + rs;
      return { kind: "vector", value: combined, left: combined.length - 1, direction: "downto", right: 0 };
    }

    // Equality & relational
    if (op === "=" || op === "/=") {
      const eq = String(l.value).toLowerCase() === String(r.value).toLowerCase();
      return { kind: "bool", value: op === "=" ? eq : !eq };
    }

    const li = l.kind === "int" ? l.value : l.kind === "vector" ? bitsToUnsigned(l.value) : 0;
    const ri = r.kind === "int" ? r.value : r.kind === "vector" ? bitsToUnsigned(r.value) : 0;

    if (op === "<") return { kind: "bool", value: li < ri };
    if (op === "<=") return { kind: "bool", value: li <= ri };
    if (op === ">") return { kind: "bool", value: li > ri };
    if (op === ">=") return { kind: "bool", value: li >= ri };

    // Arithmetic
    if (op === "+" || op === "-" || op === "*" || op === "/" || op === "mod" || op === "rem") {
      const res =
        op === "+"
          ? li + ri
          : op === "-"
            ? li - ri
            : op === "*"
              ? li * ri
              : op === "/"
                ? ri !== 0
                  ? Math.trunc(li / ri)
                  : 0
                : ri !== 0
                  ? li % ri
                  : 0;
      if (l.kind === "vector") {
        return { ...l, value: unsignedToBits(res, l.value.length) };
      }
      if (r.kind === "vector") {
        return { ...r, value: unsignedToBits(res, r.value.length) };
      }
      return { kind: "int", value: res };
    }

    return { kind: "bool", value: false };
  }
}

/**
 * Convenience helper to simulate a VHDL design across a sequence of input vectors.
 */
export function simulateVhdl(
  source: VhdlDesignFile | string,
  stimulus: Array<Record<string, StdLogic | string | number | boolean>>,
  options: VhdlSimulationOptions = {},
): VhdlSimulationStep[] {
  const sim = new VhdlSimulator(source, options);
  return stimulus.map((inputs) => sim.step(inputs));
}
