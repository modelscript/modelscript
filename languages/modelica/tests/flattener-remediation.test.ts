// SPDX-License-Identifier: AGPL-3.0-or-later

import { printArenaDAE } from "@modelscript/runtime";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Flattener Remediation Suite (Phases 0-3)", () => {
  const fs = new NodeFileSystem();

  beforeAll(async () => {
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);
  });

  it("evaluates general boolean and relational expressions in conditional components", () => {
    const ctx = new Context(fs);
    const uri = "file:///test/CondCompExpr.mo";
    ctx.load(
      `model M
  parameter Integer N = 3;
  parameter Boolean flag = true;
  Real x if N > 1 and flag;
  Real y if N == 0 or not flag;
equation
  x = 1.0;
end M;`,
      uri,
    );
    const dae = ctx.flattenArena("M", undefined, uri, { backend: "ts", eliminateAliases: false });
    expect(dae).not.toBeNull();
    expect(dae!.getVarIdxByName("x")).toBeGreaterThanOrEqual(0);
    expect(dae!.getVarIdxByName("y")).toBe(-1);
  });

  it("separates elsewhen branches into whenMeta.elseWhenClauses in TS flattener", () => {
    const ctx = new Context(fs);
    const uri = "file:///test/WhenElseWhen.mo";
    ctx.load(
      `model M
  discrete Real x(start = 0.0);
equation
  when time > 1.0 then
    x = 1.0;
  elsewhen time > 2.0 then
    x = 2.0;
  end when;
end M;`,
      uri,
    );
    const dae = ctx.flattenArena("M", undefined, uri, { backend: "ts", eliminateAliases: false });
    expect(dae).not.toBeNull();
    const text = printArenaDAE(dae!, true);
    expect(text).toContain("when time > 1.0 then");
    expect(text).toContain("elsewhen time > 2.0 then");
  });

  it("does not treat relational == in when condition as an assignment for pre() validation", () => {
    const ctx = new Context(fs);
    const uri = "file:///test/PreWhenRelational.mo";
    ctx.load(
      `model M
  Real x = time;
  discrete Integer k(start = 0);
equation
  when x >= 1.0 then
    k = if pre(x) == 1.0 then 1 else 2;
  end when;
end M;`,
      uri,
    );
    const dae = ctx.flattenArena("M", undefined, uri, { backend: "ts", eliminateAliases: false });
    expect(dae).not.toBeNull();
    expect(dae!.diagnostics.length).toBeGreaterThan(0);
  });

  it("indexes parenthesized non-identifier ArrayCtor bases directly without interning invalid Name expressions", () => {
    const ctx = new Context(fs);
    const uri = "file:///test/ArrayCtorSubscript.mo";
    ctx.load(
      `model M
  Real x = ({10.0, 20.0, 30.0})[2];
  Real y = (identity(2))[1, 2];
end M;`,
      uri,
    );
    const dae = ctx.flattenArena("M", undefined, uri, { backend: "ts", eliminateAliases: false });
    expect(dae).not.toBeNull();
    const text = printArenaDAE(dae!, true);
    expect(text).toContain("Real x = 20.0;");
    expect(text).toContain("Real y = 0.0;");
  });

  it("lowers outerProduct(v1, v2) and 1-arg array min(A)/max(A) reductions", () => {
    const ctx = new Context(fs);
    const uri = "file:///test/OuterProductMinMax.mo";
    ctx.load(
      `model M
  Real A[2, 2] = outerProduct({1.0, 2.0}, {3.0, 4.0});
  Real mn = min({3.0, -2.0, 5.0});
  Real mx = max({3.0, -2.0, 5.0});
end M;`,
      uri,
    );
    const dae = ctx.flattenArena("M", undefined, uri, {
      backend: "ts",
      omcCompatibility: true,
      eliminateAliases: false,
    });
    expect(dae).not.toBeNull();
    const text = printArenaDAE(dae!, true);
    expect(text).toContain("A = {{3.0, 4.0}, {6.0, 8.0}};");
    expect(text).toContain("Real mn = -2.0;");
    expect(text).toContain("Real mx = 5.0;");
  });

  it("evaluates N-D array comprehensions and distributes der() over binary/unary expressions", () => {
    const ctx = new Context(fs);
    const uri = "file:///test/NDCompAndDer.mo";
    ctx.load(
      `model M
  Real B[3, 2] = {i * 10.0 + j for i in 1:2, j in 1:3};
  Real x(start = 0.0);
  Real y(start = 0.0);
equation
  der(x) = 1.0;
  der(x + y) = 3.0;
end M;`,
      uri,
    );
    const dae = ctx.flattenArena("M", undefined, uri, {
      backend: "ts",
      omcCompatibility: true,
      eliminateAliases: false,
    });
    expect(dae).not.toBeNull();
    const text = printArenaDAE(dae!, true);
    expect(text).toContain("B = {{11.0, 21.0}, {12.0, 22.0}, {13.0, 23.0}};");
    expect(text).toContain("der(x) + der(y) = 3.0;");
  });

  it("transfers WASM inner/outer mappings to dae.innerComponents and dae.outerToInner", () => {
    const ctx = new Context(fs);
    const uri = "file:///test/WasmInnerOuter.mo";
    ctx.load(
      `model Sub
  outer Real env;
  Real x;
equation
  x = env;
end Sub;

model M
  inner Real env = 5.0;
  Sub s;
end M;`,
      uri,
    );
    const dae = ctx.flattenArena("M", undefined, uri, { backend: "hybrid", eliminateAliases: false });
    expect(dae).not.toBeNull();
    expect((dae as any).innerComponents?.has("env")).toBe(true);
    expect((dae as any).outerToInner?.get("s.env")).toBe("env");
  });
});
