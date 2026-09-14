// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { describe, it } from "node:test";
import { BrownfieldAlignmentEngine, type AlignmentElement } from "../src/brownfield_alignment.js";
import { DigitalThreadHypergraph, ThreadDomain } from "../src/thread_hypergraph.js";

describe("Brownfield Seed Alignment & Trigram Matching Engine", () => {
  const engine = new BrownfieldAlignmentEngine();

  describe("Domain Acronym & Abbreviation Expansion", () => {
    it("should expand common mechanical & electrical engineering acronyms", () => {
      const tokens1 = engine.tokenizeAndNormalize("Mtr_Assy_01");
      assert.deepStrictEqual(tokens1, ["motor", "assembly", "01"]);

      const tokens2 = engine.tokenizeAndNormalize("SpdSensBrkt");
      assert.deepStrictEqual(tokens2, ["speed", "sensor", "bracket"]);

      const tokens3 = engine.tokenizeAndNormalize("Batt_Pack_Ctrl");
      assert.deepStrictEqual(tokens3, ["battery", "pack", "controller"]);

      const tokens4 = engine.tokenizeAndNormalize("Hyd_Pmp_Vlv");
      assert.deepStrictEqual(tokens4, ["hydraulic", "pump", "valve"]);
    });

    it("should allow registering custom domain acronyms", () => {
      const customEngine = new BrownfieldAlignmentEngine();
      customEngine.registerAcronym("ecu", "electronic control unit");
      const tokens = customEngine.tokenizeAndNormalize("Primary_ECU");
      assert.ok(tokens.includes("electronic control unit"));
    });
  });

  describe("Trigram String Similarity", () => {
    it("should compute high trigram Dice similarity for matching root words", () => {
      const simExact = engine.computeTrigramSimilarity("electricmotor", "electricmotor");
      assert.strictEqual(simExact, 1.0);

      const simHigh = engine.computeTrigramSimilarity("motor", "motorassembly");
      assert.ok(simHigh > 0.4, `Expected simHigh > 0.4, got ${simHigh}`);

      const simLow = engine.computeTrigramSimilarity("bracket", "radiator");
      assert.ok(simLow < 0.2, `Expected simLow < 0.2, got ${simLow}`);
    });
  });

  describe("Multi-Signal Model Alignment", () => {
    const cadParts: AlignmentElement[] = [
      {
        id: "cad_01",
        name: "Mtr_Assy_01",
        domain: ThreadDomain.CAD,
        type: "CADPart",
        ports: ["flange_shaft", "pwr_cable"],
      },
      {
        id: "cad_02",
        name: "Brkt_Mount_L",
        domain: ThreadDomain.CAD,
        type: "CADPart",
        ports: ["bolt_holes"],
      },
      {
        id: "cad_03",
        name: "Spd_Sens_Wheel",
        domain: ThreadDomain.CAD,
        type: "CADPart",
        ports: ["signal_wire"],
      },
    ];

    const modelicaComponents: AlignmentElement[] = [
      {
        id: "mo_01",
        name: "electricMotor",
        domain: ThreadDomain.Modelica,
        type: "ModelicaComponent",
        ports: ["flange_a", "electrical_terminal"],
      },
      {
        id: "mo_02",
        name: "mountingBracket",
        domain: ThreadDomain.Modelica,
        type: "ModelicaComponent",
        ports: ["frame_a"],
      },
      {
        id: "mo_03",
        name: "wheelSpeedSensor",
        domain: ThreadDomain.Modelica,
        type: "ModelicaComponent",
        ports: ["signal_out"],
      },
      {
        id: "mo_04",
        name: "coolingRadiator",
        domain: ThreadDomain.Modelica,
        type: "ModelicaComponent",
      },
    ];

    it("should correlate CAD parts with Modelica components using multi-signal scoring", () => {
      const candidates = engine.alignModels(cadParts, modelicaComponents, {
        minConfidence: 0.6,
      });

      assert.ok(candidates.length >= 3);

      // Verify Motor match
      const motorMatch = candidates.find((c) => c.sourceName === "Mtr_Assy_01" && c.targetName === "electricMotor");
      assert.ok(motorMatch, "Expected Mtr_Assy_01 to match electricMotor");
      assert.ok(motorMatch!.confidence >= 0.7, `Expected motor confidence >= 0.7, got ${motorMatch!.confidence}`);
      assert.ok(motorMatch!.reasoning.includes("Shared semantic tokens"));

      // Verify Bracket match
      const bracketMatch = candidates.find(
        (c) => c.sourceName === "Brkt_Mount_L" && c.targetName === "mountingBracket",
      );
      assert.ok(bracketMatch, "Expected Brkt_Mount_L to match mountingBracket");
      assert.ok(bracketMatch!.confidence >= 0.7, `Expected bracket confidence >= 0.7, got ${bracketMatch!.confidence}`);

      // Verify Speed Sensor match
      const sensorMatch = candidates.find(
        (c) => c.sourceName === "Spd_Sens_Wheel" && c.targetName === "wheelSpeedSensor",
      );
      assert.ok(sensorMatch, "Expected Spd_Sens_Wheel to match wheelSpeedSensor");
      assert.ok(sensorMatch!.confidence >= 0.7, `Expected sensor confidence >= 0.7, got ${sensorMatch!.confidence}`);
    });

    it("should automatically seed high-confidence alignments into DigitalThreadHypergraph", () => {
      const candidates = engine.alignModels(cadParts, modelicaComponents, {
        minConfidence: 0.65,
      });

      const hypergraph = new DigitalThreadHypergraph();
      const result = engine.applySeeds(candidates, hypergraph, {
        minConfidence: 0.7,
        threadIdStart: 5000,
      });

      assert.ok(result.seededCount >= 3, `Expected at least 3 seeded matches, got ${result.seededCount}`);
      assert.ok(result.threadsCreated >= 3, `Expected at least 3 threads created, got ${result.threadsCreated}`);
      assert.strictEqual(hypergraph.getThreadCount(), result.threadsCreated);

      // Inspect created threads
      for (let s = 0; s < hypergraph.getThreadCount(); s++) {
        const rec = hypergraph.getRecord(s);
        assert.ok(rec);
        assert.ok(rec!.isSynced);
        // Both CAD (domain 2) and Modelica (domain 1) should be bound
        assert.ok((rec!.domainMask & (1 << ThreadDomain.CAD)) !== 0);
        assert.ok((rec!.domainMask & (1 << ThreadDomain.Modelica)) !== 0);
      }
    });

    it("should format candidate alignments into a readable terminal table", () => {
      const candidates = engine.alignModels(cadParts, modelicaComponents, { minConfidence: 0.65 });
      const table = engine.formatCandidatesTable(candidates);

      assert.ok(table.includes("Source Element"));
      assert.ok(table.includes("Target Element"));
      assert.ok(table.includes("Confidence"));
      assert.ok(table.includes("Mtr_Assy_01"));
      assert.ok(table.includes("electricMotor"));
    });
  });
});
