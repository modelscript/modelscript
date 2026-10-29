// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * High-Performance Simulation Step Compiler for Fortran.
 *
 * Compiles procedural Fortran AST into zero-allocation step execution closures
 * for time-stepping simulation runners (PSCAD EmtSolver, EASY5 discrete blocks, etc.).
 */

import {
  parseFortranModule,
  type FortranArraySpec,
  type FortranExpr,
  type FortranModuleAst,
  type FortranRoutineSignature,
  type FortranStmt,
  type FortranSubscript,
  type FortranUnitAst,
} from "../ast.js";
import { preprocessFortranSegment, type PreprocessedFortran } from "../preprocessor.js";

export interface RuntimeFortranArray {
  data: Float64Array;
  dims: { lower: number; upper: number }[];
  allocated: boolean;
}

export interface FortranExecutionContext {
  time: number;
  dt: number;
  firstStep: boolean;
  inputs?: ((portName: string) => number) | undefined;
  getInput?: ((portName: string) => number) | undefined;
  setOutput: (portName: string, value: number) => void;
  storf: Float64Array;
  stori: Int32Array;
  locals?: Record<string, number | boolean | string> | undefined;
  arrays?: Record<string, RuntimeFortranArray> | undefined;
  onStatementSync?: ((line: number, locals: Record<string, number | boolean | string>) => void) | undefined;
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
  signature: FortranRoutineSignature;
  moduleAst: FortranModuleAst;
}

function createRuntimeArrayFromSpec(spec: FortranArraySpec): RuntimeFortranArray {
  if (spec.allocatable || spec.dims.length === 0) {
    return {
      data: new Float64Array(0),
      dims: [],
      allocated: false,
    };
  }
  let total = 1;
  for (const d of spec.dims) {
    total *= Math.max(0, d.upper - d.lower + 1);
  }
  return {
    data: new Float64Array(Math.max(0, Math.min(total, 1_000_000))),
    dims: spec.dims.map((d) => ({ ...d })),
    allocated: true,
  };
}

function computeColumnMajorOffset(dims: { lower: number; upper: number }[], indices: number[]): number {
  let offset = 0;
  let stride = 1;
  for (let d = 0; d < dims.length; d++) {
    const bound = dims[d]!;
    const idx = indices[d] ?? bound.lower;
    if (idx < bound.lower || idx > bound.upper) return -1;
    offset += (idx - bound.lower) * stride;
    stride *= Math.max(1, bound.upper - bound.lower + 1);
  }
  return offset;
}

/**
 * Compiles a Fortran script segment or multi-unit module into a fast execution closure.
 */
export function compileFortranStep(
  scriptText: string,
  params: Record<string, string | number> = {},
  portDims: Record<string, number> = {},
): CompiledFortranComponent {
  // Pass 1: Preprocessing & Storage Directives
  const prep = preprocessFortranSegment(scriptText, params, portDims);
  const hasDirectives = /^\s*#/m.test(scriptText) || /\$#DIM/i.test(scriptText);
  const effectiveSource = hasDirectives ? prep.lines.join("\n") : scriptText;

  // Pass 2: Parse multi-unit module or single script
  const moduleAst = parseFortranModule(effectiveSource);
  const entry = moduleAst.entryUnit;
  const signature = entry.signature;
  const ast = entry.stmts;

  // Pass 3: Construct execution step closure
  const step = buildStepFunction(ast, signature.constants, signature.arrays, moduleAst);

  return {
    numRealStates: Math.max(prep.numRealStates, 1),
    numIntStates: Math.max(prep.numIntStates, 1),
    referencedPorts: Array.from(prep.referencedPorts),
    assignedPorts: Array.from(prep.assignedPorts),
    step,
    ast,
    metadata: prep,
    signature,
    moduleAst,
  };
}

export const compileFortranSegment = compileFortranStep;

