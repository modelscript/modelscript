// SPDX-License-Identifier: AGPL-3.0-or-later

import { AtpEmtParticipant, type AtpCase } from "@modelscript/atp";
import { CgmesPhasorParticipant, type CgmesModel } from "@modelscript/cgmes";
import {
  runHybridPhasorEmtCoSimulation,
  WorkerEmtParticipant,
  type FmiLsEmtCompanionInstance,
} from "@modelscript/exchange";
import { ModelicaEmtParticipant } from "@modelscript/modelica";
import { OpenDssPhasorParticipant, parseOpenDss } from "@modelscript/opendss";
import { PowerFactoryPhasorParticipant, type PowerFactoryModel } from "@modelscript/powerfactory";
import { PscadEmtParticipant, type EmtNetlist } from "@modelscript/pscad";
import { PslfPhasorParticipant, type PslfEpcCase } from "@modelscript/pslf";
import { parseRaw, PssePhasorParticipant } from "@modelscript/psse";
import { parseSpice, SpiceEmtParticipant } from "@modelscript/spice";
import assert from "node:assert/strict";
import test from "node:test";

const THREE_BUS_RAW = `0, 100.00, 33, 0, 1, 60.00 / PSS/E-33.0
3-BUS WORKER BENCHMARK
MODELSCRIPT POLYGLOT
1,'SLACK_1     ', 230.0000,3, 1, 1, 1,1.02000,   0.0000,1.10000,0.90000,1.10000,0.90000
2,'GEN_2       ', 230.0000,2, 1, 1, 1,1.01000,  -2.0000,1.10000,0.90000,1.10000,0.90000
3,'POI_3       ', 230.0000,1, 1, 1, 1,1.00000,  -4.0000,1.10000,0.90000,1.10000,0.90000
0 / END OF BUS DATA, BEGIN LOAD DATA
3,'1 ',1, 1, 1,   60.000,   20.000,    0.000,    0.000,    0.000,    0.000, 1,1,0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1,'1 ',   40.000,   10.000,  100.000, -100.000,1.02000,    0,  100.000, 0.00300, 0.18000, 0.00000, 0.00000,1.00000,1, 100.0,  100.000,    0.000, 1,1.0000
2,'1 ',   25.000,    5.000,  100.000, -100.000,1.01000,    0,  100.000, 0.00300, 0.20000, 0.00000, 0.00000,1.00000,1, 100.0,  100.000,    0.000, 1,1.0000
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 2,'1 ', 0.01000, 0.08000, 0.04000, 200.00, 200.00, 200.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1, 80.00, 1,1.0000
1, 3,'1 ', 0.01200, 0.10000, 0.05000, 200.00, 200.00, 200.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1, 100.00, 1,1.0000
2, 3,'1 ', 0.01500, 0.12000, 0.06000, 200.00, 200.00, 200.00, 0.00000, 0.00000, 0.00000, 0.00000,1,1, 120.00, 1,1.0000
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
0 / END OF TRANSFORMER DATA, BEGIN AREA DATA
0 / END OF AREA DATA, BEGIN TWO-TERMINAL DC DATA
0 / END OF TWO-TERMINAL DC DATA, BEGIN VSC DC LINE DATA
0 / END OF VSC DC LINE DATA, BEGIN IMPEDANCE CORRECTION DATA
0 / END OF IMPEDANCE CORRECTION DATA, BEGIN MULTI-TERMINAL DC DATA
0 / END OF MULTI-TERMINAL DC DATA, BEGIN MULTI-SECTION LINE DATA
0 / END OF MULTI-SECTION LINE DATA, BEGIN ZONE DATA
0 / END OF ZONE DATA, BEGIN INTER-AREA TRANSFER DATA
0 / END OF INTER-AREA TRANSFER DATA, BEGIN OWNER DATA
0 / END OF OWNER DATA, BEGIN FACTS DEVICE DATA
0 / END OF FACTS DEVICE DATA, BEGIN SWITCHED SHUNT DATA
0 / END OF SWITCHED SHUNT DATA, BEGIN GNE DATA
0 / END OF GNE DATA, BEGIN INDUCTION MACHINE DATA
0 / END OF INDUCTION MACHINE DATA
Q
`;

