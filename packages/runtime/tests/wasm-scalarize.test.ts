// SPDX-License-Identifier: AGPL-3.0-or-later

import { Causality, EqKind, ExprKind, VarType, Variability } from "@modelscript/runtime/wasm_dae.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertApprox(actual: number, expected: number, tol = 1e-4, message = ""): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`Assertion failed: ${message} - expected ${expected}, got ${actual}`);
  }
}

console.log("=== Testing WASM DAE Batch Scalarization Suite ===");

async function initWasm(): Promise<any> {
  const wasmPath = path.resolve(__dirname, "../build/release.wasm");
  const wasmBytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {
    env: {
      abort(msg: any, file: any, line: any, col: any) {
        console.error(`WASM abort at ${file}:${line}:${col} (msg: ${msg})`);
      },
    },
  });
  return instance.exports;
}

const wasm = await initWasm();

// ── Test 1: Multi-dimensional Array Unrolling & Canonical Name Interning ──
console.log("Test 1: Multi-dimensional tensor unrolling & internIndexedName...");
{
  const b = wasm.dae_createBuilder();
  const sp = wasm.dae_getStringPool(b);

  // Intern base name "T"
  const tNameStr = Buffer.from("T", "utf-8");
  const tBuf = wasm.atomicChunkAlloc(tNameStr.length);
  const mem = new Uint8Array(wasm.memory.buffer);
  mem.set(tNameStr, tBuf);
  const tNameId = wasm.stringPool_internUtf8(sp, tBuf, tNameStr.length);

  // Real T[2, 3] with start value 293.15
  const tVar = wasm.dae_addVariable(b, tNameId, VarType.Real, Variability.Continuous, Causality.Local, 293.15, 0);
  wasm.dae_setVarShapeDim(b, tVar, 0, 2); // Dim 0 = 2
  wasm.dae_setVarShapeDim(b, tVar, 1, 3); // Dim 1 = 3

  // Real P (scalar)
  const pNameStr = Buffer.from("P", "utf-8");
  const pBuf = wasm.atomicChunkAlloc(pNameStr.length);
  mem.set(pNameStr, pBuf);
  const pNameId = wasm.stringPool_internUtf8(sp, pBuf, pNameStr.length);
  const pVar = wasm.dae_addVariable(b, pNameId, VarType.Real, Variability.Parameter, Causality.Local, 101325.0, 0);

  // Vector Equation: T = P (broadcast scalar P across all 6 elements of T)
  const exprT = wasm.dae_addName(b, tVar);
  const exprP = wasm.dae_addName(b, pVar);
  wasm.dae_addEquation(b, EqKind.Array, exprT, exprP, 0);

  assert(wasm.dae_getVarCount(b) === 2, `Expected 2 initial variables, got ${wasm.dae_getVarCount(b)}`);
  assert(wasm.dae_getEqCount(b) === 1, `Expected 1 initial equation, got ${wasm.dae_getEqCount(b)}`);

  // Execute in-WASM scalarization
  const sDae = wasm.dae_scalarize(b);
  assert(sDae > 0, "Expected valid sDae pointer");

  // Verify variable count: 6 elements of T + 1 scalar P = 7 variables
  const varCount = wasm.dae_getVarCount(sDae);
  assert(varCount === 7, `Expected 7 scalarized variables, got ${varCount}`);

  // Verify equation count: 6 scalar equations
  const eqCount = wasm.dae_getEqCount(sDae);
  assert(eqCount === 6, `Expected 6 scalarized equations, got ${eqCount}`);

  // Verify start values preserved across all elements
  for (let i = 0; i < 6; i++) {
    assertApprox(wasm.dae_getVarStartValue(sDae, i), 293.15, 1e-4, `T[i] start value`);
  }
  assertApprox(wasm.dae_getVarStartValue(sDae, 6), 101325.0, 1e-4, `P start value`);

  // Verify interned names: T[1,1], T[1,2], T[1,3], T[2,1], T[2,2], T[2,3], P
  const expectedNames = ["T[1,1]", "T[1,2]", "T[1,3]", "T[2,1]", "T[2,2]", "T[2,3]", "P"];
  const sSp = wasm.dae_getStringPool(sDae);
  const outBuf = wasm.atomicChunkAlloc(64);

  for (let i = 0; i < 7; i++) {
    const nameId = wasm.dae_getVarNameId(sDae, i);
    const len = wasm.stringPool_copyOut(sSp, nameId, outBuf);
    const readMem = new Uint8Array(wasm.memory.buffer);
    const actualName = Buffer.from(readMem.buffer, outBuf, len).toString("utf-8");
    assert(
      actualName === expectedNames[i],
      `Expected var ${i} to have name '${expectedNames[i]}', got '${actualName}'`,
    );
  }
  console.log("  ✓ Multi-dimensional array variables unrolled with canonical Modelica identifiers and attributes");
}

