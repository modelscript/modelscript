// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/plcopen — Virtual PLC Scan Cycle Execution Engine.
 *
 * Implements standard IEC 61131-3 cyclic execution semantics:
 * 1. Read Inputs (Input Scan)
 * 2. Execute Task POUs & Function Blocks (Logic Evaluation)
 * 3. Update Standard Timers & Counters (TON, TOF, TP, CTU, CTD)
 * 4. Write Outputs (Output Scan)
 */

import type { PlcCallArg, PlcExpr, PlcPou, PlcProject, PlcStatement } from "../types.js";

export interface TimerState {
  type: "TON" | "TOF" | "TP";
  IN: boolean;
  PT: number; // Preset time in milliseconds
  Q: boolean;
  ET: number; // Elapsed time in milliseconds
  running: boolean;
  prevIn: boolean;
}

export interface CounterState {
  type: "CTU" | "CTD" | "CTUD";
  CU_prev: boolean;
  CD_prev: boolean;
  CV: number;
  PV: number;
  Q: boolean;
  QU: boolean;
  QD: boolean;
}

export interface TriggerState {
  type: "R_TRIG" | "F_TRIG";
  prevClk: boolean;
  initialized: boolean;
  Q: boolean;
}

export interface LatchState {
  type: "SR" | "RS";
  Q1: boolean;
}

type ControlSignal = undefined | "exit" | "return";

export type PlcValue = string | number | boolean;

export class VirtualPlc {
  private project: PlcProject | null = null;
  private variables = new Map<string, PlcValue>();
  private timers = new Map<string, TimerState>();
  private counters = new Map<string, CounterState>();
  private triggers = new Map<string, TriggerState>();
  private latches = new Map<string, LatchState>();
  private pouVarMap = new Map<string, Map<string, PlcPou["variables"][number]>>();
  private pouByName = new Map<string, PlcPou>();
  private timeCache = new Map<string, number>();
  private cycleCount = 0;
  private defaultDtMs = 10; // Default 10ms cycle time

  constructor(project?: PlcProject) {
    if (project) {
      this.loadProject(project);
    }
  }

  public loadProject(project: PlcProject): void {
    this.project = project;
    this.variables.clear();
    this.timers.clear();
    this.counters.clear();
    this.triggers.clear();
    this.latches.clear();
    this.pouVarMap.clear();
    this.pouByName.clear();
    this.timeCache.clear();
    this.cycleCount = 0;

    // Initialize variables from all POUs
    for (const pou of project.pous) {
      this.pouByName.set(pou.name.toUpperCase(), pou);
      const vMap = new Map<string, PlcPou["variables"][number]>();
      for (const v of pou.variables) {
        vMap.set(v.name.toLowerCase(), v);
      }
      this.pouVarMap.set(pou.name, vMap);

      for (const v of pou.variables) {
        let val: PlcValue = 0;
        const dtUpper = v.dataType.toUpperCase();
        if (v.initialValue !== undefined) {
          val = v.initialValue;
        } else if (dtUpper === "BOOL") {
          val = false;
        } else if (dtUpper === "INT" || dtUpper === "DINT" || dtUpper === "REAL" || dtUpper === "LREAL") {
          val = 0;
        } else if (dtUpper === "STRING") {
          val = "";
        } else if (dtUpper === "TIME") {
          val = 0;
        }

        // Store by unqualified and qualified name
        this.variables.set(v.name, val);
        this.variables.set(`${pou.name}.${v.name}`, val);
        if (v.address) {
          this.variables.set(v.address, val);
        }
      }
    }
  }

  public setVariable(name: string, value: PlcValue): void {
    this.variables.set(name, value);
    if (this.project && !name.includes(".")) {
      for (const pou of this.project.pous) {
        if (this.pouVarMap.get(pou.name)?.has(name.toLowerCase())) {
          this.variables.set(`${pou.name}.${name}`, value);
        }
      }
    }
  }

  public getVariable(name: string): PlcValue | undefined {
    return this.variables.get(name);
  }

  public getAllVariables(): Record<string, PlcValue> {
    const res: Record<string, PlcValue> = {};
    for (const [k, v] of this.variables.entries()) {
      if (!k.includes(".")) {
        res[k] = v;
      }
    }
    return res;
  }

  public getCycleCount(): number {
    return this.cycleCount;
  }

