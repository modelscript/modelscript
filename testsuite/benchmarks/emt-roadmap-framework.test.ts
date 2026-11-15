// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  computeP3743PayloadDigest,
  parseP3743Package,
  serializeP3743Package,
  signNrtlAttestation,
  verifyNrtlAttestation,
  type P3743Package,
} from "@modelscript/exchange";
import { resolveDigitalThreadWorkspace, ThreadDomain } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { formatComname, parseComfede, parseComname, serializeComfede } from "../../languages/comtrade/src/index.js";
import { parsePscx } from "../../languages/pscad/src/parser/pscx-parser.js";
import { serializePscx } from "../../languages/pscad/src/parser/pscx-writer.js";
import { evaluatePmViewCompliance, parsePmViewProfile } from "../../languages/pscad/src/verification/pmview-runner.js";
import {
  auditFac002Interconnection,
  auditMod032DataCompleteness,
} from "../../languages/psse/src/compliance/nerc-auditor.js";
import { serializePsseRaw } from "../../languages/psse/src/parser/raw-serializer.js";
import { serializePsseSeq } from "../../languages/psse/src/parser/seq-serializer.js";
import { BusType, type PsseCase, type PsseSeqCase } from "../../languages/psse/src/types.js";
import { RtoCaseSubmissionLedger } from "../../languages/sysml2/src/rto-boundary-handshake.js";
import { fitWidebandTransformer } from "../../packages/simulate/src/calibration/wideband-transformer-fitter.js";
import { evaluateGridStrength } from "../../packages/simulate/src/solvers/compliance/grid-strength-gatekeeper.js";
import { auditRelayIsolationAndSsci } from "../../packages/simulate/src/solvers/compliance/ibr-relay-auditor.js";
import { computeComplexEarthPenetrationDepth } from "../../packages/simulate/src/solvers/emt/line-constants.js";
import { compileWidebandCorridor } from "../../packages/simulate/src/solvers/emt/wideband-corridor-compiler.js";
import { routePowerUmbrella } from "../../packages/simulate/src/sysml2/power-umbrella-router.js";

const SAMPLE_RAW = [
  "0, 100.0, 33, 0, 1, 60.0",
  "SPRINGFIELD 161KV BESS STUDY",
  "BASE CASE",
  "101, 'POI_161', 161.0, 3, 1, 1, 1, 1.0, 0.0, 1.1, 0.9, 1.1, 0.9",
  "102, 'BESS_34', 34.5, 1, 1, 1, 1, 1.0, -2.0, 1.1, 0.9, 1.1, 0.9",
  "0 / END OF BUS DATA",
].join("\n");

const SAMPLE_DYR = "102 'REGCA1' 1 0.02 10.0 0.9 0.5 /";

test("Phase 1: SysML v2 digital thread & Power Umbrella router", () => {
  const ws = resolveDigitalThreadWorkspace([
    { fileName: "bess_interconnection.sysml", content: "package BESS {}" },
    { fileName: "case.raw", content: SAMPLE_RAW },
    { fileName: "case.dyr", content: SAMPLE_DYR },
    { fileName: "bess.pscx", content: "<project name='bess' />" },
    { fileName: "event.cfg", content: "STATION,DFR,2013" },
  ]);

  assert.equal(ws.scenarioId, "grid-emt-interconnection");
  assert.ok(ws.roleIndex.powerRms >= 0);
  assert.ok(ws.roleIndex.powerEmt >= 0);
  assert.ok(ws.roleIndex.telemetry >= 0);
  assert.equal(ws.documents[1]!.threadDomain, ThreadDomain.PowerRMS);
  assert.equal(ws.documents[3]!.threadDomain, ThreadDomain.PowerEMT);
  assert.equal(ws.documents[4]!.threadDomain, ThreadDomain.Telemetry);

  const decision = routePowerUmbrella(
    [
      { fileName: "case.raw", content: SAMPLE_RAW },
      { fileName: "case.dyr", content: SAMPLE_DYR },
      { fileName: "bess.pscx", content: "<project name='bess' />" },
    ],
    { poiScr: 1.65 },
  );
  assert.equal(decision.isReadyForExecution, true);
  assert.equal(decision.targetEngine, "hybrid-emt-ts");
  assert.deepEqual(decision.discoveredKeys.busNumbers, [101, 102]);
  assert.equal(decision.discoveredKeys.sbaseMva, 100);
  assert.equal(decision.discoveredKeys.baseFreqHz, 60);

  // Pre-flight should catch orphan DYR bus
  const badDecision = routePowerUmbrella([
    { fileName: "case.raw", content: SAMPLE_RAW },
    { fileName: "case.dyr", content: "999 'GENROU' 1 6.0 /" },
  ]);
  assert.equal(badDecision.isReadyForExecution, false);
  assert.ok(badDecision.preflightIssues.some((i) => i.code === "UMBRELLA_MISSING_BUS_KEY"));
});

