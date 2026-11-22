// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMagicDrawDiagram,
  createMdzipArchive,
  createRawZipArchive,
  extractMagicDrawTables,
  getMagicDrawDiagnostics,
  getMagicDrawDocumentSymbols,
  getMagicDrawHover,
  lintMagicDrawDocument,
  lowerMagicDrawParametricsToDae,
  magicDrawActionHandlers,
  magicDrawTggPlan,
  magicDrawToModelica,
  magicDrawToReqif,
  magicDrawToSysml2,
  parseMagicDraw,
  renderMagicDrawDiagramSvg,
  resolveStandardHref,
  WorkspaceModuleResolver,
} from "../src/index.js";

const SAMPLE_SYSML_XMI = `<?xml version="1.0" encoding="UTF-8"?>
<xmi:XMI xmi:version="2.5"
  xmlns:xmi="http://www.omg.org/spec/XMI/20131001"
  xmlns:uml="http://www.omg.org/spec/UML/20131001"
  xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
  <xmi:Documentation exporter="MagicDraw UML" exporterVersion="2022x"/>
  <uml:Model xmi:id="model_1" name="ElectricVehicleSystem">
    <packagedElement xmi:type="uml:Package" xmi:id="pkg_arch" name="Architecture">
      <packagedElement xmi:type="uml:Class" xmi:id="if_power" name="PowerBus">
        <ownedAttribute xmi:type="uml:Property" xmi:id="prop_v" name="voltage">
          <type href="http://www.omg.org/spec/SysML/20181001/SysML.xmi#SysML_dataType.Real"/>
        </ownedAttribute>
      </packagedElement>

      <packagedElement xmi:type="uml:DataType" xmi:id="vt_mass" name="Kilogram"/>

      <packagedElement xmi:type="uml:Class" xmi:id="blk_battery" name="BatteryPack">
        <ownedAttribute xmi:type="uml:Port" xmi:id="port_bat_out" name="powerOut" type="if_power"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="prop_bat_mass" name="mass" type="vt_mass">
          <defaultValue xmi:type="uml:LiteralReal" value="450.0"/>
        </ownedAttribute>
      </packagedElement>

      <packagedElement xmi:type="uml:Class" xmi:id="blk_motor" name="TractionMotor">
        <ownedAttribute xmi:type="uml:Port" xmi:id="port_mot_in" name="powerIn" type="if_power" isConjugated="true"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="prop_mot_mass" name="mass" type="vt_mass">
          <defaultValue xmi:type="uml:LiteralReal" value="80.0"/>
        </ownedAttribute>
      </packagedElement>

      <packagedElement xmi:type="uml:Class" xmi:id="cb_mass_budget" name="TotalMassConstraint">
        <ownedAttribute xmi:type="uml:Property" xmi:id="cb_total" name="totalMass">
          <type href="UML_Standard_Profile.mdzip#_9_0_62a020a_1105704885343_144138_7929"/>
        </ownedAttribute>
        <ownedAttribute xmi:type="uml:Property" xmi:id="cb_m1" name="m1">
          <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
        </ownedAttribute>
        <ownedAttribute xmi:type="uml:Property" xmi:id="cb_m2" name="m2">
          <type href="http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real"/>
        </ownedAttribute>
        <ownedRule xmi:type="uml:Constraint" xmi:id="rule_mass" name="massSum">
          <specification xmi:type="uml:OpaqueExpression" xmi:id="oe_mass">
            <language>English</language>
            <body>totalMass = m1 + m2</body>
          </specification>
        </ownedRule>
      </packagedElement>

      <packagedElement xmi:type="uml:Class" xmi:id="blk_ev" name="ElectricVehicle">
        <ownedAttribute xmi:type="uml:Property" xmi:id="part_bat" name="battery" type="blk_battery" aggregation="composite"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="part_mot" name="motor" type="blk_motor" aggregation="composite"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="val_total_mass" name="vehicleMass" type="vt_mass"/>
        <ownedAttribute xmi:type="uml:Property" xmi:id="cp_mass" name="massCalc" type="cb_mass_budget" aggregation="composite"/>
        <ownedConnector xmi:type="uml:Connector" xmi:id="conn_pwr" name="hvLink">
          <end xmi:id="end_1" role="port_bat_out" partWithPort="part_bat"/>
          <end xmi:id="end_2" role="port_mot_in" partWithPort="part_mot"/>
        </ownedConnector>
        <ownedConnector xmi:type="uml:Connector" xmi:id="bind_total" name="bindTotalMass">
          <end xmi:id="bend_1" role="val_total_mass"/>
          <end xmi:id="bend_2" role="cb_total" partWithPort="cp_mass"/>
        </ownedConnector>
      </packagedElement>

      <xmi:Extension extender="MagicDraw UML 2022x">
        <ownedDiagram xmi:id="diag_bdd_1" name="EV Architecture BDD" type="SysML Block Definition Diagram">
          <mdElement elementID="blk_ev" geometry="120, 40, 260, 140"/>
          <mdElement elementID="blk_battery" geometry="40, 240, 200, 100"/>
          <mdElement elementID="blk_motor" geometry="300, 240, 200, 100"/>
        </ownedDiagram>
      </xmi:Extension>
    </packagedElement>

    <packagedElement xmi:type="uml:Package" xmi:id="pkg_reqs" name="Requirements">
      <packagedElement xmi:type="uml:Class" xmi:id="req_range" name="RangeRequirement"/>
      <packagedElement xmi:type="uml:Class" xmi:id="req_mass" name="MassLimitRequirement"/>
      <packagedElement xmi:type="uml:Abstraction" xmi:id="rel_sat_1" client="blk_ev" supplier="req_range"/>
      <packagedElement xmi:type="uml:Abstraction" xmi:id="rel_der_1" client="req_mass" supplier="req_range"/>
    </packagedElement>

    <packagedElement xmi:type="uml:StateMachine" xmi:id="sm_drive" name="DriveModes">
      <region xmi:id="reg_1" name="Main">
        <subvertex xmi:type="uml:Pseudostate" xmi:id="st_init" kind="initial"/>
        <subvertex xmi:type="uml:State" xmi:id="st_park" name="Parked"/>
        <subvertex xmi:type="uml:State" xmi:id="st_drive" name="Driving"/>
        <transition xmi:id="tr_1" source="st_init" target="st_park"/>
        <transition xmi:id="tr_2" source="st_park" target="st_drive">
          <trigger xmi:id="trig_1" name="shiftDrive"/>
        </transition>
      </region>
    </packagedElement>
  </uml:Model>

  <sysml:InterfaceBlock xmi:id="st_if" base_Class="if_power"/>
  <sysml:ValueType xmi:id="st_vt" base_DataType="vt_mass" unit="ISO-80000::kg"/>
  <sysml:Block xmi:id="st_bat" base_Class="blk_battery"/>
  <sysml:Block xmi:id="st_mot" base_Class="blk_motor"/>
  <sysml:ConstraintBlock xmi:id="st_cb" base_Class="cb_mass_budget"/>
  <sysml:Block xmi:id="st_ev" base_Class="blk_ev" isEncapsulated="true"/>
  <sysml:ProxyPort xmi:id="st_p1" base_Port="port_bat_out"/>
  <sysml:ProxyPort xmi:id="st_p2" base_Port="port_mot_in"/>
  <sysml:BindingConnector xmi:id="st_bc" base_Connector="bind_total"/>
  <sysml:Requirement xmi:id="st_r1" base_Class="req_range" id="REQ-001" text="The vehicle shall achieve at least 400 km range."/>
  <sysml:PerformanceRequirement xmi:id="st_r2" base_Class="req_mass" id="REQ-002" text="Total curb mass shall not exceed 2000 kg."/>
  <sysml:Satisfy xmi:id="st_s1" base_Abstraction="rel_sat_1"/>
  <sysml:DeriveReqt xmi:id="st_d1" base_Abstraction="rel_der_1"/>
</xmi:XMI>`;