function createSampleAtpCase(): AtpCase {
  return {
    title: "ATP_Local_Feeder",
    control: { deltaTSec: 50e-6, tMaxSec: 0.03 },
    branches: [
      { node1: "ATP_POI", node2: "ATP_LOAD", rOhms: 2.0, lMh: 15.0, cUf: 0.0 },
      { node1: "ATP_LOAD", node2: "GND", rOhms: 850.0, lMh: 50.0, cUf: 0.0 },
    ],
    switches: [],
    sources: [],
    outputNodes: ["ATP_POI", "ATP_LOAD"],
  };
}

function createSamplePscadNetlist(): EmtNetlist {
  return {
    buses: [
      { id: "PSCAD_POI", name: "PSCAD_POI", baseKv: 230.0, phases: 3 },
      { id: "PSCAD_LOAD", name: "PSCAD_LOAD", baseKv: 230.0, phases: 3 },
    ],
    branches: [
      { id: "TIE", name: "Tie", kind: "rlc", fromBus: "PSCAD_POI", toBus: "PSCAD_LOAD", rOhm: 2.0, lHenry: 0.02 },
      { id: "LD", name: "Load", kind: "rlc", fromBus: "PSCAD_LOAD", toBus: "GND", rOhm: 850.0, lHenry: 0.05 },
    ],
    sources: [],
    switches: [],
    faults: [],
    nonlinearElements: [],
    controls: [],
    metadata: { projectName: "WorkerPscad", nominalFrequencyHz: 60.0, timeStepSec: 50e-6, durationSec: 0.03 },
  };
}

test("Polyglot 1: PSLF <-> ATP closed-loop hybrid co-simulation", async () => {
  const epc: PslfEpcCase = {
    title: "PSLF 2-Bus",
    sbaseMva: 100,
    buses: new Map([
      [
        1,
        {
          busNumber: 1,
          name: "SLACK",
          baseKv: 230,
          busType: 3,
          vmPu: 1.02,
          vaDeg: 0,
          vmax: 1.1,
          vmin: 0.9,
          area: 1,
          zone: 1,
        } as any,
      ],
      [
        2,
        {
          busNumber: 2,
          name: "POI",
          baseKv: 230,
          busType: 1,
          vmPu: 1.0,
          vaDeg: -2,
          vmax: 1.1,
          vmin: 0.9,
          area: 1,
          zone: 1,
        } as any,
      ],
    ]),
    branches: [
      {
        fromBus: 1,
        toBus: 2,
        circuitId: "1",
        rPu: 0.01,
        xPu: 0.08,
        bPu: 0.02,
        rate1Mva: 200,
        rate2Mva: 200,
        rate3Mva: 200,
        status: 1,
      } as any,
    ],
    transformers: [],
    generators: [
      {
        busNumber: 1,
        genId: "1",
        pgMw: 50,
        qgMvar: 10,
        qmaxMvar: 100,
        qminMvar: -100,
        pmaxMw: 100,
        pminMw: 0,
        vschedPu: 1.02,
        mbaseMva: 100,
        rSource: 0.003,
        xSource: 0.18,
        status: 1,
      } as any,
    ],
    loads: [
      {
        busNumber: 2,
        loadId: "1",
        plMw: 50,
        qlMvar: 10,
        ipMw: 0,
        iqMvar: 0,
        ypMw: 0,
        yqMvar: 0,
        area: 1,
        zone: 1,
        status: 1,
      } as any,
    ],
    shunts: [],
    areas: [],
    zones: [],
  } as any;

  const phasor = new PslfPhasorParticipant(epc, { id: "PSLF_Grid" });
  const emt = new AtpEmtParticipant(createSampleAtpCase(), { id: "ATP_Plant" });

  const res = await runHybridPhasorEmtCoSimulation(
    phasor,
    [{ id: "ATP_Plant", participant: emt, boundaryPorts: [{ phasorBusId: "2", emtBusId: "ATP_POI" }] }],
    { durationSec: 0.03, dtTsSec: 0.005, dtEmtSec: 50e-6, maxIterations: 2 },
  );

  assert.equal(phasor.language, "pslf");
  assert.equal(emt.language, "atp");
  assert.equal(res.totalMacroSteps, 6);
  assert.ok(res.macroRecords[5]!.vTsMagPu > 0.85 && res.macroRecords[5]!.vTsMagPu < 1.15);
});

