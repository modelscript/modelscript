// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  COORDINATOR_SCENARIOS,
  evaluateCoordinatorScenario,
  evaluatePolyglotDigitalThreadFromFiles,
} from "../docs/.vitepress/theme/util/semantic-coordinator-engine.js";
import {
  compileTargetToSource,
  compileWorkflowPair,
  inspectPairSemanticEnvelope,
} from "../docs/.vitepress/theme/util/workflow-compiler.js";
import {
  computeMinimalTextEdits,
  extractSemanticSpans,
  getTggTargetComponentMetadata,
  highlightWorkflowCode,
  lintWorkflowCode,
  MODELICA_GRAMMAR_VOCAB,
  queryWasmLspIntelligence,
  SCAD_GRAMMAR_VOCAB,
  STEP_GRAMMAR_VOCAB,
  SYSML_GRAMMAR_VOCAB,
} from "../docs/.vitepress/theme/util/workflow-highlighter.js";

describe("@modelscript/docs workflow-compiler", () => {
  it("compiles all 6 live browser workflow pairs and supports bidirectional edits", () => {
    const r1 = compileWorkflowPair(
      "reqif-sysml",
      `<SPEC-OBJECT IDENTIFIER="REQ-BRAKE-01" LONG-NAME="Braking Distance">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>Vehicle braking_distance must be &lt;= 30 m. ASIL-D.</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`,
    );
    assert.strictEqual(r1.error, undefined);
    assert.ok(r1.code.includes("require constraint { braking_distance <= 30 }"));

    const rev1 = compileTargetToSource(
      "reqif-sysml",
      r1.code.replace("require constraint { braking_distance <= 30 }", "require constraint { braking_distance <= 25 }"),
    );
    assert.strictEqual(rev1.error, undefined);
    assert.ok(rev1.code.includes("&lt;= 25 m"));

    const r2 = compileWorkflowPair(
      "simulink-modelica",
      `<System Name="SuspensionControl">
  <Block BlockType="Inport" Name="DamperError"/>
  <Block BlockType="DiscreteFilter" Name="LeadLag">
    <P Name="Numerator">[0.2, -0.15]</P>
    <P Name="Denominator">[1.0, -0.95]</P>
    <P Name="SampleTime">0.002</P>
  </Block>
  <Block BlockType="Outport" Name="ActuatorCmd"/>
  <Line><P Name="Src">DamperError#out:1</P><P Name="Dst">LeadLag#in:1</P></Line>
  <Line><P Name="Src">LeadLag#out:1</P><P Name="Dst">ActuatorCmd#in:1</P></Line>
</System>`,
    );
    assert.strictEqual(r2.error, undefined);
    assert.ok(
      r2.code.includes(
        "Modelica.Blocks.Discrete.TransferFunction LeadLag(b={0.2, -0.15}, a={1, -0.95}, samplePeriod=0.002);",
      ),
    );

    const r3 = compileWorkflowPair(
      "autosar-sysml",
      `<APPLICATION-SW-COMPONENT-TYPE>
  <SHORT-NAME>SteeringController</SHORT-NAME>
  <PORTS>
    <R-PORT-PROTOTYPE><SHORT-NAME>WheelAngleReq</SHORT-NAME></R-PORT-PROTOTYPE>
    <P-PORT-PROTOTYPE><SHORT-NAME>MotorTorqueCmd</SHORT-NAME></P-PORT-PROTOTYPE>
  </PORTS>
  <INTERNAL-BEHAVIORS>
    <SWC-INTERNAL-BEHAVIOR>
      <SHORT-NAME>Steering_IB</SHORT-NAME>
      <RUNNABLES>
        <RUNNABLE-ENTITY><SHORT-NAME>RE_ComputeTorque</SHORT-NAME></RUNNABLE-ENTITY>
      </RUNNABLES>
    </SWC-INTERNAL-BEHAVIOR>
  </INTERNAL-BEHAVIORS>
</APPLICATION-SW-COMPONENT-TYPE>`,
    );
    assert.strictEqual(r3.error, undefined);
    assert.ok(r3.code.includes("action RE_ComputeTorque;"));

    const r4 = compileWorkflowPair(
      "urdf-modelica",
      `<robot name="Arm6DOF">
  <link name="upper_arm"><inertial><mass value="5.0"/></inertial></link>
  <link name="forearm"><inertial><mass value="2.1"/></inertial></link>
  <joint name="elbow_flex" type="revolute">
    <parent link="upper_arm"/>
    <child link="forearm"/>
    <axis xyz="0 1 0"/>
  </joint>
</robot>`,
    );
    assert.strictEqual(r4.error, undefined);
    assert.ok(r4.code.includes("Parts.Body upper_arm(m = 5, I_11 = 0.5, I_22 = 0.5, I_33 = 0.5);"));

    const r5 = compileWorkflowPair(
      "pscad-ieee",
      `<project name="SolarPlant_250MW" version="5.0">
  <Bus name="POI" id="B1" vbase="34.5"/>
  <Component name="PV_Array_Inverter" defn="ibr" id="4521">
    <param name="V_nom" value="34.5"/>
    <param name="P_rated" value="250.0"/>
    <param name="LVRT_mode" value="IEEE2800_Standard"/>
  </Component>
</project>`,
    );
    assert.strictEqual(r5.error, undefined);
    assert.ok(r5.code.includes("Overall Result: [PASS]"));

    const r5Trip = compileWorkflowPair(
      "pscad-ieee",
      `<project name="SolarPlant_250MW" version="5.0">
  <Bus name="POI" id="B1" vbase="34.5"/>
  <Component name="PV_Array_Inverter" defn="ibr" id="4521">
    <param name="V_nom" value="34.5"/>
    <param name="P_rated" value="250.0"/>
    <param name="LVRT_mode" value="Trip_On_Sag"/>
  </Component>
</project>`,
    );
    assert.strictEqual(r5Trip.error, undefined);
    assert.ok(r5Trip.code.includes("Overall Result: [FAIL]"));

    const r6 = compileWorkflowPair(
      "sysml-ssp",
      `model DC_Motor
  parameter Real R = 0.5 "Armature resistance (Ohm)";
  parameter Real Ke = 0.08 "Back-EMF constant (V.s/rad)";
  input Real v_in;
  output Real omega(start = 0.0);
equation
  der(omega) = (Ke * (v_in - Ke * omega) / R - 0.01 * omega) / 0.002;
end DC_Motor;`,
    );
    assert.strictEqual(r6.error, undefined);
    assert.ok(r6.code.includes('<Float64 name="v_in" valueReference="2" causality="input"'));
    assert.ok(r6.code.includes('derivative="4"'));
  });

  it("executes all 6 workflow pairs forward and backward with adversarial comments & XML preservation", () => {
    // 1. reqif-sysml (with XML comment and block comment in SysML)
    const reqifXml = `<!-- ReqIF Header Comment -->
<SPEC-OBJECT IDENTIFIER="REQ-BRAKE-01" LONG-NAME="Braking Distance" LAST-CHANGE="2026-11-07T00:00:00Z">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>Vehicle braking_distance from 100 km/h must be &lt;= 35.0 m. ASIL-D.</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`;
    const fwd1 = compileWorkflowPair("reqif-sysml", reqifXml);
    assert.equal(fwd1.error, undefined);
    const bwd1 = compileTargetToSource(
      "reqif-sysml",
      `/* Fake block comment: requirement def IGNORED { require constraint { d <= 999 } } */\n` +
        fwd1.code.replaceAll("35", "30").replaceAll("ASIL-D", "ASIL-C"),
      reqifXml,
    );
    assert.equal(bwd1.error, undefined);
    assert.ok(bwd1.code.includes("<!-- ReqIF Header Comment -->"));
    assert.ok(bwd1.code.includes('LAST-CHANGE="2026-11-07T00:00:00Z"'));
    assert.ok(bwd1.code.includes("&lt;= 30 m. ASIL-C."));

    // 2. simulink-modelica (with multi-line Modelica component declaration and XML comment)
    const slxXml = `<System Name="FlightControl">
  <!-- Simulink Filter Comment -->
  <Block BlockType="DiscreteFilter" Name="LeadFilter" SID="1">
    <P Name="Numerator">[1.0, -0.85]</P>
    <P Name="Denominator">[1.0, -0.95]</P>
    <P Name="SampleTime">0.002</P>
  </Block>
  <Block BlockType="Gain" Name="Kp" SID="2">
    <P Name="Gain">4.5</P>
  </Block>
  <Line>
    <P Name="Src">LeadFilter#out:1</P>
    <P Name="Dst">Kp#in:1</P>
  </Line>
</System>`;
    const fwd2 = compileWorkflowPair("simulink-modelica", slxXml);
    assert.equal(fwd2.error, undefined);
    const multiLineMo = `model FlightControl
  /* Multi-line declaration with inline comment */
  Modelica.Blocks.Discrete.TransferFunction LeadFilter(
    b = {1.0, -0.75}, // tuned numerator
    a = {1.0, -0.95},
    samplePeriod = 0.005
  );
  Modelica.Blocks.Math.Gain Kp(
    k = 6.0
  );
equation
  connect(
    LeadFilter.y,
    Kp.u
  );
end FlightControl;`;
    const bwd2 = compileTargetToSource("simulink-modelica", multiLineMo, slxXml);
    assert.equal(bwd2.error, undefined);
    assert.ok(bwd2.code.includes("<!-- Simulink Filter Comment -->"));
    assert.ok(bwd2.code.includes('<P Name="Numerator">[1.0, -0.75]</P>'));
    assert.ok(bwd2.code.includes('<P Name="SampleTime">0.005</P>'));
    assert.ok(bwd2.code.includes('<P Name="Gain">6.0</P>'));

    // 3. autosar-sysml (preserving <REQUIRED-INTERFACE-TREF> and <SYMBOL> in ARXML)
    const arxml = `<APPLICATION-SW-COMPONENT-TYPE>
  <SHORT-NAME>BrakeController</SHORT-NAME>
  <PORTS>
    <R-PORT-PROTOTYPE>
      <SHORT-NAME>WheelSpeed</SHORT-NAME>
      <REQUIRED-INTERFACE-TREF DEST="SENDER-RECEIVER-INTERFACE">/Interfaces/IF_WheelSpeed</REQUIRED-INTERFACE-TREF>
    </R-PORT-PROTOTYPE>
    <P-PORT-PROTOTYPE>
      <SHORT-NAME>BrakeTorque</SHORT-NAME>
    </P-PORT-PROTOTYPE>
  </PORTS>
  <INTERNAL-BEHAVIORS>
    <SWC-INTERNAL-BEHAVIOR>
      <SHORT-NAME>IB_Brake</SHORT-NAME>
      <RUNNABLES>
        <RUNNABLE-ENTITY>
          <SHORT-NAME>Runnable_Step_10ms</SHORT-NAME>
          <SYMBOL>Brake_Step_10ms</SYMBOL>
        </RUNNABLE-ENTITY>
      </RUNNABLES>
    </SWC-INTERNAL-BEHAVIOR>
  </INTERNAL-BEHAVIORS>
</APPLICATION-SW-COMPONENT-TYPE>`;
    const fwd3 = compileWorkflowPair("autosar-sysml", arxml);
    assert.equal(fwd3.error, undefined);
    const bwd3 = compileTargetToSource(
      "autosar-sysml",
      fwd3.code.replace("out port BrakeTorque;", "out port BrakeTorque;\n    out port YawRateCmd;"),
      arxml,
    );
    assert.equal(bwd3.error, undefined);
    assert.ok(bwd3.code.includes("/Interfaces/IF_WheelSpeed"));
    assert.ok(bwd3.code.includes("<SYMBOL>Brake_Step_10ms</SYMBOL>"));
    assert.ok(bwd3.code.includes("<SHORT-NAME>YawRateCmd</SHORT-NAME>"));

    // 4. urdf-modelica (multi-line Body with reordered modifiers and preserved <limit>)
    const urdfXml = `<robot name="manipulator_2dof">
  <!-- Base Link -->
  <link name="base_link">
    <inertial><mass value="4.0"/><inertia ixx="0.4" ixy="0" ixz="0" iyy="0.4" iyz="0" izz="0.4"/></inertial>
  </link>
  <link name="upper_arm">
    <inertial><mass value="2.5"/><inertia ixx="0.25" ixy="0.01" ixz="0" iyy="0.25" iyz="0" izz="0.25"/></inertial>
  </link>
  <joint name="shoulder_pitch" type="revolute">
    <parent link="base_link"/>
    <child link="upper_arm"/>
    <axis xyz="0 1 0"/>
    <limit lower="-1.57" upper="1.57" effort="120" velocity="3.0"/>
  </joint>
</robot>`;
    const fwd4 = compileWorkflowPair("urdf-modelica", urdfXml);
    assert.equal(fwd4.error, undefined);
    const bwd4 = compileTargetToSource(
      "urdf-modelica",
      fwd4.code.replace("m = 2.5, I_11 = 0.25", "I_11 = 0.5, m = 5.0"),
      urdfXml,
    );
    assert.equal(bwd4.error, undefined);
    assert.ok(bwd4.code.includes("<!-- Base Link -->"));
    assert.ok(bwd4.code.includes('<mass value="5"/>'));
    assert.ok(bwd4.code.includes('ixy="0.01"'));
    assert.ok(bwd4.code.includes('effort="120"'));

    // 5. sysml-ssp (Modelica <-> FMI 3.0)
    const moCode = `model DC_Motor
  parameter Real R = 0.5 "Armature resistance (Ohm)";
  parameter Real L = 0.01 "Armature inductance (H)";
  parameter Real Ke = 0.08 "Back-EMF constant (V.s/rad)";
  input Real v_in;
  output Real omega(start = 0.0);
  Real i_a(start = 0.0);
equation
  L * der(i_a) = v_in - R * i_a - Ke * omega;
  0.002 * der(omega) = Ke * i_a - 0.01 * omega;
end DC_Motor;`;
    const fwd5 = compileWorkflowPair("sysml-ssp", moCode);
    assert.equal(fwd5.error, undefined);
    const bwd5 = compileTargetToSource("sysml-ssp", fwd5.code.replace('start="0.5"', 'start="0.75"'), moCode);
    assert.equal(bwd5.error, undefined);
    assert.ok(bwd5.code.includes('parameter Real R = 0.75 "Armature resistance (Ohm)";'));

    // 6. pscad-ieee (PSCAD <-> IEEE 2800 Compliance with bidirectional tggInvertible gain synthesis)
    const pscadCode = `<project name="SolarPlant_250MW" version="5.0">
  <!-- PSCAD Topology Comment -->
  <Bus name="POI" id="B1" vbase="34.5"/>
  <Component name="PV_Array_Inverter" defn="ibr" id="4521">
    <param name="V_nom" value="34.5"/>
    <param name="P_rated" value="250.0"/>
    <param name="LVRT_mode" value="IEEE2800_Standard"/>
    <param name="Kp_v" value="2.5"/>
    <param name="Ki_v" value="15.0"/>
  </Component>
</project>`;
    const fwd6 = compileWorkflowPair("pscad-ieee", pscadCode);
    assert.equal(fwd6.error, undefined);
    assert.ok(fwd6.code.includes("[PASS]"));
    assert.ok(fwd6.code.includes("T_step <= 50 ms"));
    assert.ok(fwd6.code.includes("I_post / I_pre = 93.8%"));

    // Edit IEEE 2800 report targets: T_step = 15.0 ms -> Kp_v = 45/15 = 3; I_post/I_pre = 95.0% -> Ki_v = (95-90)*4 = 20
    const editedReport = fwd6.code
      .replace("Report for 'SolarPlant_250MW'", "Report for 'SolarPlant_300MW'")
      .replace("T_step <= 50 ms", "T_step = 15.0 ms")
      .replace("I_post / I_pre = 93.8%", "I_post / I_pre = 95.0%");
    const bwd6 = compileTargetToSource("pscad-ieee", editedReport, pscadCode);
    assert.equal(bwd6.error, undefined);
    assert.ok(bwd6.code.includes("<!-- PSCAD Topology Comment -->"));
    assert.ok(bwd6.code.includes('name="SolarPlant_300MW"'));
    assert.ok(bwd6.code.includes('<param name="Kp_v" value="3"/>'));
    assert.ok(bwd6.code.includes('<param name="Ki_v" value="20"/>'));

    // Re-projecting updated PSCAD XML forward reflects T_step = 15.0 ms and 95.0% recovery
    const fwd6RoundTrip = compileWorkflowPair("pscad-ieee", bwd6.code);
    assert.equal(fwd6RoundTrip.error, undefined);
    assert.ok(fwd6RoundTrip.code.includes("Report for 'SolarPlant_300MW'"));
    assert.ok(fwd6RoundTrip.code.includes("T_step = 15.0 ms"));
    assert.ok(fwd6RoundTrip.code.includes("I_post / I_pre = 95.0%"));
  });

  it("proves every TGG rule across all 6 workflow pairs is lossless within its semantic envelope and enforces conflict resolution strategies", () => {
    const pairIds = ["reqif-sysml", "simulink-modelica", "autosar-sysml", "urdf-modelica", "pscad-ieee", "sysml-ssp"];
    for (const pairId of pairIds) {
      const env = inspectPairSemanticEnvelope(pairId);
      assert.ok(env.ruleCount > 0, `Pair ${pairId} must declare TGG rules`);
      for (const rule of env.rules) {
        assert.notStrictEqual(
          rule.status,
          "INFORMATION_LOSS",
          `Rule ${rule.name} in ${pairId} leaked unmapped attributes`,
        );
      }
      assert.notStrictEqual(env.losslessnessStatus, "INFORMATION_LOSS");
    }

    // Verify conflict resolution strategy ("source-wins" vs "physics-simplex")
    const reqifOrig = `<SPEC-OBJECT IDENTIFIER="REQ-BRAKE-01" LONG-NAME="Braking Distance">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>Vehicle braking_distance must be &lt;= 30 m. ASIL-D.</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`;
    const fwdReq = compileWorkflowPair("reqif-sysml", reqifOrig);
    const editedSysml = fwdReq.code.replace("braking_distance <= 30", "braking_distance <= 50");

    const sourceWins = compileTargetToSource("reqif-sysml", editedSysml, reqifOrig, "source-wins");
    assert.ok(sourceWins.code.includes("&lt;= 30 m"), "source-wins must retain original 30 m limit");

    const physicsSimplex = compileTargetToSource("reqif-sysml", editedSysml, reqifOrig, "physics-simplex");
    assert.ok(physicsSimplex.code.includes("&lt;= 40 m"), "physics-simplex must reconcile midpoint (30 + 50) / 2 = 40 m");
  });

  it("tokenizes pre-computed syntax + semantic tokens (Prong 1) and Monaco semantic spans + TGG envelope lints (Prong 2)", () => {
    const motorMo = `model DC_Motor
  parameter Real R = 0.5 "Armature resistance (Ohm)";
  parameter Real Ke = 0.08 "Back-EMF constant (V.s/rad)";
  input Real v_in;
  output Real omega(start = 0.0);
equation
  der(omega) = (Ke * (v_in - Ke * omega) / R - 0.01 * omega) / 0.002;
end DC_Motor;`;

    // 1. Prong 1: Pre-computed syntax + semantic token HTML
    const moLines = highlightWorkflowCode(motorMo, "modelica");
    const moJoined = moLines.join("\n");
    assert.ok(moJoined.includes('class="tok-keyword">model<'), "Modelica keyword highlighted");
    assert.ok(moJoined.includes('class="tok-semantic-class">DC_Motor<'), "Modelica class semantic token");
    assert.ok(moJoined.includes('class="tok-semantic-param">R<'), "Modelica parameter semantic token");
    assert.ok(moJoined.includes('class="tok-semantic-port">v_in<'), "Modelica input port semantic token");
    assert.ok(moJoined.includes('class="tok-semantic-state">omega<'), "Modelica continuous state semantic token");

    const sysmlCode = `package AutosarArchitecture {
  part def SteeringController {
    in port WheelAngleReq;
    out port MotorTorqueCmd;
    action RE_ComputeTorque;
  }
}`;
    const sysmlJoined = highlightWorkflowCode(sysmlCode, "sysml").join("\n");
    assert.ok(sysmlJoined.includes('class="tok-semantic-class">SteeringController<'));
    assert.ok(sysmlJoined.includes('class="tok-semantic-port">WheelAngleReq<'));
    assert.ok(sysmlJoined.includes('class="tok-semantic-component">RE_ComputeTorque<'));

    const xmlCode = `<robot name="Arm6DOF"><link name="upper_arm"><inertial><mass value="4.2"/></inertial></link></robot>`;
    const xmlJoined = highlightWorkflowCode(xmlCode, "xml").join("\n");
    assert.ok(xmlJoined.includes('class="tok-tag">robot<'));
    assert.ok(xmlJoined.includes('class="tok-semantic-class">&quot;Arm6DOF&quot;<'));
    assert.ok(xmlJoined.includes('class="tok-semantic-param">&quot;4.2&quot;<'));

    const ieeeCode = `Overall Result: [PASS]\n• [PASS] Clause 5.4.1: T_step <= 50 ms`;
    const ieeeJoined = highlightWorkflowCode(ieeeCode, "text").join("\n");
    assert.ok(ieeeJoined.includes('class="tok-pass">[PASS]<'));
    assert.ok(ieeeJoined.includes('class="tok-semantic-class">Clause 5.4.1<'));
    assert.ok(ieeeJoined.includes('class="tok-semantic-param">T_step<'));

    // 2. Prong 2: Monaco DocumentSemanticTokensProvider & HoverProvider spans
    const spans = extractSemanticSpans(motorMo, "modelica");
    const omegaSpan = spans.find((s) => s.kind === "state");
    assert.ok(omegaSpan, "omega classified as state semantic span");
    assert.ok(omegaSpan.hoverMarkdown?.includes("Continuous State"));

    const rSpan = spans.find((s) => s.kind === "parameter" && s.hoverMarkdown?.includes("Armature resistance"));
    assert.ok(rSpan, "R classified as parameter semantic span with docstring hover");

    // 2b. Verify @modelscript/dsl SYNTAX_NAMES grammar vocabularies & native WASM LspFacade intelligence
    assert.ok(MODELICA_GRAMMAR_VOCAB.keywords.has("equation"));
    assert.ok(MODELICA_GRAMMAR_VOCAB.keywords.has("parameter"));
    assert.ok(SYSML_GRAMMAR_VOCAB.keywords.has("requirement"));
    assert.ok(SYSML_GRAMMAR_VOCAB.keywords.has("satisfy"));
    const omegaIntel = queryWasmLspIntelligence(motorMo, "modelica", 6, 36); // cursor on `omega` in equation
    assert.ok(omegaIntel.definitionRange, "WASM LspFacade.getDefinition resolves omega declaration");
    assert.strictEqual(omegaIntel.definitionRange.startLine, 5);
    assert.ok(omegaIntel.referenceRanges.length >= 3, "WASM LspFacade.getReferences finds omega occurrences");

    const rIntel = queryWasmLspIntelligence(motorMo, "modelica", 6, 43); // cursor on `R` in equation
    assert.ok(rIntel.definitionRange, "WASM LspFacade.getDefinition resolves R declaration");
    assert.strictEqual(rIntel.definitionRange.startLine, 2);
    assert.ok(rIntel.referenceRanges.length >= 2, "WASM LspFacade.getReferences finds R occurrences");

    // 3. Live Compiler & TGG Physical Envelope Linter
    assert.strictEqual(lintWorkflowCode("sysml-ssp", "source", motorMo).length, 0);

    // Non-positive resistance triggers M3001 physical envelope error
    const badMotor = motorMo.replace("parameter Real R = 0.5", "parameter Real R = 0");
    const motorDiags = lintWorkflowCode("sysml-ssp", "source", badMotor);
    assert.ok(motorDiags.some((d) => d.code === "M3001" && d.severity === "error"));

    // Modelica begin/end mismatch triggers M2005
    const mismatchMotor = motorMo.replace("end DC_Motor;", "end WrongName;");
    assert.ok(lintWorkflowCode("sysml-ssp", "source", mismatchMotor).some((d) => d.code === "M2005"));

    // Negative URDF mass triggers TGG-PHYS-04
    const badUrdf = `<robot name="Arm"><link name="l1"><inertial><mass value="-3.5"/></inertial></link></robot>`;
    assert.ok(lintWorkflowCode("urdf-modelica", "source", badUrdf).some((d) => d.code === "TGG-PHYS-04"));

    // Non-positive Simulink SampleTime triggers TGG-PHYS-02
    const badSlx = `<System Name="S"><Block BlockType="DiscreteFilter" Name="F"><P Name="SampleTime">-0.001</P></Block></System>`;
    assert.ok(lintWorkflowCode("simulink-modelica", "source", badSlx).some((d) => d.code === "TGG-PHYS-02"));

    // Unclosed XML tag triggers XML-1002
    const unclosedXml = `<robot name="Arm"><link name="l1"></robot>`;
    assert.ok(lintWorkflowCode("urdf-modelica", "source", unclosedXml).some((d) => d.code === "XML-1002"));

    // Missing semicolon in Modelica triggers M1002
    const missingSemiMo = motorMo.replace("input Real v_in;", "input Real v_in");
    assert.ok(lintWorkflowCode("sysml-ssp", "source", missingSemiMo).some((d) => d.code === "M1002"));

    // Unbalanced parentheses in Modelica equation triggers M1001
    const unbalancedParenMo = motorMo.replace("(Ke * (v_in - Ke * omega)", "(Ke * ((v_in - Ke * omega)");
    assert.ok(lintWorkflowCode("sysml-ssp", "source", unbalancedParenMo).some((d) => d.code === "M1001"));

    // Undeclared variable in Modelica equation triggers M2002
    const undeclaredVarMo = motorMo.replace("v_in - Ke", "v_unknown - Ke");
    assert.ok(lintWorkflowCode("sysml-ssp", "source", undeclaredVarMo).some((d) => d.code === "M2002"));

    // Missing semicolon in SysML v2 triggers SYSML-1002
    const missingSemiSysml = sysmlCode.replace("in port WheelAngleReq;", "in port WheelAngleReq");
    assert.ok(lintWorkflowCode("autosar-sysml", "target", missingSemiSysml).some((d) => d.code === "SYSML-1002"));

    // Malformed require constraint in SysML v2 triggers SYSML-1003
    const badReqSysml = `package P {\n  requirement <'R1'> 'Brake' {\n    require constraint { <= 30 }\n  }\n}`;
    assert.ok(lintWorkflowCode("reqif-sysml", "target", badReqSysml).some((d) => d.code === "SYSML-1003"));

    // Malformed XML attribute without quotes triggers XML-1004
    const badAttrXml = `<robot name=Arm6DOF><link name="base"/></robot>`;
    assert.ok(lintWorkflowCode("urdf-modelica", "source", badAttrXml).some((d) => d.code === "XML-1004"));

    // Stray text inside XML container triggers XML-1005
    const strayTextXml = `<robot name="Arm6DOF">\n  strayinvalidtoken\n  <link name="base"/>\n</robot>`;
    assert.ok(lintWorkflowCode("urdf-modelica", "source", strayTextXml).some((d) => d.code === "XML-1005"));

    // Undeclared URDF link reference in joint triggers URDF-2002
    const undeclaredLinkUrdf = `<robot name="Arm"><link name="base"/><joint name="j1" type="revolute"><parent link="base"/><child link="missing_arm"/></joint></robot>`;
    assert.ok(lintWorkflowCode("urdf-modelica", "source", undeclaredLinkUrdf).some((d) => d.code === "URDF-2002"));

    // Malformed Simulink connection endpoint triggers SIMULINK-1004
    const badEndpointSlx = `<System Name="S"><Block BlockType="Gain" Name="G"/><Line><P Name="Src">G</P><P Name="Dst">G#in:1</P></Line></System>`;
    assert.ok(lintWorkflowCode("simulink-modelica", "source", badEndpointSlx).some((d) => d.code === "SIMULINK-1004"));

    // Declarative TGG backward pattern matching + tggReconcilePhysics on target panes
    const badSysmlConstraint = `requirement def <'REQ-1'> Braking_Def {\n  doc /* Must stop */\n  require constraint { braking_distance <= -5 }\n}`;
    assert.ok(lintWorkflowCode("reqif-sysml", "target", badSysmlConstraint).some((d) => d.code === "TGG-PHYS-01"));

    const badMoTransferFn = `model S\n  Modelica.Blocks.Discrete.TransferFunction F(b={1}, a={1}, samplePeriod=-0.01);\nend S;`;
    assert.ok(lintWorkflowCode("simulink-modelica", "target", badMoTransferFn).some((d) => d.code === "TGG-PHYS-02"));

    const badMoBody = `model Arm\n  Parts.Body l1(m = -2.0, I_11 = 0.1, I_22 = 0.1, I_33 = 0.1);\nend Arm;`;
    assert.ok(lintWorkflowCode("urdf-modelica", "target", badMoBody).some((d) => d.code === "TGG-PHYS-04"));

    // PSCAD native linter M6003 on non-positive V_nom and backward tggInvertible on IEEE 2800 Clauses 5.4.1 & 7.2.2
    const badPscad = `<project name="Solar"><Component name="IBR" defn="ibr" id="1"><param name="V_nom" value="-10"/></Component></project>`;
    assert.ok(lintWorkflowCode("pscad-ieee", "source", badPscad).some((d) => d.code === "M6003"));

    const badIeeeReport = [
      "IEEE 2800-2022 Interconnection Verification Report for 'Solar':",
      "Overall Result: [FAIL]",
      "• [FAIL] Clause 5.4.1 (Reactive Current Injection): T_step <= 65 ms [Limit: <= 50 ms]",
      "• [FAIL] Clause 7.2.2.3.5 (Active Power Recovery): I_post / I_pre = 82% [Limit: >= 90%]",
    ].join("\n");
    const ieeeDiags = lintWorkflowCode("pscad-ieee", "target", badIeeeReport);
    assert.ok(ieeeDiags.some((d) => d.code === "IEEE2800-5.4.1"));
    assert.ok(ieeeDiags.some((d) => d.code === "IEEE2800-7.2.2"));

    // 4. Native SCAD & STEP WASM GLR CST spans + FEA/CFD dialect parsers + declarative TGG metadata
    assert.ok(SCAD_GRAMMAR_VOCAB.keywords.has("module"));
    assert.ok(STEP_GRAMMAR_VOCAB.keywords.has("DATA"));
    const scadSpans = extractSemanticSpans(
      COORDINATOR_SCENARIOS[0]!.panes[2].defaultCode,
      "scad",
    );
    assert.ok(
      scadSpans.some((s) => s.kind === "class" && s.hoverMarkdown?.includes("OpenSCAD")),
      "SCAD WASM GLR CST extracts module declaration spans",
    );
    assert.ok(
      scadSpans.some((s) => s.kind === "parameter" && s.hoverMarkdown?.includes("flange_thickness")),
      "SCAD WASM GLR CST extracts variable assignment spans",
    );

    const stepSpans = extractSemanticSpans(
      COORDINATOR_SCENARIOS[2]!.panes[3].defaultCode,
      "step",
    );
    assert.ok(
      stepSpans.some((s) => s.kind === "port" && s.hoverMarkdown?.includes("#11")),
      "STEP WASM GLR CST extracts entity instance #11 span",
    );
    assert.ok(
      stepSpans.some((s) => s.kind === "class" && s.hoverMarkdown?.includes("STEP AP242 Entity")),
      "STEP WASM GLR CST extracts entity type spans",
    );

    const feaSpans = extractSemanticSpans(
      COORDINATOR_SCENARIOS[0]!.panes[3].defaultCode,
      "fea",
    );
    assert.ok(
      feaSpans.some((s) => s.hoverMarkdown?.includes("CalculiX")),
      "FEA dialect parser enriches CalculiX .inp spans",
    );

    const cfdSpans = extractSemanticSpans(
      COORDINATOR_SCENARIOS[1]!.panes[2].defaultCode,
      "cfd",
    );
    assert.ok(
      cfdSpans.some((s) => s.hoverMarkdown?.includes("OpenFOAM")),
      "CFD dialect parser enriches OpenFOAM dictionary spans",
    );

    const tggMeta = getTggTargetComponentMetadata();
    assert.ok(tggMeta.get("TransferFunction")?.modifiers.includes("samplePeriod"));
    assert.ok(tggMeta.get("Body")?.modifiers.includes("m"));
    assert.ok(tggMeta.get("Revolute")?.modifiers.includes("n"));
  });

  it("computes surgical narrow delta edits (computeMinimalTextEdits) instead of full-buffer replacement", () => {
    const before = `model DC_Motor
  parameter Real R = 0.5 "Armature resistance (Ohm)";
  parameter Real L = 0.01 "Armature inductance (H)";
  input Real v_in;
end DC_Motor;`;
    const after = `model DC_Motor
  parameter Real R = 0.75 "Armature resistance (Ohm)";
  parameter Real L = 0.01 "Armature inductance (H)";
  input Real v_in;
end DC_Motor;`;

    const edits = computeMinimalTextEdits(before, after);
    assert.strictEqual(edits.length, 1, "Single line value change produces exactly 1 narrow edit");
    assert.strictEqual(edits[0]!.startLine, 2, "Edit targets only line 2");
    assert.strictEqual(edits[0]!.endLine, 2, "Edit ends on line 2");
    assert.strictEqual(edits[0]!.startCol, edits[0]!.endCol, "Common suffix '5' is preserved so '7' is inserted in-place");
    assert.strictEqual(edits[0]!.text, "7", "Only the single inserted character '7' is spliced before '5'");

    const afterReplace = before.replace("R = 0.5", "R = 0.82");
    const replaceEdits = computeMinimalTextEdits(before, afterReplace);
    assert.strictEqual(replaceEdits.length, 1);
    assert.strictEqual(replaceEdits[0]!.text, "82", "Replaces '5' with '82' on line 2");

    // Identical text produces zero edits
    assert.strictEqual(computeMinimalTextEdits(before, before).length, 0);
  });

  it("evaluates all 3 4-language SemanticTheoryCoordinator scenarios and detects cross-domain conflicts", () => {
    assert.strictEqual(COORDINATOR_SCENARIOS.length, 3);

    for (const scenario of COORDINATOR_SCENARIOS) {
      assert.strictEqual(scenario.panes.length, 4);
      const defaults: [string, string, string, string] = [
        scenario.panes[0].defaultCode,
        scenario.panes[1].defaultCode,
        scenario.panes[2].defaultCode,
        scenario.panes[3].defaultCode,
      ];

      // 1. Nominal baseline must be SAT across all 4 theory oracles and parse FQN bindings
      const nomRes = evaluateCoordinatorScenario(scenario.id, defaults, 0);
      assert.strictEqual(
        nomRes.isSat,
        true,
        `${scenario.id} nominal baseline should be SAT (got ${nomRes.variableLinks.map((l) => `${l.symbol}=${l.valueFormatted}`).join(", ")})`,
      );
      assert.strictEqual(nomRes.status, "SAT");
      assert.strictEqual(nomRes.conflicts.length, 0);
      assert.strictEqual(nomRes.variableLinks.length, 4);
      assert.ok(nomRes.parsedSysmlReqCount >= 1, `Expected SysML v2 requirement parsed in ${scenario.id}`);
      assert.ok(nomRes.parsedModelicaTwinCount >= 2, `Expected Modelica annotation(twin=...) parsed in ${scenario.id}`);
      assert.ok(nomRes.variableLinks.every((l) => l.status === "SAT"));
      assert.ok(nomRes.variableLinks.every((l) => l.canonicalFqn.includes("::")));
      assert.ok(nomRes.variableLinks.every((l) => l.domainBindings.length >= 2));
      assert.ok(nomRes.hypergraphNodes.every((n) => n.status === "SYNCED" && n.namespaceFqn.includes("::")));
      assert.strictEqual(nomRes.paneVisuals.length, 4);
      assert.strictEqual(nomRes.paneVisuals[0].kind, "sysml-bdd");
      assert.ok(nomRes.parsedMetadata.directiveLinks.length >= 4);
      assert.ok(nomRes.parsedMetadata.evaluatedEquations.length >= 1);

      if (scenario.id === "aerospace-actuator") {
        assert.ok(
          nomRes.variableLinks.some((l) =>
            l.domainBindings.some((b) => b.bindingSyntax.includes("FeaSolver.step()")),
          ),
          "Expected live FeaSolver.step() binding in aerospace-actuator",
        );
        assert.strictEqual(nomRes.paneVisuals[1].kind, "modelica-dae");
        assert.strictEqual(nomRes.paneVisuals[2].kind, "scad-3d");
        assert.strictEqual(nomRes.paneVisuals[3].kind, "fea-3d");
        assert.ok(nomRes.paneVisuals[2].triangles.length > 10, "Expected tessellated 3D OpenSCAD triangles");
        assert.ok(nomRes.paneVisuals[2].csgTree.length >= 3, "Expected CSG tree nodes");
        assert.strictEqual(nomRes.parsedMetadata.portBindings.length, 2);
        assert.ok(nomRes.parsedMetadata.portBindings.every((pb) => pb.isBound));
      } else if (scenario.id === "ev-battery-coldplate") {
        assert.ok(
          nomRes.variableLinks.some((l) =>
            l.domainBindings.some((b) => b.bindingSyntax.includes("WebGPULbmRunner.step")),
          ),
          "Expected live WebGPULbmRunner.step() binding in ev-battery-coldplate",
        );
        assert.strictEqual(nomRes.paneVisuals[1].kind, "modelica-dae");
        assert.strictEqual(nomRes.paneVisuals[2].kind, "scad-3d");
        assert.strictEqual(nomRes.paneVisuals[3].kind, "cfd-3d");
        assert.ok(nomRes.paneVisuals[2].triangles.length > 20, "Expected tessellated 3D cold-plate triangles");
        assert.strictEqual(nomRes.parsedMetadata.portBindings.length, 3);
        assert.ok(
          nomRes.parsedMetadata.portBindings.every((pb) => pb.isBound),
          "Expected coolant_inlet, fluid_core, and coolant_outlet bound between OpenSCAD and OpenFOAM",
        );

        // Verify breaking a CAD tag_port name triggers [MSC-PORT-UNBOUND]
        const brokenPortCodes: [string, string, string, string] = [...defaults];
        brokenPortCodes[2] = brokenPortCodes[2].replace(
          'tag_port("fluid_core"',
          'tag_port("renamed_channel_wall"',
        );
        const brokenPortRes = evaluateCoordinatorScenario(scenario.id, brokenPortCodes, 2);
        assert.strictEqual(brokenPortRes.isSat, false, "Broken CAD-CFD port binding must trigger UNSAT");
        assert.ok(
          brokenPortRes.conflicts.some((c) => c.explanation.includes("[MSC-PORT-UNBOUND]")),
          "Expected [MSC-PORT-UNBOUND] conflict when tag_port('fluid_core') is missing",
        );
      } else if (scenario.id === "robotics-gdt-tolerance") {
        assert.strictEqual(nomRes.paneVisuals[1].kind, "urdf-3d");
        assert.strictEqual(nomRes.paneVisuals[2].kind, "modelica-dae");
        assert.strictEqual(nomRes.paneVisuals[3].kind, "step-gdt");
        assert.ok(nomRes.paneVisuals[3].entityCount >= 6);
      }

      // Verify syntax/semantic highlighting for all 4 panes (including scad, fea, cfd, step)
      for (const pane of scenario.panes) {
        assert.ok(pane.namespaceFqn.includes("::"), `Expected namespaceFqn for ${pane.fileName}`);
        const htmlLines = highlightWorkflowCode(pane.defaultCode, pane.lang);
        assert.ok(htmlLines.length >= 4);
        const spans = extractSemanticSpans(pane.defaultCode, pane.lang);
        assert.ok(spans.length > 0, `Expected semantic spans for ${pane.lang} in ${scenario.id}`);
      }

      // 2. Every fault preset must trigger UNSAT, emit ConflictClauses, and flag Hypergraph nodes
      for (const preset of scenario.presets) {
        const { codes, editedPaneIndex } = preset.apply(defaults);
        const res = evaluateCoordinatorScenario(scenario.id, codes, editedPaneIndex);
        if (preset.isFault) {
          assert.strictEqual(
            res.isSat,
            false,
            `Fault preset '${preset.id}' in '${scenario.id}' should be UNSAT (got ${res.variableLinks.map((l) => `${l.symbol}=${l.valueFormatted}`).join(", ")})`,
          );
          assert.strictEqual(res.status, "UNSAT");
          assert.ok(res.conflicts.length >= 1, `Expected conflict clause for '${preset.id}'`);
          assert.ok(
            res.conflicts.every((c) => c.culpritEntities.every((e) => e.includes("::"))),
            `Expected canonical FQN culprit entities for '${preset.id}'`,
          );
          assert.ok(
            res.hypergraphNodes.some((n) => n.status === "CONFLICT"),
            `Expected at least one CONFLICT hypergraph node for '${preset.id}'`,
          );
          const totalDiags = res.paneDiagnostics.reduce((acc, d) => acc + d.length, 0);
          assert.ok(totalDiags >= 2, `Expected cross-pane diagnostics for '${preset.id}'`);
        } else {
          assert.strictEqual(res.isSat, true);
        }
      }

      // 3. Verify Nelson-Oppen sharedEqualities and CLI file-based runner (`evaluatePolyglotDigitalThreadFromFiles`)
      assert.ok(
        nomRes.sharedEqualities.length >= 4,
        `Expected Nelson-Oppen sharedEqualities from SemanticTheoryCoordinator in ${scenario.id}`,
      );
      const cliFiles = scenario.panes.map((p) => ({
        fileName: p.fileName,
        content: p.defaultCode,
      }));
      const cliNom = evaluatePolyglotDigitalThreadFromFiles(cliFiles);
      assert.strictEqual(cliNom.scenarioId, scenario.id);
      assert.strictEqual(cliNom.isSat, true);
    }
  });
});