describe("@modelscript/magicdraw (.mdzip, .mdxml, .xmi)", () => {
  it("packs and unpacks a binary .mdzip archive and parses SysML 1.x model", () => {
    const mdzipBytes = createMdzipArchive(SAMPLE_SYSML_XMI, {
      projectName: "ElectricVehicleProject",
      magicDrawVersion: "2022x",
    });

    const doc = parseMagicDraw(mdzipBytes);
    assert.strictEqual(doc.metadata.format, "mdzip");
    assert.strictEqual(doc.metadata.status, "ok");
    assert.strictEqual(doc.metadata.projectName, "ElectricVehicleProject");
    assert.strictEqual(doc.metadata.magicDrawVersion, "2022x");

    const ev = doc.classifiers.get("blk_ev");
    assert.ok(ev);
    assert.strictEqual(ev.kind, "Block");
    assert.strictEqual(ev.isEncapsulated, true);
    assert.strictEqual(ev.properties.find((p) => p.name === "battery")?.compartment, "parts");
    assert.strictEqual(ev.properties.find((p) => p.name === "vehicleMass")?.compartment, "values");
    assert.strictEqual(ev.properties.find((p) => p.name === "massCalc")?.compartment, "constraints");

    const vt = doc.classifiers.get("vt_mass");
    assert.strictEqual(vt?.kind, "ValueType");
    assert.strictEqual(vt?.unit, "kg");

    const motor = doc.classifiers.get("blk_motor");
    assert.strictEqual(motor?.ports[0]?.isConjugated, true);
    assert.strictEqual(motor?.ports[0]?.portKind, "proxy");

    // Clean-room href resolution for both OMG & MagicDraw standard profile IDs
    const cb = doc.classifiers.get("cb_mass_budget");
    assert.strictEqual(cb?.properties[0]?.typeRef?.resolvedName, "Real");
    assert.strictEqual(cb?.properties[0]?.typeRef?.isPrimitive, true);
    assert.strictEqual(doc.unresolvedHrefs.length, 0);

    // Requirement inheritance (PerformanceRequirement -> Requirement)
    const req2 = doc.classifiers.get("req_mass");
    assert.strictEqual(req2?.kind, "Requirement");
    assert.strictEqual(req2?.requirementId, "REQ-002");

    // StateMachine & Diagrams
    assert.strictEqual(doc.stateMachines.size, 1);
    assert.strictEqual(doc.diagrams.length, 1);
    assert.strictEqual(doc.diagrams[0]?.kind, "BDD");
    assert.strictEqual(doc.diagrams[0]?.viewBounds.length, 3);
  });

  it("detects corrupt, encrypted, and Teamwork Cloud stub .mdzip archives cleanly", () => {
    // Corrupt non-ZIP bytes
    const corruptDoc = parseMagicDraw(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    assert.strictEqual(corruptDoc.metadata.status, "corrupt");
    assert.ok(lintMagicDrawDocument(corruptDoc).some((d) => d.code === "M9921"));

    // Encrypted ZIP header (general purpose bit flag bit 0 = 1)
    const fakeEncrypted = createMdzipArchive(SAMPLE_SYSML_XMI);
    fakeEncrypted[6] = (fakeEncrypted[6] ?? 0) | 0x01;
    const encDoc = parseMagicDraw(fakeEncrypted);
    assert.strictEqual(encDoc.metadata.status, "encrypted");
    assert.ok(lintMagicDrawDocument(encDoc).some((d) => d.code === "M9922"));

    // TWC stub (PROJECT-*.xml referencing teamworkcloud, no model payload)
    const twcBytes = createRawZipArchive([
      {
        name: "PROJECT-twc.xml",
        data: new TextEncoder().encode('<PROJECT name="RemoteModel" server="twc://example.com/repo"/>'),
      },
    ]);
    const twcDoc = parseMagicDraw(twcBytes);
    assert.strictEqual(twcDoc.metadata.status, "twc-stub");
    assert.ok(lintMagicDrawDocument(twcDoc).some((d) => d.code === "M9923"));
  });

  it("resolves external mounted .mdzip module hrefs via WorkspaceModuleResolver", () => {
    const libXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="lib_m" name="SharedLib">
          <packagedElement xmi:type="uml:Class" xmi:id="ext_sensor_1" name="LidarSensor"/>
        </uml:Model>
        <sysml:Block xmi:id="st_ext_1" base_Class="ext_sensor_1"/>
      </xmi:XMI>`;
    const consumerXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="cons_m" name="Vehicle">
          <packagedElement xmi:type="uml:Class" xmi:id="car_1" name="AutonomousCar">
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_lidar" name="lidar" aggregation="composite">
              <type href="SharedLib.mdzip#ext_sensor_1"/>
            </ownedAttribute>
          </packagedElement>
        </uml:Model>
        <sysml:Block xmi:id="st_car" base_Class="car_1"/>
      </xmi:XMI>`;

    const resolver = new WorkspaceModuleResolver();
    resolver.registerModule("file:///workspace/SharedLib.mdzip", parseMagicDraw(libXml));
    const doc = parseMagicDraw(consumerXml, {
      externalResolver: (href) => resolver.resolveHref(href),
    });

    assert.strictEqual(doc.unresolvedHrefs.length, 0);
    assert.strictEqual(doc.classifiers.get("car_1")?.properties[0]?.typeRef?.resolvedName, "LidarSensor");
  });

  it("renders BDD, IBD, REQ, PAR, and STM diagrams and preserves mdOwnedViews geometry", () => {
    const doc = parseMagicDraw(SAMPLE_SYSML_XMI);

    const bdd = buildMagicDrawDiagram(doc, { diagramKind: "BDD" });
    const evNode = bdd.nodes.find((n) => n.id === "blk_ev");
    assert.ok(evNode);
    assert.strictEqual(evNode.x, 120);
    assert.strictEqual(evNode.y, 40);
    assert.ok(evNode.compartments.some((c) => c.title === "parts"));
    assert.ok(evNode.compartments.some((c) => c.title === "values"));
    assert.ok(evNode.compartments.some((c) => c.title === "constraints"));

    const ibd = buildMagicDrawDiagram(doc, { diagramKind: "IBD", focusClassifierId: "blk_ev" });
    assert.strictEqual(ibd.nodes.length, 2);
    assert.strictEqual(ibd.edges.length, 1);

    const req = buildMagicDrawDiagram(doc, { diagramKind: "REQ" });
    assert.ok(req.nodes.some((n) => n.id === "req_range"));
    assert.ok(req.edges.some((e) => e.kind === "satisfy" && e.dashed));

    const par = buildMagicDrawDiagram(doc, { diagramKind: "PAR", focusClassifierId: "blk_ev" });
    assert.ok(par.nodes.some((n) => n.id === "cp_mass"));
    assert.ok(par.edges.some((e) => e.kind === "binding"));

    const stm = buildMagicDrawDiagram(doc, { diagramKind: "STM" });
    assert.strictEqual(stm.nodes.length, 3);
    assert.strictEqual(stm.edges.length, 2);

    const svg = renderMagicDrawDiagramSvg(doc, { diagramKind: "BDD" });
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes("ElectricVehicle"));
    assert.ok(svg.includes("«block»"));
  });

  it("projects to SysML v2, ReqIF 1.2, Modelica, and arena-native DAEBuilder", () => {
    const doc = parseMagicDraw(SAMPLE_SYSML_XMI);

    // 1. SysML v2 projection
    const sysml = magicDrawToSysml2(doc);
    assert.ok(sysml.includes("package ElectricVehicleSystem"));
    assert.ok(sysml.includes("part def ElectricVehicle"));
    assert.ok(sysml.includes("port powerIn : ~PowerBus;"));
    assert.ok(sysml.includes("constraint def TotalMassConstraint"));
    assert.ok(sysml.includes("requirement def <'REQ-001'> RangeRequirement"));
    assert.ok(sysml.includes("satisfy RangeRequirement;"));
    assert.ok(sysml.includes("state def DriveModes"));

    // 2. ReqIF 1.2 projection
    const reqif = magicDrawToReqif(doc);
    assert.ok(reqif.includes("<REQ-IF"));
    assert.ok(reqif.includes("REQ-001"));
    assert.ok(reqif.includes("REQ-002"));
    assert.ok(reqif.includes("<SPEC-RELATION "));

    // 3. Modelica projection
    const mo = magicDrawToModelica(doc);
    assert.ok(mo.includes("model TotalMassConstraint"));
    assert.ok(mo.includes("totalMass = m1 + m2;"));

    // 4. Arena-native DAEBuilder lowering
    const arena = lowerMagicDrawParametricsToDae(doc);
    assert.ok(arena.varCount >= 4, `Expected >= 4 DAE variables, got ${arena.varCount}`);
    assert.ok(arena.eqCount >= 3, `Expected >= 3 DAE equations, got ${arena.eqCount}`);
  });

  it("reports semantic lints (M9924–M9934), LSP diagnostics/symbols/hover, tabular RTM, and TGG plan", () => {
    const buggyXml = `<?xml version="1.0" encoding="UTF-8"?>
      <xmi:XMI xmi:version="2.5" xmlns:xmi="http://www.omg.org/spec/XMI/20131001" xmlns:uml="http://www.omg.org/spec/UML/20131001" xmlns:sysml="http://www.omg.org/spec/SysML/20181001/SysML">
        <uml:Model xmi:id="m1" name="BuggyModel">
          <packagedElement xmi:type="uml:Class" xmi:id="b1" name="BlockA">
            <ownedAttribute xmi:type="uml:Property" xmi:id="p1" name="b" type="b2" aggregation="composite"/>
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_untyped" name="mystery"/>
            <ownedAttribute xmi:type="uml:Property" xmi:id="p_ext" name="extRef">
              <type href="MissingLib.mdzip#unknown_999"/>
            </ownedAttribute>
            <ownedConnector xmi:type="uml:Connector" xmi:id="c_bad" name="badConn">
              <end xmi:id="e1" role="missing_role"/>
              <end xmi:id="e2" role="p1"/>
            </ownedConnector>
          </packagedElement>
          <packagedElement xmi:type="uml:Class" xmi:id="b2" name="BlockB">
            <ownedAttribute xmi:type="uml:Property" xmi:id="p2" name="a" type="b1" aggregation="composite"/>
          </packagedElement>
          <packagedElement xmi:type="uml:Class" xmi:id="r_empty" name="EmptyReq"/>
        </uml:Model>
        <sysml:Block xmi:id="s1" base_Class="b1"/>
        <sysml:Block xmi:id="s2" base_Class="b2"/>
        <sysml:Block xmi:id="s_orphan" base_Class="does_not_exist"/>
        <sysml:Requirement xmi:id="s_req" base_Class="r_empty"/>
      </xmi:XMI>`;

    const diags = lintMagicDrawDocument(parseMagicDraw(buggyXml));
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("M9925"), "Expected orphan stereotype M9925");
    assert.ok(codes.has("M9926"), "Expected unresolved href M9926");
    assert.ok(codes.has("M9927"), "Expected untyped property M9927");
    assert.ok(codes.has("M9928"), "Expected dangling connector M9928");
    assert.ok(codes.has("M9929"), "Expected cyclic composition M9929");
    assert.ok(codes.has("M9930"), "Expected missing req id M9930");
    assert.ok(codes.has("M9931"), "Expected missing req text M9931");
    assert.ok(codes.has("M9932"), "Expected unsatisfied req M9932");
    assert.ok(codes.has("M9933"), "Expected unverified req M9933");

    // LSP, Tabular, Actions, TGG
    const lspDiags = getMagicDrawDiagnostics(SAMPLE_SYSML_XMI);
    assert.ok(Array.isArray(lspDiags));
    const syms = getMagicDrawDocumentSymbols(SAMPLE_SYSML_XMI);
    assert.ok(syms.length >= 1);
    const evOffset = SAMPLE_SYSML_XMI.indexOf('name="ElectricVehicle"');
    const hover = getMagicDrawHover(SAMPLE_SYSML_XMI, evOffset);
    assert.ok(hover?.contents.includes("ElectricVehicle"));

    const tables = extractMagicDrawTables(SAMPLE_SYSML_XMI);
    assert.strictEqual(tables.requirements.length, 2);
    assert.ok(tables.blocks.length >= 4);

    assert.ok(magicDrawTggPlan.rules.length === 3);
    assert.ok(resolveStandardHref("http://www.omg.org/spec/UML/20131001/PrimitiveTypes.xmi#Real")?.isPrimitive);
    const actRes = magicDrawActionHandlers["magicdraw_to_sysml2"]!({ text: SAMPLE_SYSML_XMI }) as { content: string };
    assert.ok(actRes.content.includes("ElectricVehicle"));
  });
});
