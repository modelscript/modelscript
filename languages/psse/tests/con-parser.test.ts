// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeN1Contingencies,
  isLikelyConContent,
  parseCon,
  parseMon,
  parseRaw,
  parseSub,
  writeCon,
} from "../src/index.js";

const SAMPLE_CON_TEXT = `/ PSS/E CONTINGENCY DATA SPECIFICATION
CONTINGENCY 'LINE_1_2' 'Line 1-2 Outage'
  OPEN BRANCH FROM BUS 1 TO BUS 2 CKT '1'
END

CONTINGENCY 'GEN2_AND_LINE23' 'Trip Gen 2 and Line 2-3'
  OPEN BRANCH FROM BUS 2 TO BUS 3 CKT '1'
  TRIP GENERATOR BUS 2 ID '1'
END

CONTINGENCY 'BUS_4_OUTAGE' 'Bus 4 Substation Clearance'
  DISCONNECT BUS 4
END

END
`;

const SAMPLE_MON_TEXT = `/ PSS/E MONITORED ELEMENTS SPECIFICATION
MONITOR VOLTAGE RANGE BUSES 1 14 0.90 1.10
MONITOR BRANCH FROM BUS 1 TO BUS 2 CKT '1'
MONITOR BRANCHES IN SUBSYSTEM 'BULK_SYSTEM'
MONITOR TIE LINES
`;

const SAMPLE_SUB_TEXT = `/ PSS/E SUBSYSTEM DEFINITIONS
SUBSYSTEM 'BULK_SYSTEM'
  KV 69.0 230.0
  BUSES 1 2 3 4 5
  AREAS 1
END

SUBSYSTEM 'LOCAL_AREA'
  BUSES 6 7 8 9 10 11 12 13 14
  AREAS 2
END
`;

const IEEE_14_RAW = `0, 100.0, 33, 0, 0, 60.0 / PSS/E Base Case
IEEE 14-BUS TEST CASE
TRANSMISSION PLANNING CONTINGENCY TEST
1, 'BUS 1       ', 69.0, 3, 1, 1, 1, 1.060, 0.0, 1.06, 0.94, 1.1, 0.9 / Bus
2, 'BUS 2       ', 69.0, 2, 1, 1, 1, 1.045, -4.98, 1.06, 0.94, 1.1, 0.9 / Bus
3, 'BUS 3       ', 69.0, 2, 1, 1, 1, 1.010, -12.72, 1.06, 0.94, 1.1, 0.9 / Bus
4, 'BUS 4       ', 69.0, 1, 1, 1, 1, 1.019, -10.33, 1.06, 0.94, 1.1, 0.9 / Bus
5, 'BUS 5       ', 69.0, 1, 1, 1, 1, 1.020, -8.78, 1.06, 0.94, 1.1, 0.9 / Bus
0 / End of Buses
2, '1 ', 1, 1, 1, 21.7, 12.7, 0.0, 0.0, 0.0, 0.0, 1, 1, 0 / Load
3, '1 ', 1, 1, 1, 94.2, 19.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0 / Load
4, '1 ', 1, 1, 1, 47.8, -3.9, 0.0, 0.0, 0.0, 0.0, 1, 1, 0 / Load
0 / End of Loads
0 / End of Fixed Shunts
1, '1 ', 232.4, -16.9, 10.0, -40.0, 1.060, 0, 100.0, 0.0, 0.0, 1.0, 0.0, 1, 100.0, 332.4, 0.0, 1, 1.0, 0, 0.0 / Gen
2, '1 ', 40.0, 42.4, 50.0, -40.0, 1.045, 0, 100.0, 0.0, 0.0, 1.0, 0.0, 1, 100.0, 140.0, 0.0, 1, 1.0, 0, 0.0 / Gen
3, '1 ', 0.0, 23.4, 40.0, 0.0, 1.010, 0, 100.0, 0.0, 0.0, 1.0, 0.0, 1, 100.0, 100.0, 0.0, 1, 1.0, 0, 0.0 / Gen
0 / End of Generators
1, 2, '1 ', 0.01938, 0.05917, 0.0528, 120.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0, 0, 0.0 / Branch
1, 5, '1 ', 0.05403, 0.22304, 0.0492, 65.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0, 0, 0.0 / Branch
2, 3, '1 ', 0.04699, 0.19797, 0.0438, 65.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0, 0, 0.0 / Branch
2, 4, '1 ', 0.05811, 0.17632, 0.0340, 65.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0, 0, 0.0 / Branch
2, 5, '1 ', 0.05695, 0.17388, 0.0346, 65.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0, 0, 0.0 / Branch
3, 4, '1 ', 0.06701, 0.17103, 0.0128, 65.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0, 0, 0.0 / Branch
4, 5, '1 ', 0.01335, 0.04211, 0.0, 65.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0, 0, 0.0 / Branch
0 / End of Branches
0 / End of Transformers
Q
`;

