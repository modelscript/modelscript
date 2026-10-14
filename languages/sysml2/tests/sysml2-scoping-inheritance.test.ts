// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl";
import assert from "node:assert";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createSysML2QueryEngine, createSysML2WorkspaceIndex } from "../src/factory.js";
import { GenericModelicaBridge } from "../transformers/generic-modelica-bridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sysmlWasm = path.resolve(__dirname, "../dist/parser.wasm");

describe("SysML v2 Scoping, Qualified Names & Inheritance Remediation (Phase 2)", () => {
  it("resolves multi-segment qualified names (A::B::C::Target) without skipping intermediate packages", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const workspaceIndex = createSysML2WorkspaceIndex();

    const modelSource = `
      package Org {
        part def Specialist {
          attribute tag : Real;
        }

        package Dept {
          package Eng {
            part def Specialist {
              attribute level : Real;
            }
          }
        }
      }

      package Consumer {
        part def Team {
          part deepMember : Org::Dept::Eng::Specialist;
          part shallowMember : Org::Specialist;
        }
      }
    `;

    workspaceIndex.register("file:///test/MultiSegment.sysml", () => {
      const tree = parser.parse(modelSource);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await workspaceIndex.toUnifiedAsync();
    const queryEngine = createSysML2QueryEngine(unified);
    const db = queryEngine.toQueryDB();

    const teamDef = db.byName("Team")[0];
    assert.ok(teamDef, "Team definition should exist");

    const teamChildren = db.childrenOf(teamDef.id);
    const deepPart = teamChildren.find((c) => c.name === "deepMember");
    const shallowPart = teamChildren.find((c) => c.name === "shallowMember");

    assert.ok(deepPart, "deepMember should exist");
    assert.ok(shallowPart, "shallowMember should exist");

    const deepType = queryEngine.fetch("resolvedType", deepPart.id);
    assert.ok(deepType, "deepMember type should resolve");
    const deepChildren = db.childrenOf((deepType as any).id);
    assert.ok(
      deepChildren.some((c) => c.name === "level"),
      "deepMember should resolve to Eng::Specialist with attribute 'level'",
    );

    const shallowType = queryEngine.fetch("resolvedType", shallowPart.id);
    assert.ok(shallowType, "shallowMember type should resolve");
    const shallowChildren = db.childrenOf((shallowType as any).id);
    assert.ok(
      shallowChildren.some((c) => c.name === "tag"),
      "shallowMember should resolve to Org::Specialist with attribute 'tag'",
    );
  });

  it("traverses inheritance scopes (:>) to resolve inherited and transitive members", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const workspaceIndex = createSysML2WorkspaceIndex();

    const modelSource = `
      package VehicleHierarchy {
        part def Asset {
          attribute serialNumber : Real;
        }

        part def Machine :> Asset {
          attribute operatingHours : Real;
        }

        part def Generator :> Machine {
          attribute powerRating : Real;
        }
      }
    `;

    workspaceIndex.register("file:///test/Hierarchy.sysml", () => {
      const tree = parser.parse(modelSource);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await workspaceIndex.toUnifiedAsync();
    const queryEngine = createSysML2QueryEngine(unified);
    const db = queryEngine.toQueryDB();

    const genDef = db.byName("Generator")[0];
    assert.ok(genDef, "Generator definition should exist");

    // Query superclassifiers query hook
    const supers = queryEngine.fetch("superclassifiers", genDef.id) as any[];
    assert.ok(supers && supers.length > 0, "Generator should have superclassifiers");
    assert.strictEqual(supers[0].name, "Machine", "Direct superclass should be Machine");

    // Machine's superclass should be Asset
    const machineSupers = queryEngine.fetch("superclassifiers", supers[0].id) as any[];
    assert.ok(machineSupers && machineSupers.length > 0, "Machine should have superclassifiers");
    assert.strictEqual(machineSupers[0].name, "Asset", "Machine's superclass should be Asset");
  });

  it("isolates unimported sibling packages from silent global symbol capture", async () => {
    const { parser } = await createWasmParser(sysmlWasm);
    const workspaceIndex = createSysML2WorkspaceIndex();

    const modelSource = `
      package PrivateDomainA {
        part def HiddenComponent {
          attribute secretCode : Real;
        }
      }

      package DomainB {
        part def PublicSystem {
          part comp : HiddenComponent;
        }
      }
    `;

    workspaceIndex.register("file:///test/Isolation.sysml", () => {
      const tree = parser.parse(modelSource);
      return tree ? (tree.rootNode as any) : null;
    });

    const unified = await workspaceIndex.toUnifiedAsync();
    const queryEngine = createSysML2QueryEngine(unified);
    const db = queryEngine.toQueryDB();

    const pubSystem = db.byName("PublicSystem")[0];
    assert.ok(pubSystem, "PublicSystem definition should exist");

    const compUsage = db.childrenOf(pubSystem.id).find((c) => c.name === "comp");
    assert.ok(compUsage, "comp usage should exist");

    // HiddenComponent is in unimported sibling PrivateDomainA; should not silently resolve
    const resolved = queryEngine.fetch("resolvedType", compUsage.id);
    assert.strictEqual(resolved, null, "Unimported symbol HiddenComponent should not silently resolve in DomainB");
  });

  it("populates and roundtrips superclasses across Modelica extends and SysML v2 :>", () => {
    // 1. Modelica with extends -> SysML2GenericDefinition superclasses -> SysML v2 :>
    const moSource = `
      model LowPassFilter
        extends FirstOrderSystem;
        parameter Real T = 0.1;
      equation
      end LowPassFilter;
    `;

    const parsedMo = GenericModelicaBridge.parseModelicaToSysML2(moSource);
    assert.strictEqual(parsedMo.name, "LowPassFilter");
    assert.ok(parsedMo.superclasses, "parsedMo should contain superclasses");
    assert.deepStrictEqual(parsedMo.superclasses, ["FirstOrderSystem"]);

    const emittedSysml = GenericModelicaBridge.emitSysML2(parsedMo);
    assert.ok(
      emittedSysml.includes("part def LowPassFilter :> FirstOrderSystem {"),
      "SysML v2 output should contain :> FirstOrderSystem",
    );

    // 2. SysML v2 with :> -> SysML2GenericDefinition superclasses -> Modelica extends
    const sysmlSource = `
      part def HighPassFilter :> FirstOrderSystem {
        attribute cutoffFreq : Real = 1000.0;
      }
    `;

    const parsedSysml = GenericModelicaBridge.parseSysML2(sysmlSource);
    assert.strictEqual(parsedSysml.name, "HighPassFilter");
    assert.ok(parsedSysml.superclasses, "parsedSysml should contain superclasses");
    assert.deepStrictEqual(parsedSysml.superclasses, ["FirstOrderSystem"]);

    const emittedMo = GenericModelicaBridge.emitModelica(parsedSysml);
    assert.ok(
      emittedMo.includes("extends FirstOrderSystem;"),
      "Modelica output should contain extends FirstOrderSystem;",
    );
  });
});