  /**
   * Advances the PLC by one scan cycle of duration `dtMs`.
   */
  public step(dtMs = this.defaultDtMs): void {
    if (!this.project) return;
    this.cycleCount++;

    const hasPrograms = this.project.pous.some((p) => p.pouType === "program");
    // Execute Program POUs in Order (or all POUs if no top-level program is defined)
    for (const pou of this.project.pous) {
      if (hasPrograms && pou.pouType !== "program") {
        continue;
      }
      if (pou.body.kind === "ST" && pou.body.st) {
        this.executeStatements(pou, pou.body.st.statements, dtMs);
      }
    }
  }

  /**
   * Runs multiple scan cycles and returns a time-series log of variable states.
   */
  public runCycles(count: number, dtMs = this.defaultDtMs): Record<string, PlcValue>[] {
    const history: Record<string, PlcValue>[] = [];
    for (let c = 0; c < count; c++) {
      this.step(dtMs);
      history.push({
        _cycle: this.cycleCount,
        _timeMs: this.cycleCount * dtMs,
        ...this.getAllVariables(),
      });
    }
    return history;
  }

  private executeStatements(pou: PlcPou, statements: PlcStatement[], dtMs: number): ControlSignal {
    for (const stmt of statements) {
      if (stmt.kind === "exit") {
        return "exit";
      }
      if (stmt.kind === "return") {
        return "return";
      }
      if (stmt.kind === "assignment") {
        const val = this.evaluateExpr(pou, stmt.value, dtMs);
        if (stmt.target.kind === "identifier") {
          const name = stmt.target.name;
          this.variables.set(name, val);
          this.variables.set(`${pou.name}.${name}`, val);
        } else if (stmt.target.kind === "member") {
          // Object property assignment
          const objName = (stmt.target.object as { name?: string }).name ?? "";
          const prop = stmt.target.property;
          const key = `${objName}.${prop}`;
          this.variables.set(key, val);
        }
      } else if (stmt.kind === "if") {
        const cond = Boolean(this.evaluateExpr(pou, stmt.condition, dtMs));
        if (cond) {
          const sig = this.executeStatements(pou, stmt.thenStatements, dtMs);
          if (sig) return sig;
        } else {
          let matched = false;
          for (const elif of stmt.elsifs) {
            if (this.evaluateExpr(pou, elif.condition, dtMs)) {
              const sig = this.executeStatements(pou, elif.statements, dtMs);
              if (sig) return sig;
              matched = true;
              break;
            }
          }
          if (!matched && stmt.elseStatements.length > 0) {
            const sig = this.executeStatements(pou, stmt.elseStatements, dtMs);
            if (sig) return sig;
          }
        }
      } else if (stmt.kind === "case") {
        const selVal = this.evaluateExpr(pou, stmt.selector, dtMs);
        let matched = false;
        for (const c of stmt.cases) {
          if ((c.values as readonly PlcValue[]).includes(selVal)) {
            const sig = this.executeStatements(pou, c.statements, dtMs);
            if (sig) return sig;
            matched = true;
            break;
          }
        }
        if (!matched && stmt.elseStatements.length > 0) {
          const sig = this.executeStatements(pou, stmt.elseStatements, dtMs);
          if (sig) return sig;
        }
      } else if (stmt.kind === "for") {
        const startVal = Number(this.evaluateExpr(pou, stmt.start, dtMs));
        const endVal = Number(this.evaluateExpr(pou, stmt.end, dtMs));
        const stepVal = stmt.step ? Number(this.evaluateExpr(pou, stmt.step, dtMs)) : 1;
        if (stepVal !== 0) {
          for (let i = startVal; stepVal > 0 ? i <= endVal : i >= endVal; i += stepVal) {
            this.variables.set(stmt.variable, i);
            this.variables.set(`${pou.name}.${stmt.variable}`, i);
            const sig = this.executeStatements(pou, stmt.statements, dtMs);
            if (sig === "exit") break;
            if (sig === "return") return "return";
          }
        }
      } else if (stmt.kind === "while") {
        let maxIters = 1000;
        while (Boolean(this.evaluateExpr(pou, stmt.condition, dtMs)) && maxIters-- > 0) {
          const sig = this.executeStatements(pou, stmt.statements, dtMs);
          if (sig === "exit") break;
          if (sig === "return") return "return";
        }
      } else if (stmt.kind === "repeat") {
        let maxIters = 1000;
        do {
          const sig = this.executeStatements(pou, stmt.statements, dtMs);
          if (sig === "exit") break;
          if (sig === "return") return "return";
        } while (!this.evaluateExpr(pou, stmt.condition, dtMs) && --maxIters > 0);
      } else if (stmt.kind === "call") {
        this.executeCall(pou, stmt.callee, stmt.args, dtMs);
      }
    }
    return undefined;
  }

