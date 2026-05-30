import type { ArenaValue } from "./arena-eval.js";

// ─────────────────────────────────────────────────────────────────────
// Array helpers
// ─────────────────────────────────────────────────────────────────────

export function evaluateBuiltinMathFunction(funcName: string, args: ArenaValue[]): ArenaValue | null | undefined {
  if (funcName === "sin" && typeof args[0] === "number") return Math.sin(args[0]);
  if (funcName === "cos" && typeof args[0] === "number") return Math.cos(args[0]);
  if (funcName === "tan" && typeof args[0] === "number") return Math.tan(args[0]);
  if (funcName === "asin" && typeof args[0] === "number") return Math.asin(args[0]);
  if (funcName === "acos" && typeof args[0] === "number") return Math.acos(args[0]);
  if (funcName === "atan" && typeof args[0] === "number") return Math.atan(args[0]);
  if (funcName === "atan2" && typeof args[0] === "number" && typeof args[1] === "number")
    return Math.atan2(args[0], args[1]);
  if (funcName === "sinh" && typeof args[0] === "number") return Math.sinh(args[0]);
  if (funcName === "cosh" && typeof args[0] === "number") return Math.cosh(args[0]);
  if (funcName === "tanh" && typeof args[0] === "number") return Math.tanh(args[0]);
  if (funcName === "exp" && typeof args[0] === "number") return Math.exp(args[0]);
  if (funcName === "log" && typeof args[0] === "number") return Math.log(args[0]);
  if (funcName === "log10" && typeof args[0] === "number") return Math.log10(args[0]);
  if (funcName === "abs" && typeof args[0] === "number") return Math.abs(args[0]);
  if (funcName === "sqrt" && typeof args[0] === "number") return Math.sqrt(args[0]);
  if (funcName === "sign" && typeof args[0] === "number") return Math.sign(args[0]);
  if (funcName === "floor" && typeof args[0] === "number") return Math.floor(args[0]);
  if (funcName === "ceil" && typeof args[0] === "number") return Math.ceil(args[0]);
  if (funcName === "integer" && typeof args[0] === "number") return Math.floor(args[0]);
  if (funcName === "mod" && typeof args[0] === "number" && typeof args[1] === "number") {
    const b = args[1];
    return b !== 0 ? args[0] - Math.floor(args[0] / b) * b : null;
  }
  return undefined;
}

/** Flatten a nested ArenaValue array into a 1D list of leaf values. */
export function flattenArenaArray(val: ArenaValue): ArenaValue[] {
  if (!Array.isArray(val)) return [val];
  const result: ArenaValue[] = [];
  for (const el of val) result.push(...flattenArenaArray(el));
  return result;
}

/** Get the shape (dimension extents) of a nested ArenaValue array. */
export function getArenaArrayShape(val: ArenaValue): number[] {
  if (!Array.isArray(val)) return [];
  const shape = [val.length];
  if (val.length > 0 && Array.isArray(val[0])) {
    shape.push(...getArenaArrayShape(val[0]));
  }
  return shape;
}

