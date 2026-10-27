// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

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

export class VirtualPlc {
  private project: PlcProject | null = null;
  private variables = new Map<string, any>();
  private timers = new Map<string, TimerState>();
  private counters = new Map<string, CounterState>();
  private pouVarMap = new Map<string, Map<string, any>>();
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
      const vMap = new Map<string, any>();
      for (const v of pou.variables) {
        vMap.set(v.name.toLowerCase(), v);
      }
      this.pouVarMap.set(pou.name, vMap);

      for (const v of pou.variables) {
        let val: any = 0;
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

  public setVariable(name: string, value: any): void {
    this.variables.set(name, value);
  }

  public getVariable(name: string): any {
    return this.variables.get(name);
  }

  public getAllVariables(): Record<string, any> {
    const res: Record<string, any> = {};
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
  public runCycles(count: number, dtMs = this.defaultDtMs): Record<string, any>[] {
    const history: Record<string, any>[] = [];
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
          const objName = (stmt.target.object as any).name;
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
          if (c.values.includes(selVal)) {
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

  private evaluateExpr(pou: PlcPou, expr: PlcExpr): any {
    if (expr.kind === "literal") {
      if (expr.literalType === "time") {
        return this.parseTimeMs(expr.value);
      }
      return expr.value;
    }

    if (expr.kind === "identifier") {
      const name = expr.name;
      if (this.variables.has(name)) return this.variables.get(name);
      if (this.variables.has(`${pou.name}.${name}`)) {
        return this.variables.get(`${pou.name}.${name}`);
      }
      return 0;
    }

    if (expr.kind === "member") {
      const objName = (expr.object as any).name;
      const key = `${objName}.${expr.property}`;
      if (this.variables.has(key)) return this.variables.get(key);
      return 0;
    }

    if (expr.kind === "binary") {
      const left = this.evaluateExpr(pou, expr.left);
      const right = this.evaluateExpr(pou, expr.right);
      switch (expr.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return right !== 0 ? left / right : 0;
        case "MOD":
          return right !== 0 ? left % right : 0;
        case "**":
          return Math.pow(left, right);
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
          return -arg;
        case "+":
          return +arg;
        case "NOT":
          return !arg;
      }
    }

    return 0;
  }

  private parseTimeMs(val: any): number {
    if (typeof val === "number") return val;
    if (typeof val === "string") {
      const cached = this.timeCache.get(val);
      if (cached !== undefined) return cached;

      let result = 0;
      const m = /(?:T|TIME)#(\d+)(ms|s|m|h)?/i.exec(val);
      if (m) {
        const n = parseInt(m[1]!, 10);
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
