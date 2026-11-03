// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { parseAutomationML } from "../src/parser/index.js";

describe("AutomationML (IEC 62714 CAEX) Parser", () => {
  it("parses standard CAEX 2.15 XML with InstanceHierarchy, RoleClassLib, InterfaceClassLib, and SystemUnitClassLib", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CAEXFile FileName="AssemblyCell.aml" SchemaVersion="2.15">
  <InstanceHierarchy Name="ManufacturingCell">
    <Version>1.0.0</Version>
    <InternalElement Name="ConveyorBelt" ID="conv-01" RefBaseSystemUnitPath="PlantUnitLib/ConveyorUnit">
      <Attribute Name="maxSpeed" AttributeDataType="xs:double" Unit="m/s">
        <Value>2.5</Value>
      </Attribute>
      <Attribute Name="Frame">
        <Attribute Name="x" AttributeDataType="xs:double"><Value>1.25</Value></Attribute>
        <Attribute Name="y" AttributeDataType="xs:double"><Value>0.5</Value></Attribute>
        <Attribute Name="z" AttributeDataType="xs:double"><Value>0.0</Value></Attribute>
        <Attribute Name="rx" AttributeDataType="xs:double"><Value>0</Value></Attribute>
        <Attribute Name="ry" AttributeDataType="xs:double"><Value>0</Value></Attribute>
        <Attribute Name="rz" AttributeDataType="xs:double"><Value>90</Value></Attribute>
      </Attribute>
      <ExternalInterface Name="motorCmd" ID="conv-01-cmd" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface" Direction="In" DataType="BOOL" />
      <ExternalInterface Name="speedActual" ID="conv-01-spd" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface" Direction="Out" DataType="REAL" />
      <ExternalInterface Name="cadMesh" ID="conv-01-cad" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/COLLADAInterface" RefURI="file://meshes/conveyor.dae" />
      <RoleRequirements RefBaseRoleClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource" />
    </InternalElement>
    <InternalElement Name="CellPlc" ID="plc-01" PPRCategory="Resource">
      <ExternalInterface Name="driveStart" ID="plc-01-start" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface" Direction="Out" DataType="BOOL" />
      <ExternalInterface Name="speedFeedback" ID="plc-01-fb" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface" Direction="In" DataType="REAL" />
      <ExternalInterface Name="plcProgram" ID="plc-01-prog" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/PLCopenXMLInterface" RefURI="file://plc/main.st" />
      <InternalLink Name="CmdLink" RefPartnerSideA="plc-01:driveStart" RefPartnerSideB="conv-01:motorCmd" />
      <InternalLink Name="SpdLink" RefPartnerSideA="conv-01:speedActual" RefPartnerSideB="plc-01:speedFeedback" />
    </InternalElement>
  </InstanceHierarchy>
  <SystemUnitClassLib Name="PlantUnitLib">
    <SystemUnitClass Name="ConveyorUnit" RefBaseClassPath="AutomationMLBaseSystemUnitClassLib/BaseUnit">
      <SupportedRoleClass RefRoleClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource" />
    </SystemUnitClass>
  </SystemUnitClassLib>
  <RoleClassLib Name="CustomRoleLib">
    <RoleClass Name="TransportResource" RefBaseClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource" />
  </RoleClassLib>
  <InterfaceClassLib Name="CustomIfLib">
    <InterfaceClass Name="DriveBus" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface" />
  </InterfaceClassLib>
</CAEXFile>`;

    const doc = parseAutomationML(xml);
    assert.strictEqual(doc.fileName, "AssemblyCell.aml");
    assert.strictEqual(doc.schemaVersion, "2.15");
    assert.strictEqual(doc.instanceHierarchies.length, 1);
    assert.strictEqual(doc.systemUnitClassLibs.length, 1);
    assert.strictEqual(doc.roleClassLibs.length, 1);
    assert.strictEqual(doc.interfaceClassLibs.length, 1);

    const ih = doc.instanceHierarchies[0]!;
    assert.strictEqual(ih.name, "ManufacturingCell");
    assert.strictEqual(ih.elements.length, 2);

    const conv = ih.elements[0]!;
    assert.strictEqual(conv.id, "conv-01");
    assert.strictEqual(conv.name, "ConveyorBelt");
    assert.strictEqual(conv.pprCategory, "Resource");
    assert(conv.frame !== undefined);
    assert.strictEqual(conv.frame.x, 1.25);
    assert.strictEqual(conv.frame.y, 0.5);
    assert.strictEqual(conv.frame.rz, 90);
    assert.strictEqual(conv.attributes.length, 1);
    assert.strictEqual(conv.attributes[0]?.name, "maxSpeed");
    assert.strictEqual(conv.attributes[0]?.value, 2.5);
    assert.strictEqual(conv.interfaces.length, 3);
    assert.strictEqual(conv.interfaces[2]?.category, "COLLADA");
    assert.strictEqual(conv.interfaces[2]?.refUri, "file://meshes/conveyor.dae");

    const plc = ih.elements[1]!;
    assert.strictEqual(plc.internalLinks.length, 2);
    assert.strictEqual(plc.internalLinks[0]?.refPartnerSideA, "plc-01:driveStart");
    assert.strictEqual(plc.internalLinks[0]?.refPartnerSideB, "conv-01:motorCmd");
    assert(conv.range.startLine >= 1);
    assert(conv.range.endLine > conv.range.startLine);
  });

  it("parses declarative AML DSL syntax with 6-DOF frames, roles, interfaces, and links", () => {
    const dsl = `
      aml "RobotWorkcell.aml" version "3.0"

      roleClassLib "WorkcellRoles" {
        roleClass RobotArmRole extends "AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource" {
          attribute payloadKg: REAL = 12.0 [kg]
          interface powerPort: In Energy
        }
      }

      systemUnitClassLib "WorkcellUnits" {
        systemUnitClass SixAxisRobot extends "AutomationMLBaseSystemUnitClassLib/BaseUnit" {
          supportedRole "WorkcellRoles/RobotArmRole"
        }
      }

      instanceHierarchy "WeldingStation" {
        element Robot1 : "WorkcellUnits/SixAxisRobot" [id="rob-1", ppr=Resource] {
          roleRequirement "WorkcellRoles/RobotArmRole" requiresInterfaces=[powerPort] requiresAttributes=[payloadKg]
          frame (x=2.0, y=1.5, z=0.0, rx=0, ry=0, rz=45)
          attribute payloadKg: REAL = 15.0 [kg]
          interface powerPort: In Energy
          interface weldTrigger: In BOOL
          interface weldActive: Out BOOL
        }
        element WeldController [id="wctrl-1", ppr=Resource] {
          interface startWeld: Out BOOL
          interface isWelding: In BOOL
        }
        link "TriggerWeld" wctrl-1:startWeld -> rob-1:weldTrigger
        link "WeldFeedback" rob-1:weldActive -> wctrl-1:isWelding
      }
    `;

    const doc = parseAutomationML(dsl);
    assert.strictEqual(doc.fileName, "RobotWorkcell.aml");
    assert.strictEqual(doc.schemaVersion, "3.0");
    assert.strictEqual(doc.roleClassLibs.length, 1);
    assert.strictEqual(doc.systemUnitClassLibs.length, 1);
    assert.strictEqual(doc.instanceHierarchies.length, 1);

    const ih = doc.instanceHierarchies[0]!;
    assert.strictEqual(ih.elements.length, 2);
    const rob = ih.elements[0]!;
    assert.strictEqual(rob.id, "rob-1");
    assert.strictEqual(rob.pprCategory, "Resource");
    assert.strictEqual(rob.frame?.x, 2.0);
    assert.strictEqual(rob.frame?.rz, 45);
    assert.strictEqual(rob.roleRequirements.length, 1);
    assert.deepStrictEqual(rob.roleRequirements[0]?.requiredInterfaces, ["powerPort"]);
    assert.deepStrictEqual(rob.roleRequirements[0]?.requiredAttributes, ["payloadKg"]);
    assert.strictEqual(rob.internalLinks.length, 2);
  });
});