/** Build a filled array with the given shape and fill value. */
export function buildArenaFilledArray(shape: number[], value: ArenaValue): ArenaValue[] {
  if (shape.length === 0) return [];
  const n = shape[0];
  if (n === undefined || n < 0 || n > 1_000_000 || !Number.isInteger(n)) return [];
  if (shape.length === 1) {
    return Array(n).fill(value) as ArenaValue[];
  }
  const rest = shape.slice(1);
  const result: ArenaValue[] = [];
  for (let i = 0; i < n; i++) result.push(buildArenaFilledArray(rest, value));
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Built-in array function dispatch
// ─────────────────────────────────────────────────────────────────────

/**
 * Evaluate a Modelica built-in array function at compile time.
 * Returns `undefined` if the function is not a recognized array built-in.
 */
export function evaluateArrayBuiltin(funcName: string, args: ArenaValue[]): ArenaValue | null | undefined {
  switch (funcName) {
    case "fill":
      return evalFill(args);
    case "zeros":
      return evalZerosOnes(args, 0);
    case "ones":
      return evalZerosOnes(args, 1);
    case "linspace":
      return evalLinspace(args);
    case "identity":
      return evalIdentity(args);
    case "diagonal":
      return evalDiagonal(args);
    case "transpose":
      return evalTranspose(args);
    case "symmetric":
      return evalSymmetric(args);
    case "cross":
      return evalCross(args);
    case "skew":
      return evalSkew(args);
    case "cat":
      return evalCat(args);
    case "size":
      return evalSize(args);
    case "ndims":
      return evalNdims(args);
    case "scalar":
      return evalScalar(args);
    case "vector":
      return evalVector(args);
    case "matrix":
      return evalMatrix(args);
    case "array":
      return evalArrayFunc(args);
    case "outerProduct":
      return evalOuterProduct(args);
    case "promote":
      return evalPromote(args);
    case "sum":
      return evalReduction(args, "sum");
    case "product":
      return evalReduction(args, "product");
    case "min":
      return evalReduction(args, "min");
    case "max":
      return evalReduction(args, "max");
    default:
      return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Individual function implementations
// ─────────────────────────────────────────────────────────────────────

function evalFill(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2) return null;
  const value = args[0];
  if (value === undefined) return null;
  const shape: number[] = [];
  for (let i = 1; i < args.length; i++) {
    if (typeof args[i] !== "number") return null;
    shape.push(args[i] as number);
  }
  const result = buildArenaFilledArray(shape, value);
  return result.length > 0 || shape.every((d) => d === 0) ? result : null;
}

function evalZerosOnes(args: ArenaValue[], fillVal: number): ArenaValue | null {
  const shape: number[] = [];
  for (const arg of args) {
    if (typeof arg !== "number") return null;
    shape.push(arg);
  }
  if (shape.length === 0) return null;
  return buildArenaFilledArray(shape, fillVal);
}

function evalLinspace(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 3) return null;
  const x1 = args[0],
    x2 = args[1],
    n = args[2];
  if (typeof x1 !== "number" || typeof x2 !== "number" || typeof n !== "number") return null;
  if (n < 2 || !Number.isInteger(n)) return null;
  const result: number[] = [];
  for (let i = 0; i < n; i++) result.push(x1 + ((x2 - x1) * i) / (n - 1));
  return result;
}

function evalIdentity(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1 || typeof args[0] !== "number") return null;
  const n = args[0];
  if (n < 0 || !Number.isInteger(n)) return null;
  const rows: ArenaValue[] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0);
    rows.push(row);
  }
  return rows;
}

function evalDiagonal(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1 || !Array.isArray(args[0])) return null;
  const v = args[0] as ArenaValue[];
  const n = v.length;
  const rows: ArenaValue[] = [];
  for (let i = 0; i < n; i++) {
    const row: ArenaValue[] = [];
    for (let j = 0; j < n; j++) {
      const val = v[i];
      row.push(i === j ? (val !== undefined ? val : 0) : 0);
    }
    rows.push(row);
  }
  return rows;
}

function evalTranspose(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1 || !Array.isArray(args[0])) return null;
  const A = args[0] as ArenaValue[][];
  const shape = getArenaArrayShape(A);
  if (shape.length !== 2) return null;
  const [nRows, nCols] = shape;
  if (nRows == null || nCols == null) return null;
  const rows: ArenaValue[] = [];
  for (let j = 0; j < nCols; j++) {
    const row: ArenaValue[] = [];
    for (let i = 0; i < nRows; i++) {
      const r = A[i];
      const val = Array.isArray(r) ? r[j] : undefined;
      row.push(val !== undefined ? val : 0);
    }
    rows.push(row);
  }
  return rows;
}

function evalSymmetric(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1 || !Array.isArray(args[0])) return null;
  const A = args[0] as ArenaValue[][];
  const shape = getArenaArrayShape(A);
  if (shape.length !== 2 || shape[0] !== shape[1]) return null;
  const n = shape[0];
  if (n === undefined) return null;
  const rows: ArenaValue[] = [];
  for (let i = 0; i < n; i++) {
    const row: ArenaValue[] = [];
    for (let j = 0; j < n; j++) {
      const src = j >= i ? A[i] : A[j];
      const idx = j >= i ? j : i;
      const val = Array.isArray(src) ? src[idx] : undefined;
      row.push(val !== undefined ? val : 0);
    }
    rows.push(row);
  }
  return rows;
}

