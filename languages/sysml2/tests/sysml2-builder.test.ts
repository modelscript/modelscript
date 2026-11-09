// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SysMLBuilder } from "../src/builder/builder.js";
import { getSysmlParser } from "../src/factory.js";
import { OMG_SYSML2_CONTEXT } from "../src/sysmlx-interchange.js";

describe("SysML v2 Fluent Programmatic AST Builder & Unparser", () => {
  it("builds a complete hierarchical package model and unparses to valid SysML v2 text", () => {
    const pkg = SysMLBuilder.package("DronePlatform")
      .doc("High-reliability quadcopter platform specification.")
      .addImport("ScalarValues", { isAll: true })
      .addPartDef("ElectricalPowerPort", (p) => {
        p.addAttribute("voltage", "Real", 24.0, "V", { isParameter: true });
      })
      .addPartDef("Motor", (p) => {
        p.addAttribute("maxRpm", "Real", 12000, "rpm")
          .addAttribute("mass", "Real", 0.15, "kg")
          .addPort("powerIn", "ElectricalPowerPort", { direction: "in" });
      })
      .addRequirementDef("PayloadCapacityReq", (r) => {
        r.text("The drone must carry at least 2.5 kg payload under standard atmospheric conditions.")
          .assume("ambientTemperature >= -10")
          .guarantee("payloadCapacity >= 2.5");
      })
      .addPartDef("Quadcopter", (p) => {
        p.doc("Full vehicle assembly.")
          .addPart("motor1", "Motor")
          .addPart("motor2", "Motor")
          .addPart("motor3", "Motor")
          .addPart("motor4", "Motor")
          .addPort("batteryFeed", "ElectricalPowerPort", { direction: "in" })
          .addConnection("batteryFeed", "motor1.powerIn")
          .addAttribute("totalMass", "Real", 0.6, "kg")
          .addConstraint("totalMass <= 1.0", "motorMassBudget");
      });

    const source = pkg.toSource({ indent: 2, includeHeaderComment: true });
    assert.ok(source.includes("package DronePlatform {"));
    assert.ok(source.includes("part def Motor {"));
    assert.ok(source.includes("assume constraint { ambientTemperature >= -10 }"));
    assert.ok(source.includes("require constraint { payloadCapacity >= 2.5 }"));
    assert.ok(source.includes("connect batteryFeed to motor1.powerIn;"));
    assert.ok(source.includes("[kg]"));

    // Verify round-trip parsing through WASM GLR parser
    const parser = getSysmlParser();
    assert.ok(parser, "WASM parser should be loaded");
    const tree = parser.parse(source);
    const hasErr =
      typeof tree.rootNode.hasError === "function"
        ? tree.rootNode.hasError()
        : Boolean((tree.rootNode as any).hasError);
    assert.ok(!hasErr, "Generated source should have zero syntax errors in GLR parser");
  });

  it("converts builder model directly to OMG SysML v2 JSON-LD (.sysmlx) without text re-parsing", () => {
    const pkg = SysMLBuilder.package("SubseaSensor").addPartDef("PressureTransducer", (p) => {
      p.addAttribute("depthLimit", "Real", 3000, "m").addPort("dataOut", "DataPort", { direction: "out" });
    });

    const doc = pkg.toSysmlx();
    assert.equal(doc["@context"], OMG_SYSML2_CONTEXT);
    assert.ok(Array.isArray(doc["@graph"]));
    assert.ok(doc["@graph"].length >= 2);

    const pkgElem = doc["@graph"].find((e) => "name" in e && e.name === "SubseaSensor");
    assert.ok(pkgElem, "Package element should be present in JSON-LD graph");
    assert.equal(pkgElem["@type"], "Package");

    const partElem = doc["@graph"].find((e) => "name" in e && e.name === "PressureTransducer");
    assert.ok(partElem, "Part definition element should be present in JSON-LD graph");
    assert.equal(partElem["@type"], "PartDefinition");
  });

  it("supports standalone definition building with inheritance and abstract modifiers", () => {
    const chassis = SysMLBuilder.partDef("VehicleChassis")
      .abstract()
      .addAttribute("structuralWeight", "Real", 450, "kg")
      .addPort("frontAxleMount", "MountPort");

    const sportsChassis = SysMLBuilder.partDef("SportsChassis")
      .inherits("VehicleChassis")
      .addAttribute("carbonFiberContentRatio", "Real", 0.65);

    const chassisSrc = chassis.toSource({ includeHeaderComment: false });
    const sportsSrc = sportsChassis.toSource({ includeHeaderComment: false });

    assert.ok(chassisSrc.includes("abstract part def VehicleChassis {"));
    assert.ok(sportsSrc.includes("part def SportsChassis :> VehicleChassis {"));
  });
});
