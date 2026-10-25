// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Performance Simulation Step Compiler for Fortran.
 *
 * Compiles procedural Fortran AST into zero-allocation step execution closures
 * for time-stepping simulation runners (PSCAD EmtSolver, EASY5 discrete blocks, etc.).
 */

import { parseFortranScript, type FortranExpr, type FortranStmt } from "../ast.js";
import { preprocessFortranSegment, type PreprocessedFortran } from "../preprocessor.js";

export interface FortranExecutionContext {
  time: number;
  dt: number;
  firstStep: boolean;
  inputs?: ((portName: string) => number) | undefined;
  getInput?: ((portName: string) => number) | undefined;
  setOutput: (portName: string, value: number) => void;
  storf: Float64Array;
  stori: Int32Array;
  injectCurrent?: ((nodeA: string, nodeB: string, currentAmp: number) => void) | undefined;
  stampBranch?: ((nodeA: string, nodeB: string, r: number, l: number, c: number, e: number) => void) | undefined;
}

export type FortranStepFunction = (ctx: FortranExecutionContext) => void;

export interface CompiledFortranComponent {
  numRealStates: number;
  numIntStates: number;
  referencedPorts: string[];
  assignedPorts: string[];
  step: FortranStepFunction;
  ast: FortranStmt[];
  metadata: PreprocessedFortran;
}

/**
 * Compiles a Fortran script segment into a fast execution closure.
 */