  private getArgBool(
    pou: PlcPou,
    args: PlcCallArg[],
    callee: string,
    names: string[],
    fallback: boolean,
    dtMs: number,
  ): boolean {
    for (const name of names) {
      const arg = args.find((a) => a.name?.toUpperCase() === name && a.direction !== "out");
      if (arg) return Boolean(this.evaluateExpr(pou, arg.expr, dtMs));
      const propVal = this.variables.get(`${callee}.${name}`);
      if (propVal !== undefined) return Boolean(propVal);
    }
    return fallback;
  }

  private getArgNum(
    pou: PlcPou,
    args: PlcCallArg[],
    callee: string,
    names: string[],
    fallback: number,
    dtMs: number,
  ): number {
    for (const name of names) {
      const arg = args.find((a) => a.name?.toUpperCase() === name && a.direction !== "out");
      if (arg) return Number(this.evaluateExpr(pou, arg.expr, dtMs));
      const propVal = this.variables.get(`${callee}.${name}`);
      if (propVal !== undefined) return Number(propVal);
    }
    return fallback;
  }

  private writeOutArgs(pou: PlcPou, args: PlcCallArg[], outputs: Record<string, PlcValue>): void {
    for (const arg of args) {
      if (arg.direction === "out" && arg.name && arg.expr.kind === "identifier") {
        const key = arg.name.toUpperCase();
        const val = outputs[key];
        if (val !== undefined) {
          this.variables.set(arg.expr.name, val);
          this.variables.set(`${pou.name}.${arg.expr.name}`, val);
        }
      }
    }
  }