test("Phase 2: IEEE P3743, PSCAD/PSSE serializers & SCR < 2.0 gatekeeper", () => {
  const firmwareBytes = Buffer.from("wasm-ibr-firmware-binary");
  const pkg: P3743Package = {
    metadata: {
      schemaVersion: "IEEE-P3743-draft-1.0",
      caseId: "CU-BESS-01",
      title: "Springfield 161 kV BESS",
      nominalFrequencyHz: 60,
      baseMva: 100,
      createdAtIso: "2026-11-14T12:00:00Z",
    },
    buses: [
      { id: "bus-101", busNumber: 101, name: "POI_161", baseKvLL: 161, phases: ["A", "B", "C"], isPoi: true },
      { id: "bus-102", busNumber: 102, name: "BESS_34", baseKvLL: 34.5, phases: ["A", "B", "C"] },
    ],
    corridors: [
      {
        id: "line-1",
        fromBusId: "bus-101",
        toBusId: "bus-102",
        lengthKm: 12.5,
        soilModel: { kind: "two-layer", upperRhoOhmM: 40, lowerRhoOhmM: 300, upperDepthM: 5 },
      },
    ],
    vendorModels: [
      {
        id: "bess-inv-1",
        busId: "bus-102",
        payloadKind: "cigre-tb881-wasm",
        modelInfo: {
          modelName: "GridFormingBESS",
          vendorName: "OEM",
          firmwareVersion: "2.1.0",
          buildTimestamp: "2026-10-01T00:00:00Z",
          abiVersion: "CIGRE_TB881_v1",
          numInputs: 6,
          numOutputs: 4,
          numParameters: 10,
          numStates: 12,
          recommendedTimeStepSec: 50e-6,
          minTimeStepSec: 10e-6,
          maxTimeStepSec: 100e-6,
        },
        initParams: {
          nominalFreqHz: 60,
          mbaseMva: 100,
          vNominalKv: 34.5,
          controlMode: "grid_forming",
          parameters: { kDroop: 0.05 },
        },
        payloadBase64: firmwareBytes.toString("base64"),
        sha256: computeP3743PayloadDigest(firmwareBytes),
      },
    ],
    boundaryEquivalents: [],
  };

  const json = serializeP3743Package(pkg);
  const parsedP3743 = parseP3743Package(json);
  assert.equal(parsedP3743.validation.valid, true);
  assert.equal(parsedP3743.pkg.vendorModels[0]!.id, "bess-inv-1");

  // PSCAD .pscx round-trip
  const pscxText = serializePscx({
    name: "TestCase",
    version: "5.0",
    settings: { timeStepUs: 50, durationSec: 1.0, startType: "flat", frequencyHz: 60 },
    rootModule: {
      id: "mod-1",
      name: "Main",
      components: [
        {
          id: "cmp-1",
          definitionName: "master:resistor",
          instanceName: "R1",
          position: { x: 100, y: 200 },
          parameters: { R: 10 },
          ports: [],
        },
      ],
      buses: [{ id: "b1", name: "Bus1", position: { x: 50, y: 200 }, phaseCount: 3, voltageBaseKv: 161 }],
      wires: [],
    },
    subModules: new Map(),
    linkedLibraries: [],
  });
  const reparsedPscx = parsePscx(pscxText);
  assert.equal(reparsedPscx.settings.frequencyHz, 60);

  // PSS/E .raw and .seq serializers
  const psseCase: PsseCase = {
    header: { ic: 0, sbase: 100, rev: 33, xfrrat: 0, nxfrat: 1, basfrq: 60 },
    title1: "TEST",
    title2: "CASE",
    buses: new Map([
      [101, { i: 101, name: "POI_161", baseKv: 161, ide: BusType.Swing, area: 1, zone: 1, owner: 1, vm: 1, va: 0 }],
    ]),
    loads: [],
    fixedShunts: [],
    generators: [],
    branches: [],
    transformers: [],
    areas: [],
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: [],
  };
  assert.ok(serializePsseRaw(psseCase).includes("101, 'POI_161', 161"));

  const seqCase: PsseSeqCase = {
    generators: [
      { i: 101, id: "1", zrpos: 0.01, zxpos: 0.2, zrneg: 0.01, zxneg: 0.2, zr0: 0.005, zx0: 0.08, zrg: 0, zxg: 0 },
    ],
    branches: [],
    mutuals: [],
    transformers: [],
    shunts: [],
  };
  assert.ok(serializePsseSeq(seqCase).includes("101, '1', 0.01, 0.2"));

  // SCR < 2.0 gatekeeper
  const weakGrid = evaluateGridStrength({
    poiId: "POI_161",
    baseKvLL: 161,
    shortCircuitMva: 180,
    xOverRRatio: 3.2,
    units: [{ id: "BESS_1", ratedMw: 100, isIbr: true }],
  });
  assert.equal(weakGrid.scr, 1.8);
  assert.equal(weakGrid.mandatoryEmtStudy, true);
  assert.equal(weakGrid.gridStrengthClass, "weak");
});

