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
  const userFunctions = new Map<string, Extract<CStmt, { kind: "func" }>>();
  for (const s of stmts) {
    if (s.kind === "func" && s.body.length > 0) {
      userFunctions.set(s.name, s);
    }
  }

  return function step(ctx: CExecutionContext): void {
    const topLocals: Record<string, number | boolean | string> = {};
    const localArrays = new Map<string, Float64Array>();
    const pointerTargets = new Map<string, string>();
    let callDepth = 0;

    function applyTypeCast(targetType: string, rawVal: number | boolean | string): number {
      const v = Number(rawVal);
      if (isNaN(v)) return 0;
      const t = targetType.trim().toLowerCase();
      if (t === "bool") return v !== 0 ? 1 : 0;
      if (t === "float") return Math.fround(v);
      if (t === "uint32_t" || t === "unsigned" || t === "unsigned int" || t === "size_t") {
        return Math.trunc(v) >>> 0;
      }
      if (t === "uint16_t" || t === "unsigned short") {
        return Math.trunc(v) & 0xffff;
      }
      if (t === "uint8_t" || t === "unsigned char") {
        return Math.trunc(v) & 0xff;
      }
      if (
        t === "int" ||
        t === "int32_t" ||
        t === "short" ||
        t === "int16_t" ||
        t === "char" ||
        t === "int8_t" ||
        t === "long" ||
        t === "signed" ||
        t === "signed int"
      ) {
        return Math.trunc(v);
      }
      return v;
    }

    function runFrame(
      frameStmts: CStmt[],
      locals: Record<string, number | boolean | string>,
    ): number | boolean | string {
      let breaking = false;
      let continuing = false;
      let returning = false;
      let returnValue: number | boolean | string = 0;

      function evalExpr(expr: CExpr): number | boolean | string {
        switch (expr.kind) {
          case "string":
            return expr.value;
          case "number":
            return expr.value;
          case "boolean":
            return expr.value;
          case "var": {
            const val = locals[expr.name] ?? topLocals[expr.name];
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
            const idx = Math.trunc(Number(evalExpr(expr.indexExpr)));
            const localArr = localArrays.get(expr.arrayName);
            if (localArr) {
              return idx >= 0 && idx < localArr.length ? localArr[idx]! : 0;
            }
            const arrLower = expr.arrayName.toLowerCase();
            if (arrLower === "statesreal" || arrLower === "storf" || arrLower === "s" || arrLower === "x") {
              return idx >= 0 && idx < ctx.statesReal.length ? ctx.statesReal[idx]! : 0;
            }
            if (arrLower === "statesint" || arrLower === "stori") {
              return idx >= 0 && idx < ctx.statesInt.length ? ctx.statesInt[idx]! : 0;
            }
            return 0;
          }
          case "ternary": {
            const condVal = evalExpr(expr.cond);
            return condVal && condVal !== 0 ? evalExpr(expr.thenExpr) : evalExpr(expr.elseExpr);
          }
          case "cast": {
            return applyTypeCast(expr.targetType, evalExpr(expr.expr));
          }
          case "addressof": {
            return expr.varName;
          }
          case "deref": {
            if (expr.expr.kind === "var") {
              const targetVar = pointerTargets.get(expr.expr.name);
              if (targetVar) {
                return locals[targetVar] ?? topLocals[targetVar] ?? 0;
              }
            }
            return Number(evalExpr(expr.expr));
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
            const fnDef = userFunctions.get(expr.callee);
            if (fnDef && callDepth < 64) {
              const evaluatedArgs = expr.args.map((a) => evalExpr(a));
              const fnLocals: Record<string, number | boolean | string> = {};
              for (let i = 0; i < fnDef.params.length; i++) {
                fnLocals[fnDef.params[i]!.name] = evaluatedArgs[i] ?? 0;
              }
              callDepth++;
              try {
                return runFrame(fnDef.body, fnLocals);
              } finally {
                callDepth--;
              }
            }
            return 0;
          }
        }
        return 0;
      }

      function execBlock(block: CStmt[]): void {
        for (const b of block) {
          if (returning || breaking || continuing) break;
          execStmt(b);
        }
      }

      function execStmt(s: CStmt): void {
        if (returning || breaking || continuing) return;
        switch (s.kind) {
          case "func": {
            if (s.body.length > 0) {
              userFunctions.set(s.name, s);
            }
            break;
          }
          case "block": {
            execBlock(s.body);
            break;
          }
          case "decl": {
            if (s.arraySize !== undefined) {
              const buf = new Float64Array(s.arraySize);
              if (s.initElements) {
                for (let i = 0; i < Math.min(s.arraySize, s.initElements.length); i++) {
                  buf[i] = Number(evalExpr(s.initElements[i]!));
                }
              }
              localArrays.set(s.name, buf);
            } else if (s.isPointer) {
              if (s.init?.kind === "addressof") {
                pointerTargets.set(s.name, s.init.varName);
                locals[s.name] = 1;
              } else if (s.init) {
                locals[s.name] = evalExpr(s.init);
              } else {
                locals[s.name] = 0;
              }
            } else if (s.init !== undefined) {
              const rawInit = evalExpr(s.init);
              locals[s.name] = typeof rawInit === "number" ? applyTypeCast(s.varType, rawInit) : rawInit;
            } else {
              locals[s.name] = 0;
            }
            break;
          }
          case "assign": {
            if (s.expr.kind === "addressof" && s.target.type === "var") {
              pointerTargets.set(s.target.name, s.expr.varName);
              locals[s.target.name] = 1;
              break;
            }
            const val = Number(evalExpr(s.expr));
            if (s.target.type === "deref") {
              const targetVar = pointerTargets.get(s.target.pointerName);
              if (targetVar) {
                const targetStore = targetVar in locals || !(targetVar in topLocals) ? locals : topLocals;
                const current = Number(targetStore[targetVar] ?? 0);
                targetStore[targetVar] =
                  s.op === "+="
                    ? current + val
                    : s.op === "-="
                      ? current - val
                      : s.op === "*="
                        ? current * val
                        : s.op === "/="
                          ? val !== 0
                            ? current / val
                            : 0
                          : val;
              }
            } else if (s.target.type === "var") {
              const targetStore = s.target.name in locals || !(s.target.name in topLocals) ? locals : topLocals;
              const current = Number(targetStore[s.target.name] ?? 0);
              switch (s.op) {
                case "=":
                  targetStore[s.target.name] = val;
                  break;
                case "+=":
                  targetStore[s.target.name] = current + val;
                  break;
                case "-=":
                  targetStore[s.target.name] = current - val;
                  break;
                case "*=":
                  targetStore[s.target.name] = current * val;
                  break;
                case "/=":
                  targetStore[s.target.name] = val !== 0 ? current / val : 0;
                  break;
              }
            } else if (s.target.type === "port") {
              ctx.setOutput(s.target.portName, val);
            } else if (s.target.type === "subscript") {
              const idx = Math.trunc(Number(evalExpr(s.target.indexExpr)));
              const localArr = localArrays.get(s.target.arrayName);
              if (localArr) {
                if (idx >= 0 && idx < localArr.length) {
                  const current = localArr[idx]!;
                  localArr[idx] =
                    s.op === "+="
                      ? current + val
                      : s.op === "-="
                        ? current - val
                        : s.op === "*="
                          ? current * val
                          : s.op === "/="
                            ? val !== 0
                              ? current / val
                              : 0
                            : val;
                }
                break;
              }
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
              execBlock(s.thenBody);
            } else if (s.elseBody) {
              execBlock(s.elseBody);
            }
            break;
          }
          case "switch": {
            const disc = Number(evalExpr(s.expr));
            let startIdx = -1;
            let defaultIdx = -1;
            for (let i = 0; i < s.cases.length; i++) {
              const c = s.cases[i]!;
              if (c.isDefault && defaultIdx === -1) {
                defaultIdx = i;
              }
              if (c.values.some((v) => Number(evalExpr(v)) === disc)) {
                startIdx = i;
                break;
              }
            }
            if (startIdx === -1) {
              startIdx = defaultIdx;
            }
            if (startIdx !== -1) {
              for (let i = startIdx; i < s.cases.length; i++) {
                execBlock(s.cases[i]!.body);
                if (returning || continuing) break;
                if (breaking) {
                  breaking = false;
                  break;
                }
              }
            }
            break;
          }
          case "while": {
            let count = 0;
            while (count++ < 100000 && !returning && evalExpr(s.condition)) {
              execBlock(s.body);
              if (returning) break;
              if (breaking) {
                breaking = false;
                break;
              }
              if (continuing) {
                continuing = false;
              }
            }
            break;
          }
          case "for": {
            if (s.init) execStmt(s.init);
            let count = 0;
            while (count++ < 100000 && !returning && (s.condition ? evalExpr(s.condition) : true)) {
              execBlock(s.body);
              if (returning) break;
              if (breaking) {
                breaking = false;
                break;
              }
              if (continuing) {
                continuing = false;
              }
              if (s.step) execStmt(s.step);
            }
            break;
          }
          case "call": {
            evalExpr({ kind: "call", callee: s.callee, args: s.args });
            break;
          }
          case "return": {
            returnValue = s.expr !== undefined ? evalExpr(s.expr) : 0;
            returning = true;
            break;
          }
          case "break": {
            breaking = true;
            break;
          }
          case "continue": {
            continuing = true;
            break;
          }
        }
      }

      execBlock(frameStmts);
      return returnValue;
    }

    runFrame(stmts, topLocals);
  };
}
