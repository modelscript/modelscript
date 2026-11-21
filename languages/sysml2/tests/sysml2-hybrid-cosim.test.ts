// SPDX-License-Identifier: AGPL-3.0-or-later

import { AtpEmtParticipant, parseAtp, type AtpCase } from "@modelscript/atp";
import { PscadEmtParticipant, type EmtNetlist } from "@modelscript/pscad";
import { parseDyr, parseRaw, PssePhasorParticipant } from "@modelscript/psse";
import assert from "node:assert";
import test from "node:test";
import { extractSysML2HybridCoSimSpec, runSysML2HybridCoSimulation } from "../src/hybrid-cosim-orchestrator.js";

const THREE_BUS_RAW = `0, 100.00, 33, 0, 1, 60.00
SYSML2 HYBRID TEST
CASE
1, 'SLACK', 230.0000, 3, 1, 1, 1, 1.02000, 0.0000
2, 'GEN2',  230.0000, 2, 1, 1, 1, 1.01000, -2.0000
3, 'LOAD3', 230.0000, 1, 1, 1, 1, 1.00000, -4.0000
0 / END OF BUS DATA
3, '1 ', 1, 1, 1, 60.0, 20.0, 0.0, 0.0, 0.0, 0.0, 1
0 / END OF LOAD DATA
0 / END OF FIXED SHUNT DATA
1, '1 ', 40.0, 10.0, 100.0, -100.0, 1.020, 0, 100.0, 0.003, 0.18, 0, 0, 1, 1, 100, 200, 0
2, '1 ', 30.0, 5.0, 100.0, -100.0, 1.010, 0, 100.0, 0.003, 0.20, 0, 0, 1, 1, 100, 200, 0
0 / END OF GENERATOR DATA
1, 2, '1 ', 0.010, 0.080, 0.04, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
1, 3, '1 ', 0.012, 0.100, 0.05, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
2, 3, '1 ', 0.015, 0.120, 0.06, 150, 150, 150, 0, 0, 0, 0, 1, 1, 10
0 / END OF BRANCH DATA
0 / END OF TRANSFORMER DATA
Q
`;

const THREE_BUS_DYR = `1 'GENCLS' 1 5.0 2.0 /
2 'GENROU' 1 6.0 0.04 0.5 0.05 4.5 1.5 1.8 1.7 0.25 0.4 0.18 0.15 0.1 0.3 /
2 'SEXS' 1 0.1 10.0 50.0 0.05 -5.0 5.0 /
2 'TGOV1' 1 0.05 0.5 1.05 0.0 1.0 3.0 0.0 /
`;

function createLocalEmtPlant(): EmtNetlist {
  return {
    buses: [
      { id: "POI_EMT", name: "POI_EMT", baseKv: 230.0, phases: 3 },
      { id: "LOCAL_LOAD", name: "LOCAL_LOAD", baseKv: 230.0, phases: 3 },
    ],
    branches: [
      { id: "TIE_LINE", name: "Tie", kind: "rlc", fromBus: "POI_EMT", toBus: "LOCAL_LOAD", rOhm: 2.0, lHenry: 0.02 },
      { id: "PLANT_LOAD", name: "Load", kind: "rlc", fromBus: "LOCAL_LOAD", toBus: "GND", rOhm: 800.0, lHenry: 0.1 },
    ],
    sources: [],
    switches: [],
    faults: [],
    nonlinearElements: [],
    controls: [],
    metadata: { projectName: "SysmlEmtPlant", nominalFrequencyHz: 60.0, timeStepSec: 50e-6, durationSec: 0.05 },
  };
}

const SYSML_GRID_STUDY = `
package GridInterconnectionStudy {
  part def BulkTransmissionGrid {
    attribute solver = "psse";
    attribute source = "three_bus.raw";
    attribute dyrSource = "three_bus.dyr";
    port poi_bus3;
  }

  part def InverterPlant {
    attribute solver = "pscad";
    attribute source = "ibr_plant.pscx";
    port pcc_emt;
  }

  part def HybridStudySystem {
    attribute durationSec = 0.05;
    attribute dtTsSec = 0.005;
    attribute dtEmtSec = 0.00005;
    attribute frequencyHz = 60.0;
    attribute sequences = 3;
    attribute useFdne = true;
    attribute mode = "direct";
    attribute faultBusId = "2";
    attribute faultStartSec = 0.015;
    attribute faultClearSec = 0.035;
    attribute faultSusceptancePu = -15.0;
    attribute faultType = "slg";

    part grid : BulkTransmissionGrid {
      attribute busId_poi_bus3 = "3";
    }

    part plant1 : InverterPlant {
      attribute busId_pcc_emt = "POI_EMT";
    }

    connect grid.poi_bus3 to plant1.pcc_emt;
  }

  requirement def LvrtRideThrough {
    doc /* IEEE 2800 / NERC PRC-024 ride-through and steady-state envelope */
    require constraint { vPreFaultPu >= 0.95 and vPreFaultPu <= 1.05 }
    require constraint { vMinPu >= 0.20 and maxRotorSpreadDeg < 180.0 }
    require constraint { vRecoveryPu >= 0.85 }
  }

  requirement def UnbalancedFaultSignature {
    require constraint { vNegMaxPu > 0.01 and vZeroMaxPu > 0.01 }
  }

  requirement def FrequencyEnvelope {
    require constraint { freqMinHz >= 58.0 and freqMaxHz <= 62.0 }
  }
}
`;

