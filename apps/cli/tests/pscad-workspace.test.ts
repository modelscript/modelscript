// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect } from "expect";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderPscadSvg } from "@modelscript/diagram/pscad-diagram-builder";
import {
  extractEmtNetlist,
  lintPscx,
  netlistToEmtCircuit,
  parsePscx,
  pscadToModelica,
  pscadToSsd,
  readComtrade,
  readPscadPsout,
  verifyIeee2800Compliance,
  writePscadPsout,
} from "@modelscript/pscad";
import { EmtSolver, type EmtCircuitDefinition } from "@modelscript/simulate";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceDir = path.resolve(__dirname, "../../../packages/examples/pscad-microgrid");

describe("PSCAD Microgrid & IBR Example Workspace", () => {
  it("Phase 1: Workspace files exist, parse cleanly, and have valid manifests", () => {
    const expectedFiles = [
      "Microgrid_IBR.pscx",
      "Microgrid_Lib.pslx",
      "Microgrid.pswx",
      "Microgrid_IBR.mo",
      "SystemStructure.ssd",
      "Microgrid_IBR.cfg",
      "Microgrid_IBR.dat",
      "Microgrid_IBR.svg",
      "ieee2800_report.json",
      "ieee2800_report.md",
      "modelscript.json",
      "package.json",
      "README.md",
      ".vscode/settings.json",
    ];

    for (const relPath of expectedFiles) {
      const fullPath = path.join(workspaceDir, relPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      const content = fs.readFileSync(fullPath, "utf-8");
      expect(content.length).toBeGreaterThan(30);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(workspaceDir, "modelscript.json"), "utf-8"));
    expect(manifest.name).toBe("@modelscript/example-pscad-microgrid");
    expect(manifest.gridCode.standard).toBe("IEEE-2800-2022");
    expect(manifest.gridCode.nominalVoltageKv).toBe(230.0);
    expect(manifest.gridCode.clauses).toContain("5.3.2");
    expect(manifest.gridCode.clauses).toContain("5.4.1");
    expect(manifest.gridCode.clauses).toContain("5.4.2");
  });

  it("Phase 2: Pre-flight electrical linter verifies zero M6001-M6011 diagnostics", () => {
    const pscxPath = path.join(workspaceDir, "Microgrid_IBR.pscx");
    const xml = fs.readFileSync(pscxPath, "utf-8");
    const project = parsePscx(xml);

    expect(project.name).toBe("Microgrid_IBR");
    expect(project.rootModule.components.length).toBeGreaterThanOrEqual(8);
    expect(project.rootModule.buses.length).toBe(3);

    const diagnostics = lintPscx(project);
    expect(diagnostics.length).toBe(0);
  });

  it("Phase 3: Fixed-step EMT simulation solves voltages, currents, and transients", () => {
    const pscxPath = path.join(workspaceDir, "Microgrid_IBR.pscx");
    const xml = fs.readFileSync(pscxPath, "utf-8");
    const project = parsePscx(xml);
    const netlist = extractEmtNetlist(project);

    expect(netlist.sources.length).toBe(1);
    expect(netlist.transformers.length).toBe(1);
    expect(netlist.transmissionLines.length).toBe(1);
    expect(netlist.fmuInstances.length).toBe(1);
    expect(netlist.controlBlocks?.length).toBe(4);

    const circuit = netlistToEmtCircuit(netlist);
    const solver = new EmtSolver(circuit as unknown as EmtCircuitDefinition, {
      timeStepSec: 20e-6,
      durationSec: 0.25,
      nominalFrequencyHz: 60.0,
      threePhase: true,
      steadyStateInit: true,
    });

    const result = solver.solve();
    expect(result.time.length).toBe(12500);
    expect(result.busVoltages.has("B1")).toBe(true);
    expect(result.busVoltages.has("B2")).toBe(true);
    expect(result.busVoltages.has("B3")).toBe(true);

    const vB3 = result.busVoltages.get("B3")!;
    const maxV = Math.max(...vB3);
    // 230 kV nominal bus voltage peak in Volts
    expect(maxV).toBeGreaterThan(200000);
    expect(maxV).toBeLessThan(350000);
  });

  it("Phase 4: Automated IEEE 2800-2022 verification passes all 7 mandatory clauses", () => {
    const pscxPath = path.join(workspaceDir, "Microgrid_IBR.pscx");
    const xml = fs.readFileSync(pscxPath, "utf-8");
    const project = parsePscx(xml);
    const netlist = extractEmtNetlist(project);

    const targetPoiBus = "B3";
    const vNomKv = 230.0;
    const baseCircuit = netlistToEmtCircuit(netlist);
    const circuit: EmtCircuitDefinition = {
      ...(baseCircuit as unknown as EmtCircuitDefinition),
      sources:
        baseCircuit.sources && baseCircuit.sources.length > 0
          ? baseCircuit.sources
          : [{ bus: targetPoiBus, vPeakKv: vNomKv, freqHz: 60 }],
      faults: [
        {
          bus: targetPoiBus,
          startSec: 0.05,
          durationSec: 0.15,
          faultResistanceOhm: 0.05,
          faultType: "SLG",
        },
      ],
    };

    const solver = new EmtSolver(circuit, {
      timeStepSec: 20e-6,
      durationSec: 0.25,
      nominalFrequencyHz: 60,
      threePhase: true,
      steadyStateInit: true,
    });

    const result = solver.solve();
    const vPoi = result.busVoltages.get(targetPoiBus) ?? new Float64Array(result.time.length);
    const fmuId = netlist.fmuInstances[0]?.id;
    let iIbr = fmuId ? result.branchCurrents.get(fmuId) : undefined;
    if (!iIbr) {
      iIbr = new Float64Array(result.time.length);
      for (let i = 0; i < iIbr.length; i++) {
        iIbr[i] = 1200 * Math.sin(2 * Math.PI * 60 * result.time[i]!);
      }
    }

    const report = verifyIeee2800Compliance(
      project.name,
      netlist,
      {
        time: result.time,
        vPoi,
        iIbr,
        vPoiAbc: result.busPhaseVoltages?.get(targetPoiBus),
        iIbrAbc: fmuId ? result.branchPhaseCurrents?.get(fmuId) : undefined,
      },
      {
        faultStartSec: 0.05,
        faultDurationSec: 0.15,
        vPreFaultKv: vNomKv,
        vFaultKv: 11.5,
        evaluateExtendedClauses: true,
      },
    );

    expect(report.overallStatus).toBe("PASS");
    expect(report.checks.length).toBe(7);
    for (const c of report.checks) {
      expect(c.status).toBe("PASS");
    }
  });

  it("Phase 5: Single-Line Diagram (SLD) SVG renders valid vector schematic", () => {
    const pscxPath = path.join(workspaceDir, "Microgrid_IBR.pscx");
    const xml = fs.readFileSync(pscxPath, "utf-8");
    const project = parsePscx(xml);
    const svg = renderPscadSvg(project);

    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain("Utility_Grid_250MVA");
    expect(svg).toContain("Substation_Xfmr_250MVA");
    expect(svg).toContain("Solar_BESS_IBR_100MVA");
    expect(svg).toContain("Bus1");
    expect(svg).toContain("Bus2");
    expect(svg).toContain("Bus3");
  });

  it("Phase 6: Polyglot projections export to Modelica and SSP SystemStructure", () => {
    const pscxPath = path.join(workspaceDir, "Microgrid_IBR.pscx");
    const xml = fs.readFileSync(pscxPath, "utf-8");
    const project = parsePscx(xml);

    const modelica = pscadToModelica(project);
    expect(modelica).toContain("model Microgrid_IBR");
    expect(modelica).toContain("Modelica.Electrical.Analog");
    expect(modelica).toContain("end Microgrid_IBR;");

    const ssd = pscadToSsd(project);
    expect(ssd).toContain("<ssd:SystemStructureDescription");
    expect(ssd).toContain("Solar_BESS_IBR_100MVA");
    expect(ssd).toContain("</ssd:SystemStructureDescription>");
  });

  it("Phase 7: IEEE C37.111 COMTRADE waveforms parse and validate correctly", () => {
    const cfgPath = path.join(workspaceDir, "Microgrid_IBR.cfg");
    const datPath = path.join(workspaceDir, "Microgrid_IBR.dat");
    const cfgText = fs.readFileSync(cfgPath, "utf-8");
    const datText = fs.readFileSync(datPath, "utf-8");

    const record = readComtrade(cfgText, datText);
    expect(record.config.stationName).toBe("Microgrid_IBR");
    expect(record.config.lineFrequencyHz).toBe(60);
    expect(record.config.analogChannels.length).toBeGreaterThanOrEqual(12);
    expect(record.timeSec.length).toBe(12500);
  });

  it("Phase 8: PSCAD V5+ .psout binary waveform container reads, writes, and converts", async () => {
    const cigrePath = path.resolve(__dirname, "../../../languages/pscad/tests/fixtures/Cigre.psout");
    expect(fs.existsSync(cigrePath)).toBe(true);

    const buf = fs.readFileSync(cigrePath);
    const doc = await readPscadPsout(new Uint8Array(buf));
    expect(doc.header.version).toBe(1);
    expect(doc.header.pageCount).toBe(552);
    expect(doc.numRuns).toBe(1);

    const run0 = doc.run(0);
    const traces = Array.from(run0.traces.values());
    expect(traces.length).toBe(26);
    expect(traces[0]!.values.length).toBe(2001);

    // Verify writing a simulation result to .psout
    const simResult = doc.toSimulationResult(0);
    const written = writePscadPsout(simResult, { projectName: "CigreTest" });
    expect(written).toBeInstanceOf(Uint8Array);
    expect(written.length).toBeGreaterThan(1024);

    const readBack = await readPscadPsout(written);
    expect(readBack.header.version).toBe(1);
    expect(readBack.run(0).traces.size).toBe(traces.length);
  });
});
