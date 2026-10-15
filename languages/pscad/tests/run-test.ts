// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test runner for @modelscript/pscad language, parser, and linter.
 */

import { buildPscadDiagram } from "../../../packages/diagram/src/pscad-diagram-builder.js";
import { EmtSolver } from "../../../packages/simulate/src/solvers/emt/index.js";
import { pscadLanguage, runPscadSimulationPipeline } from "../src/language.js";
import { lintPscx } from "../src/lints/index.js";
import { extractEmtNetlist, netlistToEmtCircuit } from "../src/netlist/emt-netlist.js";
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
  if (!pscadLanguage.fileExtensions.includes(".pslx")) throw new Error("Expected .pslx extension");
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

  // 8. Verify Master Library Ports, Multi-Segment Wire Chains, Direct Wiring & Open Breakers
  console.log("8. Testing Master Library Catalog, Multi-Segment Wires & Breaker Topology...");
  const advancedPscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="AdvancedTopology" version="5.0.0">
  <paramlist name="Settings">
    <param name="time_step" value="10.0"/>
    <param name="time_duration" value="0.5"/>
    <param name="f_base" value="50.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <User classid="UserCmp" name="master:source_3" id="S1" x="100" y="100" orient="0">
          <paramlist>
            <param name="Name" value="3Phase_Src"/>
            <param name="V" value="110.0"/>
            <param name="f" value="1000.0"/>
          </paramlist>
        </User>
        <Wire classid="Bus" id="BusA" name="Bus_110kV" x="136" y="80">
          <paramlist><param name="BaseKV" value="110.0"/></paramlist>
          <vertex x="0" y="0"/>
          <vertex x="0" y="40"/>
        </Wire>
        <User classid="UserCmp" name="master:inductor" id="L1" x="190" y="100" orient="0">
          <paramlist><param name="L" value="0.05"/></paramlist>
        </User>
        <User classid="UserCmp" name="master:capacitor" id="C1" x="262" y="100" orient="0">
          <paramlist><param name="C" value="1e-5"/></paramlist>
        </User>
        <User classid="UserCmp" name="master:ground" id="GND1" x="280" y="100" orient="0"/>
        <User classid="UserCmp" name="master:breaker" id="BRK_OPEN" x="400" y="200" orient="0">
          <paramlist><param name="Status" value="Open"/></paramlist>
        </User>
        <User classid="UserCmp" name="master:inductor" id="BAD_L" x="500" y="200" orient="0">
          <paramlist><param name="L" value="-0.01"/></paramlist>
        </User>
        <!-- Two-segment wire chain from BusA (136,100) -> (150,100) -> L1.p1 (172,100) -->
        <Wire classid="WireOrthogonal" id="W1"><vertex x="136" y="100"/><vertex x="150" y="100"/></Wire>
        <Wire classid="WireOrthogonal" id="W2"><vertex x="150" y="100"/><vertex x="172" y="100"/></Wire>
        <!-- Direct component-to-component wire from L1.p2 (208,100) to C1.p1 (244,100) -->
        <Wire classid="WireOrthogonal" id="W3"><vertex x="208" y="100"/><vertex x="244" y="100"/></Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

  const advProj = parsePscx(advancedPscx);
  // Component param f="1000.0" must NOT overwrite project f_base="50.0"
  if (advProj.settings.frequencyHz !== 50.0) {
    throw new Error(`Expected project frequencyHz=50.0, got ${advProj.settings.frequencyHz}`);
  }
  // String starting with digits ("3Phase_Src") must remain a string
  const s1Comp = advProj.rootModule.components.find((c) => c.id === "S1")!;
  if (s1Comp.instanceName !== "3Phase_Src") {
    throw new Error(`Expected instanceName '3Phase_Src', got '${s1Comp.instanceName}'`);
  }
  const advNetlist = extractEmtNetlist(advProj);
  if (advNetlist.sources.length !== 1) throw new Error("Expected 1 extracted voltage source");
  const l1Branch = advNetlist.branches.find((b) => b.id === "L1")!;
  const c1Branch = advNetlist.branches.find((b) => b.id === "C1")!;
  if (l1Branch.resistanceOhm !== 0) throw new Error("Pure inductor should have 0 series resistance");
  if (l1Branch.toBus !== c1Branch.fromBus || l1Branch.toBus === "0") {
    throw new Error(
      `Expected L1.toBus and C1.fromBus to share virtual node, got ${l1Branch.toBus} vs ${c1Branch.fromBus}`,
    );
  }
  if (c1Branch.toBus !== "0") {
    throw new Error(`Expected C1.toBus connected to ground ('0'), got '${c1Branch.toBus}'`);
  }
  const advDiags = lintPscx(advProj);
  if (!advDiags.some((d) => d.code === "M6003" && d.componentId === "BAD_L" && (d.line ?? 0) > 1)) {
    throw new Error("Expected M6003 with valid source line for negative inductance on BAD_L");
  }

  // 9. Verify CSMF Control Block Extraction & Modelica.Blocks Projection
  console.log("9. Testing CSMF Control Block Extraction & Modelica.Blocks Projection...");
  const csmfPscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="CsmfControlsTest" version="5.0.0">
  <paramlist name="Settings">
    <param name="time_step" value="20.0"/>
    <param name="time_duration" value="0.2"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <User classid="UserCmp" name="master:const" id="C_REF" x="100" y="100" orient="0">
          <paramlist>
            <param name="Name" value="V_Ref"/>
            <param name="value" value="1.0"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:pi_ctlr" id="PI_1" x="200" y="100" orient="0">
          <paramlist>
            <param name="Name" value="AVR_PI"/>
            <param name="Kp" value="2.5"/>
            <param name="Ti" value="0.05"/>
            <param name="inputs" value="V_Ref"/>
          </paramlist>
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;
  const csmfProj = parsePscx(csmfPscx);
  const csmfNetlist = extractEmtNetlist(csmfProj);
  if (!csmfNetlist.controlBlocks || csmfNetlist.controlBlocks.length !== 2) {
    throw new Error(`Expected 2 extracted CSMF control blocks, got ${csmfNetlist.controlBlocks?.length ?? 0}`);
  }
  const csmfModelica = pscadToModelica(csmfProj);
  if (!csmfModelica.includes("Modelica.Blocks.Sources.Constant V_Ref(k = 1);")) {
    throw new Error("Expected Modelica.Blocks.Sources.Constant in projected Modelica code");
  }
  if (!csmfModelica.includes("Modelica.Blocks.Continuous.PI AVR_PI(k = 2.5, T = 0.05);")) {
    throw new Error("Expected Modelica.Blocks.Continuous.PI in projected Modelica code");
  }
  if (!csmfModelica.includes("connect(V_Ref.y, AVR_PI.u);")) {
    throw new Error("Expected connect(V_Ref.y, AVR_PI.u) in projected Modelica code");
  }

  const csmfCircuit = netlistToEmtCircuit(csmfNetlist);
  if (!csmfCircuit.csmfBlocks || csmfCircuit.csmfBlocks.length !== 2) {
    throw new Error("Expected netlistToEmtCircuit to preserve 2 csmfBlocks");
  }

  // Verify M6005 diagnostic when a CSMF block references an unknown upstream signal
  const brokenCsmfProj = parsePscx(csmfPscx.replace('value="V_Ref"', 'value="Missing_Sensor"'));
  const brokenCsmfDiags = lintPscx(brokenCsmfProj);
  if (!brokenCsmfDiags.some((d) => d.code === "M6005")) {
    throw new Error("Expected M6005 csmf-unresolved-input diagnostic for Missing_Sensor");
  }

  // 10. Verify Graphical <Wire> CSMF Signal Tracing & Hierarchical Sub-Module Flattening
  console.log("10. Testing Graphical <Wire> CSMF Signal Tracing & Hierarchical Sub-Module Flattening...");
  const hierPscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="HierarchicalAndWiredCsmfTest" version="5.0.0">
  <paramlist name="Settings">
    <param name="time_step" value="20.0"/>
    <param name="time_duration" value="0.2"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="HarmonicFilterSub">
      <Port x="-36" y="0"><param name="name" value="PCC"/><param name="dim" value="3"/></Port>
      <schematic>
        <Bus id="PCC_Internal" name="PCC" x="100" y="100" length="40" vbase="34.5"/>
        <User classid="UserCmp" name="master:inductor" id="Lf" x="150" y="100" orient="0">
          <paramlist><param name="Name" value="L_Filter"/><param name="L" value="0.015"/></paramlist>
          <port name="p1" pos="[-18, 0]" kind="electrical" dim="3"/>
          <port name="p2" pos="[18, 0]" kind="electrical" dim="3"/>
        </User>
        <User classid="UserCmp" name="master:capacitor" id="Cf" x="210" y="100" orient="0">
          <paramlist><param name="Name" value="C_Filter"/><param name="C" value="0.0001"/></paramlist>
          <port name="p1" pos="[-18, 0]" kind="electrical" dim="3"/>
          <port name="p2" pos="[18, 0]" kind="electrical" dim="3"/>
        </User>
        <User classid="UserCmp" name="master:ground" id="GND_Sub" x="228" y="118" orient="0"/>
        <Wire classid="WireOrthogonal"><vertex x="110" y="100"/><vertex x="132" y="100"/></Wire>
        <Wire classid="WireOrthogonal"><vertex x="168" y="100"/><vertex x="192" y="100"/></Wire>
      </schematic>
    </Definition>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <Bus id="Grid_POI" name="Grid_POI" x="100" y="200" length="60" vbase="34.5"/>
        <User classid="UserCmp" name="HarmonicFilterSub" id="Sub1" x="180" y="200" orient="0">
          <paramlist><param name="Name" value="FilterBank1"/></paramlist>
        </User>
        <Wire classid="WireOrthogonal"><vertex x="120" y="200"/><vertex x="144" y="200"/></Wire>

        <!-- CSMF blocks connected purely via graphical <Wire> (no explicit 'inputs' param!) -->
        <User classid="UserCmp" name="master:const" id="W_CONST" x="100" y="400" orient="0">
          <paramlist>
            <param name="Name" value="Wired_Ref"/>
            <param name="value" value="1.05"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:gain" id="W_GAIN" x="180" y="400" orient="0">
          <paramlist>
            <param name="Name" value="Wired_Gain"/>
            <param name="K" value="2.0"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:pi_ctlr" id="W_PI" x="260" y="400" orient="0">
          <paramlist>
            <param name="Name" value="Wired_PI"/>
            <param name="Kp" value="4.0"/>
            <param name="Ti" value="0.02"/>
          </paramlist>
        </User>
        <!-- Wire from W_CONST.out (118, 400) to W_GAIN.in (162, 400) -->
        <Wire classid="WireOrthogonal"><vertex x="118" y="400"/><vertex x="162" y="400"/></Wire>
        <!-- Wire from W_GAIN.out (198, 400) to W_PI.in (242, 400) -->
        <Wire classid="WireOrthogonal"><vertex x="198" y="400"/><vertex x="242" y="400"/></Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

  const hierProj = parsePscx(hierPscx);
  const hierNetlist = extractEmtNetlist(hierProj);

  // Verify sub-module flattening: FilterBank1_Lf and FilterBank1_Cf should be flattened into branches
  const flatLf = hierNetlist.branches.find((b) => b.id === "FilterBank1_Lf");
  const flatCf = hierNetlist.branches.find((b) => b.id === "FilterBank1_Cf");
  if (!flatLf || !flatCf) {
    throw new Error(
      `Expected sub-module RLC branches FilterBank1_Lf and FilterBank1_Cf to be flattened, got [${hierNetlist.branches.map((b) => b.id).join(", ")}]`,
    );
  }
  if (flatLf.fromBus !== "Grid_POI") {
    throw new Error(
      `Expected flattened FilterBank1_Lf.fromBus to map to parent bus 'Grid_POI', got '${flatLf.fromBus}'`,
    );
  }
  if (flatCf.toBus !== "0") {
    throw new Error(`Expected flattened FilterBank1_Cf.toBus to map to ground ('0'), got '${flatCf.toBus}'`);
  }

  // Verify graphical <Wire> signal tracing for CSMF control blocks
  const wiredGain = hierNetlist.controlBlocks?.find((cb) => cb.id === "Wired_Gain");
  const wiredPi = hierNetlist.controlBlocks?.find((cb) => cb.id === "Wired_PI");
  if (!wiredGain || wiredGain.inputs[0] !== "Wired_Ref") {
    throw new Error(
      `Expected Wired_Gain to trace graphical <Wire> input 'Wired_Ref', got [${wiredGain?.inputs.join(", ")}]`,
    );
  }
  if (!wiredPi || wiredPi.inputs[0] !== "Wired_Gain") {
    throw new Error(
      `Expected Wired_PI to trace graphical <Wire> input 'Wired_Gain', got [${wiredPi?.inputs.join(", ")}]`,
    );
  }

  // 11. Verify End-to-End .pscx Apparatus Extraction (Faults, Timed Breakers, MOV Arresters, Sync Machines, VSC Bridges) & Modelica SineVoltage/IdealTransformer Projection
  console.log(
    "11. Testing End-to-End .pscx Apparatus Extraction & Modelica SineVoltage/IdealTransformer Projection...",
  );
  const apparatusPscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="ApparatusGrid" version="5.0.0">
  <paramlist name="Settings">
    <param name="time_step" value="25.0"/>
    <param name="time_duration" value="0.2"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic>
        <Bus id="GenBus" name="GenBus" x="100" y="100" length="60" vbase="18.0"/>
        <Bus id="HVBus" name="HVBus" x="300" y="100" length="60" vbase="230.0"/>
        <User classid="UserCmp" name="master:sync_machine" id="SM1" x="64" y="100" orient="0">
          <paramlist>
            <param name="Name" value="SyncGen1"/>
            <param name="MVA" value="300.0"/>
            <param name="V" value="18.0"/>
            <param name="H" value="4.2"/>
            <param name="Xd" value="1.75"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:xfmr-3p2w" id="TX1" x="180" y="100" orient="0">
          <paramlist>
            <param name="MVA" value="300.0"/>
            <param name="V1" value="18.0"/>
            <param name="V2" value="230.0"/>
            <param name="X" value="0.1"/>
            <param name="Connection" value="D-Yg"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:breaker3" id="BRK1" x="252" y="100" orient="0">
          <paramlist>
            <param name="Status" value="Closed"/>
            <param name="t_open" value="0.06"/>
            <param name="t_close" value="0.15"/>
            <param name="chopping_current" value="1.2"/>
            <param name="single_pole_phase" value="0"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:arrester" id="MOV1" x="310" y="118" orient="0">
          <paramlist>
            <param name="Vref" value="192.0"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:tpflt" id="FLT1" x="330" y="118" orient="0">
          <paramlist>
            <param name="type" value="SLG"/>
            <param name="t_start" value="0.04"/>
            <param name="duration" value="0.05"/>
            <param name="R" value="0.005"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:vsc_pwm" id="VSC1" x="336" y="100" orient="0">
          <paramlist>
            <param name="MVA" value="150.0"/>
            <param name="V" value="230.0"/>
            <param name="Vdc" value="400.0"/>
            <param name="f_carrier" value="2160.0"/>
          </paramlist>
        </User>
        <Wire classid="WireOrthogonal"><vertex x="100" y="100"/><vertex x="144" y="100"/></Wire>
        <Wire classid="WireOrthogonal"><vertex x="216" y="100"/><vertex x="234" y="100"/></Wire>
        <Wire classid="WireOrthogonal"><vertex x="270" y="100"/><vertex x="300" y="100"/></Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

  const appProj = parsePscx(apparatusPscx);
  const appNetlist = extractEmtNetlist(appProj);
  const appCircuit = netlistToEmtCircuit(appNetlist);

  if (!appCircuit.synchronousMachines || appCircuit.synchronousMachines.length !== 1) {
    throw new Error("Expected 1 synchronous machine in netlistToEmtCircuit output");
  }
  if (
    appCircuit.synchronousMachines[0]!.inertiaConstantH !== 4.2 ||
    appCircuit.synchronousMachines[0]!.bus !== "GenBus"
  ) {
    throw new Error("Expected SyncGen1 on GenBus with H=4.2 s");
  }
  if (!appCircuit.surgeArresters || appCircuit.surgeArresters[0]!.protectionLevelKv !== 192.0) {
    throw new Error("Expected MOV1 surge arrester with Vref=192.0 kV");
  }
  if (!appCircuit.faults || appCircuit.faults[0]!.faultType !== "SLG" || appCircuit.faults[0]!.startSec !== 0.04) {
    throw new Error("Expected FLT1 SLG fault at t_start=0.04 s");
  }
  if (
    !appCircuit.breakers ||
    appCircuit.breakers[0]!.openTimeSec !== 0.06 ||
    appCircuit.breakers[0]!.singlePoleTripPhase !== "A"
  ) {
    throw new Error("Expected BRK1 timed breaker with openTimeSec=0.06 s and singlePoleTripPhase='A'");
  }
  if (
    !appCircuit.converterBridges ||
    appCircuit.converterBridges[0]!.kind !== "vsc_pwm" ||
    appCircuit.converterBridges[0]!.dcLinkKv !== 400.0
  ) {
    throw new Error("Expected VSC1 converter bridge with kind='vsc_pwm' and dcLinkKv=400.0 kV");
  }

  // Verify Modelica projection includes SineVoltage and IdealTransformer
  if (!modelicaCode.includes("Modelica.Electrical.Analog.Sources.SineVoltage Gen1")) {
    throw new Error("Expected pscadToModelica to emit Modelica.Electrical.Analog.Sources.SineVoltage for Gen1");
  }
  if (!modelicaCode.includes("Modelica.Electrical.Analog.Basic.IdealTransformer")) {
    throw new Error(
      "Expected pscadToModelica to emit Modelica.Electrical.Analog.Basic.IdealTransformer for transformer turns ratio",
    );
  }

  // 12. Test Extended Apparatus Pre-Flight Linter Rules (M6006-M6008), MMC Extraction & Turnkey Simulation Pipeline
  console.log("12. Testing Extended Linter Rules (M6006-M6008), MMC Extraction & Turnkey Pipeline...");
  const phase7Pscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Phase7_MMC_Grid" version="5.0.2" type="case">
  <paramlist name="Settings">
    <param name="time_step" value="50.0"/>
    <param name="time_duration" value="0.12"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic classid="GraphFrame">
        <Bus classid="Bus" id="Bus1" name="POI_230" x="100" y="100">
          <paramlist><param name="BaseKV" value="230.0"/></paramlist>
        </Bus>
        <Bus classid="Bus" id="Bus2" name="Remote_230" x="300" y="100">
          <paramlist><param name="BaseKV" value="230.0"/></paramlist>
        </Bus>
        <!-- Short Bergeron line: length=2 km -> tau = 6.9 us < dt = 50 us (triggers M6006) -->
        <User classid="UserCmp" name="master:tline" id="ShortLine" x="200" y="100" orient="0">
          <paramlist>
            <param name="length" value="2.0"/>
            <param name="R_per_km" value="0.02"/>
            <param name="L_per_km" value="0.001"/>
            <param name="C_per_km" value="1.2e-8"/>
            <param name="model_type" value="bergeron"/>
          </paramlist>
        </User>
        <!-- Synchronous machine with invalid reactance order Xd''=0.45 > Xd'=0.30 (triggers M6007) -->
        <User classid="UserCmp" name="master:sync_machine" id="BadSync" x="64" y="100" orient="0">
          <paramlist>
            <param name="MVA" value="250.0"/>
            <param name="V" value="230.0"/>
            <param name="Xd" value="1.8"/>
            <param name="Xd_p" value="0.30"/>
            <param name="Xd_pp" value="0.45"/>
          </paramlist>
        </User>
        <!-- Under-rated MOV arrester: Vref=120 kV < 230 * sqrt(2/3) = 187.8 kV (triggers M6008) -->
        <User classid="UserCmp" name="master:arrester" id="UnderMov" x="100" y="118" orient="0">
          <paramlist>
            <param name="Vref" value="120.0"/>
          </paramlist>
        </User>
        <!-- Modular Multilevel Converter (MMC) Thévenin Equivalent Arm Bridge -->
        <User classid="UserCmp" name="master:mmc_thevenin" id="MMC1" x="336" y="100" orient="0">
          <paramlist>
            <param name="MVA" value="400.0"/>
            <param name="V" value="230.0"/>
            <param name="Vdc" value="400.0"/>
            <param name="N_sm" value="48"/>
            <param name="C_sm" value="0.015"/>
            <param name="L_arm" value="0.018"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:inverter_fmu" id="IBR1" x="120" y="100" orient="0">
          <paramlist>
            <param name="MVA" value="150.0"/>
            <param name="V" value="230.0"/>
            <param name="fmu_path" value="mmc_ibr.fmu"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:tpflt" id="FLT_POI" x="100" y="118" orient="0">
          <paramlist>
            <param name="type" value="SLG"/>
            <param name="t_start" value="0.02"/>
            <param name="duration" value="0.05"/>
          </paramlist>
        </User>
        <Wire classid="WireOrthogonal"><vertex x="100" y="100"/><vertex x="164" y="100"/></Wire>
        <Wire classid="WireOrthogonal"><vertex x="236" y="100"/><vertex x="300" y="100"/></Wire>
      </schematic>
    </Definition>
  </definitions>