  private executeCall(pou: PlcPou, callee: string, args: PlcCallArg[], _dtMs: number): PlcValue | undefined {
    const calleeUpper = callee.toUpperCase();
    const calleeVar =
      this.pouVarMap.get(pou.name)?.get(callee.toLowerCase()) ??
      pou.variables.find((v) => v.name.toLowerCase() === callee.toLowerCase());
    const resolvedType = (calleeVar?.dataType ?? callee).toUpperCase();

    // 1. Standard Timers: TON / TOF / TP
    if (
      resolvedType.startsWith("TON") ||
      resolvedType.startsWith("TOF") ||
      resolvedType.startsWith("TP") ||
      calleeUpper.startsWith("TON") ||
      calleeUpper.startsWith("TOF") ||
      calleeUpper.startsWith("TP")
    ) {
      const timerType: "TON" | "TOF" | "TP" =
        resolvedType.startsWith("TOF") || calleeUpper.startsWith("TOF")
          ? "TOF"
          : resolvedType.startsWith("TP") || calleeUpper.startsWith("TP")
            ? "TP"
            : "TON";

      let timer = this.timers.get(callee);
      if (!timer) {
        timer = {
          type: timerType,
          IN: false,
          PT: 0,
          Q: false,
          ET: 0,
          running: false,
          prevIn: false,
        };
        this.timers.set(callee, timer);
      }

      for (const arg of args) {
        if (arg.name?.toUpperCase() === "IN") {
          timer.IN = Boolean(this.evaluateExpr(pou, arg.expr, _dtMs));
        } else if (arg.name?.toUpperCase() === "PT") {
          timer.PT = this.parseTimeMs(this.evaluateExpr(pou, arg.expr, _dtMs));
        }
      }

      if (timer.type === "TON") {
        if (timer.IN) {
          timer.ET = Math.min(timer.PT, timer.ET + _dtMs);
          timer.Q = timer.ET >= timer.PT;
        } else {
          timer.ET = 0;
          timer.Q = false;
        }
      } else if (timer.type === "TOF") {
        if (timer.IN) {
          timer.Q = true;
          timer.ET = 0;
          timer.running = false;
        } else {
          if (timer.prevIn && !timer.IN) {
            timer.running = true;
            timer.ET = 0;
          }
          if (timer.running) {
            timer.ET = Math.min(timer.PT, timer.ET + _dtMs);
            timer.Q = timer.ET < timer.PT;
            if (timer.ET >= timer.PT) {
              timer.running = false;
            }
          } else {
            timer.Q = false;
          }
        }
        timer.prevIn = timer.IN;
      } else if (timer.type === "TP") {
        const rising = !timer.prevIn && timer.IN;
        timer.prevIn = timer.IN;
        if (rising && !timer.running) {
          timer.running = true;
          timer.Q = true;
          timer.ET = 0;
        }
        if (timer.running) {
          timer.ET = Math.min(timer.PT, timer.ET + _dtMs);
          timer.Q = timer.ET < timer.PT;
          if (timer.ET >= timer.PT) {
            timer.running = false;
            timer.Q = false;
          }
        }
      }

      this.writeOutArgs(pou, args, { Q: timer.Q, ET: timer.ET });
      this.variables.set(`${callee}.Q`, timer.Q);
      this.variables.set(`${callee}.ET`, timer.ET);
      return timer.Q;
    }

    // 2. Standard Counters: CTU / CTD / CTUD
    if (
      resolvedType === "CTU" ||
      resolvedType === "CTD" ||
      resolvedType === "CTUD" ||
      calleeUpper.startsWith("CTU") ||
      calleeUpper.startsWith("CTD")
    ) {
      const counterType: "CTU" | "CTD" | "CTUD" =
        resolvedType === "CTUD" || calleeUpper.startsWith("CTUD")
          ? "CTUD"
          : resolvedType === "CTD" || calleeUpper.startsWith("CTD")
            ? "CTD"
            : "CTU";

      let cnt = this.counters.get(callee);
      if (!cnt) {
        cnt = {
          type: counterType,
          CU_prev: false,
          CD_prev: false,
          CV: 0,
          PV: 0,
          Q: false,
          QU: false,
          QD: false,
        };
        this.counters.set(callee, cnt);
      }

      const cu = this.getArgBool(pou, args, callee, ["CU"], false, _dtMs);
      const cd = this.getArgBool(pou, args, callee, ["CD"], false, _dtMs);
      const r = this.getArgBool(pou, args, callee, ["R", "RESET"], false, _dtMs);
      const ld = this.getArgBool(pou, args, callee, ["LD", "LOAD"], false, _dtMs);
      cnt.PV = this.getArgNum(pou, args, callee, ["PV"], cnt.PV, _dtMs);

      if (counterType === "CTU") {
        if (r) {
          cnt.CV = 0;
        } else if (cu && !cnt.CU_prev) {
          cnt.CV += 1;
        }
        cnt.CU_prev = cu;
        cnt.Q = cnt.CV >= cnt.PV;
        cnt.QU = cnt.Q;
      } else if (counterType === "CTD") {
        if (ld) {
          cnt.CV = cnt.PV;
        } else if (cd && !cnt.CD_prev) {
          cnt.CV -= 1;
        }
        cnt.CD_prev = cd;
        cnt.Q = cnt.CV <= 0;
        cnt.QD = cnt.Q;
      } else {
        if (r) {
          cnt.CV = 0;
        } else if (ld) {
          cnt.CV = cnt.PV;
        } else {
          if (cu && !cnt.CU_prev) cnt.CV += 1;
          if (cd && !cnt.CD_prev) cnt.CV -= 1;
        }
        cnt.CU_prev = cu;
        cnt.CD_prev = cd;
        cnt.QU = cnt.CV >= cnt.PV;
        cnt.QD = cnt.CV <= 0;
        cnt.Q = cnt.QU;
      }

      this.writeOutArgs(pou, args, { Q: cnt.Q, QU: cnt.QU, QD: cnt.QD, CV: cnt.CV });
      this.variables.set(`${callee}.Q`, cnt.Q);
      this.variables.set(`${callee}.QU`, cnt.QU);
      this.variables.set(`${callee}.QD`, cnt.QD);
      this.variables.set(`${callee}.CV`, cnt.CV);
      return cnt.CV;
    }

    // 3. Edge Triggers: R_TRIG / F_TRIG
    if (
      resolvedType === "R_TRIG" ||
      resolvedType === "F_TRIG" ||
      calleeUpper.startsWith("R_TRIG") ||
      calleeUpper.startsWith("F_TRIG")
    ) {
      const trigType: "R_TRIG" | "F_TRIG" =
        resolvedType === "F_TRIG" || calleeUpper.startsWith("F_TRIG") ? "F_TRIG" : "R_TRIG";
      let trig = this.triggers.get(callee);
      if (!trig) {
        trig = {
          type: trigType,
          prevClk: false,
          initialized: false,
          Q: false,
        };
        this.triggers.set(callee, trig);
      }

      const clk = this.getArgBool(pou, args, callee, ["CLK"], false, _dtMs);
      if (trigType === "R_TRIG") {
        trig.Q = clk && !trig.prevClk;
      } else {
        trig.Q = trig.initialized ? !clk && trig.prevClk : false;
      }
      trig.prevClk = clk;
      trig.initialized = true;

      this.writeOutArgs(pou, args, { Q: trig.Q });
      this.variables.set(`${callee}.Q`, trig.Q);
      return trig.Q;
    }

    // 4. Bistable Latches: SR / RS
    if (resolvedType === "SR" || resolvedType === "RS") {
      let latch = this.latches.get(callee);
      if (!latch) {
        latch = { type: resolvedType, Q1: false };
        this.latches.set(callee, latch);
      }

      if (resolvedType === "SR") {
        const s1 = this.getArgBool(pou, args, callee, ["S1", "S"], false, _dtMs);
        const r = this.getArgBool(pou, args, callee, ["R", "R1"], false, _dtMs);
        latch.Q1 = s1 || (!r && latch.Q1);
      } else {
        const s = this.getArgBool(pou, args, callee, ["S", "S1"], false, _dtMs);
        const r1 = this.getArgBool(pou, args, callee, ["R1", "R"], false, _dtMs);
        latch.Q1 = !r1 && (s || latch.Q1);
      }

      this.writeOutArgs(pou, args, { Q1: latch.Q1, Q: latch.Q1 });
      this.variables.set(`${callee}.Q1`, latch.Q1);
      this.variables.set(`${callee}.Q`, latch.Q1);
      return latch.Q1;
    }

    // 5. Built-in IEC 61131-3 standard functions
    const evalPositional = () => args.map((a) => Number(this.evaluateExpr(pou, a.expr, _dtMs)));
    switch (calleeUpper) {
      case "ABS": {
        const [x = 0] = evalPositional();
        return Math.abs(x);
      }
      case "SQRT": {
        const [x = 0] = evalPositional();
        return Math.sqrt(Math.max(0, x));
      }
      case "SIN": {
        const [x = 0] = evalPositional();
        return Math.sin(x);
      }
      case "COS": {
        const [x = 0] = evalPositional();
        return Math.cos(x);
      }
      case "MAX": {
        const vals = evalPositional();
        return vals.length > 0 ? Math.max(...vals) : 0;
      }
      case "MIN": {
        const vals = evalPositional();
        return vals.length > 0 ? Math.min(...vals) : 0;
      }
      case "LIMIT": {
        const [mn = 0, inVal = 0, mx = 0] = evalPositional();
        return Math.min(mx, Math.max(mn, inVal));
      }
      case "SEL": {
        const g = args[0] ? Boolean(this.evaluateExpr(pou, args[0].expr, _dtMs)) : false;
        const in0 = args[1] ? this.evaluateExpr(pou, args[1].expr, _dtMs) : 0;
        const in1 = args[2] ? this.evaluateExpr(pou, args[2].expr, _dtMs) : 0;
        return g ? in1 : in0;
      }
    }

    // 6. User-defined FUNCTION and FUNCTION_BLOCK POU calls
    const targetPou = this.pouByName.get(resolvedType) ?? this.pouByName.get(calleeUpper);
    if (targetPou && targetPou.body.kind === "ST" && targetPou.body.st) {
      const inputVars = targetPou.variables.filter((v) => v.scope === "input" || v.scope === "inOut");

      // Load instance state into targetPou scope
      for (const v of targetPou.variables) {
        const instVal = this.variables.get(`${callee}.${v.name}`);
        if (instVal !== undefined) {
          this.variables.set(v.name, instVal);
          this.variables.set(`${targetPou.name}.${v.name}`, instVal);
        }
      }

      // Bind call arguments (named or positional)
      args.forEach((arg, idx) => {
        if (arg.direction === "out") return;
        const val = this.evaluateExpr(pou, arg.expr, _dtMs);
        const paramName = arg.name ?? inputVars[idx]?.name;
        if (paramName) {
          this.variables.set(paramName, val);
          this.variables.set(`${targetPou.name}.${paramName}`, val);
          this.variables.set(`${callee}.${paramName}`, val);
        }
      });

      this.executeStatements(targetPou, targetPou.body.st.statements, _dtMs);

      // Copy state back to instance properties and collect outputs
      const outMap: Record<string, PlcValue> = {};
      for (const v of targetPou.variables) {
        const updated = this.variables.get(`${targetPou.name}.${v.name}`) ?? this.variables.get(v.name);
        if (updated !== undefined) {
          this.variables.set(`${callee}.${v.name}`, updated);
          outMap[v.name.toUpperCase()] = updated;
        }
      }
      this.writeOutArgs(pou, args, outMap);

      // For FUNCTION POUs, return the value assigned to the function's name
      return this.variables.get(`${targetPou.name}.${targetPou.name}`) ?? this.variables.get(targetPou.name);
    }

    return undefined;
  }