test("Polyglot 2: PowerFactory <-> SPICE closed-loop hybrid co-simulation", async () => {
  const pfModel: PowerFactoryModel = {
    name: "PF_2Bus",
    substations: new Map(),
    bays: new Map(),
    terminals: new Map([
      ["T1", { id: "T1", name: "SlackTerm", uknom: 230, outserv: false } as any],
      ["T2", { id: "T2", name: "PoiTerm", uknom: 230, outserv: false } as any],
    ]),
    lines: new Map([
      [
        "L1",
        {
          id: "L1",
          name: "Line12",
          bus1Id: "T1",
          bus2Id: "T2",
          dline: 50,
          typeId: "TL1",
          outserv: false,
        } as any,
      ],
    ]),
    lineTypes: new Map([
      ["TL1", { id: "TL1", name: "TypeLine", rline: 0.08, xline: 0.4, bline: 3.0, uline: 230 } as any],
    ]),
    transformers2w: new Map(),
    trafo2Types: new Map(),
    transformers3w: new Map(),
    trafo3Types: new Map(),
    generators: new Map([
      [
        "G1",
        {
          id: "G1",
          name: "Gen1",
          bus1Id: "T1",
          pgini: 40,
          qgini: 10,
          usetp: 1.01,
          ip_ctrl: 1,
          outserv: false,
        } as any,
      ],
    ]),
    symTypes: new Map(),
    staticGenerators: new Map(),
    loads: new Map([["LD2", { id: "LD2", name: "Load2", bus1Id: "T2", plini: 40, qlini: 10, outserv: false } as any]]),
    shunts: new Map(),
    switches: new Map(),
    diagrams: new Map(),
  };

  const spiceText = `SPICE 3-Phase RLC Plant
R_A POI_A 0 800
R_B POI_B 0 800
R_C POI_C 0 800
L_A POI_A N_A 10m
R_LA N_A 0 1200
.end
`;
  const spiceCircuit = parseSpice(spiceText);

  const phasor = new PowerFactoryPhasorParticipant(pfModel, { id: "PF_Grid" });
  const emt = new SpiceEmtParticipant(spiceCircuit, { id: "SPICE_Plant" });

  const res = await runHybridPhasorEmtCoSimulation(
    phasor,
    [{ id: "SPICE_Plant", participant: emt, boundaryPorts: [{ phasorBusId: "T2", emtBusId: "POI" }] }],
    { durationSec: 0.025, dtTsSec: 0.005, dtEmtSec: 50e-6 },
  );

  assert.equal(phasor.language, "powerfactory");
  assert.equal(emt.language, "spice");
  assert.equal(res.totalMacroSteps, 5);
  assert.ok(res.macroRecords[4]!.vTsMagPu > 0.85 && res.macroRecords[4]!.vTsMagPu < 1.15);
});

