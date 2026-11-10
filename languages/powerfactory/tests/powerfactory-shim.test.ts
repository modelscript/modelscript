// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import test from "node:test";
import { parsePowerFactoryText } from "../src/parser/powerfactory-parser.js";
import { executePythonPowerFactoryScript, PowerFactorySession } from "../src/powerfactory-shim.js";

const gridXml = `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmTerm" loc_name="Bus_A"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_B"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>

  <DataObject class="ElmLne" loc_name="Line_AB">
    <bus1>Bus_A</bus1>
    <bus2>Bus_B</bus2>
    <dline>15.0</dline>
    <r1>1.5</r1>
    <x1>4.5</x1>
    <b1>12.0</b1>
  </DataObject>

  <DataObject class="ElmSym" loc_name="Gen_A">
    <bus1>Bus_A</bus1>
    <pgini>50.0</pgini>
    <qgini>10.0</qgini>
    <usetp>1.03</usetp>
  </DataObject>

  <DataObject class="ElmLod" loc_name="Load_B">
    <bus1>Bus_B</bus1>
    <plini>40.0</plini>
    <qlini>12.0</qlini>
  </DataObject>
</PowerFactory>`;

test("PowerFactorySession: executes ComLdf and populates calculation attributes", () => {
  const model = parsePowerFactoryText(gridXml, "ShimGrid");
  const session = new PowerFactorySession();
  session.loadModel(model);

  const app = session.getApplication();
  assert.ok(app.GetActiveProject());

  const ldf = app.GetFromStudyCase("ComLdf");
  assert.ok(ldf);

  const res = ldf.Execute();
  assert.strictEqual(res, 0, "ComLdf must return 0 on success");
  assert.ok(session.lastPowerFlow?.converged);

  // Check data objects
  const busA = session.dataObjects.get("Bus_A");
  const busB = session.dataObjects.get("Bus_B");
  assert.ok(busA && busB);

  const vA = busA.GetAttribute("m:u");
  const vB = busB.GetAttribute("m:u");
  assert.ok(vA !== undefined && Math.abs(vA - 1.03) < 1e-3);
  assert.ok(vB !== undefined && vB > 0.95 && vB < 1.05);

  const lineAB = session.dataObjects.get("Line_AB");
  assert.ok(lineAB);
  const loading = lineAB.GetAttribute("c:loading");
  assert.ok(loading !== undefined && loading > 0);

  // Run Short Circuit
  const shc = app.GetFromStudyCase("ComShc");
  assert.strictEqual(shc?.Execute(), 0);
  assert.ok(session.lastShortCircuit);
  const ikss = busA.GetAttribute("m:Ikss");
  assert.ok(ikss !== undefined && ikss > 0);
});

test("executePythonPowerFactoryScript: executes Python automation commands in-memory", () => {
  const pythonScript = `
import powerfactory as pf

app = pf.GetApplication()
app.PrintPlain("Starting automated grid study...")
ldf = app.GetFromStudyCase("ComLdf")
ldf.Execute()

shc = app.GetFromStudyCase("ComShc")
shc.Execute()
`;

  const session = executePythonPowerFactoryScript(pythonScript, {
    "grid.xml": gridXml,
  });

  assert.ok(session.lastPowerFlow?.converged);
  assert.ok(session.lastShortCircuit);
  assert.ok(session.messages.some((m) => m.includes("Starting automated grid study...")));
  assert.ok(session.messages.some((m) => m.includes("[LDF] Solved AC Power Flow")));
  assert.ok(session.messages.some((m) => m.includes("[SHC] Calculated short-circuit")));
});