test("PSS/E .con Parser: Parses multi-element contingency actions and serializes round-trip", () => {
  assert.equal(isLikelyConContent(SAMPLE_CON_TEXT), true);

  const conCase = parseCon(SAMPLE_CON_TEXT);
  assert.equal(conCase.contingencies.length, 3);
  assert.equal(conCase.byName.has("LINE_1_2"), true);
  assert.equal(conCase.byName.has("GEN2_AND_LINE23"), true);
  assert.equal(conCase.byName.has("BUS_4_OUTAGE"), true);

  const c1 = conCase.byName.get("LINE_1_2")!;
  assert.equal(c1.id, "LINE_1_2");
  assert.equal(c1.label, "Line 1-2 Outage");
  assert.equal(c1.actions.length, 1);
  assert.deepEqual(c1.actions[0], {
    type: "open_branch",
    fromBus: 1,
    toBus: 2,
    ckt: "1",
  });

  const c2 = conCase.byName.get("GEN2_AND_LINE23")!;
  assert.equal(c2.actions.length, 2);
  assert.deepEqual(c2.actions[0], {
    type: "open_branch",
    fromBus: 2,
    toBus: 3,
    ckt: "1",
  });
  assert.deepEqual(c2.actions[1], {
    type: "trip_generator",
    bus: 2,
    id: "1",
  });

  const c3 = conCase.byName.get("BUS_4_OUTAGE")!;
  assert.equal(c3.actions.length, 1);
  assert.deepEqual(c3.actions[0], {
    type: "disconnect_bus",
    bus: 4,
  });

  // Test writeCon and round-trip
  const serialized = writeCon(conCase);
  assert.ok(serialized.includes("CONTINGENCY 'LINE_1_2'"));
  assert.ok(serialized.includes("OPEN BRANCH FROM BUS 1 TO BUS 2 CKT '1'"));
  assert.ok(serialized.includes("TRIP GENERATOR BUS 2 ID '1'"));
  assert.ok(serialized.includes("DISCONNECT BUS 4"));

  const reparsed = parseCon(serialized);
  assert.equal(reparsed.contingencies.length, 3);
  assert.equal(reparsed.byName.get("GEN2_AND_LINE23")?.actions.length, 2);
});

test("PSS/E .mon & .sub Parsers: Ingests monitored elements and subsystem zones", () => {
  const monCase = parseMon(SAMPLE_MON_TEXT);
  assert.equal(monCase.voltageRanges.length, 1);
  assert.equal(monCase.voltageRanges[0]!.busStart, 1);
  assert.equal(monCase.voltageRanges[0]!.busEnd, 14);
  assert.equal(monCase.voltageRanges[0]!.vMin, 0.9);
  assert.equal(monCase.voltageRanges[0]!.vMax, 1.1);
  assert.equal(monCase.monitoredBranches.length, 1);
  assert.equal(monCase.monitoredBranches[0]!.fromBus, 1);
  assert.equal(monCase.monitoredBranches[0]!.toBus, 2);
  assert.equal(monCase.monitoredSubsystems.length, 1);
  assert.equal(monCase.monitoredSubsystems[0], "BULK_SYSTEM");
  assert.equal(monCase.monitorTieLines, true);

  const subCase = parseSub(SAMPLE_SUB_TEXT);
  assert.equal(subCase.subsystems.size, 2);
  const bulk = subCase.subsystems.get("BULK_SYSTEM")!;
  assert.ok(bulk);
  assert.equal(bulk.kvRanges.length, 1);
  assert.deepEqual(bulk.kvRanges[0], [69.0, 230.0]);
  assert.deepEqual(bulk.buses, [1, 2, 3, 4, 5]);
  assert.deepEqual(bulk.areas, [1]);
});

test("PSS/E Contingency Analysis with Custom .con Case: Evaluates defined multi-element outages", () => {
  const parsed = parseRaw(IEEE_14_RAW);
  const conCase = parseCon(SAMPLE_CON_TEXT);

  const result = analyzeN1Contingencies(parsed, {
    conCase,
    caseTitle: "IEEE 14 Custom Contingency Study",
  });

  // Exactly 3 contingencies from .con should be evaluated
  assert.equal(result.totalContingencies, 3);
  assert.equal(result.contingencies.length, 3);

  const ids = result.contingencies.map((c) => c.contingencyId);
  assert.ok(ids.includes("LINE_1_2"));
  assert.ok(ids.includes("GEN2_AND_LINE23"));
  assert.ok(ids.includes("BUS_4_OUTAGE"));

  assert.ok(result.reportText.includes("PSS/E N-1 CONTINGENCY SECURITY SCREENING REPORT"));
  assert.ok(result.reportText.includes("LINE_1_2"));
});
