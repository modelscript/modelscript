// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { attachPmviewBatchToDossier, parsePmviewBatchSummary } from "../src/compliance/index.js";
import {
  compileP3743ToEmtCorridors,
  computeP3743PayloadDigest,
  exportP3743ToCimRdf,
  importCimRdfToP3743,
  instantiateP3743WasmVendorModels,
  parseP3743Package,
  serializeP3743Package,
  validateP3743Package,
  type P3743Package,
} from "../src/p3743/index.js";

function buildSampleP3743Package(): P3743Package {
  const dummyWasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const payloadBase64 = Buffer.from(dummyWasm).toString("base64");
  const sha256 = computeP3743PayloadDigest(dummyWasm);

  return {
    metadata: {
      schemaVersion: "IEEE-P3743-draft-1.0",
      caseId: "ERCOT-WEST-IBR-01",
      title: "345 kV IBR Wideband EMT Corridor",
      nominalFrequencyHz: 60,
      baseMva: 100,
      createdAtIso: "2026-11-15T00:00:00.000Z",
      utilityOrRto: "ERCOT",
    },
    buses: [
      { id: "BUS_POI", busNumber: 101, name: "POI_345", baseKvLL: 345, phases: ["A", "B", "C"], isPoi: true },
      { id: "BUS_SUB", busNumber: 102, name: "SUB_345", baseKvLL: 345, phases: ["A", "B", "C"] },
    ],
    corridors: [
      {
        id: "LINE_POI_SUB",
        fromBusId: "BUS_POI",
        toBusId: "BUS_SUB",
        lengthKm: 45,
        soilModel: { kind: "two-layer", upperRhoOhmM: 50, lowerRhoOhmM: 200, upperDepthM: 5 },
      },
    ],
    vendorModels: [
      {
        id: "IBR_GFL_1",
        busId: "BUS_POI",
        payloadKind: "cigre-tb881-wasm",
        modelInfo: {
          modelName: "VendorGFL_v2",
          vendorName: "GridInverterCorp",
          firmwareVersion: "2.1.0",
          buildTimestamp: "2026-10-01T00:00:00Z",
          abiVersion: "IEEE_P2800.2_v1",
          numInputs: 10,
          numOutputs: 8,
          numParameters: 12,
          numStates: 24,
          recommendedTimeStepSec: 50e-6,
          minTimeStepSec: 20e-6,
          maxTimeStepSec: 100e-6,
        },
        initParams: {
          nominalFreqHz: 60,
          mbaseMva: 250,
          vNominalKv: 345,
          controlMode: "voltage_control",
          parameters: { kp_pll: 10.0, ki_pll: 100.0 },
        },
        payloadBase64,
        sha256,
      },
    ],
    boundaryEquivalents: [
      {
        busId: "BUS_SUB",
        shortCircuitMva: 4500,
        xOverRRatio: 12.5,
        z1Ohm: { r: 2.1, x: 26.25 },
        z0Ohm: { r: 4.5, x: 42.0 },
        sourceTool: "aspen-oneliner",
      },
    ],
  };
}

test("IEEE P3743 serialization, parsing, and SHA-256 tamper detection", () => {
  const pkg = buildSampleP3743Package();
  const json = serializeP3743Package(pkg);
  const parsed = parseP3743Package(json);
  assert.strictEqual(parsed.validation.valid, true);
  assert.strictEqual(parsed.validation.errors.length, 0);

  // Tamper with payloadBase64 and verify SHA-256 check catches it
  const tampered: P3743Package = structuredClone(pkg);
  tampered.vendorModels[0]!.payloadBase64 = Buffer.from([1, 2, 3, 4]).toString("base64");
  const badValidation = validateP3743Package(tampered);
  assert.strictEqual(badValidation.valid, false);
  assert.ok(badValidation.errors.some((e) => e.includes("SHA-256 mismatch")));
});

test("IEEE P3743 compiles to wideband EMT corridors with boundary equivalents", () => {
  const pkg = buildSampleP3743Package();
  const compiled = compileP3743ToEmtCorridors(pkg);
  assert.strictEqual(compiled.caseId, "ERCOT-WEST-IBR-01");
  assert.strictEqual(compiled.corridors.length, 1);
  assert.strictEqual(compiled.verifiedVendorModels.length, 1);
  assert.strictEqual(compiled.verifiedVendorModels[0]?.id, "IBR_GFL_1");

  const c = compiled.corridors[0]!;
  assert.strictEqual(c.corridorId, "LINE_POI_SUB");
  assert.ok(c.fdLine.yPoles.length > 0);
  assert.ok(c.fdLine.tauSec > 0);
  assert.strictEqual(c.toBoundary?.busId, "BUS_SUB");
  assert.strictEqual(c.toBoundary?.shortCircuitMva, 4500);
});

