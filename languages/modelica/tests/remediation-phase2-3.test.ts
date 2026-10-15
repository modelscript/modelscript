// SPDX-License-Identifier: AGPL-3.0-or-later

import { StringWriter } from "@modelscript/dsl/utils";
import { ArenaDAEPrinter } from "@modelscript/runtime";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { areExpressionsEqual } from "../src/flattener/expressions/binary-ops.js";
import { evalArithmeticString } from "../src/flattener/expressions/cst-utils.js";
import { getFlatteningState, getNamedArrayShape, setNamedArrayShape } from "../src/flattener/support/state.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

async function initContext(files: Record<string, string>) {
  const { parser } = await createWasmParser(modelicaWasm);
  Context.registerParser(".mo", parser as any);
  const ctx = new Context(new NodeFileSystem());
  for (const [name, src] of Object.entries(files)) {
    const uri = `file:///test/${name}.mo`;
    ctx.load(src, uri);
  }
  return ctx;
}

function printArena(arena: any): string {
  const out = new StringWriter();
  const printer = new ArenaDAEPrinter(out, arena, true);
  printer.printDAE(arena);
  return out.toString().trim();
}

describe("Flattener Phase 2 & 3 Remediation", () => {
  it("should isolate flattener lifecycle state across sequential calls", async () => {
    const model1 = `
model ModelWithInner
  inner parameter Real sharedParam = 42.0;
  Real x;
equation
  x = sharedParam;
end ModelWithInner;
`;
    const model2 = `
model IndependentModel
  Real y;
equation
  y = 10.0;
end IndependentModel;
`;
    const ctx = await initContext({
      ModelWithInner: model1,
      IndependentModel: model2,
    });

    const arena1 = ctx.flattenArena("ModelWithInner", undefined, "file:///test/ModelWithInner.mo");
    assert(arena1 !== null);
    const text1 = printArena(arena1);
    assert(text1.includes("sharedParam"), "ModelWithInner must include sharedParam");

    // Flatten second model immediately using the same flattener
    const arena2 = ctx.flattenArena("IndependentModel", undefined, "file:///test/IndependentModel.mo");
    assert(arena2 !== null);
    const text2 = printArena(arena2);
    assert(!text2.includes("sharedParam"), "IndependentModel must NOT retain any inner parameters from ModelWithInner");
    assert(!arena2.extensionMetadata.expandableBuses?.length, "IndependentModel must have empty expandable buses");
    assert.strictEqual(arena2.getVarCount(), 1, "IndependentModel must have exactly 1 variable");
  });

  it("should instantiate hierarchical components and resolve names correctly", async () => {
    const hierModel = `
model Sub
  Real u;
  Real v;
equation
  v = 2.0 * u;
end Sub;

model Hierarchical
  Sub s1;
  Sub s2;
equation
  s1.u = 1.0;
  s2.u = s1.v;
end Hierarchical;
`;
    const ctx = await initContext({ Hierarchical: hierModel });
    const arena = ctx.flattenArena("Hierarchical", undefined, "file:///test/Hierarchical.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("s1.u"), "Hierarchical model must have s1.u");
    assert(text.includes("s1.v"), "Hierarchical model must have s1.v");
    assert(text.includes("s2.u"), "Hierarchical model must have s2.u");
    assert(text.includes("s2.v"), "Hierarchical model must have s2.v");
  });

  it("should parse and flatten matrix with nested comma arguments accurately", async () => {
    const matrixModel = `
model MatrixWithNestedArgs
  Real M[2, 2] = [max(1.0, 2.0), 3.0; 4.0, min(5.0, 6.0)];
  Real x;
equation
  x = M[1, 1] + M[2, 2];
end MatrixWithNestedArgs;
`;
    const ctx = await initContext({ MatrixWithNestedArgs: matrixModel });
    const arena = ctx.flattenArena("MatrixWithNestedArgs", undefined, "file:///test/MatrixWithNestedArgs.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("M[1,1]"), "Matrix elements must be flattened properly");
    assert(text.includes("M[2,2]"), "Matrix elements must be flattened properly");
  });

  it("should work correctly with scalarization and constant folding in single pass", async () => {
    const simpleFoldModel = `
model SimpleFold
  constant Real a = 10.0;
  constant Real b = 20.0;
  Real x;
equation
  x = a + b;
end SimpleFold;
`;
    const ctx = await initContext({ SimpleFold: simpleFoldModel });
    const arena = ctx.flattenArena("SimpleFold", undefined, "file:///test/SimpleFold.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("30.0"), `Constants must be folded into 30.0. Got: ${text}`);
  });

  it("should unroll 3D array comprehensions with right-to-left nesting per Modelica 3.6 §10.4.2", async () => {
    const comp3DModel = `
model Comp3D
  Real A[2, 2, 2] = {100 * i + 10 * j + k for k in 1:2, j in 1:2, i in 1:2};
end Comp3D;
`;
    const ctx = await initContext({ Comp3D: comp3DModel });
    const arena = ctx.flattenArena("Comp3D", undefined, "file:///test/Comp3D.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(
      text.includes("{{{111.0, 112.0}, {121.0, 122.0}}, {{211.0, 212.0}, {221.0, 222.0}}}"),
      `Expected 3D unrolled comprehension in:\n${text}`,
    );
  });

  it("should distribute der() over subscripted array expressions accurately", async () => {
    const derSubModel = `
model DerSubscript
  Real x[2];
  Real y[2];
equation
  x[1] = time;
  x[2] = 2.0 * time;
  y[1] = der(x[1] + x[2]);
  y[2] = der(x[2]);
end DerSubscript;
`;
    const ctx = await initContext({ DerSubscript: derSubModel });
    const arena = ctx.flattenArena("DerSubscript", undefined, "file:///test/DerSubscript.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("der(x[1]) + der(x[2])"), `Expected distributed der(x[1]) + der(x[2]) in:\n${text}`);
  });

  it("should rewrite inStream and actualStream for N=3 inside connectors and nested expressions", async () => {
    const stream3Model = `
connector FluidPort
  Real p;
  flow Real m_flow;
  stream Real h_outflow;
end FluidPort;

model ThreePortStream
  FluidPort c1(m_flow(min = -10.0));
  FluidPort c2(m_flow(min = -10.0));
  FluidPort c3(m_flow(min = -10.0));
  Real h_in1;
  Real h_act1;
  Real h_neg;
equation
  c1.p = 1.0;
  c1.m_flow = 1.0;
  c2.m_flow = -0.4;
  c1.h_outflow = 100.0;
  c2.h_outflow = 200.0;
  c3.h_outflow = 300.0;
  connect(c1, c2);
  connect(c1, c3);
  h_in1 = inStream(c1.h_outflow);
  h_act1 = actualStream(c1.h_outflow);
  h_neg = -inStream(c2.h_outflow);
end ThreePortStream;
`;
    const ctx = await initContext({ ThreePortStream: stream3Model });
    const arena = ctx.flattenArena("ThreePortStream", undefined, "file:///test/ThreePortStream.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(
      !text.includes("inStream(") && !text.includes("actualStream("),
      `Expected all inStream/actualStream calls to be rewritten, got:\n${text}`,
    );
    assert(
      text.includes("$OMC$PositiveMax(-c2.m_flow") && text.includes("$OMC$PositiveMax(-c3.m_flow"),
      `Expected N=3 mass-flow-weighted PositiveMax mixing in:\n${text}`,
    );
  });

  it("should preserve expandable connector signals referenced in IfElse, when equations, and algorithm statements", async () => {
    const busModel = `
expandable connector ControlBus
end ControlBus;

model Sensor
  ControlBus bus;
  Real sigIf = 1.0;
  Real sigWhen = 2.0;
  Real sigAlg = 3.0;
equation
  connect(sigIf, bus.sigIf);
  connect(sigWhen, bus.sigWhen);
  connect(sigAlg, bus.sigAlg);
end Sensor;

model Controller
  ControlBus bus;
  Real yIf;
  discrete Real yWhen(start = 0.0);
  Real yAlg;
equation
  yIf = if time > 0.5 then bus.sigIf else 0.0;
  when time > 1.0 then
    yWhen = bus.sigWhen;
  end when;
algorithm
  yAlg := bus.sigAlg;
end Controller;

model BusSystem
  Sensor s;
  Controller c;
equation
  connect(s.bus, c.bus);
end BusSystem;
`;
    const ctx = await initContext({ BusSystem: busModel });
    const arena = ctx.flattenArena("BusSystem", undefined, "file:///test/BusSystem.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("sigIf"), `Expected bus signal sigIf referenced in IfElse to be preserved in:\n${text}`);
    assert(
      text.includes("sigWhen"),
      `Expected bus signal sigWhen referenced in when-equation to be preserved in:\n${text}`,
    );
    assert(
      text.includes("sigAlg"),
      `Expected bus signal sigAlg referenced in algorithm statement to be preserved in:\n${text}`,
    );
  });

  it("should lower outerProduct and 1-arg/2-arg min/max array reductions", async () => {
    const src = `
model BuiltinArrayOps
  Real v1[2] = {2.0, 3.0};
  Real v2[2] = {4.0, 5.0};
  Real M[2, 2] = outerProduct(v1, v2);
  Real rMin = min({time * 2.0, time, 10.0});
  Real rMax = max({time * 2.0, time});
end BuiltinArrayOps;
`;
    const ctx = await initContext({ BuiltinArrayOps: src });
    const arena = ctx.flattenArena("BuiltinArrayOps", undefined, "file:///test/BuiltinArrayOps.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("v1[1] * v2[1]") || text.includes("8.0"), `Expected outerProduct expansion in:\n${text}`);
    assert(text.includes("min(2.0 * time, min(time, 10.0))"), `Expected pairwise min reduction in:\n${text}`);
    assert(text.includes("max(2.0 * time, time)"), `Expected pairwise max reduction in:\n${text}`);
  });

  it("should support homotopy and semiLinear built-in operators with vectorization and real coercion", async () => {
    const src = `
model HomotopySemiLinearModel
  Real x = time;
  Real h = homotopy(x ^ 2, x);
  Real hv[2] = homotopy({x, 2}, {0, 1});
  Real s = semiLinear(x, 2, 5);
end HomotopySemiLinearModel;
`;
    const ctx = await initContext({ HomotopySemiLinearModel: src });
    const arena = ctx.flattenArena("HomotopySemiLinearModel", undefined, "file:///test/HomotopySemiLinearModel.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("homotopy(x ^ 2.0, x)"), `Expected homotopy call in:\n${text}`);
    assert(text.includes("homotopy(x, 0.0)"), `Expected vectorized homotopy[1] with real coercion in:\n${text}`);
    assert(text.includes("semiLinear(x, 2.0, 5.0)"), `Expected semiLinear call with real coercion in:\n${text}`);
  });

  it("should distribute der() over negation, if-else, product, quotient, and power rules", async () => {
    const src = `
model DerDistributionModel
  Real x;
  Real y;
  Real dNeg;
  Real dIf;
  Real dMul;
  Real dDiv;
  Real dPow;
equation
  der(x) = 1.0;
  der(y) = 2.0;
  dNeg = der(-x);
  dIf = der(if time > 0.5 then x else y);
  dMul = der(x * y);
  dDiv = der(x / y);
  dPow = der(x ^ 3.0);
end DerDistributionModel;
`;
    const ctx = await initContext({ DerDistributionModel: src });
    const arena = ctx.flattenArena("DerDistributionModel", undefined, "file:///test/DerDistributionModel.mo");
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("-der(x)"), `Expected der(-x) -> -der(x) in:\n${text}`);
    assert(text.includes("if time > 0.5 then der(x) else der(y)"), `Expected der(if-else) distribution in:\n${text}`);
    assert(text.includes("der(x) * y + x * der(y)"), `Expected product rule in:\n${text}`);
    assert(text.includes("(der(x) * y - x * der(y)) / y ^ 2.0"), `Expected quotient rule in:\n${text}`);
    assert(text.includes("3.0 * x ^ 2.0 * der(x)"), `Expected power rule in:\n${text}`);
  });

  it("should resolve overconstrained connection spanning tree and emit equalityConstraint on broken cycles", async () => {
    const src = `
type Real2 = Real[2];
type Overconstrained
  extends Real2;
  function equalityConstraint
    input Real u1[2];
    input Real u2[2];
    output Real residue[1];
  algorithm
    residue[1] := u1[1] - u2[1];
  end equalityConstraint;
end Overconstrained;

connector C
  Real e;
  flow Real f;
  Overconstrained o;
end C;

model OverconstrainedCycle
  C c1, c2, c3, c4;
  Boolean r1 = Connections.isRoot(c1.o);
  Boolean b1 = Connections.rooted(c1.o);
equation
  Connections.potentialRoot(c1.o);
  Connections.branch(c1.o, c2.o);
  Connections.branch(c1.o, c3.o);
  connect(c2, c4);
  connect(c3, c4);
end OverconstrainedCycle;
`;
    const ctx = await initContext({ OverconstrainedCycle: src });
    const arena = ctx.flattenArena("OverconstrainedCycle", undefined, "file:///test/OverconstrainedCycle.mo", {
      omcCompatibility: true,
    });
    assert(arena !== null);
    const text = printArena(arena);
    assert(text.includes("Boolean r1 = true"), `Expected Connections.isRoot(c1.o) = true in:\n${text}`);
    assert(text.includes("Boolean b1 = true"), `Expected Connections.rooted(c1.o) = true in:\n${text}`);
    assert(
      text.includes("Overconstrained.equalityConstraint(c2.o, c4.o) = {0.0}"),
      `Expected broken cycle equalityConstraint in:\n${text}`,
    );
  });

  it("should skip shadow WASM env allocation in TS mode and pool/reuse WASM flattener via flattener_destroy", async () => {
    const src = `
model SubComp
  parameter Real k = 1.0;
  Real v[2] = {k, 2.0 * k};
end SubComp;

model PooledWasmModel
  parameter Boolean enableSub = true;
  SubComp s1(k = 3.0) if enableSub;
  SubComp s2(k = 4.0) if not enableSub;
  Real y;
equation
  y = s1.v[1] + s1.v[2];
end PooledWasmModel;
`;
    const ctx = await initContext({ PooledWasmModel: src });
    const tsArena = ctx.flattenArena("PooledWasmModel", undefined, "file:///test/PooledWasmModel.mo", {
      useWasmKernel: false,
    });
    assert(tsArena !== null);
    assert(
      !(tsArena as any)._wasmFlattener,
      "Expected pure TS elaboration not to allocate a shadow _wasmFlattener instance",
    );

    const ex = tsArena.exports as any;
    assert(typeof ex.flattener_destroy === "function", "Expected flattener_destroy to be exported from WASM");
    const ptr1 = ex.flattener_create(tsArena.ptr);
    assert(ptr1 !== 0, "Expected flattener_create to return non-zero pointer");
    ex.flattener_destroy(ptr1);
    const ptr2 = ex.flattener_create(tsArena.ptr);
    assert.strictEqual(
      ptr2,
      ptr1,
      "Expected flattener_create after flattener_destroy to reuse pooled ModelicaFlattener",
    );
    ex.flattener_destroy(ptr2);

    const wasmArena1 = ctx.flattenArena("PooledWasmModel", undefined, "file:///test/PooledWasmModel.mo", {
      useWasmKernel: true,
    });
    const wasmArena2 = ctx.flattenArena("PooledWasmModel", undefined, "file:///test/PooledWasmModel.mo", {
      useWasmKernel: true,
    });
    assert(wasmArena1 !== null && wasmArena2 !== null);
    const text1 = printArena(wasmArena1);
    const text2 = printArena(wasmArena2);
    assert.strictEqual(text1, text2, "Expected repeated pooled WASM flattening to produce identical output");
    assert(text1.includes("s1.v[1]"), `Expected enabled component s1 in:\n${text1}`);
    assert(!text1.includes("s2.v[1]"), `Expected disabled component s2 to be omitted in:\n${text1}`);
  });

  it("should support typed FlatteningState, consolidated arithmetic/equality helpers, and non-electrical bus-to-bus connections (Phase 3.5)", async () => {
    assert.strictEqual(evalArithmeticString("2 * 3 + 4", false), 10);
    assert.strictEqual(evalArithmeticString("2^3 + 1", false), 9);
    assert.strictEqual(evalArithmeticString("1.5e2 + 0.5 * 10", true), 155);
    assert.strictEqual(evalArithmeticString("max(3, 7) + abs(-2)", false), 9);

    const src = `
connector HeatPort
  Real T;
  flow Real Q_flow;
end HeatPort;

expandable connector ThermalBus
end ThermalBus;

model ThermalBusToBus
  HeatPort p1(T(start = 300.0));
  HeatPort p2;
  ThermalBus bus1;
  ThermalBus bus2;
equation
  connect(p1, bus1.portA);
  connect(bus1, bus2);
  connect(bus2.portA, p2);
  p1.T = 350.0;
  p2.Q_flow = -10.0;
end ThermalBusToBus;
`;
    const ctx = await initContext({ ThermalBusToBus: src });
    const arena = ctx.flattenArena("ThermalBusToBus", undefined, "file:///test/ThermalBusToBus.mo", {
      useWasmKernel: false,
    });
    assert(arena !== null);

    const state = getFlatteningState(arena);
    assert(state.db !== undefined, "Expected state.db to be populated via typed FlatteningState");
    assert(state.flattener !== undefined, "Expected state.flattener to be populated via typed FlatteningState");
    assert(state.stmtRanges instanceof Map, "Expected state.stmtRanges to be lazily initialized Map");
    assert(state.deducedOutputShapes instanceof Map, "Expected state.deducedOutputShapes to be lazily initialized Map");

    setNamedArrayShape(arena, "testArr", [3, 4]);
    assert.deepStrictEqual(getNamedArrayShape(arena, "testArr"), [3, 4]);

    const eInt = arena.addIntLiteral(5);
    const eReal = arena.addRealLiteral(5.0);
    assert.strictEqual(areExpressionsEqual(arena, eInt, eReal, false), false);
    assert.strictEqual(areExpressionsEqual(arena, eInt, eReal, true), true);

    const text = printArena(arena);
    assert(
      text.includes("bus1.portA.T") && text.includes("bus2.portA.T"),
      `Expected non-electrical expandable bus potential variables in:\n${text}`,
    );
    assert(
      text.includes("bus1.portA.Q_flow") && text.includes("bus2.portA.Q_flow"),
      `Expected non-electrical expandable bus flow variables in:\n${text}`,
    );
  });
});
