// SPDX-License-Identifier: AGPL-3.0-or-later

import { Context } from "@modelscript/modelica/context";
import { createWasmParser } from "@modelscript/modelica/parser";
import assert from "node:assert";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { generateFmuWrapperModelica, type FmiModelDescription, type FmiTerminal } from "../src/fmu/index.js";
class NodeFileSystem {
  basename(p: string): string {
    return path.basename(p);
  }
  extname(p: string): string {
    return path.extname(p);
  }
  join(...paths: string[]): string {
    return path.join(...paths);
  }
  read(p: string): string {
    return fs.readFileSync(p, "utf8");
  }
  readBinary(p: string): Uint8Array {
    return fs.readFileSync(p);
  }
  readdir(p: string): any[] {
    return fs.readdirSync(p, { withFileTypes: true });
  }
  resolve(...paths: string[]): string {
    return path.resolve(...paths);
  }
  get sep(): string {
    return path.sep;
  }
  stat(p: string): any {
    return fs.statSync(p, { throwIfNoEntry: false }) ?? null;
  }
}

const require = createRequire(import.meta.url);
const modelicaWasmPath = require.resolve("@modelscript/modelica/parser.wasm");

console.log("=== Running Acausal FMU Wrapper Modelica Flattener Parity Tests ===");

const { parser } = await createWasmParser(modelicaWasmPath);
Context.registerParser(".mo", parser as any);

const desc: FmiModelDescription = {
  fmiVersion: "3.0",
  modelName: "CoolingModule",
  guid: "{a1b2c3d4-e5f6-7890-1234-56789abcdef0}",
  description: "Acausal cooling module with electrical pin and thermal port",
  author: "ModelScript",
  generationTool: "ModelScript 0.0.18",
  supportsCoSimulation: true,
  supportsModelExchange: true,
  coSimulationModelIdentifier: "CoolingModule_cs",
  modelExchangeModelIdentifier: "CoolingModule_me",
  defaultExperiment: undefined,
  numberOfEventIndicators: 0,
  variables: [
    { name: "p.v", valueReference: 1, causality: "input", variability: "continuous", type: "Real" },
    { name: "p.i", valueReference: 2, causality: "output", variability: "continuous", type: "Real" },
    { name: "n.v", valueReference: 3, causality: "input", variability: "continuous", type: "Real" },
    { name: "n.i", valueReference: 4, causality: "output", variability: "continuous", type: "Real" },
    { name: "T_coolant", valueReference: 5, causality: "parameter", variability: "fixed", type: "Real", start: 298.15 },
  ],
};

const terminals: FmiTerminal[] = [
  {
    name: "p",
    terminalKind: "org.modelica.types.electrical.PositivePin",
    memberVariables: [
      { variableName: "p.v", memberName: "v", variableKind: "potential" },
      { variableName: "p.i", memberName: "i", variableKind: "flow" },
    ],
  },
  {
    name: "n",
    terminalKind: "org.modelica.types.electrical.NegativePin",
    memberVariables: [
      { variableName: "n.v", memberName: "v", variableKind: "potential" },
      { variableName: "n.i", memberName: "i", variableKind: "flow" },
    ],
  },
];

// Generate wrapper code
const wrapperCode = generateFmuWrapperModelica(desc, "CoolingModule.fmu", undefined, terminals);

// Wrap alongside mock pin connectors so it can be parsed and flattened standalone
const fullModelicaSource = `
connector PositivePin
  Real v;
  flow Real i;
end PositivePin;

connector NegativePin
  Real v;
  flow Real i;
end NegativePin;

${wrapperCode.replace(/import Modelica\.Electrical\.Analog\.Interfaces\.PositivePin;\s*/g, "").replace(/import Modelica\.Electrical\.Analog\.Interfaces\.NegativePin;\s*/g, "")}
`;

console.log("Full Source:\n" + fullModelicaSource);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mo-flatten-test-"));
const moPath = path.join(tmpDir, "CoolingModule.mo");
fs.writeFileSync(moPath, fullModelicaSource, "utf-8");

try {
  const context = Context.createBatch(new NodeFileSystem());
  await context.addLibrary(moPath);

  const arena = context.flattenArena("CoolingModule");
  assert.ok(arena, "Flattening should succeed and return DAEBuilder arena");

  console.log(`Arena varCount: ${arena.varCount}, eqCount: ${arena.eqCount}`);
  assert.ok(arena.varCount >= 9, "Should have variables for connectors, parameter, and protected boundary vars");
  assert.ok(arena.eqCount >= 4, "Should have 4 boundary equality equations (p.v, p.i, n.v, n.i)");

  const varNames: string[] = [];
  for (let i = 0; i < arena.varCount; i++) {
    varNames.push(arena.getVarName(i));
  }

  assert.ok(varNames.includes("p.v"), "Should contain p.v");
  assert.ok(varNames.includes("p.i"), "Should contain p.i");
  assert.ok(varNames.includes("n.v"), "Should contain n.v");
  assert.ok(varNames.includes("n.i"), "Should contain n.i");
  assert.ok(varNames.includes("fmu_p_v"), "Should contain fmu_p_v");
  assert.ok(varNames.includes("fmu_p_i"), "Should contain fmu_p_i");
  assert.ok(varNames.includes("fmu_n_v"), "Should contain fmu_n_v");
  assert.ok(varNames.includes("fmu_n_i"), "Should contain fmu_n_i");
  assert.ok(varNames.includes("T_coolant"), "Should contain parameter T_coolant");

  console.log("✓ All Acausal FMU Wrapper Modelica Flattener Parity tests passed successfully!");
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
