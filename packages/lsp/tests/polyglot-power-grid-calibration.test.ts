// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseComtradeCff } from "@modelscript/comtrade";
import { Context } from "@modelscript/modelica";
import { createWasmParser } from "@modelscript/modelica/parser";
import {
  clearPscadFortranSources,
  EmtdcHostBridge,
  extractEmtNetlist,
  parsePscx,
  registerPscadFortranSource,
} from "@modelscript/pscad";
import { initBltWasm } from "@modelscript/runtime";
import { ArenaSimulator, ModelicaCalibrator } from "@modelscript/simulate";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Extract the files map from the HeroExample in apps/web/src/pages/ansatz-editor/constants.ts
function loadPolyglotPowerGridFiles(): Record<string, string> {
  const constantsPath = path.resolve(__dirname, "../../../apps/web/src/pages/ansatz-editor/constants.ts");
  const src = fs.readFileSync(constantsPath, "utf8");
  const marker = 'id: "polyglot-power-grid-comtrade-calibration"';
  const start = src.indexOf(marker);
  assert.ok(start >= 0, "Expected polyglot-power-grid-comtrade-calibration HeroExample in constants.ts");

  const extractTemplateFile = (fileName: string): string => {
    const key = `"${fileName}": \``;
    const keyIdx = src.indexOf(key, start);
    assert.ok(keyIdx >= 0, `Missing file '${fileName}' in polyglot-power-grid-comtrade-calibration`);
    const bodyStart = keyIdx + key.length;
    const bodyEnd = src.indexOf("`,", bodyStart);
    assert.ok(bodyEnd > bodyStart, `Unterminated template literal for '${fileName}'`);
    return src.slice(bodyStart, bodyEnd);
  };

  return {
    "GridRequirements.sysml": extractTemplateFile("GridRequirements.sysml"),
    "TransmissionGrid.raw": extractTemplateFile("TransmissionGrid.raw"),
    "InverterIsland.pscx": extractTemplateFile("InverterIsland.pscx"),
    "VoltVarDroop.f90": extractTemplateFile("VoltVarDroop.f90"),
    "PlantController.mo": extractTemplateFile("PlantController.mo"),
    "FaultRecord.cff": extractTemplateFile("FaultRecord.cff"),
  };
}