export function compileFortranStep(
  scriptText: string,
  params: Record<string, string | number> = {},
  portDims: Record<string, number> = {},
): CompiledFortranComponent {
  // Pass 1: Preprocessing & Storage Directives
  const prep = preprocessFortranSegment(scriptText, params, portDims);

  // Pass 2: Parsing procedural AST
  const ast = parseFortranScript(prep.lines.join("\n"));

  // Pass 3: Construct execution step closure
  const step = buildStepFunction(ast);

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

export const compileFortranSegment = compileFortranStep;

export function buildStepFunction(stmts: FortranStmt[]): FortranStepFunction {
  return function step(ctx: FortranExecutionContext): void {
    const locals: Record<string, number | boolean | string> = {};
    let nstorf = 0;
    let nstori = 0;

    function evalExpr(expr: FortranExpr): number | boolean | string {
      switch (expr.kind) {
        case "string":
          return expr.value;
        case "number":
          return expr.value;
        case "boolean":
          return expr.value;
        case "var": {
          const upper = expr.name.toUpperCase();
          if (upper === "NSTORF") return nstorf;
          if (upper === "NSTORI") return nstori;
          const val = locals[expr.name] ?? locals[expr.name.toLowerCase()] ?? locals[upper];
          return val !== undefined ? val : 0;
        }
        case "port": {
          const fn = ctx.inputs ?? (ctx as any).getInput;
          return fn ? fn(expr.portName) : 0;
        }
        case "special": {
          if (expr.name === "TIME") return ctx.time;
          if (expr.name === "DELT") return ctx.dt;
          if (expr.name === "FIRSTSTEP") return ctx.firstStep;
          return 0;
        }
        case "state": {
          const rawIdx = evalExpr(expr.indexExpr);
          const idx = Math.trunc(Number(rawIdx));
          if (expr.array === "storf") {
            return idx >= 0 && idx < ctx.storf.length ? ctx.storf[idx]! : 0;
          } else {
            return idx >= 0 && idx < ctx.stori.length ? ctx.stori[idx]! : 0;
          }
        }
        case "unary": {
          const inner = evalExpr(expr.expr);
          if (expr.op === "!") return !inner;
          if (expr.op === "-") return -Number(inner);
          return inner;
        }
        case "binary": {
          const l = evalExpr(expr.left);
          const r = evalExpr(expr.right);
          switch (expr.op) {
            case "+":
              return Number(l) + Number(r);
            case "-":
              return Number(l) - Number(r);
            case "*":
              return Number(l) * Number(r);
            case "/":
              return Number(l) / (Number(r) || 1e-12);
            case "^":
              return Math.pow(Number(l), Number(r));
            case "==":
              return l === r;
            case "!=":
              return l !== r;
            case "<":
              return Number(l) < Number(r);
            case "<=":
              return Number(l) <= Number(r);
            case ">":
              return Number(l) > Number(r);
            case ">=":
              return Number(l) >= Number(r);
            case "&&":
              return Boolean(l) && Boolean(r);
            case "||":
              return Boolean(l) || Boolean(r);
            default:
              return 0;
          }
        }
        case "math": {
          const evaluatedArgs = expr.args.map((a) => Number(evalExpr(a)));
          const a0 = evaluatedArgs[0] ?? 0;
          const a1 = evaluatedArgs[1] ?? 0;
          switch (expr.func) {
            case "sqrt":
              return Math.sqrt(Math.max(0, a0));
            case "abs":
              return Math.abs(a0);
            case "sin":
              return Math.sin(a0);
            case "cos":
              return Math.cos(a0);
            case "tan":
              return Math.tan(a0);
            case "asin":
              return Math.asin(Math.max(-1, Math.min(1, a0)));
            case "acos":
              return Math.acos(Math.max(-1, Math.min(1, a0)));
            case "atan":
              return Math.atan(a0);
            case "atan2":
              return Math.atan2(a0, a1);
            case "exp":
              return Math.exp(Math.min(100, Math.max(-100, a0)));
            case "log":
              return Math.log(Math.max(1e-12, a0));
            case "log10":
              return Math.log10(Math.max(1e-12, a0));
            case "min":
              return Math.min(...evaluatedArgs);
            case "max":
              return Math.max(...evaluatedArgs);
            default:
              return a0;
          }
        }
      }
    }

    function evalNodeStr(expr: FortranExpr): string {
      if (expr.kind === "string") return expr.value;
      if (expr.kind === "var") {
        const val = locals[expr.name] ?? locals[expr.name.toLowerCase()] ?? locals[expr.name.toUpperCase()];
        return typeof val === "string" ? val : expr.name;
      }
      if (expr.kind === "port") return expr.portName;
      return String(evalExpr(expr));
    }

    function assignTarget(expr: FortranExpr, val: number): void {
      if (expr.kind === "port") {
        ctx.setOutput(expr.portName, Number(val));
      } else if (expr.kind === "var") {
        const upper = expr.name.toUpperCase();
        if (upper === "NSTORF") nstorf = Math.trunc(Number(val));
        else if (upper === "NSTORI") nstori = Math.trunc(Number(val));
        else locals[expr.name] = val;
      } else if (expr.kind === "state") {
        const rawIdx = evalExpr(expr.indexExpr);
        const idx = Math.trunc(Number(rawIdx));
        if (expr.array === "storf") {
          if (idx >= 0 && idx < ctx.storf.length) ctx.storf[idx] = Number(val);
        } else {
          if (idx >= 0 && idx < ctx.stori.length) ctx.stori[idx] = Math.trunc(Number(val));
        }
      }
    }

    function execStmt(stmt: FortranStmt): void {
      switch (stmt.kind) {
        case "assign": {
          const val = evalExpr(stmt.expr);
          const t = stmt.target;
          if (t.type === "port") {
            ctx.setOutput(t.portName, Number(val));
          } else if (t.type === "state") {
            const rawIdx = evalExpr(t.indexExpr);
            const idx = Math.trunc(Number(rawIdx));
            if (t.array === "storf") {
              if (idx >= 0 && idx < ctx.storf.length) ctx.storf[idx] = Number(val);
            } else {
              if (idx >= 0 && idx < ctx.stori.length) ctx.stori[idx] = Math.trunc(Number(val));
            }
          } else if (t.type === "var") {
            const upper = t.name.toUpperCase();
            if (upper === "NSTORF") nstorf = Math.trunc(Number(val));
            else if (upper === "NSTORI") nstori = Math.trunc(Number(val));
            else locals[t.name] = val;
          }
          break;
        }
        case "stateAdvance": {
          if (stmt.array === "storf") nstorf += stmt.delta;
          else if (stmt.array === "stori") nstori += stmt.delta;
          break;
        }
        case "if": {
          const cond = Boolean(evalExpr(stmt.condition));
          if (cond) {
            for (const s of stmt.thenBody) execStmt(s);
          } else if (stmt.elseBody) {
            for (const s of stmt.elseBody) execStmt(s);
          }
          break;
        }
        case "call": {
          const subName = stmt.subroutine.toUpperCase();
          const args = stmt.args;

          switch (subName) {
            case "REALPOLE": {
              // Signature: REALPOLE([ICALL], K, T, Vin, Vout)
              const [kExpr, tExpr, inExpr, outExpr] =
                args.length >= 5 ? [args[1]!, args[2]!, args[3]!, args[4]!] : [args[0]!, args[1]!, args[2]!, args[3]!];
              if (!outExpr) break;

              const K = Number(evalExpr(kExpr));
              const T = Math.max(1e-9, Number(evalExpr(tExpr)));
              const u = Number(evalExpr(inExpr));
              const dt = ctx.dt;

              const sIdx = nstorf;
              nstorf += 2;

              let y: number;
              if (ctx.firstStep) {
                y = K * u;
                if (sIdx + 1 < ctx.storf.length) {
                  ctx.storf[sIdx] = y;
                  ctx.storf[sIdx + 1] = u;
                }
              } else {
                const yPrev = sIdx < ctx.storf.length ? ctx.storf[sIdx]! : 0;
                const uPrev = sIdx + 1 < ctx.storf.length ? ctx.storf[sIdx + 1]! : 0;
                const D = 2 * T + dt;
                const a = (2 * T - dt) / D;
                const b = (K * dt) / D;
                y = a * yPrev + b * (u + uPrev);
                if (sIdx + 1 < ctx.storf.length) {
                  ctx.storf[sIdx] = y;
                  ctx.storf[sIdx + 1] = u;
                }
              }
              assignTarget(outExpr, y);
              break;
            }

            case "DELAY1": {
              // Signature: DELAY1([ICALL], Vin, Vout)
              const [inExpr, outExpr] = args.length >= 3 ? [args[1]!, args[2]!] : [args[0]!, args[1]!];
              if (!outExpr) break;

              const u = Number(evalExpr(inExpr));
              const sIdx = nstorf++;

              let y: number;
              if (ctx.firstStep) {
                y = u;
                if (sIdx < ctx.storf.length) ctx.storf[sIdx] = u;
              } else {
                y = sIdx < ctx.storf.length ? ctx.storf[sIdx]! : u;
                if (sIdx < ctx.storf.length) ctx.storf[sIdx] = u;
              }
              assignTarget(outExpr, y);
              break;
            }

            case "INTGRL": {
              // Signature: INTGRL([ICALL], K, Vin, Vout)
              const [kExpr, inExpr, outExpr] =
                args.length >= 4 ? [args[1]!, args[2]!, args[3]!] : [args[0]!, args[1]!, args[2]!];
              if (!outExpr) break;

              const K = Number(evalExpr(kExpr));
              const u = Number(evalExpr(inExpr));
              const dt = ctx.dt;

              const sIdx = nstorf;
              nstorf += 2;

              let y: number;
              if (ctx.firstStep) {
                y = 0;
                if (sIdx + 1 < ctx.storf.length) {
                  ctx.storf[sIdx] = 0;
                  ctx.storf[sIdx + 1] = u;
                }
              } else {
                const yPrev = sIdx < ctx.storf.length ? ctx.storf[sIdx]! : 0;
                const uPrev = sIdx + 1 < ctx.storf.length ? ctx.storf[sIdx + 1]! : 0;
                y = yPrev + 0.5 * K * dt * (u + uPrev);
                if (sIdx + 1 < ctx.storf.length) {
                  ctx.storf[sIdx] = y;
                  ctx.storf[sIdx + 1] = u;
                }
              }
              assignTarget(outExpr, y);
              break;
            }

            case "LEADLAG": {
              // Signature: LEADLAG([ICALL], K, T1, T2, Vin, Vout)
              const [kExpr, t1Expr, t2Expr, inExpr, outExpr] =
                args.length >= 6
                  ? [args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]
                  : [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!];
              if (!outExpr) break;

              const K = Number(evalExpr(kExpr));
              const T1 = Number(evalExpr(t1Expr));
              const T2 = Math.max(1e-9, Number(evalExpr(t2Expr)));
              const u = Number(evalExpr(inExpr));
              const dt = ctx.dt;

              const sIdx = nstorf;
              nstorf += 2;

              let y: number;
              if (ctx.firstStep) {
                y = K * u;
                if (sIdx + 1 < ctx.storf.length) {
                  ctx.storf[sIdx] = y;
                  ctx.storf[sIdx + 1] = u;
                }
              } else {
                const yPrev = sIdx < ctx.storf.length ? ctx.storf[sIdx]! : 0;
                const uPrev = sIdx + 1 < ctx.storf.length ? ctx.storf[sIdx + 1]! : 0;
                const D = 2 * T2 + dt;
                const a = (2 * T2 - dt) / D;
                const b0 = (K * (2 * T1 + dt)) / D;
                const b1 = (-K * (2 * T1 - dt)) / D;
                y = a * yPrev + b0 * u + b1 * uPrev;
                if (sIdx + 1 < ctx.storf.length) {
                  ctx.storf[sIdx] = y;
                  ctx.storf[sIdx + 1] = u;
                }
              }
              assignTarget(outExpr, y);
              break;
            }

            case "DIFF": {
              // Signature: DIFF([ICALL], K, T, Vin, Vout)
              const [kExpr, tExpr, inExpr, outExpr] =
                args.length >= 5 ? [args[1]!, args[2]!, args[3]!, args[4]!] : [args[0]!, args[1]!, args[2]!, args[3]!];
              if (!outExpr) break;

              const K = Number(evalExpr(kExpr));
              const T = Math.max(1e-9, Number(evalExpr(tExpr)));
              const u = Number(evalExpr(inExpr));
              const dt = ctx.dt;

              const sIdx = nstorf;
              nstorf += 2;

              let y: number;
              if (ctx.firstStep) {
                y = 0;
                if (sIdx + 1 < ctx.storf.length) {
                  ctx.storf[sIdx] = 0;
                  ctx.storf[sIdx + 1] = u;
                }
              } else {
                const yPrev = sIdx < ctx.storf.length ? ctx.storf[sIdx]! : 0;
                const uPrev = sIdx + 1 < ctx.storf.length ? ctx.storf[sIdx + 1]! : 0;
                const D = 2 * T + dt;
                const a = (2 * T - dt) / D;
                const b = (2 * K) / D;
                y = a * yPrev + b * (u - uPrev);
                if (sIdx + 1 < ctx.storf.length) {
                  ctx.storf[sIdx] = y;
                  ctx.storf[sIdx + 1] = u;
                }
              }
              assignTarget(outExpr, y);
              break;
            }

            case "LIMITER":
            case "LIMIT":
            case "HARDLIMIT": {
              // Signature: LIMITER/HARDLIMIT([ICALL], Vin, Vmin, Vmax, Vout) or (Vin, Vmin, Vmax, Vout)
              const [inExpr, minExpr, maxExpr, outExpr] =
                args.length >= 5 ? [args[1]!, args[2]!, args[3]!, args[4]!] : [args[0]!, args[1]!, args[2]!, args[3]!];
              if (!outExpr) break;

              const u = Number(evalExpr(inExpr));
              const lo = Number(evalExpr(minExpr));
              const hi = Number(evalExpr(maxExpr));
              const y = Math.min(hi, Math.max(lo, u));
              assignTarget(outExpr, y);
              break;
            }

            case "CMPLX_POLAR": {
              // Signature: CMPLX_POLAR([ICALL], Re, Im, Mag, PhaseDeg)
              const [reExpr, imExpr, magExpr, phExpr] =
                args.length >= 5 ? [args[1]!, args[2]!, args[3]!, args[4]!] : [args[0]!, args[1]!, args[2]!, args[3]!];
              const re = Number(evalExpr(reExpr));
              const im = Number(evalExpr(imExpr));
              const mag = Math.sqrt(re * re + im * im);
              const ph = (Math.atan2(im, re) * 180) / Math.PI;
              if (magExpr) assignTarget(magExpr, mag);
              if (phExpr) assignTarget(phExpr, ph);
              break;
            }

            case "SIN_COS": {
              // Signature: SIN_COS([ICALL], Theta, SinOut, CosOut)
              const [thExpr, sOut, cOut] =
                args.length >= 4 ? [args[1]!, args[2]!, args[3]!] : [args[0]!, args[1]!, args[2]!];
              const th = Number(evalExpr(thExpr));
              if (sOut) assignTarget(sOut, Math.sin(th));
              if (cOut) assignTarget(cOut, Math.cos(th));
              break;
            }

            case "CURRENT_SOURCE": {
              // Signature: CURRENT_SOURCE([ICALL], NodeA, NodeB, I)
              const [naExpr, nbExpr, iExpr] =
                args.length >= 4 ? [args[1]!, args[2]!, args[3]!] : [args[0]!, args[1]!, args[2]!];
              if (ctx.injectCurrent && naExpr && nbExpr && iExpr) {
                const nodeA = evalNodeStr(naExpr);
                const nodeB = evalNodeStr(nbExpr);
                const iVal = Number(evalExpr(iExpr));
                ctx.injectCurrent(nodeA, nodeB, iVal);
              }
              break;
            }

            case "E_BRANCH": {
              // Signature: E_BRANCH([ICALL], NodeA, NodeB, R, L, C, E)
              if (ctx.stampBranch && args.length >= 6) {
                const [naExpr, nbExpr, rExpr, lExpr, cExpr, eExpr] =
                  args.length >= 7
                    ? [args[1]!, args[2]!, args[3]!, args[4]!, args[5]!, args[6]!]
                    : [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!];
                const nodeA = evalNodeStr(naExpr);
                const nodeB = evalNodeStr(nbExpr);
                const R = Number(evalExpr(rExpr));
                const L = Number(evalExpr(lExpr));
                const C = Number(evalExpr(cExpr));
                const E = Number(evalExpr(eExpr));
                ctx.stampBranch(nodeA, nodeB, R, L, C, E);
              }
              break;
            }

            default:
              break;
          }
          break;
        }
      }
    }

    for (const s of stmts) {
      execStmt(s);
    }
  };
}