  private evaluateExpr(pou: PlcPou, expr: PlcExpr, dtMs = this.defaultDtMs): PlcValue {
    if (expr.kind === "literal") {
      if (expr.literalType === "time") {
        return this.parseTimeMs(expr.value);
      }
      return expr.value;
    }

    if (expr.kind === "identifier") {
      const name = expr.name;
      const scopedVal = this.variables.get(`${pou.name}.${name}`);
      if (scopedVal !== undefined) {
        return scopedVal;
      }
      const directVal = this.variables.get(name);
      if (directVal !== undefined) return directVal;
      return 0;
    }

    if (expr.kind === "member") {
      const objName = (expr.object as { name?: string }).name ?? "";
      const key = `${objName}.${expr.property}`;
      const memberVal = this.variables.get(key);
      if (memberVal !== undefined) return memberVal;
      return 0;
    }

    if (expr.kind === "call") {
      const res = this.executeCall(pou, expr.callee, expr.args, dtMs);
      return res ?? 0;
    }

    if (expr.kind === "binary") {
      const left = this.evaluateExpr(pou, expr.left, dtMs);
      const right = this.evaluateExpr(pou, expr.right, dtMs);
      const lNum = Number(left);
      const rNum = Number(right);
      switch (expr.op) {
        case "+":
          return typeof left === "string" || typeof right === "string" ? `${left}${right}` : lNum + rNum;
        case "-":
          return lNum - rNum;
        case "*":
          return lNum * rNum;
        case "/":
          return rNum !== 0 ? lNum / rNum : 0;
        case "MOD":
          return rNum !== 0 ? lNum % rNum : 0;
        case "**":
          return Math.pow(lNum, rNum);
        case "=":
          return left === right;
        case "<>":
          return left !== right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case ">":
          return left > right;
        case ">=":
          return left >= right;
        case "AND":
          return Boolean(left) && Boolean(right);
        case "OR":
          return Boolean(left) || Boolean(right);
        case "XOR":
          return Boolean(left) !== Boolean(right);
      }
    }

    if (expr.kind === "unary") {
      const arg = this.evaluateExpr(pou, expr.argument, dtMs);
      switch (expr.op) {
        case "-":
          return -Number(arg);
        case "+":
          return +Number(arg);
        case "NOT":
          return !arg;
      }
    }

    return 0;
  }

  private parseTimeMs(val: unknown): number {
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const cached = this.timeCache.get(val);
      if (cached !== undefined) return cached;

      let result = 0;
      const m = /(?:T|TIME)#(\d+)(ms|s|m|h)?/i.exec(val);
      if (m) {
        const n = parseInt(m[1] ?? "0", 10);
        const u = (m[2] ?? "ms").toLowerCase();
        if (u === "ms") result = n;
        else if (u === "s") result = n * 1000;
        else if (u === "m") result = n * 60000;
        else if (u === "h") result = n * 3600000;
      } else {
        const num = parseFloat(val);
        if (!isNaN(num)) result = num;
      }
      this.timeCache.set(val, result);
      return result;
    }
    return 0;
  }
}
