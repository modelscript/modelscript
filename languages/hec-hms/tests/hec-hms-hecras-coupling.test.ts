// SPDX-License-Identifier: AGPL-3.0-or-later

import { parseFlow } from "@modelscript/hec-ras";
import assert from "node:assert/strict";
import test from "node:test";
import { hmsHydrographToHecRasU01, simulateSubbasinRunoff } from "../src/index.js";

test("HEC-HMS <-> HEC-RAS Coupling: exports hydrograph directly readable by HEC-RAS parser", () => {
  const subbasin = {
    name: "Headwaters",
    area: 50.0,
    downstream: "RiverReach",
    curveNumber: 80.0,
    lagMinutes: 60.0,
  };

  const hydrograph = simulateSubbasinRunoff(subbasin, {
    precipitationTotal: 60.0,
    durationHours: 12.0,
    timeStepHours: 0.25,
  });

  assert.ok(hydrograph.length > 0);

  const u01Content = hmsHydrographToHecRasU01(hydrograph, {
    riverName: "Illinois",
    reachName: "UpperReach",
    station: "10500",
    flowTitle: "Simulated 100yr Flood Hydrograph",
  });

  assert.ok(u01Content.includes("Flow Title=Simulated 100yr Flood Hydrograph"));
  assert.ok(u01Content.includes("Boundary for River Reach & Node=Illinois,UpperReach,10500"));
  assert.ok(u01Content.includes("Hydrograph Data="));

  // Ingest via @modelscript/hec-ras parser to verify interoperability
  const parsedFlow = parseFlow(u01Content);
  assert.ok(parsedFlow.boundaryConditions.length > 0, "HEC-RAS parser should parse the generated boundary condition");
  const bc = parsedFlow.boundaryConditions[0]!;
  assert.equal(bc.type, "Flow Hydrograph");
  assert.ok(bc.hydrograph && bc.hydrograph.length > 0, "Boundary hydrograph points should be populated");
});
