// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSysmlParser } from "../src/factory.js";
import {
  OMG_SYSML2_CONTEXT,
  SysML2ModelInterchange,
  type SysmlxDocument,
  type SysmlxElement,
} from "../src/sysmlx-interchange.js";

describe("OMG SysML v2 Standard Model Interchange (.sysmlx / .kermlx) (Phase 6)", () => {
  const sampleSysml = `
    package VehicleSystem {
      port def PowerPort {
        attribute voltage : ScalarValues::Real;
      }

      part def Wheel;

      abstract part def Chassis {
        port pIn : PowerPort;
        port pOut : ~PowerPort;
      }

      part def ElectricVehicle :> Chassis {
        part wheels : Wheel;
        attribute mass : ScalarValues::Real = 1500;
        connection connect pIn to pOut;
        assert constraint maxMass { mass <= 2000 }
      }

      requirement def RangeReq {
        attribute minRange : ScalarValues::Real;
      }

      part vehicleInstance : ElectricVehicle {
        satisfy RangeReq;
      }
    }
  `;

  it("exports SysML v2 source code to official OMG JSON-LD (.sysmlx)", async () => {
    const doc = await SysML2ModelInterchange.exportToSysmlx(sampleSysml, {
      sourceUri: "file:///workspace/Vehicle.sysml",
      description: "Automotive Powertrain SysML v2 Architecture",
    });

    assert.strictEqual(doc["@context"], OMG_SYSML2_CONTEXT);
    assert.strictEqual(doc.metadata?.description, "Automotive Powertrain SysML v2 Architecture");
    assert.strictEqual(doc.metadata?.generator, "ModelScript SysML v2 Interchange Engine");
    assert.ok(Array.isArray(doc["@graph"]));
    assert.ok(doc["@graph"].length > 0);

    const elements = doc["@graph"].filter((e): e is SysmlxElement => !("relationshipType" in e));
    const relationships = doc["@graph"].filter((e) => "relationshipType" in e);

    // Verify Package element
    const pkg = elements.find((e) => e["@type"] === "Package" && e.name === "VehicleSystem");
    assert.ok(pkg, "VehicleSystem package must exist");
    assert.strictEqual(pkg.qualifiedName, "VehicleSystem");

    // Verify Part Definitions
    const wheelDef = elements.find((e) => e["@type"] === "PartDefinition" && e.name === "Wheel");
    assert.ok(wheelDef, "Wheel definition must exist");
    assert.strictEqual(wheelDef.qualifiedName, "VehicleSystem::Wheel");

    const chassisDef = elements.find((e) => e["@type"] === "PartDefinition" && e.name === "Chassis");
    assert.ok(chassisDef, "Chassis definition must exist");
    assert.strictEqual(chassisDef.isAbstract, true);

    const evDef = elements.find((e) => e["@type"] === "PartDefinition" && e.name === "ElectricVehicle");
    assert.ok(evDef, "ElectricVehicle definition must exist");
    assert.deepStrictEqual(evDef.superclasses, ["Chassis"]);

    // Verify Ports and Conjugation
    const pIn = elements.find((e) => e["@type"] === "PortUsage" && e.name === "pIn");
    assert.ok(pIn, "pIn port usage must exist");
    assert.strictEqual(pIn.attributes?.type, "PowerPort");
    assert.strictEqual(pIn.attributes?.isConjugated, undefined);

    const pOut = elements.find((e) => e["@type"] === "PortUsage" && e.name === "pOut");
    assert.ok(pOut, "pOut conjugated port usage must exist");
    assert.strictEqual(pOut.attributes?.isConjugated, true);

    // Verify Constraint
    const constraint = elements.find(
      (e) => (e["@type"] === "ConstraintUsage" || e["@type"] === "AssertConstraintUsage") && e.name === "maxMass",
    );
    assert.ok(constraint, "maxMass constraint must exist");
    assert.strictEqual(constraint.attributes?.expression, "mass <= 2000");

    // Verify Specialization relationships in graph
    assert.ok(
      relationships.some(
        (r: any) =>
          r["@type"] === "Subclassification" &&
          r.relationshipType === "specialization" &&
          r.target[0]["@id"] === "urn:sysml2:type:Chassis",
      ),
      "Specialization relationship to Chassis must exist",
    );
  });

  it("imports an OMG .sysmlx document back into valid SysML v2 source code", async () => {
    const doc = await SysML2ModelInterchange.exportToSysmlx(sampleSysml);
    const reconstructedSysml = SysML2ModelInterchange.importFromSysmlx(doc);

    // Validate textual presence of key SysML v2 constructs
    assert.ok(reconstructedSysml.includes("package VehicleSystem"), "Reconstructed code must have package");
    assert.ok(reconstructedSysml.includes("port def PowerPort"), "Must have port def PowerPort");
    assert.ok(reconstructedSysml.includes("part def Wheel"), "Must have part def Wheel");
    assert.ok(reconstructedSysml.includes("abstract part def Chassis"), "Must have abstract part def Chassis");
    assert.ok(reconstructedSysml.includes("port pIn : PowerPort"), "Must have port pIn");
    assert.ok(reconstructedSysml.includes("port pOut : ~PowerPort"), "Must have conjugated port pOut : ~PowerPort");
    assert.ok(
      reconstructedSysml.includes("part def ElectricVehicle :> Chassis"),
      "Must have ElectricVehicle :> Chassis",
    );
    assert.ok(reconstructedSysml.includes("part wheels : Wheel"), "Must have part wheels : Wheel");
    assert.ok(reconstructedSysml.includes("connection connect pIn to pOut"), "Must have connection");
    assert.ok(reconstructedSysml.includes("assert constraint maxMass { mass <= 2000 }"), "Must have constraint");
    assert.ok(reconstructedSysml.includes("satisfy RangeReq"), "Must have satisfy RangeReq");
  });

  it("verifies lossless round-trip parseability with native WASM GLR parser", async () => {
    const parser = await getSysmlParser();
    const doc = await SysML2ModelInterchange.exportToSysmlx(sampleSysml);
    const reconstructedSysml = SysML2ModelInterchange.importFromSysmlx(doc);

    // Parse reconstructed text with the real GLR parser
    const tree = parser.parse(reconstructedSysml);
    assert.ok(tree, "Parser must successfully parse reconstructed SysML v2");
    assert.ok(tree.rootNode, "Root node must be present");
    assert.strictEqual(tree.rootNode.hasError(), false, "Reconstructed SysML v2 text must have zero parse errors");

    // Second round-trip: export reconstructed -> sysmlx -> import -> parse
    const doc2 = await SysML2ModelInterchange.exportToSysmlx(reconstructedSysml);
    const reconstructedSysml2 = SysML2ModelInterchange.importFromSysmlx(doc2);
    const tree2 = parser.parse(reconstructedSysml2);
    assert.strictEqual(tree2.rootNode.hasError(), false, "Second round-trip must have zero parse errors");
  });

  it("imports synthetic third-party OMG .sysmlx document from Cameo/Papyrus", async () => {
    const parser = await getSysmlParser();
    const thirdPartyDoc: SysmlxDocument = {
      "@context": OMG_SYSML2_CONTEXT,
      metadata: {
        generator: "Dassault Cameo Systems Modeler 2024x",
        version: "2024x",
      },
      "@graph": [
        {
          "@id": "urn:uuid:pkg-1",
          "@type": "Package",
          name: "AerospacePayload",
          ownedElement: [{ "@id": "urn:uuid:def-1" }, { "@id": "urn:uuid:def-2" }],
        },
        {
          "@id": "urn:uuid:def-1",
          "@type": "PortDefinition",
          name: "TelemetryBus",
          owner: { "@id": "urn:uuid:pkg-1" },
        },
        {
          "@id": "urn:uuid:def-2",
          "@type": "PartDefinition",
          name: "OpticalPayload",
          owner: { "@id": "urn:uuid:pkg-1" },
          ownedElement: [{ "@id": "urn:uuid:usage-1" }, { "@id": "urn:uuid:usage-2" }, { "@id": "urn:uuid:conn-1" }],
        },
        {
          "@id": "urn:uuid:usage-1",
          "@type": "PortUsage",
          name: "telemetryIn",
          owner: { "@id": "urn:uuid:def-2" },
          attributes: {
            type: "TelemetryBus",
            direction: "in",
          },
        },
        {
          "@id": "urn:uuid:usage-2",
          "@type": "PortUsage",
          name: "telemetryOut",
          owner: { "@id": "urn:uuid:def-2" },
          attributes: {
            type: "TelemetryBus",
            isConjugated: true,
          },
        },
        {
          "@id": "urn:uuid:conn-1",
          "@type": "ConnectionUsage",
          name: "busBridge",
          owner: { "@id": "urn:uuid:def-2" },
          attributes: {
            source: "telemetryIn",
            target: "telemetryOut",
          },
        },
      ],
    };

    const sysmlCode = SysML2ModelInterchange.importFromSysmlx(thirdPartyDoc);
    assert.ok(sysmlCode.includes("package AerospacePayload"));
    assert.ok(sysmlCode.includes("port def TelemetryBus;"));
    assert.ok(sysmlCode.includes("part def OpticalPayload {"));
    assert.ok(sysmlCode.includes("in port telemetryIn : TelemetryBus;"));
    assert.ok(sysmlCode.includes("port telemetryOut : ~TelemetryBus;"));
    assert.ok(sysmlCode.includes("connection busBridge connect telemetryIn to telemetryOut;"));

    // Verify it parses cleanly with our GLR parser
    const tree = parser.parse(sysmlCode);
    assert.strictEqual(tree.rootNode.hasError(), false, "Third-party imported model must parse cleanly");
  });
});