</project>`;

  const p7Res = runPscadSimulationPipeline({
    documentText: phase7Pscx,
    runSimulation: true,
    exportComtrade: true,
    verifyIeee2800: true,
  });

  const diagCodes = new Set(p7Res.diagnostics.map((d) => d.code));
  console.log(`   Phase 7 Diagnostics: ${Array.from(diagCodes).join(", ")}`);
  if (!diagCodes.has("M6006")) {
    throw new Error("Expected M6006 (line-travel-time-underflow) diagnostic for 2 km Bergeron line at dt=50 us");
  }
  if (!diagCodes.has("M6007")) {
    throw new Error("Expected M6007 (sync-machine-reactance-order) diagnostic when Xd'' > Xd'");
  }
  if (!diagCodes.has("M6008")) {
    throw new Error("Expected M6008 (mov-arrester-under-rated) warning when Vref < Vbus * sqrt(2/3)");
  }

  const mmcBridge = p7Res.circuit.converterBridges?.[0];
  if (!mmcBridge || mmcBridge.topology !== "mmc_thevenin" || mmcBridge.numSubmodulesPerArm !== 48) {
    throw new Error("Expected MMC1 to be extracted with topology='mmc_thevenin' and numSubmodulesPerArm=48");
  }
  if (!p7Res.simulationResult || p7Res.simulationResult.time.length < 100) {
    throw new Error("Expected runPscadSimulationPipeline to execute companion transient simulation");
  }
  if (!p7Res.comtrade || !p7Res.comtrade.cfg.includes("Phase7_MMC_Grid") || p7Res.comtrade.dat.length < 100) {
    throw new Error("Expected runPscadSimulationPipeline to export IEEE C37.111 COMTRADE .cfg and .dat");
  }
  if (!p7Res.complianceReport || p7Res.complianceReport.checks.length < 3) {
    throw new Error("Expected runPscadSimulationPipeline to generate IEEE 2800-2022 compliance report");
  }

  // 13. Test Phase 8 Coaxial Cable (master:cable) & 5th-Order Induction Machine / DFIG Extraction & Simulation
  console.log("13. Testing Coaxial Cable (master:cable) & Induction Machine / DFIG Extraction & Simulation...");
  const phase8Pscx = `<?xml version="1.0" encoding="UTF-8"?>