test("Phase 3: 2-layer soil, wideband corridor, C37.232/239 & transformer fitter", () => {
  const mu0 = 4 * Math.PI * 1e-7;
  // High-frequency limit approaches upper soil layer (rho1=20), low-frequency approaches lower layer (rho2=500)
  const hfDepth = computeComplexEarthPenetrationDepth(2 * Math.PI * 1e6, mu0, 100, {
    upperResistivityOhmM: 20,
    lowerResistivityOhmM: 500,
    upperLayerDepthM: 25,
  });
  const hfHomo1 = computeComplexEarthPenetrationDepth(2 * Math.PI * 1e6, mu0, 20);
  assert.ok(Math.abs(hfDepth.pRe - hfHomo1.pRe) / hfHomo1.pRe < 0.01);

  const corridor = compileWidebandCorridor({
    corridorId: "CORR_161",
    fromNode: 1,
    toNode: 2,
    lengthKm: 25,
    conductors: [
      { id: "A", phase: 1, xM: -4, yTowerM: 22, sagM: 4, radiusM: 0.014, dcResistanceOhmPerKm: 0.055 },
      { id: "B", phase: 2, xM: 0, yTowerM: 22, sagM: 4, radiusM: 0.014, dcResistanceOhmPerKm: 0.055 },
      { id: "C", phase: 3, xM: 4, yTowerM: 22, sagM: 4, radiusM: 0.014, dcResistanceOhmPerKm: 0.055 },
    ],
    twoLayerSoil: { upperResistivityOhmM: 30, lowerResistivityOhmM: 300, upperLayerDepthM: 6 },
    parallelCouplings: [{ coupledCorridorId: "CORR_161_PAR", centerToCenterSeparationM: 25, parallelLengthKm: 25 }],
  });
  assert.equal(corridor.fdLine.yPoles.length, 6);
  assert.equal(corridor.mutualCouplings.length, 1);

  // COMNAME & COMFEDE
  const name = formatComname({
    startDate: "2026-11-14",
    startTime: "13-45-00-000",
    timeCode: "-5T",
    stationName: "SPRINGFIELD_345",
    deviceId: "DFR_01",
    companyName: "CITY_UTILITIES",
    userFields: [],
    extension: "cfg",
  });
  assert.equal(parseComname(name).stationName, "SPRINGFIELD_345");

  const soe = parseComfede(
    serializeComfede({
      header: {
        stationName: "SPRINGFIELD_345",
        deviceId: "SOE_1",
        revisionYear: 2010,
        startTimestampIso: "2026-11-14T13:45:00Z",
      },
      events: [
        {
          sequenceNumber: 1,
          timestampIso: "2026-11-14T13:45:00.010Z",
          offsetMs: 10,
          channelId: "BRK_1",
          description: "Close",
          state: "CLOSED",
          phase: "A",
        },
      ],
    }),
  );
  assert.equal(soe.events.length, 1);

  // Transformer saturation + SFRA fitting
  const timeSec = Array.from({ length: 40 }, (_, k) => k * 0.001);
  const voltageV = timeSec.map((t) => 131000 * Math.cos(2 * Math.PI * 60 * t));
  const currentA = timeSec.map((t) => Math.max(0, 1200 * Math.sin(2 * Math.PI * 60 * t)));
  const fitted = fitWidebandTransformer(
    { id: "XF1", ratedMva: 100, primaryKv: 161, secondaryKv: 34.5, leakageReactancePu: 0.1 },
    { timeSec, voltageV, currentA },
    [
      { freqHz: 1e3, magnitudeDb: -20 },
      { freqHz: 5e3, magnitudeDb: -5 },
      { freqHz: 1e4, magnitudeDb: -18 },
      { freqHz: 5e4, magnitudeDb: -32 },
      { freqHz: 1e5, magnitudeDb: -12 },
      { freqHz: 5e5, magnitudeDb: -35 },
    ],
  );
  assert.ok(fitted.highFreqPoles.length >= 2);
  assert.ok(fitted.fittedSaturation.peakInrushMeasuredA > 1000);
});

