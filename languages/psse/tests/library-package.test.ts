// SPDX-License-Identifier: AGPL-3.0-or-later

import { createZip } from "@modelscript/exchange";
import { globalLibraryRegistry } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compileAssemblyScriptDyrModel,
  ensureBuiltInPsseLibraryRegistered,
  fmuToPsse,
  loadFmuForPsse,
  parseDyr,
  parseRaw,
  simulatePsseTransient,
  type PsseLinkedDynamicInstance,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STD_LIB_DIR = path.resolve(__dirname, "../assets/psse-std-lib");

const THREE_BUS_RAW = `0, 100.0, 33, 0, 1, 60.0 / PSS/E 3-BUS TEST SYSTEM
3-BUS LIBRARY TEST
CASE 1
1, 'GEN1_BUS    ', 138.0, 3, 1, 1, 1, 1.03, 0.0
2, 'GEN2_BUS    ', 138.0, 2, 1, 1, 1, 1.02, 0.0
3, 'LOAD_BUS    ', 138.0, 1, 1, 1, 1, 1.00, 0.0
0 / END OF BUS DATA, BEGIN LOAD DATA
3, '1 ', 1, 1, 1, 120.0, 40.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ', 80.0, 20.0, 200.0, -100.0, 1.03, 0, 100.0, 0.003, 0.16, 0.0, 0.0, 1.0, 1, 100.0, 250.0, 0.0
2, '1 ', 50.0, 15.0, 150.0, -80.0, 1.02, 0, 100.0, 0.004, 0.18, 0.0, 0.0, 1.0, 1, 100.0, 200.0, 0.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 3, '1 ', 0.008, 0.065, 0.04, 250.0, 280.0, 300.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 25.0
2, 3, '1 ', 0.010, 0.075, 0.04, 250.0, 280.0, 300.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 30.0
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
0 / END OF TRANSFORMER DATA
Q
`;