// ── Test 2: Vector Equation with Array Constructor Slicing ──
console.log("Test 2: Vector equation with ArrayCtor element slicing & Int-to-Real coercion...");
{
  const b = wasm.dae_createBuilder();
  const sp = wasm.dae_getStringPool(b);

  const xNameStr = Buffer.from("x", "utf-8");
  const xBuf = wasm.atomicChunkAlloc(xNameStr.length);
  new Uint8Array(wasm.memory.buffer).set(xNameStr, xBuf);
  const xNameId = wasm.stringPool_internUtf8(sp, xBuf, xNameStr.length);

  // Real x[3]
  const xVar = wasm.dae_addVariable(b, xNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  wasm.dae_setVarShapeDim(b, xVar, 0, 3); // 3 elements

  // Vector Equation: x = {10, 20, 30} (integers should coerce to Real 10.0, 20.0, 30.0)
  const lit1 = wasm.dae_addIntLiteral(b, 10);
  const lit2 = wasm.dae_addIntLiteral(b, 20);
  const lit3 = wasm.dae_addIntLiteral(b, 30);
  const ctor = wasm.dae_addExpression(b, ExprKind.ArrayCtor, 3, lit1, 3);
  wasm.dae_addExpression(b, ExprKind.Tuple, 0, lit2, 0);
  wasm.dae_addExpression(b, ExprKind.Tuple, 0, lit3, 0);

  const exprX = wasm.dae_addName(b, xVar);
  wasm.dae_addEquation(b, EqKind.Array, exprX, ctor, 3);

  const sDae = wasm.dae_scalarize(b);
  assert(wasm.dae_getVarCount(sDae) === 3, "Expected 3 scalarized variables");
  assert(wasm.dae_getEqCount(sDae) === 3, "Expected 3 scalarized equations");

  // Verify RHS of each equation is a RealLiteral with values 10.0, 20.0, 30.0
  const expectedVals = [10.0, 20.0, 30.0];
  for (let eq = 0; eq < 3; eq++) {
    const rhs = wasm.dae_getEqRhs(sDae, eq);
    const knd = wasm.dae_getExprKind(sDae, rhs);
    assert(knd === ExprKind.RealLiteral, `Expected Eq ${eq} RHS to be RealLiteral, got ${knd}`);
    const val = wasm.dae_getExprRealValue(sDae, rhs);
    assertApprox(val, expectedVals[eq], 1e-4, `Eq ${eq} RHS value`);
  }
  console.log("  ✓ ArrayCtor sliced into scalar equations with automatic Int-to-Real coercion");
}

// ── Test 3: Constant Subscript Direct Resolution ──
console.log("Test 3: Constant multi-index subscript direct resolution...");
{
  const b = wasm.dae_createBuilder();
  const sp = wasm.dae_getStringPool(b);

  const aNameStr = Buffer.from("A", "utf-8");
  const aBuf = wasm.atomicChunkAlloc(aNameStr.length);
  new Uint8Array(wasm.memory.buffer).set(aNameStr, aBuf);
  const aNameId = wasm.stringPool_internUtf8(sp, aBuf, aNameStr.length);

  // Real A[2, 2]
  const aVar = wasm.dae_addVariable(b, aNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
  wasm.dae_setVarShapeDim(b, aVar, 0, 2);
  wasm.dae_setVarShapeDim(b, aVar, 1, 2);

  // Real y (scalar)
  const yNameStr = Buffer.from("y", "utf-8");
  const yBuf = wasm.atomicChunkAlloc(yNameStr.length);
  new Uint8Array(wasm.memory.buffer).set(yNameStr, yBuf);
  const yNameId = wasm.stringPool_internUtf8(sp, yBuf, yNameStr.length);
  const yVar = wasm.dae_addVariable(b, yNameId, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);

  // Equation: y = A[2, 1] (row 2, col 1 in 1-based indexing -> flat offset (2-1)*2 + (1-1) = 2 -> A[2,1])
  const exprA = wasm.dae_addName(b, aVar);
  const subRow = wasm.dae_addIntLiteral(b, 2);
  const subCol = wasm.dae_addIntLiteral(b, 1);
  const subExpr = wasm.dae_addExpression(b, ExprKind.Subscript, exprA, subRow, 2);
  wasm.dae_addExpression(b, ExprKind.Tuple, 0, subCol, 0);

  const exprY = wasm.dae_addName(b, yVar);
  wasm.dae_addEquation(b, EqKind.Simple, exprY, subExpr, 0);

  const sDae = wasm.dae_scalarize(b);
  // Scalar variables: A[1,1]=0, A[1,2]=1, A[2,1]=2, A[2,2]=3, y=4
  assert(wasm.dae_getVarCount(sDae) === 5, "Expected 5 variables");
  assert(wasm.dae_getEqCount(sDae) === 1, "Expected 1 equation");

  // RHS should resolve directly to ExprKind.Name referencing var index 2 (A[2,1])!
  const rhs = wasm.dae_getEqRhs(sDae, 0);
  const rKind = wasm.dae_getExprKind(sDae, rhs);
  assert(rKind === ExprKind.Name, `Expected resolved subscript to be ExprKind.Name, got ${rKind}`);
  const targetVar = wasm.dae_getExprData1(sDae, rhs);
  assert(targetVar === 2, `Expected target variable index 2 (A[2,1]), got ${targetVar}`);

  console.log("  ✓ Constant multi-index subscript resolved directly to scalar variable index");
}

// ── Test 4: Initial Equations & Derivatives in Array Expansion ──
console.log("Test 4: Initial equations and der(x) preservation in array expansion...");
{
  const b = wasm.dae_createBuilder();
  const sp = wasm.dae_getStringPool(b);

  const zNameStr = Buffer.from("z", "utf-8");
  const zBuf = wasm.atomicChunkAlloc(zNameStr.length);
  new Uint8Array(wasm.memory.buffer).set(zNameStr, zBuf);
  const zNameId = wasm.stringPool_internUtf8(sp, zBuf, zNameStr.length);

  // Real z[2]
  const zVar = wasm.dae_addVariable(b, zNameId, VarType.Real, Variability.Continuous, Causality.Local, 5.0, 0);
  wasm.dae_setVarShapeDim(b, zVar, 0, 2);

  // Vector initial equation: z = {0.0, 0.0} (EqKind.InitialSimple = 7)
  const zExpr = wasm.dae_addName(b, zVar);
  const zero1 = wasm.dae_addRealLiteral(b, 0.0);
  const zero2 = wasm.dae_addRealLiteral(b, 0.0);
  const zeroCtor = wasm.dae_addExpression(b, ExprKind.ArrayCtor, 2, zero1, 2);
  wasm.dae_addExpression(b, ExprKind.Tuple, 0, zero2, 0);
  wasm.dae_addEquation(b, EqKind.InitialSimple, zExpr, zeroCtor, 2);

  // Vector dynamic equation: der(z) = z
  const derZ = wasm.dae_addDer(b, zVar);
  wasm.dae_addEquation(b, EqKind.Array, derZ, zExpr, 2);

  const sDae = wasm.dae_scalarize(b);
  assert(wasm.dae_getVarCount(sDae) === 2, "Expected 2 variables");
  assert(
    wasm.dae_getEqCount(sDae) === 4,
    `Expected 4 equations (2 initial + 2 dynamic), got ${wasm.dae_getEqCount(sDae)}`,
  );

  // Check equation kinds
  assert(wasm.dae_getEqKind(sDae, 0) === EqKind.InitialSimple, "Eq 0 should be InitialSimple");
  assert(wasm.dae_getEqKind(sDae, 1) === EqKind.InitialSimple, "Eq 1 should be InitialSimple");
  assert(wasm.dae_getEqKind(sDae, 2) === EqKind.Simple, "Eq 2 should be Simple");
  assert(wasm.dae_getEqKind(sDae, 3) === EqKind.Simple, "Eq 3 should be Simple");

  // Verify der(z[1]) and der(z[2]) LHS
  for (let eq = 2; eq < 4; eq++) {
    const lhs = wasm.dae_getEqLhs(sDae, eq);
    assert(wasm.dae_getExprKind(sDae, lhs) === ExprKind.Der, `Eq ${eq} LHS should be Der`);
  }

  console.log("  ✓ Initial equations and der(x) expanded correctly with appropriate EqKind preservation");
}

console.log("=== All WASM DAE Scalarization Tests Passed Successfully! ===");