test("Polyglot 3: CGMES <-> Modelica closed-loop hybrid co-simulation", async () => {
  const cgmes: CgmesModel = {
    substations: new Map(),
    voltageLevels: new Map(),
    busbars: new Map(),
    baseVoltages: new Map([["BV230", 230]]),
    nodes: new Map([
      ["TN1", { mRID: "TN1", name: "SlackNode", baseVoltageKv: 230 } as any],
      ["TN2", { mRID: "TN2", name: "PoiNode", baseVoltageKv: 230 } as any],
    ]),
    connectivityNodes: new Map(),
    terminals: new Map([
      [
        "TM_G1",
        {
          mRID: "TM_G1",
          conductingEquipmentId: "GEN1",
          topologicalNodeId: "TN1",
          sequenceNumber: 1,
          connected: true,
        } as any,
      ],
      [
        "TM_L1",
        {
          mRID: "TM_L1",
          conductingEquipmentId: "LINE1",
          topologicalNodeId: "TN1",
          sequenceNumber: 1,
          connected: true,
        } as any,
      ],
      [
        "TM_L2",
        {
          mRID: "TM_L2",
          conductingEquipmentId: "LINE1",
          topologicalNodeId: "TN2",
          sequenceNumber: 2,
          connected: true,
        } as any,
      ],
      [
        "TM_LD",
        {
          mRID: "TM_LD",
          conductingEquipmentId: "LOAD2",
          topologicalNodeId: "TN2",
          sequenceNumber: 1,
          connected: true,
        } as any,
      ],
    ]),
    lines: new Map([["LINE1", { mRID: "LINE1", name: "Line12", r: 4.0, x: 35.0, bch: 1e-4, gch: 0 } as any]]),
    transformers: new Map(),
    transformerEnds: new Map(),
    generators: new Map([
      [
        "GEN1",
        {
          mRID: "GEN1",
          name: "Gen1",
          ratedSMva: 100,
          pMw: 40,
          qMvar: 10,
          maxQMvar: 100,
          minQMvar: -100,
          referencePriority: 1,
        } as any,
      ],
    ]),
    loads: new Map([["LOAD2", { mRID: "LOAD2", name: "Load2", pMw: 40, qMvar: 10 } as any]]),
    shunts: new Map(),
    svVoltages: new Map([
      ["TN1", { topologicalNodeId: "TN1", vPu: 1.01, angleDeg: 0 } as any],
      ["TN2", { topologicalNodeId: "TN2", vPu: 1.0, angleDeg: -2 } as any],
    ]),
    svFlows: new Map(),
  };

  // Modelica 3-phase resistive Norton companion (G = 1/800 S per phase)
  const modelicaCompanion: FmiLsEmtCompanionInstance = {
    stampCompanion: () => ({
      gEq: new Float64Array([1 / 800, 0, 0, 0, 1 / 800, 0, 0, 0, 1 / 800]),
      iHist: new Float64Array([0, 0, 0]),
    }),
    doStep: () => {},
  };

  const phasor = new CgmesPhasorParticipant(cgmes, { id: "CGMES_Grid", impedanceInOhms: true });
  const emt = new ModelicaEmtParticipant([{ busId: "MOD_POI", companion: modelicaCompanion }], { id: "Modelica_IBR" });

  const res = await runHybridPhasorEmtCoSimulation(
    phasor,
    [{ id: "Modelica_IBR", participant: emt, boundaryPorts: [{ phasorBusId: "TN2", emtBusId: "MOD_POI" }] }],
    { durationSec: 0.025, dtTsSec: 0.005, dtEmtSec: 50e-6 },
  );

  assert.equal(phasor.language, "cgmes");
  assert.equal(emt.language, "modelica");
  assert.equal(res.totalMacroSteps, 5);
  const vFinal = res.macroRecords[4]!.vTsMagPu;
  assert.ok(vFinal > 0.85 && vFinal < 1.15, `Expected CGMES<->Modelica steady V near 1.0 pu, got ${vFinal}`);
});

