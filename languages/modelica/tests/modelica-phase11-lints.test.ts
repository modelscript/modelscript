// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unit tests for Phase 11 shared diagnostic reconciliation and multi-class CST caching:
 * - I4: Unified `resolveModelicaVariableInWorkspace` / `resolveModelicaTypeInWorkspace` shared by testsuite and LSP
 * - §3: Multi-class sentinel (`0xffffffff`) in `getEnclosingClass` preserves exact scoping without O(N) root rescans
 */

import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../src/context.js";
import {
  resolveModelicaTypeInWorkspace,
  resolveModelicaVariableInWorkspace,
} from "../src/diagnostic-reconciliation.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser, facade } = await createWasmParser(modelicaWasm);

function createContext(): Context {
  Context.registerParser(".mo", parser as unknown as Parameters<typeof Context.registerParser>[1]);
  return Context.createBatch(new NodeFileSystem());
}

describe("Modelica Phase 11 shared reconciliation (I4) and multi-class caching", () => {
  it("resolves cross-file expandable buses, component chains, and qualified imports via shared reconciliation helpers", () => {
    const ctx = createContext();
    ctx.load(
      `
package ExternalPkg
  record CustomRecord
    Real value;
  end CustomRecord;
end ExternalPkg;
`,
      "external_pkg.mo",
    );
    ctx.load(
      `
expandable connector ControlBus
end ControlBus;

record InnerPair
  Real gain = 2.0;
end InnerPair;

model Plant
  import CR = ExternalPkg.CustomRecord;
  ControlBus bus;
  InnerPair cfg;
  CR data;
  Real y;
equation
  y = cfg.gain + bus.speed + data.value;
end Plant;
`,
      "plant.mo",
    );

    const qe = ctx.queryEngine;
    const db = qe.toQueryDB();
    const view = {
      symbols: qe.index.symbols,
      symbol: (id: number) => db.symbol(id),
      byName: (n: string) => db.byName(n),
      query: <T = unknown>(q: string, id: number) => db.query<T>(q, id),
    };

    assert.equal(resolveModelicaVariableInWorkspace(view, "cfg.gain", "Plant"), true);
    assert.equal(resolveModelicaVariableInWorkspace(view, "bus.speed", "Plant"), true);
    assert.equal(resolveModelicaVariableInWorkspace(view, "missingSym", "Plant"), false);
    assert.equal(resolveModelicaTypeInWorkspace(view, "CR"), true);
    assert.equal(resolveModelicaTypeInWorkspace(view, "ExternalPkg.CustomRecord"), true);
    assert.equal(resolveModelicaTypeInWorkspace(view, "MissingLib.MissingType"), false);
  });

  it("isolates diagnostics accurately across multi-class files after getEnclosingClass sentinel caching", () => {
    const src = `
model ClassOne
  Real a = 1.0;
end ClassOne;

model ClassTwo
  Real b = 2.0;
end ClassTwo;

model ClassThree
  model Nested
    Real n = 1.0;
  end Nested;
  Real c = undeclared_xyz;
end ClassThree;

model ClassFour
  Real d = 4.0;
end ClassFour;
`;
    const root = facade.parseIncremental(src, 0, 0, src.length, "file:///phase11_multiclass.mo");
    assert.ok(root > 0);
    const diags = facade.getDiagnostics(root, 0, 0, src);
    const m2002 = diags.filter((d: any) => d.code === 2002);
    assert.equal(
      m2002.length,
      1,
      `Expected 1 M2002 on undeclared_xyz across multi-class file: ${JSON.stringify(m2002)}`,
    );
    assert.ok(m2002[0]!.message.includes("undeclared_xyz"));
  });
});