function evalCross(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2) return null;
  const x = args[0],
    y = args[1];
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== 3 || y.length !== 3) return null;
  const x1 = x[0],
    x2 = x[1],
    x3 = x[2];
  const y1 = y[0],
    y2 = y[1],
    y3 = y[2];
  if (
    typeof x1 !== "number" ||
    typeof x2 !== "number" ||
    typeof x3 !== "number" ||
    typeof y1 !== "number" ||
    typeof y2 !== "number" ||
    typeof y3 !== "number"
  )
    return null;
  return [x2 * y3 - x3 * y2, x3 * y1 - x1 * y3, x1 * y2 - x2 * y1];
}

function evalSkew(args: ArenaValue[]): ArenaValue | null {
  const vec = args[0];
  if (!Array.isArray(vec) || vec.length !== 3) return null;
  const x1 = vec[0],
    x2 = vec[1],
    x3 = vec[2];
  if (typeof x1 !== "number" || typeof x2 !== "number" || typeof x3 !== "number") return null;
  return [
    [0, -x3, x2],
    [x3, 0, -x1],
    [-x2, x1, 0],
  ];
}

function evalCat(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2 || typeof args[0] !== "number") return null;
  const dim = args[0];
  if (dim === 1) {
    const result: ArenaValue[] = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (Array.isArray(a)) result.push(...a);
      else if (a != null) result.push(a);
    }
    return result;
  }
  return null;
}

function evalSize(args: ArenaValue[]): ArenaValue | null {
  const A = args[0];
  if (A === undefined) return null;
  const shape = getArenaArrayShape(A);
  if (shape.length === 0) return null;
  if (args.length >= 2 && typeof args[1] === "number") {
    const dimIndex = args[1] - 1;
    const sizeAtDim = shape[dimIndex];
    return dimIndex >= 0 && dimIndex < shape.length && sizeAtDim !== undefined ? sizeAtDim : null;
  }
  return shape;
}

function evalNdims(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1) return null;
  const arg = args[0];
  if (arg === undefined) return null;
  return getArenaArrayShape(arg).length;
}

function evalScalar(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1) return null;
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  const flat = flattenArenaArray(firstArg);
  const firstElem = flat[0];
  return flat.length === 1 && firstElem !== undefined ? firstElem : null;
}

function evalVector(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1) return null;
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  return flattenArenaArray(firstArg);
}

function evalMatrix(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1) return null;
  const A = args[0];
  if (A === undefined) return null;
  const shape = getArenaArrayShape(A);
  if (shape.length === 0) return [[A]];
  if (shape.length === 1) return [A];
  if (shape.length === 2) return A;
  return null;
}

function evalArrayFunc(args: ArenaValue[]): ArenaValue | null {
  return args.length > 0 ? args : null;
}

function evalOuterProduct(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2) return null;
  const x = args[0],
    y = args[1];
  if (!Array.isArray(x) || !Array.isArray(y)) return null;
  const rows: ArenaValue[] = [];
  for (const xi of x) {
    if (typeof xi !== "number") return null;
    const row: ArenaValue[] = [];
    for (const yj of y) {
      if (typeof yj !== "number") return null;
      row.push(xi * yj);
    }
    rows.push(row);
  }
  return rows;
}

function evalPromote(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2 || typeof args[1] !== "number") return null;
  const targetNdims = args[1];
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  let result = firstArg;
  const currentNdims = getArenaArrayShape(result).length;
  if (targetNdims <= currentNdims) return result;
  for (let i = currentNdims; i < targetNdims; i++) result = [result];
  return result;
}

function evalReduction(args: ArenaValue[], op: "sum" | "product" | "min" | "max"): ArenaValue | null {
  // For 2-arg scalar min/max
  if (
    (op === "min" || op === "max") &&
    args.length === 2 &&
    typeof args[0] === "number" &&
    typeof args[1] === "number"
  ) {
    return op === "min" ? Math.min(args[0], args[1]) : Math.max(args[0], args[1]);
  }
  // Single-arg array reduction
  if (args.length !== 1) return null;
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  const flat = flattenArenaArray(firstArg);
  if (flat.length === 0) return null;
  if (!flat.every((v) => typeof v === "number")) return null;
  const nums = flat as number[];
  switch (op) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "product":
      return nums.reduce((a, b) => a * b, 1);
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}
