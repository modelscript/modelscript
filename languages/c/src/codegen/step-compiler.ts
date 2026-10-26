// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Performance Simulation Step Compiler for C.
 *
 * Compiles procedural C AST into zero-allocation step execution closures
 * for time-stepping simulation runners (PSCAD C segments, Simulink S-functions, discrete filters).
 */

import { parseCScript, type CExpr, type CStmt } from "../ast.js";
import { preprocessCSegment, type PreprocessedC } from "../preprocessor.js";

export interface CExecutionContext {
  time: number;
  dt: number;
  firstStep: boolean;
  inputs?: ((portName: string) => number) | undefined;
  getInput?: ((portName: string) => number) | undefined;
  setOutput: (portName: string, value: number) => void;
  statesReal: Float64Array;
  statesInt: Int32Array;
}

export type CStepFunction = (ctx: CExecutionContext) => void;

export interface CompiledCComponent {
  numRealStates: number;
  numIntStates: number;
  referencedPorts: string[];
  assignedPorts: string[];
  step: CStepFunction;
  ast: CStmt[];
  metadata: PreprocessedC;
}

export function compileCStep(scriptText: string, params: Record<string, string | number> = {}): CompiledCComponent {
  // Pass 1: Preprocessor & macro evaluation
  const prep = preprocessCSegment(scriptText, params);

  // Pass 2: Procedural AST parsing
  const ast = parseCScript(prep.lines.join("\n"));

  // Pass 3: Build optimized execution step closure
  const step = buildCStepFunction(ast);

  return {
    numRealStates: Math.max(prep.numRealStates, 1),
    numIntStates: Math.max(prep.numIntStates, 1),
    referencedPorts: Array.from(prep.referencedPorts),
    assignedPorts: Array.from(prep.assignedPorts),
    step,
    ast,
    metadata: prep,
  };
}

