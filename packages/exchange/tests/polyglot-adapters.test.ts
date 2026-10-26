// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { fmuToPscad } from "../../../languages/pscad/src/index.js";
import { fmuToPsse } from "../../../languages/psse/src/index.js";
import { fmuToSimulink } from "../../../languages/simulink/src/index.js";

console.log("=== Running Polyglot Black-Box Adapter Tests ===");

const sampleFmu = {
  modelName: "SolarInverter",
  description: "Vendor Solar Inverter Controller",
  guid: "{9876-fedc}",
  fmiVersion: "2.0",
  variables: [
    {
      name: "v_grid",
      causality: "input",
      type: "Real",
      valueReference: 1,
      unit: "V",
      start: 480.0,
      description: "Grid RMS Voltage",
    },
    {
      name: "i_pv_ref",
      causality: "input",
      type: "Real",
      valueReference: 2,
      unit: "A",
      start: 50.0,
    },
    {
      name: "p_ac",
      causality: "output",
      type: "Real",
      valueReference: 3,
      unit: "W",
    },
    {
      name: "q_ac",
      causality: "output",
      type: "Real",
      valueReference: 4,
      unit: "VAr",
    },
    {
      name: "kp_pll",
      causality: "parameter",
      type: "Real",
      valueReference: 5,
      start: 12.5,
    },
    {
      name: "ki_pll",
      causality: "parameter",
      type: "Real",
      valueReference: 6,
      start: 45.0,
    },
  ],
};

// 1. Test PSCAD Projection
console.log("1. Testing fmuToPscad...");
const pscadResult = fmuToPscad(sampleFmu);
assert.strictEqual(pscadResult.componentName, "SolarInverter");
assert.ok(pscadResult.pscxXml.includes('<User classid="UserCmp" defn="SolarInverter"'));
assert.ok(pscadResult.pscxXml.includes('<port name="v_grid" type="in"'));
assert.ok(pscadResult.pscxXml.includes('<port name="p_ac" type="out"'));
assert.ok(pscadResult.pscxXml.includes('<param name="kp_pll" value="12.5"'));
assert.ok(pscadResult.fortranGlue.includes("SUBROUTINE SolarInverter_STEP"));
assert.ok(pscadResult.fortranGlue.includes("CALL C_FMU_STEP(TIME, DELT, IN_ARR, OUT_ARR)"));
assert.strictEqual(pscadResult.inputPins.length, 2);
assert.strictEqual(pscadResult.outputPins.length, 2);
assert.strictEqual(pscadResult.parameterCount, 2);

// 2. Test PSS/E USRMDL Projection
console.log("2. Testing fmuToPsse...");
const psseResult = fmuToPsse(sampleFmu, 205, "1");
assert.strictEqual(psseResult.modelName, "SOLARINVERTE");
assert.ok(psseResult.dyrRecord.includes("205 'USRMDL' '1' 'SOLARINVERTE'"));
assert.strictEqual(psseResult.totalCons, 2);
assert.strictEqual(psseResult.totalVars, 2);
assert.ok(psseResult.conMap.some((c) => c.name === "kp_pll" && c.value === 12.5));
assert.ok(psseResult.conMap.some((c) => c.name === "ki_pll" && c.value === 45.0));

// 3. Test Simulink Level-2 C-MEX Projection
console.log("3. Testing fmuToSimulink...");
const slxResult = fmuToSimulink(sampleFmu);
assert.strictEqual(slxResult.sFunctionName, "SolarInverter_sfun");
assert.strictEqual(slxResult.numInputs, 2);
assert.strictEqual(slxResult.numOutputs, 2);
assert.strictEqual(slxResult.numParameters, 2);
assert.ok(slxResult.cMexSource.includes("#define S_FUNCTION_NAME SolarInverter_sfun"));
assert.ok(slxResult.cMexSource.includes("static void mdlInitializeSizes"));
assert.ok(slxResult.cMexSource.includes("static void mdlOutputs"));
assert.ok(slxResult.simulinkBlockXml.includes('<Block BlockType="S-Function" Name="SolarInverter">'));

// 4. Test AUTOSAR Classic SWC Projection
console.log("4. Testing fmuToAutosar...");
const { fmuToAutosar } = await import("../../../languages/autosar/src/index.js");
const autosarResult = fmuToAutosar(sampleFmu, 0.02);
assert.strictEqual(autosarResult.swcName, "SolarInverter_Swc");
assert.strictEqual(autosarResult.runnableName, "SolarInverter_Swc_Step");
assert.strictEqual(autosarResult.periodSec, 0.02);
assert.strictEqual(autosarResult.rPorts.length, 2);
assert.strictEqual(autosarResult.pPorts.length, 2);
assert.ok(autosarResult.arxml.includes("<APPLICATION-SW-COMPONENT-TYPE>"));
assert.ok(autosarResult.arxml.includes("<SHORT-NAME>SolarInverter_Swc</SHORT-NAME>"));
assert.ok(autosarResult.arxml.includes("<PERIOD>0.02</PERIOD>"));
assert.ok(autosarResult.virtualRteGlue.includes('virtualRte.registerRunnable("SolarInverter_Swc"'));

console.log("All Polyglot Black-Box Adapter tests PASSED!");