<project name="Phase8_Offshore_Wind_DFIG" version="5.0.2" type="case">
  <paramlist name="Settings">
    <param name="time_step" value="40.0"/>
    <param name="time_duration" value="0.06"/>
    <param name="f_base" value="60.0"/>
  </paramlist>
  <definitions>
    <Definition classid="UserCmpDefn" name="Main">
      <schematic classid="GraphFrame">
        <Bus classid="Bus" id="Bus1" name="Onshore_132" x="100" y="100">
          <paramlist><param name="BaseKV" value="132.0"/></paramlist>
        </Bus>
        <Bus classid="Bus" id="Bus2" name="Offshore_132" x="300" y="100">
          <paramlist><param name="BaseKV" value="132.0"/></paramlist>
        </Bus>
        <User classid="UserCmp" name="master:source_3" id="GridSrc" x="64" y="100" orient="0">
          <paramlist>
            <param name="V" value="132.0"/>
            <param name="f" value="60.0"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:cable" id="SubCable1" x="200" y="100" orient="0">
          <paramlist>
            <param name="length" value="45.0"/>
            <param name="model_type" value="fd"/>
            <param name="core_radius" value="0.022"/>
            <param name="insulation_radius" value="0.052"/>
            <param name="eps_r" value="2.3"/>
            <param name="burial_depth" value="1.5"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:ind_machine" id="AuxPumpMotor" x="100" y="136" orient="0">
          <paramlist>
            <param name="MVA" value="5.0"/>
            <param name="V" value="132.0"/>
            <param name="H" value="0.6"/>
            <param name="slip" value="0.03"/>
            <param name="Tm" value="0.45"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="master:dfig" id="WindDFIG1" x="336" y="100" orient="0">
          <paramlist>
            <param name="MVA" value="120.0"/>
            <param name="V" value="132.0"/>
            <param name="H" value="1.8"/>
            <param name="slip" value="-0.10"/>
            <param name="Tm" value="-0.80"/>
            <param name="Vdr" value="0.06"/>
            <param name="Vqr" value="-0.08"/>
            <param name="I_crowbar" value="1.8"/>
          </paramlist>
        </User>
        <User classid="UserCmp" name="OffshoreCollector" id="SubModInst1" x="300" y="180" orient="0">
          <paramlist><param name="RatingMVA" value="120.0"/></paramlist>
        </User>
        <Wire classid="WireOrthogonal"><vertex x="100" y="100"/><vertex x="164" y="100"/></Wire>
        <Wire classid="WireOrthogonal"><vertex x="236" y="100"/><vertex x="300" y="100"/></Wire>
      </schematic>
    </Definition>
    <Definition classid="UserCmpDefn" name="OffshoreCollector">
      <schematic classid="GraphFrame">
        <Bus classid="Bus" id="SubBus1" name="Collector_33kV" x="120" y="120">
          <paramlist><param name="BaseKV" value="33.0"/></paramlist>
        </Bus>
        <User classid="UserCmp" name="master:breaker3" id="SubBrk1" x="180" y="120" orient="0">
          <paramlist><param name="t_open" value="0.05"/></paramlist>
        </User>
      </schematic>
    </Definition>
  </definitions>