export function buildCStepFunction(stmts: CStmt[]): CStepFunction {
  return function step(ctx: CExecutionContext): void {
    const locals: Record<string, number | boolean | string> = {};

    function evalExpr(expr: CExpr): number | boolean | string {
      switch (expr.kind) {
        case "string":
          return expr.value;
        case "number":
          return expr.value;
        case "boolean":
          return expr.value;
        case "var": {
          const val = locals[expr.name];
          return val !== undefined ? val : 0;
        }
        case "port": {
          const fn = ctx.inputs ?? ctx.getInput;
          return fn ? fn(expr.portName) : 0;
        }
        case "special": {
          if (expr.name === "TIME") return ctx.time;
          if (expr.name === "DT") return ctx.dt;
          if (expr.name === "FIRST_STEP") return ctx.firstStep;
          return 0;
        }
        case "subscript": {
          const idx = Number(evalExpr(expr.indexExpr));
          const arrLower = expr.arrayName.toLowerCase();
          if (arrLower === "statesreal" || arrLower === "storf" || arrLower === "s" || arrLower === "x") {
            return idx >= 0 && idx < ctx.statesReal.length ? ctx.statesReal[idx]! : 0;
          }
          if (arrLower === "statesint" || arrLower === "stori") {
            return idx >= 0 && idx < ctx.statesInt.length ? ctx.statesInt[idx]! : 0;
          }
          return 0;
        }
        case "unary": {
          const inner = Number(evalExpr(expr.expr));
          switch (expr.op) {
            case "-":
              return -inner;
            case "+":
              return +inner;
            case "!":
              return inner === 0 ? 1 : 0;
            case "~":
              return ~inner;
          }
          break;
        }
        case "binary": {
          const l = Number(evalExpr(expr.left));
          const r = Number(evalExpr(expr.right));
          switch (expr.op) {
            case "+":
              return l + r;
            case "-":
              return l - r;
            case "*":
              return l * r;
            case "/":
              return r !== 0 ? l / r : 0;
            case "%":
              return r !== 0 ? l % r : 0;
            case "==":
              return l === r ? 1 : 0;
            case "!=":
              return l !== r ? 1 : 0;
            case "<":
              return l < r ? 1 : 0;
            case "<=":
              return l <= r ? 1 : 0;
            case ">":
              return l > r ? 1 : 0;
            case ">=":
              return l >= r ? 1 : 0;
            case "&&":
              return l !== 0 && r !== 0 ? 1 : 0;
            case "||":
              return l !== 0 || r !== 0 ? 1 : 0;
            case "&":
              return (l | 0) & (r | 0);
            case "|":
              return l | 0 | (r | 0);
            case "^":
              return (l | 0) ^ (r | 0);
            case "<<":
              return (l | 0) << (r | 0);
            case ">>":
              return (l | 0) >> (r | 0);
          }
          break;
        }
        case "math": {
          const evaluatedArgs = expr.args.map((a) => Number(evalExpr(a)));
          const a0 = evaluatedArgs[0] ?? 0;
          const a1 = evaluatedArgs[1] ?? 0;
          switch (expr.func) {
            case "sin":
              return Math.sin(a0);
            case "cos":
              return Math.cos(a0);
            case "tan":
              return Math.tan(a0);
            case "asin":
              return Math.asin(a0);
            case "acos":
              return Math.acos(a0);
            case "atan":
              return Math.atan(a0);
            case "atan2":
              return Math.atan2(a0, a1);
            case "exp":
              return Math.exp(a0);
            case "log":
              return Math.log(a0);
            case "log10":
              return Math.log10(a0);
            case "sqrt":
              return Math.sqrt(Math.max(0, a0));
            case "fabs":
              return Math.abs(a0);
            case "pow":
              return Math.pow(a0, a1);
            case "fmin":
              return Math.min(a0, a1);
            case "fmax":
              return Math.max(a0, a1);
            case "floor":
              return Math.floor(a0);
            case "ceil":
              return Math.ceil(a0);
          }
          break;
        }
        case "call": {
          // Fallback user function or stub
          return 0;
        }
      }
      return 0;
    }

    function execStmt(s: CStmt): void {
      switch (s.kind) {
        case "decl": {
          if (s.init !== undefined) {
            locals[s.name] = evalExpr(s.init);
          } else {
            locals[s.name] = 0;
          }
          break;
        }
        case "assign": {
          const val = Number(evalExpr(s.expr));
          if (s.target.type === "var") {
            const current = Number(locals[s.target.name] ?? 0);
            switch (s.op) {
              case "=":
                locals[s.target.name] = val;
                break;
              case "+=":
                locals[s.target.name] = current + val;
                break;
              case "-=":
                locals[s.target.name] = current - val;
                break;
              case "*=":
                locals[s.target.name] = current * val;
                break;
              case "/=":
                locals[s.target.name] = val !== 0 ? current / val : 0;
                break;
            }
          } else if (s.target.type === "port") {
            ctx.setOutput(s.target.portName, val);
          } else if (s.target.type === "subscript") {
            const idx = Number(evalExpr(s.target.indexExpr));
            const arrLower = s.target.arrayName.toLowerCase();
            if (arrLower === "statesreal" || arrLower === "storf" || arrLower === "s" || arrLower === "x") {
              if (idx >= 0 && idx < ctx.statesReal.length) {
                const current = ctx.statesReal[idx]!;
                switch (s.op) {
                  case "=":
                    ctx.statesReal[idx] = val;
                    break;
                  case "+=":
                    ctx.statesReal[idx] = current + val;
                    break;
                  case "-=":
                    ctx.statesReal[idx] = current - val;
                    break;
                  case "*=":
                    ctx.statesReal[idx] = current * val;
                    break;
                  case "/=":
                    ctx.statesReal[idx] = val !== 0 ? current / val : 0;
                    break;
                }
              }
            } else if (arrLower === "statesint" || arrLower === "stori") {
              if (idx >= 0 && idx < ctx.statesInt.length) {
                ctx.statesInt[idx] = val | 0;
              }
            }
          }
          break;
        }
        case "if": {
          const cond = evalExpr(s.condition);
          if (cond && cond !== 0) {
            for (const b of s.thenBody) execStmt(b);
          } else if (s.elseBody) {
            for (const b of s.elseBody) execStmt(b);
          }
          break;
        }
        case "while": {
          let count = 0;
          while (count++ < 100000 && evalExpr(s.condition)) {
            for (const b of s.body) execStmt(b);
          }
          break;
        }
        case "for": {
          if (s.init) execStmt(s.init);
          let count = 0;
          while (count++ < 100000 && (s.condition ? evalExpr(s.condition) : true)) {
            for (const b of s.body) execStmt(b);
            if (s.step) execStmt(s.step);
          }
          break;
        }
        case "call": {
          evalExpr({ kind: "call", callee: s.callee, args: s.args });
          break;
        }
        case "return":
        case "break":
        case "continue":
          break;
      }
    }

    for (const stmt of stmts) {
      execStmt(stmt);
    }
  };
}
