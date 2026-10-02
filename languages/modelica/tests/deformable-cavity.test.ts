// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createWasmParser } from "../src-gen/bindings.js";
import { Context } from "../src/context.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("Phase 2: Modelica Deformable Physiological Plant & Device Control", () => {
  it("should parse, index, and flatten DeformableVentricle with dynamic spatial clearance", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);

    const filePath = path.resolve(__dirname, "../examples/Physiological.mo");
    const source = fs.readFileSync(filePath, "utf-8");

    const ctx = new Context(new NodeFileSystem());
    const uri = "file:///examples/Physiological.mo";
    ctx.load(source, uri);

    // Flatten DeformableVentricle
    const arena = ctx.flattenArena("Physiological.DeformableVentricle", undefined, uri);
    assert(arena !== null, "DeformableVentricle arena should not be null");
    assert(arena.varCount > 0, "DeformableVentricle must have variables");
    assert(arena.eqCount > 0, "DeformableVentricle must have equations");

    // Check that key physiological variables exist in the DAE
    const varNames: string[] = [];
    for (let i = 0; i < arena.varCount; i++) {
      varNames.push(arena.getVarName(i));
    }

    assert(varNames.includes("V"), "Chamber volume variable V must exist in DAE");
    assert(varNames.includes("P"), "Chamber pressure variable P must exist in DAE");
    assert(varNames.includes("R_choke"), "Non-linear choke resistance R_choke must exist in DAE");
    assert(varNames.includes("clearance.distance"), "Clearance distance input must exist in DAE");
    assert(varNames.includes("clearance.contactWarning"), "Contact warning output must exist in DAE");
  });

  it("should flatten closed-loop CoupledLvadSuction model with controller and spatial feedback", async () => {
    const { parser } = await createWasmParser(modelicaWasm);
    Context.registerParser(".mo", parser as any);

    const filePath = path.resolve(__dirname, "../examples/Physiological.mo");
    const source = fs.readFileSync(filePath, "utf-8");

    const ctx = new Context(new NodeFileSystem());
    const uri = "file:///examples/Physiological.mo";
    ctx.load(source, uri);

    // Flatten complete closed-loop system: CoupledLvadSuction
    const arena = ctx.flattenArena("Physiological.CoupledLvadSuction", undefined, uri);
    assert(arena !== null, "CoupledLvadSuction arena should not be null");
    assert(arena.varCount >= 10, `Expected at least 10 variables, got ${arena.varCount}`);
    assert(arena.eqCount >= 10, `Expected at least 10 equations, got ${arena.eqCount}`);

    const varNames: string[] = [];
    for (let i = 0; i < arena.varCount; i++) {
      varNames.push(arena.getVarName(i));
    }

    assert(
      varNames.some((v) => v.includes("pump") && v.includes("speedRpm")),
      "Pump speed variable must exist in closed-loop DAE",
    );
    assert(
      varNames.some((v) => v.includes("ventricle") && v.includes("V")),
      "Ventricle volume variable must exist in closed-loop DAE",
    );
    assert(
      varNames.some((v) => v.includes("controller") && v.includes("targetRpm")),
      "Controller targetRpm must exist in closed-loop DAE",
    );
  });
});
