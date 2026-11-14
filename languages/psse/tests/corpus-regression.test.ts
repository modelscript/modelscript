// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  compileAsToWasm,
  createZip,
  generateFmiLsRmsAnnotationXml,
  generateFmiLsRmsAsStub,
  parseFmiLsRmsAnnotations,
  type FmiLsRmsCompanionInstance,
} from "@modelscript/exchange";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  calculateShortCircuit,
  calculateSotaDiscrepancy,
  ensureBuiltInPsseLibraryRegistered,
  lintPsse,
  loadFmuForPsse,
  parseDyr,
  parsePsseOut,
  parseRaw,
  parseSeq,
  simulatePsseTransient,
  solvePowerFlow,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTSUITE_DIR = path.resolve(__dirname, "../testsuite");

describe("@modelscript/psse — Corpus Regression & Ground-Truth Verification", () => {
  it("parses, lints (0 errors), solves AC power flow, and simulates all testsuite .raw/.dyr cases", async () => {
    await ensureBuiltInPsseLibraryRegistered();
    const rawFiles = fs
      .readdirSync(TESTSUITE_DIR)
      .filter((f) => f.toLowerCase().endsWith(".raw"))
      .sort();

    assert.ok(rawFiles.length >= 5, `Expected >= 5 .raw corpus files, found ${rawFiles.length}`);

    for (const rawFile of rawFiles) {
      const rawPath = path.join(TESTSUITE_DIR, rawFile);
      const parsed = parseRaw(fs.readFileSync(rawPath, "utf-8"));
      const dyrPath = rawPath.replace(/\.raw$/i, ".dyr");
      if (fs.existsSync(dyrPath)) {
        parsed.dyr = parseDyr(fs.readFileSync(dyrPath, "utf-8"));
      }

      const errors = lintPsse(parsed).filter((d) => d.severity === "error");
      assert.equal(errors.length, 0, `${rawFile} produced lint errors: ${errors.map((e) => e.message).join("; ")}`);

      const pf = solvePowerFlow(parsed, { maxIterations: 30, tolerance: 1e-4 });
      assert.equal(pf.converged, true, `${rawFile} AC power flow did not converge`);
      assert.ok(pf.maxMismatchPu < 1e-4, `${rawFile} maxMismatchPu ${pf.maxMismatchPu} >= 1e-4`);

      if (rawFile === "ieee9.raw") {
        let maxDv = 0;
        let maxDa = 0;
        for (const b of pf.buses) {
          const refBus = parsed.buses.get(b.busNumber);
          if (!refBus) continue;
          maxDv = Math.max(maxDv, Math.abs(b.vm - refBus.vm));
          maxDa = Math.max(maxDa, Math.abs(b.va - refBus.va));
        }
        assert.ok(maxDv < 1e-3, `${rawFile} max |ΔVm| ${maxDv.toFixed(5)} pu >= 1e-3`);
        assert.ok(maxDa < 0.1, `${rawFile} max |ΔVa| ${maxDa.toFixed(3)} deg >= 0.1`);
      }

      const sim = simulatePsseTransient(parsed, { stopTime: 0.4, timeStep: 0.02 });
      assert.ok(sim.t.length >= 10, `${rawFile} transient simulation returned too few steps`);

      const seqPath = rawPath.replace(/\.raw$/i, ".seq");
      if (fs.existsSync(seqPath)) {
        const seqCase = parseSeq(fs.readFileSync(seqPath, "utf-8"));
        const sc = calculateShortCircuit(parsed, { seq: seqCase });
        assert.equal(sc.buses.length, parsed.buses.size, `${rawFile} short-circuit bus count mismatch`);
        assert.ok(
          sc.buses.some((b) => b.ik3PhaseKa > 0 && b.ik1LineGroundKa > 0),
          `${rawFile} invalid fault currents`,
        );
      }

      // Optional commercial PSS/E reference CSV parity check (<case>.ref.csv)
      const refCsvPath = rawPath.replace(/\.raw$/i, ".ref.csv");
      if (fs.existsSync(refCsvPath)) {
        const lines = fs.readFileSync(refCsvPath, "utf-8").trim().split(/\r?\n/);
        const headers = lines[0]!.split(",").map((h) => h.trim());
        const rows = lines.slice(1).map((l) => l.split(",").map(Number));
        for (let col = 1; col < headers.length; col++) {
          const chName = headers[col]!;
          const simSeries = sim.variables[chName];
          if (!simSeries) continue;
          const n = Math.min(simSeries.length, rows.length);
          const refArr = new Float64Array(n);
          const simArr = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            refArr[i] = rows[i]![col]!;
            simArr[i] = simSeries[i]!;
          }
          const m = calculateSotaDiscrepancy(simArr, refArr);
          assert.ok(m.nrmsePercent < 5.0, `${rawFile} ${chName} NRMSE ${m.nrmsePercent}% >= 5%`);
          assert.ok(m.theilTic < 0.05, `${rawFile} ${chName} Theil TIC ${m.theilTic} >= 0.05`);
        }
      }

      // Optional commercial PSS/E binary .out reference parity check (<case>.out)
      const refOutPath = rawPath.replace(/\.raw$/i, ".out");
      if (fs.existsSync(refOutPath)) {
        const outData = parsePsseOut(new Uint8Array(fs.readFileSync(refOutPath)));
        for (let idx = 0; idx < outData.channelNames.length; idx++) {
          const chName = outData.channelNames[idx]!;
          const chVals = outData.channels[idx]!;
          const simSeries = sim.variables[chName];
          if (!simSeries) continue;
          const n = Math.min(simSeries.length, chVals.length);
          const refArr = new Float64Array(n);
          const simArr = new Float64Array(n);
          for (let i = 0; i < n; i++) {
            refArr[i] = chVals[i]!;
            simArr[i] = simSeries[i]!;
          }
          const m = calculateSotaDiscrepancy(simArr, refArr);
          assert.ok(m.nrmsePercent < 5.0, `${rawFile} ${chName} NRMSE ${m.nrmsePercent}% >= 5%`);
          assert.ok(m.theilTic < 0.05, `${rawFile} ${chName} Theil TIC ${m.theilTic} >= 0.05`);
        }
      }
    }
  });

  it("computes NRMSE and Theil TIC trajectory parity via calculateSotaDiscrepancy", () => {
    const ref = new Float64Array([1.04, 1.038, 1.035, 1.037, 1.039, 1.04]);
    const sim = new Float64Array([1.04, 1.0378, 1.0352, 1.0369, 1.0391, 1.04]);
    const metrics = calculateSotaDiscrepancy(sim, ref, { ratedSpan: 0.1 });
    assert.equal(metrics.status, "PASS");
    assert.ok(metrics.nrmsePercent < 1.0);
    assert.ok(metrics.theilTic < 0.01);
  });

  it("supports fmi-ls-rms Norton companion stamping in simulatePsseTransient and browser-safe .fmu unpacking", async () => {
    const xmlSnippet = generateFmiLsRmsAnnotationXml({
      version: "1.0",
      supportsNewtonIteration: false,
      terminals: [
        {
          terminalName: "GridBus",
          busIdVar: "bus_id",
          vrVar: "vr",
          viVar: "vi",
          gEqVar: "G_eq",
          bEqVar: "B_eq",
          irHistVar: "Ir_hist",
          iiHistVar: "Ii_hist",
        },
      ],
    });
    const fullXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="3.0" modelName="RmsTestIbr" instantiationToken="rms-test">
  <VendorAnnotations>${xmlSnippet}</VendorAnnotations>
  <ModelVariables>
    <Float64 name="vr" valueReference="1" causality="input"/>
    <Float64 name="vi" valueReference="2" causality="input"/>
    <Float64 name="G_eq" valueReference="3" causality="output"/>
    <Float64 name="B_eq" valueReference="4" causality="output"/>
    <Float64 name="Ir_hist" valueReference="5" causality="output"/>
    <Float64 name="Ii_hist" valueReference="6" causality="output"/>
  </ModelVariables>
</fmiModelDescription>`;

    const parsedManifest = parseFmiLsRmsAnnotations(fullXml);
    assert.ok(parsedManifest);
    assert.equal(parsedManifest.terminals[0]?.vrVar, "vr");

    const fmuZip = createZip(new Map([["modelDescription.xml", new TextEncoder().encode(fullXml)]]));
    const loaded = await loadFmuForPsse(fmuZip, { busNumber: 5 });
    assert.equal(loaded.fmiLsRms?.version, "1.0");

    const ieee9Path = path.join(TESTSUITE_DIR, "ieee9.raw");
    const parsed = parseRaw(fs.readFileSync(ieee9Path, "utf-8"));
    let stampCalls = 0;
    let stepCalls = 0;
    const companion: FmiLsRmsCompanionInstance = {
      busNumber: 5,
      stampNorton() {
        stampCalls++;
        return { gEq: 0.05, bEq: -0.02, irHist: 0.01, iiHist: 0.0 };
      },
      doStep() {
        stepCalls++;
      },
    };

    const sim = simulatePsseTransient(parsed, {
      stopTime: 0.2,
      timeStep: 0.02,
      nortonCompanions: [companion],
    });
    assert.ok(sim.t.length >= 10);
    assert.ok(stampCalls >= 10, `Expected >= 10 stampNorton calls, got ${stampCalls}`);
    assert.ok(stepCalls >= 10, `Expected >= 10 doStep calls, got ${stepCalls}`);
  });

  it("compiles an AssemblyScript FMI 3.0 + fmi-ls-rms WASM .fmu and executes it end-to-end in simulatePsseTransient", async () => {
    const xmlSnippet = generateFmiLsRmsAnnotationXml({
      version: "1.0",
      supportsNewtonIteration: false,
      terminals: [
        {
          terminalName: "GridBus",
          busIdVar: "bus_id",
          vrVar: "vr",
          viVar: "vi",
          gEqVar: "G_eq",
          bEqVar: "B_eq",
          irHistVar: "Ir_hist",
          iiHistVar: "Ii_hist",
        },
      ],
    });
    const fullXml = `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="3.0" modelName="RmsCompiledIbr" instantiationToken="rms-compiled-test">
  <VendorAnnotations>${xmlSnippet}</VendorAnnotations>
  <ModelVariables>
    <Float64 name="vr" valueReference="1" causality="input"/>
    <Float64 name="vi" valueReference="2" causality="input"/>
    <Float64 name="G_eq" valueReference="3" causality="output"/>
    <Float64 name="B_eq" valueReference="4" causality="output"/>
    <Float64 name="Ir_hist" valueReference="5" causality="output"/>
    <Float64 name="Ii_hist" valueReference="6" causality="output"/>
  </ModelVariables>
</fmiModelDescription>`;

    const asSource = generateFmiLsRmsAsStub("RmsCompiledIbr", { gEq: 0.05, bEq: -0.02 });
    const compiled = await compileAsToWasm(asSource, "RmsCompiledIbr");
    assert.equal(compiled.success, true, `AssemblyScript compilation failed: ${compiled.message}`);
    assert.ok(compiled.wasm && compiled.wasm.length > 0);

    const fmuZip = createZip(
      new Map([
        ["modelDescription.xml", new TextEncoder().encode(fullXml)],
        ["binaries/wasm/model.wasm", compiled.wasm],
      ]),
    );

    const loaded = await loadFmuForPsse(fmuZip, { busNumber: 5 });
    assert.ok(loaded.nortonCompanion, "Expected nortonCompanion from compiled FMI 3.0 WASM FMU");
    const stamp0 = loaded.nortonCompanion.stampNorton(0, 0.02);
    assert.ok(Math.abs(stamp0.gEq - 0.05) < 1e-6);
    assert.ok(Math.abs(stamp0.bEq + 0.02) < 1e-6);

    const ieee9Path = path.join(TESTSUITE_DIR, "ieee9.raw");
    const parsed = parseRaw(fs.readFileSync(ieee9Path, "utf-8"));
    const sim = simulatePsseTransient(parsed, {
      stopTime: 0.2,
      timeStep: 0.02,
      nortonCompanions: [loaded.nortonCompanion],
    });
    assert.ok(sim.t.length >= 10);
    assert.equal(sim.summary.convergedPowerFlow, true);
  });
});
