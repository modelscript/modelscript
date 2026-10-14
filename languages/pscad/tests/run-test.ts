// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test runner for @modelscript/pscad language, parser, and linter.
 */

import { pscadLanguage } from "../src/language.js";
import { lintPscx } from "../src/lints/index.js";
import { extractEmtNetlist } from "../src/netlist/emt-netlist.js";
import { parsePscx } from "../src/parser/pscx-parser.js";
import { pscadToModelica } from "../src/projections/modelica.js";
import { pscadToSsd } from "../src/projections/ssp.js";
import { verifyIeee2800Compliance } from "../src/verification/ieee2800.js";

async function main() {
  console.log("Starting @modelscript/pscad Parser & Linter Verification...");

  const samplePscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="IEEE9Bus_IBR" version="5.0.0" type="normal">
  <param name="time_step" value="20.0"/>
  <param name="time_duration" value="2.5"/>
  <param name="start_type" value="0"/>
  <param name="f_base" value="60.0"/>
  <hierarchy>
    <call name="Main" link="10001" />
  </hierarchy>
  <definitions>
    <definition name="Main" type="module">
      <schematic>
        <!-- Generator 1 at Bus 1 -->
        <User classid="UserCmp" defn="source_3p" id="1" x="100" y="200" orient="0">
          <param name="Name" value="Gen1"/>
          <param name="V" value="16.5"/>
          <param name="MVA" value="250.0"/>
          <port name="out" pos="[20, 0]"/>
        </User>

        <!-- Step-up Transformer T1: 16.5 kV to 230 kV -->
        <User classid="UserCmp" defn="xfmr-3p" id="2" x="250" y="200" orient="0">
          <param name="Name" value="T1"/>
          <param name="MVA" value="250.0"/>
          <param name="V1" value="16.5"/>
          <param name="V2" value="230.0"/>
          <param name="X" value="0.0576"/>
          <port name="P" pos="[-30, 0]"/>
          <port name="S" pos="[30, 0]"/>
        </User>

        <!-- Bus 1 (16.5 kV) and Bus 2 (230 kV) -->
        <Bus name="Bus1" id="B1" x="120" y="200" length="60" vbase="16.5"/>
        <Bus name="Bus2" id="B2" x="350" y="200" length="60" vbase="230.0"/>

        <!-- Transmission Line 2-3 -->
        <User classid="UserCmp" defn="tline_3p" id="3" x="480" y="200" orient="0">
          <param name="Name" value="Line_2_3"/>
          <param name="Length" value="75.0"/>
          <param name="R" value="0.035"/>
          <param name="L" value="0.0012"/>
          <param name="C" value="1.2e-8"/>
          <port name="in" pos="[-40, 0]"/>
          <port name="out" pos="[40, 0]"/>
        </User>

        <!-- Bus 3 (230 kV) with Black-Box Inverter FMU -->
        <Bus name="Bus3" id="B3" x="550" y="200" length="60" vbase="230.0"/>
        
        <User classid="UserCmp" defn="inverter_fmu" id="4" x="650" y="200" orient="0">
          <param name="Name" value="Solar_IBR_FMU"/>
          <param name="fmu_path" value="resources/SolarInverter.fmu"/>
          <param name="MVA" value="100.0"/>
          <param name="V" value="230.0"/>
          <port name="term" pos="[-20, 0]"/>
        </User>

        <!-- Floating bus to test linter M6001 -->
        <Bus name="FloatingBus" id="B_Float" x="800" y="100" length="40" vbase="69.0"/>

        <!-- Component with invalid negative resistance to test linter M6003 -->
        <User classid="UserCmp" defn="resistor" id="5" x="800" y="300" orient="0">
          <param name="Name" value="FaultyResistor"/>
          <param name="R" value="-5.0"/>
          <port name="p1" pos="[-10, 0]"/>
        </User>

        <!-- Wires -->
        <Wire>
          <vertex x="120" y="200"/>
          <vertex x="220" y="200"/>
        </Wire>
        <Wire>
          <vertex x="280" y="200"/>
          <vertex x="350" y="200"/>
        </Wire>
      </schematic>
    </definition>
  </definitions>
</project>`;

  // 1. Verify Parser
  console.log("1. Parsing PSCAD .pscx...");
  const project = parsePscx(samplePscx);
  console.log(`   Project Name: ${project.name}`);
  console.log(
    `   Time Step: ${project.settings.timeStepUs} µs, Duration: ${project.settings.durationSec} s, Freq: ${project.settings.frequencyHz} Hz`,
  );
  console.log(`   Components: ${project.rootModule.components.length}`);
  console.log(`   Buses: ${project.rootModule.buses.length}`);
  console.log(`   Wires: ${project.rootModule.wires.length}`);

  if (project.settings.timeStepUs !== 20.0) throw new Error("Expected timeStepUs to be 20.0");
  if (project.settings.durationSec !== 2.5) throw new Error("Expected durationSec to be 2.5");
  if (project.rootModule.components.length !== 5)
    throw new Error(`Expected 5 components, got ${project.rootModule.components.length}`);

  // 2. Verify Electrical Netlist Extraction
  console.log("2. Extracting EMT Netlist...");
  const netlist = extractEmtNetlist(project);
  console.log(`   Extracted Transformers: ${netlist.transformers.length}`);
  console.log(`   Extracted Transmission Lines: ${netlist.transmissionLines.length}`);
  console.log(`   Extracted FMU Instances: ${netlist.fmuInstances.length}`);
  console.log(`   Extracted Branches: ${netlist.branches.length}`);

  if (netlist.transformers.length !== 1) throw new Error("Expected 1 transformer");
  if (netlist.transmissionLines.length !== 1) throw new Error("Expected 1 transmission line");
  if (netlist.fmuInstances.length !== 1) throw new Error("Expected 1 FMU instance");

  const t1 = netlist.transformers[0];
  console.log(`   T1: ${t1.primaryKv} kV -> ${t1.secondaryKv} kV, ${t1.mvaRating} MVA`);
  if (t1.mvaRating !== 250.0 || t1.primaryKv !== 16.5 || t1.secondaryKv !== 230.0) {
    throw new Error("Transformer T1 parameters mismatch");
  }

  // 3. Verify Pre-flight Linter Rules
  console.log("3. Running Pre-flight Linter...");
  const diags = lintPscx(project);
  console.log(`   Diagnostics emitted: ${diags.length}`);
  for (const d of diags) {
    console.log(`   [${d.severity.toUpperCase()}] ${d.code} (${d.rule}): ${d.message}`);
  }

  // Verify M6001 (floating node)
  const floatingDiag = diags.find((d) => d.code === "M6001" && d.message.includes("FloatingBus"));
  if (!floatingDiag) throw new Error("Expected M6001 for FloatingBus");

  // Verify M6003 (invalid negative parameter)
  const paramDiag = diags.find((d) => d.code === "M6003" && d.message.includes("FaultyResistor"));
  if (!paramDiag) throw new Error("Expected M6003 for FaultyResistor negative resistance");

  // 4. Verify Language Definition
  console.log("4. Verifying Language Actions...");
  if (pscadLanguage.name !== "pscad") throw new Error("Expected language name to be pscad");
  if (!pscadLanguage.fileExtensions.includes(".pscx")) throw new Error("Expected .pscx extension");
  console.log(`   Registered actions: ${pscadLanguage.actions?.map((a) => a.id).join(", ")}`);

  // 5. Verify Modelica Projection
  console.log("5. Testing Modelica Projection (pscadToModelica)...");
  const modelicaCode = pscadToModelica(project);
  if (!modelicaCode.includes("model IEEE9Bus_IBR")) throw new Error("Expected model declaration in Modelica code");
  if (!modelicaCode.includes("Modelica.Electrical.Analog.Basic.Ground")) throw new Error("Expected Ground declaration");
  console.log(`   Generated Modelica code: ${modelicaCode.length} bytes`);

  // 6. Verify SSP SystemStructure Projection
  console.log("6. Testing SSP Projection (pscadToSsd)...");
  const ssdXml = pscadToSsd(project);
  if (!ssdXml.includes("<ssd:SystemStructureDescription")) throw new Error("Expected valid SSD root tag");
  if (!ssdXml.includes('<ssd:Component name="Solar_IBR_FMU"')) throw new Error("Expected Solar_IBR_FMU component");
  if (!ssdXml.includes("<ssd:Connection")) throw new Error("Expected SSD connections");
  console.log(`   Generated SSP SSD XML: ${ssdXml.length} bytes`);

  // 7. Verify IEEE 2800-2022 Automated Verification Engine
  console.log("7. Testing IEEE 2800 Verification Engine (verifyIeee2800Compliance)...");
  const nSteps = 1000;
  const time = new Float64Array(nSteps);
  const vPoi = new Float64Array(nSteps);
  const iIbr = new Float64Array(nSteps);
  for (let i = 0; i < nSteps; i++) {
    time[i] = i * 20e-6; // 20 ms total
    vPoi[i] = 230e3 * Math.sin(2 * Math.PI * 60 * time[i]!);
    iIbr[i] = 1200 * Math.sin(2 * Math.PI * 60 * time[i]!);
  }

  const report = verifyIeee2800Compliance(
    project.name,
    netlist,
    { time, vPoi, iIbr },
    { faultStartSec: 0.005, faultDurationSec: 0.01, vPreFaultKv: 230, vFaultKv: 11.5 },
  );

  console.log(`   IEEE 2800 Report Result: [${report.overallStatus}] with ${report.checks.length} evaluated clauses`);
  if (report.checks.length !== 3) throw new Error("Expected 3 evaluated IEEE 2800 clauses");

  console.log("ALL TESTS PASSED SUCCESSFULLY! Milestones 1, 2, 3, 4 & 5 verified.");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