describe("@modelscript/psse — package.json Standard Library, AssemblyScript WASM & FMU Linking", () => {
  it("loads @modelscript/psse-std-lib via package.json and steps SEXS + TGOV1 from runtime.wasm", async () => {
    const pkgJsonPath = path.join(STD_LIB_DIR, "package.json");
    assert.ok(fs.existsSync(pkgJsonPath), "Expected psse-std-lib/package.json");

    const pkg = await globalLibraryRegistry.loadLibraryFromDir(STD_LIB_DIR);
    assert.ok(pkg, "Expected loadLibraryFromDir to return loaded package");
    assert.equal(pkg.packageName, "@modelscript/psse-std-lib");
    assert.equal(pkg.manifest.language, "psse");
    assert.ok(pkg.wasmBytes && pkg.wasmBytes.byteLength > 0, "Expected compiled runtime.wasm bytes");

    const psseCase = parseRaw(THREE_BUS_RAW);
    psseCase.dyr = parseDyr(
      `1 'GENROU' 1 6.5 0.05 0.35 0.08 4.2 1.5 1.85 1.75 0.30 0.45 0.20 0.14 0.09 0.18 /\n` +
        `1 'SEXS' 1 0.1 10.0 100.0 0.05 -5.0 5.0 /\n` +
        `1 'TGOV1' 1 0.05 0.5 1.2 0.0 1.0 1.0 0.0 /\n`,
    );

    const sim = simulatePsseTransient(psseCase, {
      stopTime: 0.4,
      timeStep: 0.02,
      faultBus: 3,
      faultStartSec: 0.1,
      faultClearSec: 0.2,
    });
    assert.ok(sim.t.length > 10);
    assert.ok(sim.summary.minBusVoltagePu < 1.0);
  });

  it("compiles a custom AssemblyScript USRMDL exciter and links an FMU co-simulation instance", async () => {
    const customAsSource = `
      export function CUSTOM_EXC_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
        store<f64>(statePtr, load<f64>(ioPtr + 16));
      }
      export function CUSTOM_EXC_step(_t: f64, _dt: f64, _conPtr: usize, statePtr: usize, ioPtr: usize): void {
        const vterm = load<f64>(ioPtr + 0);
        const efd0 = load<f64>(statePtr);
        const efdOut = efd0 + 15.0 * (1.03 - vterm);
        store<f64>(ioPtr + 16, efdOut);
      }
    `;
    const compiled = await compileAssemblyScriptDyrModel(customAsSource);
    assert.ok(compiled.wasmBytes && compiled.wasmBytes.byteLength > 0, compiled.diagnostics.join("; "));

    const fmuProjection = fmuToPsse(
      {
        modelName: "FmuGovernor",
        variables: [
          { name: "R_droop", causality: "parameter", type: "Real", valueReference: 1, start: 0.05 },
          { name: "speedDev", causality: "input", type: "Real", valueReference: 2 },
          { name: "pmech", causality: "output", type: "Real", valueReference: 3 },
        ],
      },
      2,
      "1",
    );
    assert.ok(fmuProjection.dyrRecord.includes("USRMDL"));

    let fmuSteps = 0;
    const fmuLink: PsseLinkedDynamicInstance = {
      busNumber: 2,
      machineId: "1",
      modelName: fmuProjection.modelName,
      init() {},
      doStep(_t, _dt, io) {
        fmuSteps++;
        return { pmech: Math.max(0.1, io.pmech - 0.5 * io.speedDev) };
      },
    };

    const psseCase = parseRaw(THREE_BUS_RAW);
    const sim = simulatePsseTransient(psseCase, {
      stopTime: 0.3,
      timeStep: 0.02,
      faultBus: 3,
      faultStartSec: 0.05,
      faultClearSec: 0.15,
      fmuModels: [fmuLink],
      useWasmStdLib: false,
    });
    assert.ok(fmuSteps > 5, `Expected FMU doStep to be called, got ${fmuSteps}`);
    assert.ok(sim.t.length > 5);
  });

  it("auto-registers psse-std-lib and unpacks a .fmu archive with embedded WASM via loadFmuForPsse", async () => {
    globalLibraryRegistry.clear();
    await ensureBuiltInPsseLibraryRegistered();
    const pkgs = globalLibraryRegistry.getPackagesForLanguage("psse");
    assert.ok(pkgs.length >= 1, "Expected built-in @modelscript/psse-std-lib to be auto-registered");

    const fmuAsSource = `
      export function FMUGOV_init(_conPtr: usize, _count: i32, statePtr: usize, ioPtr: usize): void {
        store<f64>(statePtr, load<f64>(ioPtr + 24));
      }
      export function FMUGOV_step(_t: f64, _dt: f64, _conPtr: usize, statePtr: usize, ioPtr: usize): void {
        const pm0 = load<f64>(statePtr);
        const speedDev = load<f64>(ioPtr + 8);
        store<f64>(ioPtr + 24, pm0 - 0.5 * speedDev);
      }
    `;
    const compiled = await compileAssemblyScriptDyrModel(fmuAsSource);
    assert.ok(compiled.wasmBytes, compiled.diagnostics.join("; "));

    const modelDescXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="FMUGOV" guid="{12345678-1234-1234-1234-1234567890ab}">
  <CoSimulation modelIdentifier="FMUGOV" canHandleVariableCommunicationStepSize="true"/>
  <ModelVariables>
    <ScalarVariable name="R_droop" valueReference="1" causality="parameter" variability="fixed"><Real start="0.05"/></ScalarVariable>
    <ScalarVariable name="speedDev" valueReference="2" causality="input"><Real start="0.0"/></ScalarVariable>
    <ScalarVariable name="pmech" valueReference="3" causality="output"><Real/></ScalarVariable>
  </ModelVariables>
  <ModelStructure/>
</fmiModelDescription>`;

    const zipFiles = new Map<string, Uint8Array>();
    zipFiles.set("modelDescription.xml", new TextEncoder().encode(modelDescXml));
    zipFiles.set("binaries/wasm/FMUGOV.wasm", compiled.wasmBytes);
    const fmuBytes = createZip(zipFiles);

    const linked = await loadFmuForPsse(fmuBytes, { busNumber: 1, machineId: "1" });
    assert.equal(linked.modelDescription.modelName, "FMUGOV");
    assert.ok(linked.projection.dyrRecord.includes("USRMDL"));

    const psseCase = parseRaw(THREE_BUS_RAW);
    psseCase.dyr = parseDyr(
      `1 'EXST1' 1 0.02 0.1 -0.1 0.0 0.0 200.0 0.05 5.0 -4.0 /\n` +
        `2 'HYGOV' 1 0.05 0.1 5.0 0.05 0.5 0.2 1.05 0.0 1.0 /\n`,
    );
    const sim = simulatePsseTransient(psseCase, {
      stopTime: 0.3,
      timeStep: 0.02,
      faultBus: 3,
      faultStartSec: 0.05,
      faultClearSec: 0.15,
      fmuModels: [linked.instance],
    });
    assert.ok(sim.t.length > 5);
  });
});
