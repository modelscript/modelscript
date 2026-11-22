// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyClassifierKind,
  classifyPropertyCompartment,
  classifyRelationshipStereotype,
  isStereotypeKindOf,
  lookupQudvUnit,
  lookupUmlPrimitive,
  resolveStandardHref,
} from "../src/profiles/index.js";

describe("@modelscript/magicdraw — Clean-Room OMG Profiles & QUDV", () => {
  it("resolves OMG UML 2.5 primitive types case-insensitively", () => {
    assert.strictEqual(lookupUmlPrimitive("Real")?.sysml2Type, "ScalarValues::Real");
    assert.strictEqual(lookupUmlPrimitive("integer")?.modelicaType, "Integer");
    assert.strictEqual(lookupUmlPrimitive("Boolean")?.isNumeric, false);
    assert.strictEqual(lookupUmlPrimitive("UnlimitedNatural")?.sysml2Type, "ScalarValues::Natural");
  });

  it("evaluates SysML 1.6 stereotype inheritance hierarchy", () => {
    assert.strictEqual(isStereotypeKindOf("PerformanceRequirement", "Requirement"), true);
    assert.strictEqual(isStereotypeKindOf("DesignConstraint", "AbstractRequirement"), true);
    assert.strictEqual(isStereotypeKindOf("ConstraintBlock", "Block"), true);
    assert.strictEqual(isStereotypeKindOf("InterfaceBlock", "Block"), true);
    assert.strictEqual(isStereotypeKindOf("Block", "Requirement"), false);
  });

  it("classifies classifiers, property compartments, and relationship stereotypes", () => {
    assert.strictEqual(
      classifyClassifierKind("uml:Class", [
        {
          id: "s1",
          profilePrefix: "sysml",
          name: "FunctionalRequirement",
          qualifiedName: "sysml:FunctionalRequirement",
          targetId: "c1",
          baseAttr: "base_Class",
          tags: {},
        },
      ]),
      "Requirement",
    );

    assert.strictEqual(
      classifyPropertyCompartment({ aggregation: "composite", stereotypes: [], targetClassifierKind: "Block" }),
      "parts",
    );
    assert.strictEqual(
      classifyPropertyCompartment({ aggregation: "none", stereotypes: [], targetClassifierKind: "Block" }),
      "references",
    );
    assert.strictEqual(
      classifyPropertyCompartment({ aggregation: "none", stereotypes: [], isPrimitiveType: true }),
      "values",
    );
    assert.strictEqual(
      classifyPropertyCompartment({
        aggregation: "composite",
        stereotypes: [],
        targetClassifierKind: "ConstraintBlock",
      }),
      "constraints",
    );

    assert.strictEqual(
      classifyRelationshipStereotype([
        {
          id: "r1",
          profilePrefix: "sysml",
          name: "Verify",
          qualifiedName: "sysml:Verify",
          targetId: "a1",
          baseAttr: "base_Abstraction",
          tags: {},
        },
      ]),
      "verify",
    );
  });

  it("resolves QUDV/ISO-80000 units and MagicDraw standard href shims", () => {
    assert.strictEqual(lookupQudvUnit("ISO-80000::kg")?.quantityKind, "Mass");
    assert.strictEqual(lookupQudvUnit("kW")?.siFactor, 1e3);
    assert.strictEqual(
      resolveStandardHref("UML_Standard_Profile.mdzip#_9_0_62a020a_1105704885343_144138_7929")?.name,
      "Real",
    );
    assert.strictEqual(
      resolveStandardHref("http://www.omg.org/spec/SysML/20181001/SysML.xmi#SysML_dataType.Boolean")?.name,
      "Boolean",
    );
    assert.strictEqual(resolveStandardHref("ISO-80000.mdzip#ISO-80000::N")?.unit, "N");
  });
});