</project>`;

  const p8Res = runPscadSimulationPipeline({
    documentText: phase8Pscx,
    runSimulation: true,
  });

  const subCable = p8Res.circuit.transmissionLines?.find((l) => l.id === "SubCable1");
  if (
    !subCable ||
    !subCable.isCable ||
    subCable.modelType !== "fdpm" ||
    subCable.coreRadiusM !== 0.022 ||
    subCable.insulationRadiusM !== 0.052
  ) {
    throw new Error(
      "Expected SubCable1 (master:cable) to extract coaxial cable geometry with isCable=true, modelType='fdpm', coreRadiusM=0.022",
    );
  }
  if (!p8Res.circuit.inductionMachines || p8Res.circuit.inductionMachines.length !== 2) {
    throw new Error(
      `Expected 2 induction machines (AuxPumpMotor + WindDFIG1), got ${p8Res.circuit.inductionMachines?.length ?? 0}`,
    );
  }
  const dfigCfg = p8Res.circuit.inductionMachines.find((m) => m.id === "WindDFIG1");
  if (!dfigCfg || dfigCfg.machineType !== "dfig" || dfigCfg.crowbarTriggerCurrentPu !== 1.8) {
    throw new Error("Expected WindDFIG1 to have machineType='dfig' and crowbarTriggerCurrentPu=1.8");
  }
  if (!p8Res.simulationResult || p8Res.simulationResult.time.length < 50) {
    throw new Error("Expected Phase 8 submarine cable + DFIG EMT simulation to complete");
  }

  // 14. Test Upgraded VS Code .pscx Diagram Backend & IEEE/IEC Apparatus Vector Glyphs
  console.log("14. Testing VS Code .pscx Diagram Backend & IEEE/IEC Apparatus Glyphs...");
  const fullAppDiag = buildPscadDiagram(appProj);
  const brkCell = fullAppDiag.cells.find((c) => c.id === "BRK1");
  const movCell = fullAppDiag.cells.find((c) => c.id === "MOV1");
  const fltCell = fullAppDiag.cells.find((c) => c.id === "FLT1");
  const vscCell = fullAppDiag.cells.find((c) => c.id === "VSC1");
  if (
    !brkCell?.markup ||
    brkCell.markup.length < 3 ||
    !movCell?.markup ||
    movCell.markup.length < 4 ||
    !fltCell?.markup ||
    !fltCell.markup.some((m: any) => m.selector === "faultBolt") ||
    !vscCell?.markup ||
    vscCell.markup.length < 4
  ) {
    throw new Error("Expected IEEE/IEC vector glyphs on breaker, surge arrester, fault, and converter bridge cells");
  }

  // 15. Test Phase 9 Full Apparatus Modelica & SSP Projections + Live EmtSolver Pipeline Runner
  console.log("15. Testing Full Apparatus Modelica & SSP Projections + Live EmtSolver Pipeline Runner...");
  const appMo = pscadToModelica(appProj);
  const p8Mo = pscadToModelica(parsePscx(phase8Pscx));
  if (
    !appMo.includes("SM1_emf") ||
    !appMo.includes("SM1_Lsub") ||
    !appMo.includes("VSC1_vconv") ||
    !appMo.includes("ZDiode MOV1") ||
    !appMo.includes("FLT1_sw") ||
    !appMo.includes("BRK1_trip")
  ) {
    throw new Error(
      "Expected pscadToModelica(appProj) to project synchronous machine, VSC bridge, MOV arrester, fault, and timed breaker equations",
    );
  }
  if (!p8Mo.includes("AuxPumpMotor_Req") || !p8Mo.includes("WindDFIG1_Ltr")) {
    throw new Error(
      "Expected pscadToModelica(phase8Pscx) to project squirrel-cage and DFIG induction machine equations",
    );
  }

  const appSsd = pscadToSsd(appProj);
  const p8Ssd = pscadToSsd(parsePscx(phase8Pscx));
  if (
    !appSsd.includes('name="SM1"') ||
    !appSsd.includes('source="resources/SyncMachine_6thOrder.fmu"') ||
    !appSsd.includes('name="VSC1"') ||
    !appSsd.includes('source="resources/Converter_vsc_pwm.fmu"')
  ) {
    throw new Error("Expected pscadToSsd(appProj) to emit SSD FMU components for SM1 and VSC1");
  }
  if (
    !p8Ssd.includes('source="resources/WindDFIG_5thOrder.fmu"') ||
    !p8Ssd.includes('source="resources/InductionMotor_5thOrder.fmu"')
  ) {
    throw new Error(
      "Expected pscadToSsd(phase8Pscx) to emit SSD FMU components for WindDFIG_5thOrder and InductionMotor_5thOrder",
    );
  }

  // Run full pipeline with live 3-phase EmtSolver via solverRunner
  const livePipelineRes = runPscadSimulationPipeline({
    documentText: apparatusPscx,
    runSimulation: true,
    verifyIeee2800: true,
    solverRunner: (circuit, opts) => {
      const solver = new EmtSolver(circuit as any, {
        timeStepSec: opts.timeStepSec,
        durationSec: opts.durationSec,
        threePhase: opts.threePhase,
        steadyStateInit: true,
        maxNonlinearIterations: 6,
      });
      return solver.solve();
    },
  });

  if (
    !livePipelineRes.simulationResult ||
    livePipelineRes.simulationResult.time.length < 500 ||
    !livePipelineRes.simulationResult.busVoltages.has("HVBus") ||
    !livePipelineRes.complianceReport ||
    !livePipelineRes.comtrade
  ) {
    throw new Error(
      "Expected runPscadSimulationPipeline with live EmtSolver solverRunner to produce full trajectory, COMTRADE, and IEEE 2800 report",
    );
  }

  console.log("ALL TESTS PASSED SUCCESSFULLY! Milestones 1, 2, 3, 4 & 5 + Phases 1-9 SOTA verified.");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