test("Polyglot 4: OpenDSS <-> PSCAD unbalanced 3-phase distribution co-simulation", async () => {
  const dssText = `
Clear
New Circuit.TestFeeder basekv=12.47 pu=1.02 phases=3 bus1=SourceBus
New Line.L1 bus1=SourceBus bus2=LoadBus phases=3 r1=0.2 x1=0.4 c1=0 length=2 units=km
New Load.LD1 bus1=LoadBus phases=3 kV=12.47 kW=500 kvar=150
Set Voltagebases=[12.47]
Calcvoltagebases
`;
  const deck = parseOpenDss(dssText);
  const phasor = new OpenDssPhasorParticipant(deck, { id: "OpenDSS_Feeder" });
  const emt = new PscadEmtParticipant(createSamplePscadNetlist(), { id: "PSCAD_DER" });

  const res = await runHybridPhasorEmtCoSimulation(
    phasor,
    [{ id: "PSCAD_DER", participant: emt, boundaryPorts: [{ phasorBusId: "LoadBus", emtBusId: "PSCAD_POI" }] }],
    { durationSec: 0.025, dtTsSec: 0.005, dtEmtSec: 50e-6, sequences: 3 },
  );

  assert.equal(phasor.language, "opendss");
  assert.equal(res.totalMacroSteps, 5);
  assert.ok(res.macroRecords[4]!.vTsMagPu > 0.85 && res.macroRecords[4]!.vTsMagPu < 1.15);
});

test("Multi-Core WorkerEmtParticipant (worker_threads): parallel PSCAD + ATP workers match in-process", async () => {
  const psseCase = parseRaw(THREE_BUS_RAW);
  const pscadNet = createSamplePscadNetlist();
  const atpCase = createSampleAtpCase();

  // Run 1: In-process (PSCAD on Bus 2 + ATP on Bus 3)
  const inProcRes = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(psseCase, { id: "PSSE_InProc" }),
    [
      {
        id: "Plant_PSCAD",
        participant: new PscadEmtParticipant(pscadNet, { id: "Plant_PSCAD" }),
        boundaryPorts: [{ phasorBusId: "2", emtBusId: "PSCAD_POI" }],
      },
      {
        id: "Plant_ATP",
        participant: new AtpEmtParticipant(atpCase, { id: "Plant_ATP" }),
        boundaryPorts: [{ phasorBusId: "3", emtBusId: "ATP_POI" }],
      },
    ],
    { durationSec: 0.025, dtTsSec: 0.005, dtEmtSec: 50e-6 },
  );

  // Run 2: True multi-core OS worker_threads (1 PSCAD worker thread + 1 ATP worker thread)
  const workerRes = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(psseCase, { id: "PSSE_Workers" }),
    [
      {
        id: "Plant_PSCAD",
        participant: new WorkerEmtParticipant({ kind: "pscad", netlist: pscadNet }, { id: "Plant_PSCAD" }),
        boundaryPorts: [{ phasorBusId: "2", emtBusId: "PSCAD_POI" }],
      },
      {
        id: "Plant_ATP",
        participant: new WorkerEmtParticipant({ kind: "atp", atpCase }, { id: "Plant_ATP" }),
        boundaryPorts: [{ phasorBusId: "3", emtBusId: "ATP_POI" }],
      },
    ],
    { durationSec: 0.025, dtTsSec: 0.005, dtEmtSec: 50e-6 },
  );

  assert.equal(workerRes.plantCount, 2);
  assert.equal(workerRes.macroRecords.length, inProcRes.macroRecords.length);
  for (let i = 0; i < inProcRes.macroRecords.length; i++) {
    const a = inProcRes.macroRecords[i]!;
    const b = workerRes.macroRecords[i]!;
    assert.ok(
      Math.abs(a.vTsMagPu - b.vTsMagPu) < 1e-4,
      `Worker vs in-process voltage mismatch at record ${i}: ${a.vTsMagPu} vs ${b.vTsMagPu}`,
    );
  }
});

