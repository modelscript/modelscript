// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { describe, it } from "node:test";
import { PolyglotTransformer, UnifiedWorkspace, WorkspaceTypeRegistry } from "../src/index.js";

describe("WorkspaceTypeRegistry & Dynamic Symbol Type Resolution", () => {
  it("should resolve primitive type mappings across all 5 domains", () => {
    const registry = new WorkspaceTypeRegistry();

    // Modelica -> Other domains
    assert.strictEqual(registry.resolvePrimitive("modelica", "sysml2", "Real"), "ISQ::Real");
    assert.strictEqual(registry.resolvePrimitive("modelica", "step", "Real"), "REAL");
    assert.strictEqual(registry.resolvePrimitive("modelica", "owl2", "Real"), "xsd:double");
    assert.strictEqual(registry.resolvePrimitive("modelica", "csv", "Real"), "number");

    assert.strictEqual(registry.resolvePrimitive("modelica", "sysml2", "Integer"), "KerML::Integer");
    assert.strictEqual(registry.resolvePrimitive("modelica", "step", "Integer"), "INTEGER");
    assert.strictEqual(registry.resolvePrimitive("modelica", "owl2", "Integer"), "xsd:integer");
    assert.strictEqual(registry.resolvePrimitive("modelica", "csv", "Integer"), "number");

    assert.strictEqual(registry.resolvePrimitive("modelica", "sysml2", "Boolean"), "KerML::Boolean");
    assert.strictEqual(registry.resolvePrimitive("modelica", "step", "Boolean"), "BOOLEAN");
    assert.strictEqual(registry.resolvePrimitive("modelica", "owl2", "Boolean"), "xsd:boolean");
    assert.strictEqual(registry.resolvePrimitive("modelica", "csv", "Boolean"), "boolean");

    // SysML v2 -> Other domains
    assert.strictEqual(registry.resolvePrimitive("sysml2", "modelica", "KerML::Real"), "Real");
    assert.strictEqual(registry.resolvePrimitive("sysml2", "modelica", "ISQ::Real"), "Real");
    assert.strictEqual(registry.resolvePrimitive("sysml2", "step", "KerML::Real"), "REAL");
    assert.strictEqual(registry.resolvePrimitive("sysml2", "owl2", "KerML::Real"), "xsd:double");

    // STEP -> Other domains
    assert.strictEqual(registry.resolvePrimitive("step", "modelica", "REAL"), "Real");
    assert.strictEqual(registry.resolvePrimitive("step", "sysml2", "REAL"), "ISQ::Real");

    // OWL 2 -> Other domains
    assert.strictEqual(registry.resolvePrimitive("owl2", "modelica", "xsd:double"), "Real");
    assert.strictEqual(registry.resolvePrimitive("owl2", "sysml2", "xsd:integer"), "KerML::Integer");
  });

  it("should handle custom library type mappings and domain synonyms", () => {
    const registry = new WorkspaceTypeRegistry();

    registry.registerTypeMapping("modelica", "sysml2", "Modelica.Electrical.Analog.Basic.Resistor", "ISQ::Resistance");

    assert.strictEqual(
      registry.resolveTypeMapping("modelica", "sysml2", "Modelica.Electrical.Analog.Basic.Resistor"),
      "ISQ::Resistance",
    );

    // Domain synonym resolution
    registry.registerDomainSynonym("Resistor", "Modelica.Electrical.Analog.Basic.Resistor");
    assert.strictEqual(registry.resolveTypeMapping("modelica", "sysml2", "Resistor"), "ISQ::Resistance");

    // Unknown type fallback
    assert.strictEqual(registry.resolveTypeMapping("modelica", "sysml2", "CustomUnknown"), "CustomUnknown");
  });

  it("should integrate seamlessly with PolyglotTransformer", () => {
    const transformer = new PolyglotTransformer();

    assert.strictEqual(transformer.resolveType("modelica", "sysml2", "Real"), "ISQ::Real");
    assert.strictEqual(transformer.resolveType("modelica", "step", "Real"), "REAL");
    assert.strictEqual(transformer.resolveType("modelica", "owl2", "Real"), "xsd:double");
    assert.strictEqual(transformer.resolveType("modelica", "csv", "Real"), "number");

    // Register custom library type via transformer's registry
    transformer.typeRegistry.registerTypeMapping(
      "modelica",
      "step",
      "MechanicalShaft",
      "STEP_GEOMETRIC_REPRESENTATION_ITEM",
    );

    assert.strictEqual(
      transformer.resolveType("modelica", "step", "MechanicalShaft"),
      "STEP_GEOMETRIC_REPRESENTATION_ITEM",
    );
  });

  it("should integrate with UnifiedWorkspace and preserve workspace type registry", () => {
    const ws = new UnifiedWorkspace();
    assert.ok(ws.typeRegistry instanceof WorkspaceTypeRegistry);

    ws.typeRegistry.registerTypeMapping("modelica", "sysml2", "MotorType", "ActuatorPart");

    ws.registerWorkspace(
      "testLang",
      {},
      {
        polyglot: {
          languages: ["sysml2"],
          rules: [],
        },
      },
    );

    const transformer = ws.createPolyglotTransformer("testLang");
    assert.ok(transformer);
    assert.strictEqual(transformer.typeRegistry, ws.typeRegistry);
    assert.strictEqual(transformer.resolveType("modelica", "sysml2", "MotorType"), "ActuatorPart");
  });
});