export function buildStepFunction(
  stmts: FortranStmt[],
  initialConstants: Record<string, number> = {},
  initialArraySpecs: Record<string, FortranArraySpec> = {},
  moduleAst?: FortranModuleAst,
  callDepth: number = 0,
): FortranStepFunction {
  return function step(ctx: FortranExecutionContext): void {
    const locals: Record<string, number | boolean | string> = ctx.locals ?? {};
    const arrays: Record<string, RuntimeFortranArray> = ctx.arrays ?? {};

    for (const [k, v] of Object.entries(initialConstants)) {
      if (locals[k] === undefined && locals[k.toLowerCase()] === undefined && locals[k.toUpperCase()] === undefined) {
        locals[k] = v;
      }
    }
    for (const [arrName, spec] of Object.entries(initialArraySpecs)) {
      const existing = arrays[arrName] ?? arrays[arrName.toLowerCase()] ?? arrays[arrName.toUpperCase()];
      if (!existing) {
        arrays[arrName] = createRuntimeArrayFromSpec(spec);
      }
    }

    let nstorf = 0;
    let nstori = 0;

    function getArray(name: string): RuntimeFortranArray | undefined {
      return arrays[name] ?? arrays[name.toLowerCase()] ?? arrays[name.toUpperCase()];
    }

    function setArray(name: string, arr: RuntimeFortranArray): void {
      arrays[name] = arr;
    }

    function syncSmallArrayToLocals(name: string, arr: RuntimeFortranArray): void {
      if (arr.allocated && arr.data.length > 0 && arr.data.length <= 16 && arr.dims.length === 1) {
        const lo = arr.dims[0]!.lower;
        for (let i = 0; i < arr.data.length; i++) {
          locals[`${name}(${lo + i})`] = arr.data[i]!;
        }
      }
    }

    function expandSubscriptIndices(arr: RuntimeFortranArray, subscripts: FortranSubscript[]): number[][] {
      if (!arr.allocated || arr.dims.length === 0) return [];
      const dimRanges: number[][] = [];
      for (let d = 0; d < arr.dims.length; d++) {
        const bound = arr.dims[d]!;
        const sub = subscripts[d];
        if (!sub) {
          const all: number[] = [];
          for (let k = bound.lower; k <= bound.upper; k++) all.push(k);
          dimRanges.push(all);
        } else if (sub.kind === "index") {
          dimRanges.push([Math.trunc(Number(evalExpr(sub.expr)))]);
        } else {
          const start = sub.start ? Math.trunc(Number(evalExpr(sub.start))) : bound.lower;
          const end = sub.end ? Math.trunc(Number(evalExpr(sub.end))) : bound.upper;
          const stride = sub.stride ? Math.trunc(Number(evalExpr(sub.stride))) : 1;
          const range: number[] = [];
          if (stride !== 0) {
            for (let k = start; stride > 0 ? k <= end : k >= end; k += stride) {
              range.push(k);
            }
          }
          dimRanges.push(range);
        }
      }

      // Column-major cartesian product (first dimension varies fastest)
      let coords: number[][] = [[]];
      for (let d = 0; d < dimRanges.length; d++) {
        const nextCoords: number[][] = [];
        for (const prefix of coords) {
          for (const val of dimRanges[d]!) {
            nextCoords.push([...prefix, val]);
          }
        }
        coords = nextCoords;
      }
      return coords;
    }

    function evalArrayValues(expr: FortranExpr): number[] | null {
      if (expr.kind === "arrayConstructor") {
        return expr.elements.map((e) => Number(evalExpr(e)));
      }
      if (expr.kind === "var") {
        const arr = getArray(expr.name);
        if (arr && arr.allocated) return Array.from(arr.data);
      }
      if (expr.kind === "arrayAccess") {
        const arr = getArray(expr.name);
        if (arr && arr.allocated) {
          const coords = expandSubscriptIndices(arr, expr.subscripts);
          if (coords.length > 1 || expr.subscripts.some((s) => s.kind === "slice")) {
            return coords.map((c) => {
              const off = computeColumnMajorOffset(arr.dims, c);
              return off >= 0 && off < arr.data.length ? arr.data[off]! : 0;
            });
          }
        }
      }
      if (expr.kind === "math" && expr.func === "matmul" && expr.args.length >= 2) {
        const aArg = expr.args[0]!;
        const bArg = expr.args[1]!;
        const arrA = aArg.kind === "var" ? getArray(aArg.name) : undefined;
        const arrB = bArg.kind === "var" ? getArray(bArg.name) : undefined;
        if (arrA?.allocated && arrB?.allocated && arrA.dims.length === 2 && arrB.dims.length >= 1) {
          const m = arrA.dims[0]!.upper - arrA.dims[0]!.lower + 1;
          const kDim = arrA.dims[1]!.upper - arrA.dims[1]!.lower + 1;
          if (arrB.dims.length === 1) {
            const out = new Array<number>(m).fill(0);
            for (let i = 0; i < m; i++) {
              let sum = 0;
              for (let p = 0; p < kDim; p++) {
                sum += (arrA.data[i + p * m] ?? 0) * (arrB.data[p] ?? 0);
              }
              out[i] = sum;
            }
            return out;
          } else {
            const n = arrB.dims[1]!.upper - arrB.dims[1]!.lower + 1;
            const out = new Array<number>(m * n).fill(0);
            for (let j = 0; j < n; j++) {
              for (let i = 0; i < m; i++) {
                let sum = 0;
                for (let p = 0; p < kDim; p++) {
                  sum += (arrA.data[i + p * m] ?? 0) * (arrB.data[p + j * kDim] ?? 0);
                }
                out[i + j * m] = sum;
              }
            }
            return out;
          }
        }
      }
      if (expr.kind === "unary") {
        const inner = evalArrayValues(expr.expr);
        if (inner) {
          return expr.op === "-" ? inner.map((x) => -x) : inner;
        }
      }
      if (expr.kind === "binary") {
        const leftArr = evalArrayValues(expr.left);
        const rightArr = evalArrayValues(expr.right);
        if (leftArr || rightArr) {
          const leftVals = leftArr ?? [Number(evalExpr(expr.left))];
          const rightVals = rightArr ?? [Number(evalExpr(expr.right))];
          const len = Math.max(leftVals.length, rightVals.length);
          const out = new Array<number>(len);
          for (let i = 0; i < len; i++) {
            const l = leftVals.length === 1 ? leftVals[0]! : (leftVals[i] ?? 0);
            const r = rightVals.length === 1 ? rightVals[0]! : (rightVals[i] ?? 0);
            switch (expr.op) {
              case "+":
                out[i] = l + r;
                break;
              case "-":
                out[i] = l - r;
                break;
              case "*":
                out[i] = l * r;
                break;
              case "/":
                out[i] = r !== 0 ? l / r : 0;
                break;
              case "^":
                out[i] = Math.pow(l, r);
                break;
              default:
                out[i] = 0;
            }
          }
          return out;
        }
      }
      return null;
    }

    function invokeUserUnit(
      callee: FortranUnitAst,
      callArgs: FortranExpr[],
    ): Record<string, number | boolean | string> {
      const childLocals: Record<string, number | boolean | string> = {
        ...moduleAst?.moduleConstants,
        ...callee.signature.constants,
      };
      const childArrays: Record<string, RuntimeFortranArray> = {};
      for (const [aName, spec] of Object.entries(callee.signature.arrays)) {
        childArrays[aName] = createRuntimeArrayFromSpec(spec);
      }

      const formalArgs = callee.signature.args;
      for (let i = 0; i < formalArgs.length; i++) {
        const formal = formalArgs[i]!;
        const actual = callArgs[i];
        if (!actual) continue;

        if (actual.kind === "var") {
          const callerArr = getArray(actual.name);
          if (callerArr) {
            childArrays[formal] = callerArr;
            continue;
          }
        }
        const val = evalExpr(actual);
        childLocals[formal] = val;
      }

      if (callDepth < 16) {
        const childStep = buildStepFunction(
          callee.stmts,
          callee.signature.constants,
          callee.signature.arrays,
          moduleAst,
          callDepth + 1,
        );
        childStep({
          ...ctx,
          locals: childLocals,
          arrays: childArrays,
        });
      }

      // Copy back intent(out) / intent(inout) or unassigned positional variable arguments
      const outSet = new Set(callee.signature.outputs.map((o) => o.toUpperCase()));
      const inOnlySet = new Set(
        callee.signature.inputs.filter((inp) => !outSet.has(inp.toUpperCase())).map((inp) => inp.toUpperCase()),
      );

      for (let i = 0; i < formalArgs.length; i++) {
        const formal = formalArgs[i]!;
        const actual = callArgs[i];
        if (!actual || inOnlySet.has(formal.toUpperCase())) continue;

        const outVal = childLocals[formal] ?? childLocals[formal.toLowerCase()] ?? childLocals[formal.toUpperCase()];
        if (outVal !== undefined && typeof outVal === "number") {
          assignTarget(actual, outVal);
        }
      }

      return childLocals;
    }

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
          const fn = ctx.inputs ?? ctx.getInput;
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
        case "arrayConstructor": {
          return expr.elements.length > 0 ? Number(evalExpr(expr.elements[0]!)) : 0;
        }
        case "arrayAccess": {
          const arr = getArray(expr.name);
          if (arr && arr.allocated) {
            const coords = expandSubscriptIndices(arr, expr.subscripts);
            if (coords.length > 0) {
              const off = computeColumnMajorOffset(arr.dims, coords[0]!);
              return off >= 0 && off < arr.data.length ? arr.data[off]! : 0;
            }
            return 0;
          }
          // Check user-defined FUNCTION in moduleAst
          const callee = moduleAst?.units.get(expr.name.toUpperCase());
          if (callee) {
            const argExprs: FortranExpr[] = expr.subscripts.map((s) =>
              s.kind === "index" ? s.expr : (s.start ?? { kind: "number", value: 0 }),
            );
            const childLocals = invokeUserUnit(callee, argExprs);
            const retName = callee.returnVar ?? callee.name;
            const retVal =
              childLocals[retName] ?? childLocals[retName.toLowerCase()] ?? childLocals[retName.toUpperCase()];
            return retVal !== undefined ? retVal : 0;
          }
          return 0;
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
          // Array intrinsics: sum, maxval, minval, size, dot_product, matmul
          if (expr.func === "sum" || expr.func === "maxval" || expr.func === "minval" || expr.func === "size") {
            const firstArg = expr.args[0];
            const vals = firstArg ? evalArrayValues(firstArg) : null;
            if (vals) {
              if (expr.func === "size") return vals.length;
              if (vals.length === 0) return 0;
              if (expr.func === "sum") return vals.reduce((a, b) => a + b, 0);
              if (expr.func === "maxval") return Math.max(...vals);
              if (expr.func === "minval") return Math.min(...vals);
            }
          }
          if (expr.func === "dot_product" && expr.args.length >= 2) {
            const v1 = evalArrayValues(expr.args[0]!);
            const v2 = evalArrayValues(expr.args[1]!);
            if (v1 && v2) {
              const len = Math.min(v1.length, v2.length);
              let dot = 0;
              for (let i = 0; i < len; i++) dot += v1[i]! * v2[i]!;
              return dot;
            }
          }
          if (expr.func === "matmul" && expr.args.length >= 2) {
            const matVals = evalArrayValues(expr);
            if (matVals && matVals.length > 0) return matVals[0]!;
          }

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
      } else if (expr.kind === "arrayAccess") {
        const arr = getArray(expr.name);
        if (arr && arr.allocated) {
          const coords = expandSubscriptIndices(arr, expr.subscripts);
          for (const c of coords) {
            const off = computeColumnMajorOffset(arr.dims, c);
            if (off >= 0 && off < arr.data.length) arr.data[off] = Number(val);
          }
          syncSmallArrayToLocals(expr.name, arr);
        }
      }
    }

    function execStmt(stmt: FortranStmt): void {
      if (stmt.line !== undefined && ctx.onStatementSync) {
        ctx.onStatementSync(stmt.line, locals);
      }
      switch (stmt.kind) {
        case "allocate": {
          for (const item of stmt.items) {
            const dims = item.dims.map((d) => ({
              lower: d.lower ? Math.trunc(Number(evalExpr(d.lower))) : 1,
              upper: Math.trunc(Number(evalExpr(d.upper))),
            }));
            let total = 1;
            for (const d of dims) {
              total *= Math.max(0, d.upper - d.lower + 1);
            }
            const arr: RuntimeFortranArray = {
              data: new Float64Array(Math.max(0, Math.min(total, 1_000_000))),
              dims,
              allocated: true,
            };
            setArray(item.name, arr);
            syncSmallArrayToLocals(item.name, arr);
          }
          break;
        }
        case "deallocate": {
          for (const name of stmt.names) {
            const existing = getArray(name);
            if (existing) {
              existing.data = new Float64Array(0);
              existing.dims = [];
              existing.allocated = false;
            }
          }
          break;
        }
        case "assign": {
          const t = stmt.target;
          if (t.type === "array") {
            let arr = getArray(t.name);
            if (!arr) {
              // Implicit 1D/ND array auto-vivification if undeclared
              const dims = t.subscripts.map((s) => ({
                lower: 1,
                upper: Math.max(16, s.kind === "index" ? Math.trunc(Number(evalExpr(s.expr))) : 16),
              }));
              let total = 1;
              for (const d of dims) total *= d.upper;
              arr = { data: new Float64Array(total), dims, allocated: true };
              setArray(t.name, arr);
            }
            if (arr.allocated) {
              const coords = expandSubscriptIndices(arr, t.subscripts);
              const rhsVals = evalArrayValues(stmt.expr);
              if (rhsVals) {
                for (let i = 0; i < coords.length; i++) {
                  const off = computeColumnMajorOffset(arr.dims, coords[i]!);
                  if (off >= 0 && off < arr.data.length) {
                    arr.data[off] = rhsVals[i % rhsVals.length] ?? 0;
                  }
                }
              } else {
                const scalarVal = Number(evalExpr(stmt.expr));
                for (const c of coords) {
                  const off = computeColumnMajorOffset(arr.dims, c);
                  if (off >= 0 && off < arr.data.length) {
                    arr.data[off] = scalarVal;
                  }
                }
              }
              syncSmallArrayToLocals(t.name, arr);
            }
            break;
          }

          if (t.type === "var") {
            const arr = getArray(t.name);
            if (arr && arr.allocated) {
              const rhsVals = evalArrayValues(stmt.expr);
              if (rhsVals) {
                for (let i = 0; i < Math.min(arr.data.length, rhsVals.length); i++) {
                  arr.data[i] = rhsVals[i]!;
                }
              } else {
                arr.data.fill(Number(evalExpr(stmt.expr)));
              }
              syncSmallArrayToLocals(t.name, arr);
              break;
            }
          }

          const val = evalExpr(stmt.expr);
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
        case "do": {
          const startVal = Math.trunc(Number(evalExpr(stmt.startExpr)));
          const endVal = Math.trunc(Number(evalExpr(stmt.endExpr)));
          const stepVal = stmt.stepExpr ? Math.trunc(Number(evalExpr(stmt.stepExpr))) : 1;
          if (stepVal !== 0) {
            let iter = 0;
            const maxIters = 10000;
            for (let idx = startVal; stepVal > 0 ? idx <= endVal : idx >= endVal; idx += stepVal) {
              if (++iter > maxIters) break;
              locals[stmt.loopVar] = idx;
              for (const s of stmt.body) execStmt(s);
            }
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

            default: {
              const callee = moduleAst?.units.get(subName);
              if (callee) {
                invokeUserUnit(callee, args);
              }
              break;
            }
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

export interface FortranSimulationOptions {
  startTime?: number | undefined;
  stopTime?: number | undefined;
  dt?: number | undefined;
  inputs?: Record<string, number | ((t: number) => number)> | undefined;
  params?: Record<string, string | number> | undefined;
  onStatement?: ((line: number, env: Record<string, number>) => Promise<void> | void) | undefined;
}

export interface FortranSimulationResult {
  routineName: string;
  t: number[];
  states: string[];
  y: number[][];
  finalLocals: Record<string, number>;
  finalArrays?: Record<string, Float64Array>;
}

function defaultExcitationForInput(name: string, t: number, stopTime: number, index: number): number {
  const lower = name.toLowerCase();
  const tau = Math.max(stopTime * 0.25, 1e-3);
  if (lower === "p_c" || lower.includes("press")) {
    return 1.0e6 + 5.0e6 * (1 - Math.exp(-t / tau));
  }
  if (lower === "a_t" || lower.includes("area")) {
    return 0.045 + 0.005 * Math.sin((2 * Math.PI * t) / Math.max(stopTime, 1e-3));
  }
  if (lower === "c_f" || lower.includes("coeff")) {
    return 1.55 + 0.12 * (1 - Math.exp(-t / tau));
  }
  const phase = index * 0.7;
  return 2.0 + 1.5 * Math.sin((2 * Math.PI * t) / Math.max(stopTime, 1e-3) + phase);
}

/**
 * Simulates a Fortran subroutine, program, or time-stepping script in-memory (and in-browser),
 * with optional statement-level async debugging hook (`onStatement`) for DAP integration.
 */
export async function simulateFortranRoutine(
  scriptText: string,
  options: FortranSimulationOptions = {},
): Promise<FortranSimulationResult> {
  const startTime = options.startTime ?? 0;
  const stopTime = options.stopTime ?? 1.0;
  const dt = options.dt ?? Math.max((stopTime - startTime) / 100, 0.001);

  const compiled = compileFortranStep(scriptText, options.params ?? {});
  const sig = compiled.signature;

  const storf = new Float64Array(Math.max(compiled.numRealStates, 8));
  const stori = new Int32Array(Math.max(compiled.numIntStates, 8));
  const portOutputs = new Map<string, number>();

  // Determine tracked signal names
  const trackedVars: string[] = [];
  const seenUpper = new Set<string>();
  const addTracked = (v: string) => {
    const u = v.toUpperCase();
    if (!seenUpper.has(u)) {
      seenUpper.add(u);
      trackedVars.push(v);
    }
  };

  for (const out of sig.outputs) addTracked(out);
  for (const p of compiled.assignedPorts) addTracked(p);
  for (const loc of sig.locals) addTracked(loc);
  for (const inp of sig.inputs) addTracked(inp);

  // Also scan AST assignments for any assigned variables
  const scanAssigned = (stmts: FortranStmt[]) => {
    for (const s of stmts) {
      if (s.kind === "assign") {
        if (s.target.type === "var") addTracked(s.target.name);
        else if (s.target.type === "port") addTracked(s.target.portName);
      } else if (s.kind === "if") {
        scanAssigned(s.thenBody);
        if (s.elseBody) scanAssigned(s.elseBody);
      } else if (s.kind === "do") {
        scanAssigned(s.body);
      }
    }
  };
  scanAssigned(compiled.ast);

  if (trackedVars.length === 0) {
    addTracked("storf_0");
  }

  const tSeries: number[] = [];
  const ySeries: number[][] = [];
  const persistentLocals: Record<string, number | boolean | string> = {
    ...sig.constants,
  };
  const persistentArrays: Record<string, RuntimeFortranArray> = {};

  const numSteps = Math.max(1, Math.min(2000, Math.round((stopTime - startTime) / dt)));

  for (let stepIdx = 0; stepIdx <= numSteps; stepIdx++) {
    const t = startTime + stepIdx * dt;
    const firstStep = stepIdx === 0;

    // Seed inputs for this step
    sig.inputs.forEach((inp, idx) => {
      const custom =
        options.inputs?.[inp] ?? options.inputs?.[inp.toLowerCase()] ?? options.inputs?.[inp.toUpperCase()];
      if (typeof custom === "function") {
        persistentLocals[inp] = custom(t);
      } else if (typeof custom === "number") {
        persistentLocals[inp] = custom;
      } else {
        persistentLocals[inp] = defaultExcitationForInput(inp, t, stopTime, idx);
      }
    });

    if (options.onStatement) {
      // Execute with async statement hook
      const hookedLines: { line: number; snapshot: Record<string, number> }[] = [];
      compiled.step({
        time: t,
        dt,
        firstStep,
        locals: persistentLocals,
        arrays: persistentArrays,
        storf,
        stori,
        inputs: (portName: string) => {
          const custom = options.inputs?.[portName];
          if (typeof custom === "function") return custom(t);
          if (typeof custom === "number") return custom;
          return defaultExcitationForInput(portName, t, stopTime, 0);
        },
        setOutput: (portName: string, val: number) => {
          portOutputs.set(portName, val);
          persistentLocals[portName] = val;
        },
        onStatementSync: (line, env) => {
          const numericSnap: Record<string, number> = { time: t, dt };
          for (const [k, v] of Object.entries(env)) {
            if (typeof v === "number") numericSnap[k] = v;
          }
          hookedLines.push({ line, snapshot: numericSnap });
        },
      });
      for (const h of hookedLines) {
        await options.onStatement(h.line, h.snapshot);
      }
    } else {
      compiled.step({
        time: t,
        dt,
        firstStep,
        locals: persistentLocals,
        arrays: persistentArrays,
        storf,
        stori,
        inputs: (portName: string) => {
          const custom = options.inputs?.[portName];
          if (typeof custom === "function") return custom(t);
          if (typeof custom === "number") return custom;
          return defaultExcitationForInput(portName, t, stopTime, 0);
        },
        setOutput: (portName: string, val: number) => {
          portOutputs.set(portName, val);
          persistentLocals[portName] = val;
        },
      });
    }

    tSeries.push(Number(t.toFixed(6)));
    const stepRow: number[] = [];
    for (const vName of trackedVars) {
      let val = 0;
      if (vName === "storf_0") {
        val = storf[0] ?? 0;
      } else if (portOutputs.has(vName)) {
        val = portOutputs.get(vName)!;
      } else {
        const raw =
          persistentLocals[vName] ?? persistentLocals[vName.toLowerCase()] ?? persistentLocals[vName.toUpperCase()];
        val = typeof raw === "number" ? raw : 0;
      }
      stepRow.push(val);
    }
    ySeries.push(stepRow);
  }

  const finalLocals: Record<string, number> = {};
  for (const [k, v] of Object.entries(persistentLocals)) {
    if (typeof v === "number") finalLocals[k] = v;
  }
  const finalArrays: Record<string, Float64Array> = {};
  for (const [k, arr] of Object.entries(persistentArrays)) {
    if (arr.allocated) {
      finalArrays[k.toLowerCase()] = arr.data;
    }
  }

  return {
    routineName: sig.name,
    t: tSeries,
    states: trackedVars,
    y: ySeries,
    finalLocals,
    finalArrays,
  };
}