test("Multi-Core WorkerEmtParticipant async Picard rollback (maxIterations=2) + per-micro-step FDNE matches in-process", async () => {
  const psseRaw = `0, 100.00, 33, 0, 1, 60.00
WORKER PICARD TEST
CASE
1, 'SLACK', 230.0000, 3, 1, 1, 1, 1.02000, 0.0000
2, 'BUS2',  230.0000, 1, 1, 1, 1, 1.00000, -2.0000
3, 'BUS3',  230.0000, 1, 1, 1, 1, 1.00000, -3.0000
0 / END OF BUS DATA
2, '1 ', 1, 1, 1, 30.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1
3, '1 ', 1, 1, 1, 30.0, 10.0, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 60.0, 20.0, 200.0, -200.0, 1.020, 0, 100.0, 0.003, 0.15, 0, 0, 1, 1, 100, 200, 0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.01, 0.08, 0.02, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
1, 3, '1 ', 0.01, 0.09, 0.02, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;
  const psseCase = parseRaw(psseRaw);
  const pscadNet: EmtNetlist = {
    buses: [{ id: "PSCAD_POI", name: "PSCAD_POI", baseKv: 230, phases: 3 }],
    branches: [{ id: "L1", name: "L1", kind: "rlc", fromBus: "PSCAD_POI", toBus: "GND", rOhm: 850, lHenry: 0.1 }],
    sources: [],
    switches: [],
    faults: [],
    nonlinearElements: [],
    controls: [],
    metadata: { projectName: "WorkerPicardPscad", nominalFrequencyHz: 60, timeStepSec: 50e-6, durationSec: 0.02 },
  };
  const atpCase: AtpCase = {
    title: "WorkerPicardAtp",
    deltaT: 50e-6,
    tMax: 0.02,
    branches: [{ node1: "ATP_POI", node2: "GND", rOhms: 850, lMh: 100, cUf: 0 }],
    switches: [],
    sources: [],
  };

  const commonOpts = {
    durationSec: 0.02,
    dtTsSec: 0.005,
    dtEmtSec: 50e-6,
    useFdne: true,
    maxIterations: 2,
    iterationTolerancePu: 1e-6,
  } as const;

  const inProcRes = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(psseCase, { id: "PSSE_InProc_Picard" }),
    [
      {
        id: "Plant_PSCAD",
        participant: new PscadEmtParticipant(pscadNet, { id: "Plant_PSCAD" }),
        boundaryPorts: [{ phasorBusId: "2", emtBusId: "PSCAD_POI" }],
      },
      {
        id: "Plant_ATP",
        participant: new AtpEmtParticipant(atpCase, { id: "Plant_ATP" }),
        boundaryPorts: [{ phasorBusId: "3", emtBusId: "ATP_POI" }],
      },
    ],
    commonOpts,
  );

  const workerRes = await runHybridPhasorEmtCoSimulation(
    new PssePhasorParticipant(psseCase, { id: "PSSE_Worker_Picard" }),
    [
      {
        id: "Plant_PSCAD",
        participant: new WorkerEmtParticipant({ kind: "pscad", netlist: pscadNet }, { id: "Plant_PSCAD" }),
        boundaryPorts: [{ phasorBusId: "2", emtBusId: "PSCAD_POI" }],
      },
      {
        id: "Plant_ATP",
        participant: new WorkerEmtParticipant({ kind: "atp", atpCase }, { id: "Plant_ATP" }),
        boundaryPorts: [{ phasorBusId: "3", emtBusId: "ATP_POI" }],
      },
    ],
    commonOpts,
  );

  assert.ok(
    workerRes.totalPicardIterations > workerRes.totalMacroSteps,
    `Expected async worker Picard rollback iterations > ${workerRes.totalMacroSteps}, got ${workerRes.totalPicardIterations}`,
  );
  assert.equal(workerRes.macroRecords.length, inProcRes.macroRecords.length);
  for (let i = 0; i < inProcRes.macroRecords.length; i++) {
    const a = inProcRes.macroRecords[i]!;
    const b = workerRes.macroRecords[i]!;
    assert.ok(
      Math.abs(a.vTsMagPu - b.vTsMagPu) < 1e-3,
      `Worker vs in-process Picard rollback mismatch at record ${i}: ${a.vTsMagPu} vs ${b.vTsMagPu}`,
    );
  }
});