test("Phase 4 & 5: PMView, Relay/SSCI, MOD-032/FAC-002, NRTL & RTO Handshake", () => {
  const profile = parsePmViewProfile("0.0 1.0 60.0\n2.0 0.10 60.0\n18.5 0.10 60.0\n24.0 0.10 60.0");
  assert.equal(profile.length, 4);

  const pmReport = evaluatePmViewCompliance({
    profileName: "PMView_profile_2800_LVRT_PVGR.txt",
    samples: profile,
    pPreMw: 100,
    response: {
      timeSec: [0, 5, 10, 17.5, 18.5, 23.5],
      pPoiMw: [100, 30, 45, 50, 0, 0],
      qPoiMvar: [0, 40, 40, 40, 0, 0],
      vPoiPu: [1.0, 0.2, 0.4, 0.6, 0.1, 0.1],
      isConnected: [true, true, true, true, false, false],
    },
  });
  assert.equal(pmReport.overallPassed, true);

  const relayAudit = auditRelayIsolationAndSsci({
    relays: [
      {
        relayId: "REL_21",
        zone1ClearanceSec: 0.03,
        observedClearanceWithPpcSec: 0.031,
        observedClearanceWithoutPpcSec: 0.032,
        hasIndependentBackupTrip: true,
      },
    ],
    impedanceScan: [
      { freqHz: 18, rOhm: -0.45, xOhm: 12.0 },
      { freqHz: 45, rOhm: 1.2, xOhm: 25.0 },
    ],
  });
  assert.equal(relayAudit.relayIsolationPassed, true);
  assert.equal(relayAudit.ssciRiskDetected, true);
  assert.deepEqual(relayAudit.ssciCriticalFrequenciesHz, [18]);

  const mod032Case: PsseCase = {
    header: { ic: 0, sbase: 100, rev: 33, xfrrat: 0, nxfrat: 1, basfrq: 60 },
    title1: "MOD032",
    title2: "TEST",
    buses: new Map([
      [101, { i: 101, name: "POI", baseKv: 161, ide: BusType.Swing, area: 1, zone: 1, owner: 1, vm: 1, va: 0 }],
    ]),
    loads: [],
    fixedShunts: [],
    generators: [
      {
        i: 101,
        id: "1",
        pg: 50,
        qg: 0,
        qt: 30,
        qb: -30,
        vs: 1,
        ireg: 0,
        mbase: 100,
        zr: 0,
        zx: 0.2,
        rt: 0,
        xt: 0,
        gtap: 1,
        stat: 1,
        rmpct: 100,
        pt: 100,
        pb: 0,
      },
    ],
    branches: [],
    transformers: [],
    areas: [],
    twoTerminalDc: [],
    vscDc: [],
    switchedShunts: [],
  };
  assert.equal(auditMod032DataCompleteness(mod032Case).severity, "violation");
  assert.equal(auditFac002Interconnection(mod032Case, { poiScr: 1.7 }).materialModificationDetected, true);

  // NRTL Ed25519 signature + RTO Ledger
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const signedAtt = signNrtlAttestation(
    {
      attestationId: "NRTL-2026-001",
      nrtlLabId: "UL-GRID-01",
      nrtlLabName: "NRTL Power Lab",
      equipmentVendor: "OEM",
      modelName: "BESS_GFM",
      firmwareVersion: "2.1.0",
      modelArtifactSha256: "abc123",
      boundaryMode: "REAL_FIRMWARE_CODE",
      issuedAtIso: "2026-11-14T12:00:00Z",
      dossier: { ieee2800Passed: true, prc029Passed: true, pmViewPassed: true },
    },
    privateKey,
    publicKeyPem,
  );
  assert.equal(verifyNrtlAttestation(signedAtt).valid, true);

  const ledger = new RtoCaseSubmissionLedger([{ busNumber: 101, name: "POI_161", baseKv: 161, area: 1 }]);
  const okHandshake = ledger.submitCase({
    submissionId: "SUB-1",
    branchName: "cu-bess-2026",
    submittedBy: "CityUtilities",
    timestampIso: "2026-11-14T13:00:00Z",
    poiBusNumber: 101,
    buses: [
      { busNumber: 101, name: "POI_161", baseKv: 161, area: 1 },
      { busNumber: 102, name: "BESS_34", baseKv: 34.5, area: 1 },
    ],
    artifacts: ["case.raw", "case.dyr", "bess.p3743"],
    nrtlAttestations: [signedAtt],
    contingencies: ["N-1_LINE_101_103"],
  });
  assert.equal(okHandshake.accepted, true);
  assert.equal(okHandshake.mergedBusCount, 2);

  // Voltage mismatch conflict
  const badHandshake = ledger.submitCase({
    submissionId: "SUB-2",
    branchName: "cu-bess-conflict",
    submittedBy: "CityUtilities",
    timestampIso: "2026-11-14T13:05:00Z",
    poiBusNumber: 101,
    buses: [{ busNumber: 101, name: "POI_161", baseKv: 230, area: 1 }],
    artifacts: [],
    nrtlAttestations: [],
    contingencies: [],
  });
  assert.equal(badHandshake.accepted, false);
  assert.equal(badHandshake.conflicts.length, 1);
  assert.equal(badHandshake.conflicts[0]!.field, "baseKv");
});
