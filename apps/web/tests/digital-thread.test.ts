// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkUnitParity, computeDigitalThreadMetrics, extractDigitalThreadTwins } from "../src/util/digitalThread";

describe("Digital Thread Twin Explorer & Unit Parity Engine", () => {
  describe("Physical Quantity Parity Checking (checkUnitParity)", () => {
    it("returns compatible for identical units", () => {
      const res = checkUnitParity("rad/s", "rad/s");
      assert.equal(res.status, "compatible");
      assert.equal(res.factor, 1.0);
    });

    it("handles dimensionless and empty unit pairs", () => {
      const res = checkUnitParity(undefined, undefined);
      assert.equal(res.status, "compatible");
      assert.match(res.message, /dimensionless/i);
    });

    it("normalizes dot and multiplication notations (e.g., N.m ⟷ N*m)", () => {
      const res = checkUnitParity("N.m", "N*m");
      assert.equal(res.status, "compatible");
      assert.equal(res.factor, 1.0);
    });

    it("verifies torque to work/energy equivalency (N.m ⟷ kg.m2/s2)", () => {
      const res = checkUnitParity("N.m", "kg.m2/s2");
      assert.equal(res.status, "compatible");
      assert.match(res.message, /torque/i);
    });

    it("supports angular velocity compatibility across inverse seconds (1/s ⟷ rad/s)", () => {
      const res = checkUnitParity("1/s", "rad/s");
      assert.equal(res.status, "compatible");
    });

    it("converts RPM to rad/s with correct scaling factor", () => {
      const res = checkUnitParity("rpm", "rad/s");
      assert.equal(res.status, "compatible");
      assert.ok(res.factor && Math.abs(res.factor - 0.104719755) < 1e-6);
    });

    it("scales mass units correctly between grams and kilograms", () => {
      const gToKg = checkUnitParity("g", "kg");
      assert.equal(gToKg.status, "compatible");
      assert.equal(gToKg.factor, 0.001);

      const kgToG = checkUnitParity("kg", "g");
      assert.equal(kgToG.status, "compatible");
      assert.equal(kgToG.factor, 1000);
    });

    it("flags incompatible physical dimensions with diagnostic message", () => {
      const res = checkUnitParity("kg", "m/s");
      assert.equal(res.status, "incompatible");
      assert.match(res.message, /mismatch/i);
    });
  });

  describe("Digital Thread Twin Extraction (extractDigitalThreadTwins)", () => {
    it("extracts twins from Modelica component twin modifier and verifies parity", () => {
      const rootClass = {
        name: "DroneMotor",
        components: [
          {
            component_name: "rotorSpeed",
            type_name: "Real",
            description: "Motor output velocity",
            modifiers: [
              { modifier_name: "twin", modifier_value: "FlightCtrl.rotorCommand" },
              { modifier_name: "unit", modifier_value: "rad/s" },
            ],
          },
        ],
      } as any;

      const twins = extractDigitalThreadTwins("AeroDrone", "1.0.0", [], rootClass, []);

      assert.equal(twins.length, 1);
      assert.equal(twins[0].source.domain, "modelica");
      assert.equal(twins[0].target.domain, "sysml2");
      assert.equal(twins[0].target.name, "FlightCtrl.rotorCommand");
      assert.equal(twins[0].parity.status, "compatible");
    });

    it("extracts CAD bindings from CAD annotations and associates STEP viewer path", () => {
      const rootClass = {
        name: "ChassisAssembly",
        components: [
          {
            component_name: "frameStructure",
            type_name: "CADAssembly",
            description: "Chassis frame",
            modifiers: [{ modifier_name: "CAD", modifier_value: "cad://models/frame.step" }],
          },
        ],
      } as any;

      const artifactViewers = [
        {
          id: "step-1",
          path: "models/frame.step",
          displayName: "Frame STEP 3D",
          viewerType: "cad" as const,
        },
      ];

      const twins = extractDigitalThreadTwins("AeroDrone", "1.0.0", [], rootClass, artifactViewers);

      assert.equal(twins.length, 1);
      assert.equal(twins[0].relationship, "cad-binding");
      assert.equal(twins[0].source.domain, "modelica");
      assert.equal(twins[0].target.domain, "cad");
      assert.equal(twins[0].cadViewerConfig?.url, "models/frame.step");
    });

    it("cross-correlates polyglot package STEP files and SysML v2 definitions", () => {
      const classes = [
        {
          id: 1,
          class_name: "Propeller",
          class_kind: "modelica-model",
        },
      ];

      const artifactViewers = [
        {
          id: "step-prop",
          path: "cad/propeller.step",
          displayName: "Propeller Geometry",
          viewerType: "cad" as const,
        },
        {
          id: "sysml-prop",
          path: "sysml/propeller.sysml",
          displayName: "Propeller Specs",
          viewerType: "sysml" as const,
        },
      ];

      const twins = extractDigitalThreadTwins("AeroDrone", "1.0.0", classes as any, null, artifactViewers);

      assert.equal(twins.length, 2);
      const cadTwin = twins.find((t) => t.target.domain === "cad");
      const sysmlTwin = twins.find((t) => t.target.domain === "sysml2");

      assert.ok(cadTwin);
      assert.equal(cadTwin.source.name, "Propeller");
      assert.ok(sysmlTwin);
      assert.equal(sysmlTwin.relationship, "implements");
    });
  });

  describe("Digital Thread Metrics (computeDigitalThreadMetrics)", () => {
    it("computes totals, compatible counts, and parity rate percentages", () => {
      const mockTwins = [
        {
          id: "1",
          relationship: "twin" as const,
          source: { domain: "modelica" as const, name: "Motor", kind: "Class" },
          target: { domain: "sysml2" as const, name: "MotorReq", kind: "Part" },
          parity: { status: "compatible" as const, sourceUnit: "rad/s", targetUnit: "rad/s", message: "ok" },
        },
        {
          id: "2",
          relationship: "cad-binding" as const,
          source: { domain: "modelica" as const, name: "Gear", kind: "Class" },
          target: { domain: "cad" as const, name: "gear.step", kind: "Step" },
          parity: { status: "compatible" as const, sourceUnit: "m", targetUnit: "m", message: "ok" },
        },
        {
          id: "3",
          relationship: "twin" as const,
          source: { domain: "modelica" as const, name: "Sensor", kind: "Class" },
          target: { domain: "sysml2" as const, name: "SensorSpec", kind: "Part" },
          parity: { status: "incompatible" as const, sourceUnit: "V", targetUnit: "A", message: "mismatch" },
        },
      ];

      const metrics = computeDigitalThreadMetrics(mockTwins);
      assert.equal(metrics.total, 3);
      assert.equal(metrics.compatible, 2);
      assert.equal(metrics.cadBindings, 1);
      assert.equal(metrics.sysmlAlignments, 2);
      assert.equal(metrics.parityRate, 67); // 2/3 = 66.67% -> 67%
    });

    it("handles empty twins list gracefully", () => {
      const metrics = computeDigitalThreadMetrics([]);
      assert.equal(metrics.total, 0);
      assert.equal(metrics.compatible, 0);
      assert.equal(metrics.cadBindings, 0);
      assert.equal(metrics.sysmlAlignments, 0);
      assert.equal(metrics.parityRate, 100);
    });
  });
});
