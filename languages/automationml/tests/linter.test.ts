// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { lintAutomationML } from "../src/lints/index.js";
import { parseAutomationML } from "../src/parser/index.js";

describe("AutomationML Semantic Linter (M8301–M8307)", () => {
  it("reports zero diagnostics on a valid AutomationML plant topology", () => {
    const dsl = `
      aml "ValidPlant.aml" version "2.15"
      roleClassLib "CustomRoles" {
        roleClass ActuatorRole extends "AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource" {
          attribute maxForce: REAL = 100.0
          interface cmdIn: In BOOL
        }
      }
      systemUnitClassLib "CustomUnits" {
        systemUnitClass LinearActuator extends "AutomationMLBaseSystemUnitClassLib/BaseUnit" {
          supportedRole "CustomRoles/ActuatorRole"
        }
      }
      instanceHierarchy "PressCell" {
        element Press1 : "CustomUnits/LinearActuator" [id="press-1", ppr=Resource] {
          roleRequirement "CustomRoles/ActuatorRole" requiresInterfaces=[cmdIn] requiresAttributes=[maxForce]
          frame (x=0.0, y=1.0, z=0.5, rx=0, ry=0, rz=0)
          attribute maxForce: REAL = 250.0 [N]
          interface cmdIn: In BOOL
          interface logicRef: InOut PLCopenXML uri="file://plc/press.st"
        }
        element Plc1 [id="plc-1", ppr=Resource] {
          interface cmdOut: Out BOOL
        }
        link "PressCmd" plc-1:cmdOut -> press-1:cmdIn
      }
    `;
    const doc = parseAutomationML(dsl);
    const diags = lintAutomationML(doc, { availableUris: ["file://plc/press.st"] });
    assert.strictEqual(diags.length, 0);
  });

  it("detects M8301 (aml-unresolved-base-class) for unknown SystemUnitClass, RoleClass, or InterfaceClass", () => {
    const dsl = `
      aml "UnresolvedClasses.aml"
      instanceHierarchy "Cell" {
        element MachineA : "MissingLib/MissingUnit" [id="m1"] {
          roleRequirement "MissingRoleLib/UnknownRole"
          interface badPort: In BOOL extends "MissingIfLib/UnknownInterface"
        }
      }
    `;
    const doc = parseAutomationML(dsl);
    const diags = lintAutomationML(doc);
    const m8301 = diags.filter((d) => d.code === "M8301");
    assert.strictEqual(m8301.length, 3);
    assert.strictEqual(m8301[0]?.rule, "aml-unresolved-base-class");
  });

  it("detects M8302 (aml-inheritance-cycle) in class libraries", () => {
    const dsl = `
      aml "CyclicClasses.aml"
      roleClassLib "CyclicRoles" {
        roleClass RoleA extends "CyclicRoles/RoleB"
        roleClass RoleB extends "CyclicRoles/RoleA"
      }
    `;
    const doc = parseAutomationML(dsl);
    const diags = lintAutomationML(doc);
    assert(diags.some((d) => d.code === "M8302" && d.rule === "aml-inheritance-cycle"));
  });

  it("detects M8303 (aml-invalid-internal-link) when link endpoints do not resolve", () => {
    const dsl = `
      aml "BrokenLink.aml"
      instanceHierarchy "Cell" {
        element Conv1 [id="conv-1"] {
          interface runIn: In BOOL
        }
        link "BrokenPartner" ghost-el:outPort -> conv-1:nonExistentPort
      }
    `;
    const doc = parseAutomationML(dsl);
    const diags = lintAutomationML(doc);
    const m8303 = diags.filter((d) => d.code === "M8303");
    assert.strictEqual(m8303.length, 2);
    assert.strictEqual(m8303[0]?.rule, "aml-invalid-internal-link");
  });

  it("detects M8304 (aml-port-direction-conflict) for Out->Out, In->In, or mismatched data types", () => {
    const dsl = `
      aml "PortConflict.aml"
      instanceHierarchy "Cell" {
        element NodeA [id="a"] {
          interface outBool: Out BOOL
          interface inReal: In REAL
        }
        element NodeB [id="b"] {
          interface outBool2: Out BOOL
          interface outBoolForReal: Out BOOL
        }
        link "OutToOut" a:outBool -> b:outBool2
        link "TypeMismatch" b:outBoolForReal -> a:inReal
      }
    `;
    const doc = parseAutomationML(dsl);
    const diags = lintAutomationML(doc);
    const m8304 = diags.filter((d) => d.code === "M8304");
    assert.strictEqual(m8304.length, 2);
    assert.strictEqual(m8304[0]?.rule, "aml-port-direction-conflict");
  });

  it("detects M8305 (aml-unsatisfied-role-requirement) when mandated interfaces or attributes are missing", () => {
    const dsl = `
      aml "MissingRoleReqs.aml"
      roleClassLib "Roles" {
        roleClass ServoRole extends "AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource" {
          attribute ratedTorque: REAL = 10.0
          interface torqueCmd: In REAL
        }
      }
      instanceHierarchy "Cell" {
        element Servo1 [id="srv-1"] {
          roleRequirement "Roles/ServoRole"
        }
      }
    `;
    const doc = parseAutomationML(dsl);
    const diags = lintAutomationML(doc);
    const m8305 = diags.filter((d) => d.code === "M8305");
    assert.strictEqual(m8305.length, 2);
    assert.strictEqual(m8305[0]?.rule, "aml-unsatisfied-role-requirement");
  });

  it("detects M8306 (aml-broken-external-ref-uri) for empty or missing PLCopenXML / COLLADA URIs", () => {
    const dsl = `
      aml "BrokenUri.aml"
      instanceHierarchy "Cell" {
        element Robot1 [id="rob-1"] {
          interface plcIf: InOut PLCopenXML
          interface cadIf: InOut COLLADA uri="file://missing/mesh.dae"
        }
      }
    `;
    const doc = parseAutomationML(dsl);
    const diags = lintAutomationML(doc, { availableUris: ["file://valid/mesh.dae"] });
    const m8306 = diags.filter((d) => d.code === "M8306");
    assert.strictEqual(m8306.length, 2);
    assert.strictEqual(m8306[0]?.rule, "aml-broken-external-ref-uri");
  });

  it("detects M8307 (aml-invalid-frame-transform) for non-finite coordinates or out-of-range Euler angles", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<CAEXFile FileName="BadFrame.aml" SchemaVersion="2.15">
  <InstanceHierarchy Name="Cell">
    <InternalElement Name="BadSensor" ID="sens-1">
      <Frame x="NaN" y="0" z="0" rx="0" ry="0" rz="0" />
    </InternalElement>
    <InternalElement Name="BadRot" ID="rot-1">
      <Frame x="1" y="2" z="3" rx="0" ry="0" rz="720" />
    </InternalElement>
  </InstanceHierarchy>
</CAEXFile>`;
    const doc = parseAutomationML(xml);
    const diags = lintAutomationML(doc);
    const m8307 = diags.filter((d) => d.code === "M8307");
    assert.strictEqual(m8307.length, 2);
    assert.strictEqual(m8307[0]?.rule, "aml-invalid-frame-transform");
  });
});