test("extractSysML2HybridCoSimSpec parses parts, connections, simulation options, and requirements", () => {
  const spec = extractSysML2HybridCoSimSpec(SYSML_GRID_STUDY);
  assert.equal(spec.packageName, "GridInterconnectionStudy");
  assert.equal(spec.systemName, "HybridStudySystem");
  assert.equal(spec.phasorPart?.name, "grid");
  assert.equal(spec.phasorPart?.solver, "psse");
  assert.equal(spec.emtParts.length, 1);
  assert.equal(spec.emtParts[0]!.name, "plant1");
  assert.equal(spec.emtParts[0]!.solver, "pscad");
  assert.equal(spec.connections.length, 1);
  assert.deepEqual(spec.connections[0], {
    fromPart: "grid",
    fromPort: "poi_bus3",
    toPart: "plant1",
    toPort: "pcc_emt",
  });
  assert.equal(spec.options.sequences, 3);
  assert.equal(spec.options.useFdne, true);
  assert.equal(spec.options.fault?.faultType, "slg");
  assert.equal(spec.requirements.length, 5);
});

test("runSysML2HybridCoSimulation executes PSS/E <-> PSCAD from SysML v2 and verifies IEEE 2800 LVRT requirements", async () => {
  const psseCase = parseRaw(THREE_BUS_RAW);
  const dyrCase = parseDyr(THREE_BUS_DYR);
  const emtNetlist = createLocalEmtPlant();

  const res = await runSysML2HybridCoSimulation(SYSML_GRID_STUDY, {
    participants: {
      grid: new PssePhasorParticipant(psseCase, { id: "grid", dyrCase }),
      plant1: new PscadEmtParticipant(emtNetlist, { id: "plant1" }),
    },
  });

  assert.equal(res.simulation.totalMacroSteps, 10);
  assert.equal(res.simulation.topologyUpdates, 2);
  assert.equal(
    res.verification.report.allSatisfied,
    true,
    `Expected all SysML v2 requirements satisfied, violated: ${res.verification.report.violatedRequirements.join(", ")}`,
  );
  assert.ok(res.verification.report.minMargin > 0);
  assert.equal(res.verification.metrics["convergedPowerFlow"], true);
  assert.equal(res.verification.metrics["stable"], true);
});

test("runSysML2HybridCoSimulation detects violated SysML v2 requirements with quantitative margin", async () => {
  const strictSysml = SYSML_GRID_STUDY.replace(
    "require constraint { vMinPu >= 0.20 and maxRotorSpreadDeg < 180.0 }",
    "require constraint { vMinPu >= 0.98 }",
  );
  const psseCase = parseRaw(THREE_BUS_RAW);
  const dyrCase = parseDyr(THREE_BUS_DYR);

  const res = await runSysML2HybridCoSimulation(strictSysml, {
    participants: {
      grid: new PssePhasorParticipant(psseCase, { id: "grid", dyrCase }),
      plant1: new PscadEmtParticipant(createLocalEmtPlant(), { id: "plant1" }),
    },
  });

  assert.equal(res.verification.report.allSatisfied, false);
  assert.ok(res.verification.report.violatedRequirements.some((n) => n.startsWith("LvrtRideThrough")));
  assert.ok(res.verification.report.minMargin < 0, "Expected negative margin on violated requirement");
});

test("Polyglot Multi-Plant SysML v2 architecture couples PSS/E to concurrent PSCAD + ATP plants", async () => {
  const multiPlantSysml = `
package PolyglotMultiPlantStudy {
  part def BulkGrid {
    attribute solver = "psse";
    port bus2_port;
    port bus3_port;
  }
  part def PscadPlant {
    attribute solver = "pscad";
    port pcc;
  }
  part def AtpPlant {
    attribute solver = "atp";
    port pcc;
  }
  part def MultiPlantSystem {
    attribute durationSec = 0.025;
    attribute dtTsSec = 0.005;
    attribute dtEmtSec = 0.00005;
    attribute mode = "fmi";
    part grid : BulkGrid {
      attribute busId_bus2_port = "2";
      attribute busId_bus3_port = "3";
    }
    part windFarm : PscadPlant {
      attribute busId_pcc = "POI_EMT";
    }
    part solarFarm : AtpPlant {
      attribute busId_pcc = "ATP_POI";
    }
    connect grid.bus2_port to windFarm.pcc;
    connect grid.bus3_port to solarFarm.pcc;
  }
  requirement def MultiBusVoltageBounds {
    require constraint { vMinPu_2 >= 0.85 and vMinPu_3 >= 0.85 }
    require constraint { vMaxPu_2 <= 1.15 and vMaxPu_3 <= 1.15 }
  }
}
`;

  const psseCase = parseRaw(THREE_BUS_RAW);
  const atpCase: AtpCase = {
    title: "SolarAtp",
    deltaT: 50e-6,
    tMax: 0.025,
    branches: [{ node1: "ATP_POI", node2: "GND", rOhms: 850, lMh: 100, cUf: 0 }],
    switches: [],
    sources: [],
  };
  assert.ok(typeof parseAtp === "function");

  const res = await runSysML2HybridCoSimulation(multiPlantSysml, {
    participants: {
      grid: new PssePhasorParticipant(psseCase, { id: "grid" }),
      windFarm: new PscadEmtParticipant(createLocalEmtPlant(), { id: "windFarm" }),
      solarFarm: new AtpEmtParticipant(atpCase, { id: "solarFarm" }),
    },
  });

  assert.equal(res.simulation.mode, "fmi");
  assert.equal(res.simulation.plantCount, 2);
  assert.equal(res.simulation.totalMacroSteps, 5);
  assert.equal(res.verification.report.allSatisfied, true);
});
