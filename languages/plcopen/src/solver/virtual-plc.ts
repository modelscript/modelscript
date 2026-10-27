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
  type: "CTU" | "CTD";
  CU_prev: boolean;
  CD_prev: boolean;
  CV: number;
  PV: number;
  Q: boolean;
}

export type PlcValue = string | number | boolean;

export class VirtualPlc {
  private project: PlcProject | null = null;
  private variables = new Map<string, PlcValue>();
  private timers = new Map<string, TimerState>();
  private counters = new Map<string, CounterState>();
  private pouVarMap = new Map<string, Map<string, PlcPou["variables"][number]>>();
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
    this.pouVarMap.clear();
    this.timeCache.clear();
    this.cycleCount = 0;

    // Initialize variables from all POUs
    for (const pou of project.pous) {
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

    // Execute POUs in Order
    for (const pou of this.project.pous) {
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

  private executeStatements(pou: PlcPou, statements: PlcStatement[], dtMs: number): void {
    for (const stmt of statements) {
      if (stmt.kind === "assignment") {
        const val = this.evaluateExpr(pou, stmt.value);
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
        const cond = Boolean(this.evaluateExpr(pou, stmt.condition));
        if (cond) {
          this.executeStatements(pou, stmt.thenStatements, dtMs);
        } else {
          let matched = false;
          for (const elif of stmt.elsifs) {
            if (this.evaluateExpr(pou, elif.condition)) {
              this.executeStatements(pou, elif.statements, dtMs);
              matched = true;
              break;
            }
          }
          if (!matched && stmt.elseStatements.length > 0) {
            this.executeStatements(pou, stmt.elseStatements, dtMs);
          }
        }
      } else if (stmt.kind === "case") {
        const selVal = this.evaluateExpr(pou, stmt.selector);
        let matched = false;
        for (const c of stmt.cases) {
          if ((c.values as readonly PlcValue[]).includes(selVal)) {
            this.executeStatements(pou, c.statements, dtMs);
            matched = true;
            break;
          }
        }
        if (!matched && stmt.elseStatements.length > 0) {
          this.executeStatements(pou, stmt.elseStatements, dtMs);
        }
      } else if (stmt.kind === "for") {
        const startVal = Number(this.evaluateExpr(pou, stmt.start));
        const endVal = Number(this.evaluateExpr(pou, stmt.end));
        const stepVal = stmt.step ? Number(this.evaluateExpr(pou, stmt.step)) : 1;
        for (let i = startVal; i <= endVal; i += stepVal) {
          this.variables.set(stmt.variable, i);
          this.executeStatements(pou, stmt.statements, dtMs);
        }
      } else if (stmt.kind === "while") {
        let maxIters = 1000;
        while (Boolean(this.evaluateExpr(pou, stmt.condition)) && maxIters-- > 0) {
          this.executeStatements(pou, stmt.statements, dtMs);
        }
      } else if (stmt.kind === "call") {
        this.executeCall(pou, stmt.callee, stmt.args, dtMs);
      }
    }
  }

  private executeCall(pou: PlcPou, callee: string, args: PlcCallArg[], _dtMs: number): void {
    const calleeUpper = callee.toUpperCase();
    const calleeVar =
      this.pouVarMap.get(pou.name)?.get(callee.toLowerCase()) ??
      pou.variables.find((v) => v.name.toLowerCase() === callee.toLowerCase());
    const resolvedType = (calleeVar?.dataType ?? callee).toUpperCase();

    // Check if this is TON / TOF / TP standard timer call
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

      // Read input arguments: IN := expr, PT := expr
      for (const arg of args) {
        if (arg.name?.toUpperCase() === "IN") {
          timer.IN = Boolean(this.evaluateExpr(pou, arg.expr));
        } else if (arg.name?.toUpperCase() === "PT") {
          timer.PT = this.parseTimeMs(this.evaluateExpr(pou, arg.expr));
        }
      }

      // Execute timer logic on invocation
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

      // Write output arguments: Q => outVar, ET => outVar
      for (const arg of args) {
        if (arg.name?.toUpperCase() === "Q" && arg.direction === "out") {
          if (arg.expr.kind === "identifier") {
            this.variables.set(arg.expr.name, timer.Q);
          }
        } else if (arg.name?.toUpperCase() === "ET" && arg.direction === "out") {
          if (arg.expr.kind === "identifier") {
            this.variables.set(arg.expr.name, timer.ET);
          }
        }
      }

      // Update timer object properties: callee.Q, callee.ET
      this.variables.set(`${callee}.Q`, timer.Q);
      this.variables.set(`${callee}.ET`, timer.ET);
    }
  }

  private evaluateExpr(pou: PlcPou, expr: PlcExpr): PlcValue {
    if (expr.kind === "literal") {
      if (expr.literalType === "time") {
        return this.parseTimeMs(expr.value);
      }
      return expr.value;
    }

    if (expr.kind === "identifier") {
      const name = expr.name;
      const directVal = this.variables.get(name);
      if (directVal !== undefined) return directVal;
      const scopedVal = this.variables.get(`${pou.name}.${name}`);
      if (scopedVal !== undefined) {
        return scopedVal;
      }
      return 0;
    }

    if (expr.kind === "member") {
      const objName = (expr.object as { name?: string }).name ?? "";
      const key = `${objName}.${expr.property}`;
      const memberVal = this.variables.get(key);
      if (memberVal !== undefined) return memberVal;
      return 0;
    }

    if (expr.kind === "binary") {
      const left = this.evaluateExpr(pou, expr.left);
      const right = this.evaluateExpr(pou, expr.right);
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
      const arg = this.evaluateExpr(pou, expr.argument);
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