describe("Polyglot Power Grid + COMTRADE Calibration HeroExample E2E", () => {
  it("parses FaultRecord.cff and calibrates PlantController.mo to true K_droop=4.0 and T_avr=0.20", async () => {
    const files = loadPolyglotPowerGridFiles();

    // 1. Parse COMTRADE .cff disturbance record
    const record = parseComtradeCff(files["FaultRecord.cff"]!);
    const timeSec = Array.from(record.timeSec ?? record.timestamps ?? []);
    assert.equal(timeSec.length, 31, "Expected 31 COMTRADE samples (0..1.5s at 20 Hz)");

    const measurements = new Map<string, { t: number[]; y: number[] }>();
    assert.ok(record.analogData instanceof Map, "Expected Map analogData from parseComtradeCff");
    for (const [chName, arr] of record.analogData.entries()) {
      measurements.set(chName, { t: timeSec, y: Array.from(arr) });
    }
    assert.ok(measurements.has("Vt"), "Expected Vt channel in FaultRecord.cff");
    assert.ok(measurements.has("Q_out"), "Expected Q_out channel in FaultRecord.cff");

    // 2. Flatten PlantController.mo via WASM parser + arena flattener
    await initBltWasm();
    const wasmPath = require.resolve("@modelscript/modelica/parser.wasm");
    const { parser } = await createWasmParser(wasmPath);
    Context.registerParser(".mo", parser as any);

    const memFiles = new Map<string, string>([["/PlantController.mo", files["PlantController.mo"]!]]);
    const ctx = Context.createBatch({
      basename: (p: string) => path.basename(p),
      extname: (p: string) => path.extname(p),
      join: (...ps: string[]) => path.join(...ps),
      resolve: (...ps: string[]) => path.resolve(...ps),
      sep: "/",
      read: (p: string) => memFiles.get(p) ?? "",
      readBinary: (p: string) => new TextEncoder().encode(memFiles.get(p) ?? ""),
      readdir: () => [],
      stat: (p: string) =>
        memFiles.has(p) ? { isFile: () => true, isDirectory: () => false, size: memFiles.get(p)!.length } : null,
    } as any);
    await ctx.addLibrary("/PlantController.mo");
    const arena = ctx.flattenArena("PlantController");
    assert.ok(arena, "PlantController should flatten into DAEBuilder arena");

    // 3. Calibrate K_droop and T_avr against COMTRADE measurements
    const simulator = new ArenaSimulator(arena);
    const calibrator = new ModelicaCalibrator(arena, simulator, {
      parameters: ["K_droop", "T_avr"],
      parameterBounds: new Map([
        ["K_droop", { min: 0.5, max: 10.0 }],
        ["T_avr", { min: 0.05, max: 2.0 }],
      ]),
      measurements,
      method: "lm",
      maxIterations: 60,
      tolerance: 1e-6,
    });

    const result = calibrator.calibrate();
    const kOpt = result.parameters.get("K_droop") ?? 0;
    const tOpt = result.parameters.get("T_avr") ?? 0;
    const simStates = Array.from(result.simulated.y.keys());

    assert.ok(
      Math.abs(kOpt - 4.0) < 0.05,
      `Expected calibrated K_droop ≈ 4.0, got ${kOpt} (T_avr=${tOpt}, residual=${result.residual}, iters=${result.iterations}, states=${simStates.join(",")})`,
    );
    assert.ok(Math.abs(tOpt - 0.2) < 0.02, `Expected calibrated T_avr ≈ 0.20, got ${tOpt}`);
  });

  it("links VoltVarDroop.f90 into InverterIsland.pscx and executes custom Fortran UDM via EMTDC bridge", () => {
    const files = loadPolyglotPowerGridFiles();
    clearPscadFortranSources();
    try {
      registerPscadFortranSource("inmemory://model/VoltVarDroop.f90", files["VoltVarDroop.f90"]!);
      const project = parsePscx(files["InverterIsland.pscx"]!);
      const netlist = extractEmtNetlist(project);

      assert.ok(
        netlist.customFortranBlocks && netlist.customFortranBlocks.length === 1,
        "Expected 1 custom Fortran block",
      );
      const block = netlist.customFortranBlocks[0]!;
      assert.equal(block.name, "IBR_Ctrl");

      const bridge = new EmtdcHostBridge({ timeStepSec: 50e-6, maxNodes: 8 });
      const udm = bridge.registerCustomFortranBlock(block);

      // Simulate voltage dip: V_pcc = 184 kV -> v_err = 1 - 184/230 = 0.20 pu -> q_raw = 0.20 * 4.0 = 0.80 pu
      udm.ports["V_pcc"] = 184.0;
      bridge.stepDsdyn(0.0, true, false);
      assert.ok(Math.abs((udm.ports["Q_cmd"] ?? 0) - 0.8) < 1e-5, `Expected Q_cmd = 0.8, got ${udm.ports["Q_cmd"]}`);

      // Severe voltage dip: V_pcc = 115 kV -> v_err = 0.50 -> q_raw = 2.0 -> clamped to Q_max = 1.2
      udm.ports["V_pcc"] = 115.0;
      bridge.stepDsdyn(50e-6, false, false);
      assert.ok(
        Math.abs((udm.ports["Q_cmd"] ?? 0) - 1.2) < 1e-5,
        `Expected clamped Q_cmd = 1.2, got ${udm.ports["Q_cmd"]}`,
      );
    } finally {
      clearPscadFortranSources();
    }
  });

  it("lints TransmissionGrid.raw and InverterIsland.pscx cleanly even with an empty sibling model.pscx", async () => {
    const files = loadPolyglotPowerGridFiles();
    const { lintPscadWorkspace } = await import("@modelscript/pscad");
    const { lintPsseWorkspace } = await import("@modelscript/psse");

    const pscadDiags = lintPscadWorkspace(
      new Map([
        ["file:///model.pscx", ""],
        ["file:///InverterIsland.pscx", files["InverterIsland.pscx"]!],
      ]),
      { tier: "formal" },
    );
    assert.ok(Array.isArray(pscadDiags), "lintPscadWorkspace should not throw on empty sibling model.pscx");

    const psseDiags = lintPsseWorkspace(new Map([["file:///TransmissionGrid.raw", files["TransmissionGrid.raw"]!]]));
    assert.ok(Array.isArray(psseDiags), "lintPsseWorkspace should succeed on TransmissionGrid.raw");
  });
});