test("IEEE P3743 exports to and imports from CIM / EMTIOP RDF-XML", () => {
  const pkg = buildSampleP3743Package();
  const rdfXml = exportP3743ToCimRdf(pkg);
  const reimported = importCimRdfToP3743(rdfXml, { caseId: "CIM-RT-01" });
  assert.strictEqual(reimported.buses.length, 2);
  assert.strictEqual(reimported.corridors.length, 1);
  assert.strictEqual(reimported.corridors[0]?.id, "LINE_POI_SUB");
  assert.strictEqual(reimported.corridors[0]?.lengthKm, 45);
});

test("IEEE P3743 forwards tabulated mutualCouplings and steps CIGRE TB 881 WASM vendor model", async () => {
  // Minimal valid WASM module exporting 1 page of memory (64 KiB)
  const minimalWasm = new Uint8Array([
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00, // magic + version
    0x05,
    0x03,
    0x01,
    0x00,
    0x01, // memory section: 1 memory, min 1 page
    0x07,
    0x0a,
    0x01,
    0x06,
    0x6d,
    0x65,
    0x6d,
    0x6f,
    0x72,
    0x79,
    0x02,
    0x00, // export "memory"
  ]);
  const pkg = buildSampleP3743Package();
  pkg.corridors[0]!.mutualCouplings = [
    {
      corridorA: "LINE_POI_SUB",
      corridorB: "PARALLEL_230",
      frequenciesHz: [60, 1000],
      rMutualOhmPerKm: [0.12, 0.85],
      lMutualHPerKm: [0.0009, 0.0006],
      couplingLengthKm: 20,
    },
  ];
  pkg.vendorModels[0]!.payloadBase64 = Buffer.from(minimalWasm).toString("base64");
  pkg.vendorModels[0]!.sha256 = computeP3743PayloadDigest(minimalWasm);

  const compiled = compileP3743ToEmtCorridors(pkg);
  assert.strictEqual(compiled.corridors[0]?.mutualCouplings.length, 1);
  assert.strictEqual(compiled.corridors[0]?.mutualCouplings[0]?.coupledCorridorId, "PARALLEL_230");
  assert.strictEqual(compiled.corridors[0]?.mutualCouplings[0]?.lMutualHPerKm, 0.0009);

  const handles = await instantiateP3743WasmVendorModels(pkg);
  assert.strictEqual(handles.length, 1);
  const out = handles[0]!.step({
    timeSec: 0.01,
    va: 1.0,
    vb: -0.5,
    vc: -0.5,
    ia: 0.1,
    ib: -0.05,
    ic: -0.05,
    pRefPu: 1.0,
  });
  assert.strictEqual(typeof out.idTargetPu, "number");
  assert.strictEqual(out.isTripped, false);
});

test("ERCOT PMView batch summary CSV parser", () => {
  const csv = [
    "testId,category,status,measured,threshold,notes",
    "T01,LVRT_0.0PU,PASS,0.92,0.85,Recovered within 1.0s",
    "T02,HVRT_1.2PU,PASS,1.18,1.20,No trip",
    "T03,SCR_1.5,FAIL,0.40,0.80,Oscillation detected",
  ].join("\n");
  const summary = parsePmviewBatchSummary(csv, "ERCOT_AGS_ESR_3.5");
  assert.strictEqual(summary.profileName, "ERCOT_AGS_ESR_3.5");
  assert.strictEqual(summary.totalTests, 3);
  assert.strictEqual(summary.passedTests, 2);
  assert.strictEqual(summary.failedTests, 1);
  assert.strictEqual(summary.allPassed, false);
  assert.strictEqual(summary.cases[0]?.category, "LVRT");

  const dossier = attachPmviewBatchToDossier({ ieee2800Passed: true, prc029Passed: true }, summary);
  assert.strictEqual(dossier.pmViewProfileName, "ERCOT_AGS_ESR_3.5");
  assert.strictEqual(dossier.pmViewPassed, false);
});
