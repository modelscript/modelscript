// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { parseSourceToPolyglotNode } from "../src/commands/polyglot.js";

describe("Polyglot CLI Command Suite (`msx polyglot`)", () => {
  const scratchDir = path.resolve(import.meta.dirname, "scratch_polyglot");
  const cliPath = path.resolve(import.meta.dirname, "../src/main.ts");
  const tsxBin = path.resolve(import.meta.dirname, "../../../node_modules/.bin/tsx");

  // Setup scratch fixtures
  if (!fs.existsSync(scratchDir)) {
    fs.mkdirSync(scratchDir, { recursive: true });
  }

  const sampleMoPath = path.join(scratchDir, "DroneMotor.mo");
  const sampleSysmlPath = path.join(scratchDir, "FlightController.sysml");
  const sampleScadPath = path.join(scratchDir, "PropellerGuard.scad");

  fs.writeFileSync(
    sampleMoPath,
    `model DroneMotor
  parameter Real torque = 2.5;
  parameter Real maxRpm = 12000.0;
  Real voltage;
  Real current;
equation
  torque = 0.05 * current;
end DroneMotor;`,
    "utf-8",
  );

  fs.writeFileSync(
    sampleSysmlPath,
    `package FlightControl {
  part def FlightController {
    attribute sampleRate: Real = 500.0;
    attribute isFailsafeActive: Boolean = false;
    port telemetryPort: Real;
  }
}`,
    "utf-8",
  );

  fs.writeFileSync(
    sampleScadPath,
    `// Parametric Propeller Guard
outer_radius = 135.0;
wall_thickness = 3.2;

module PropellerGuard() {
  cylinder(r = outer_radius, h = wall_thickness);
  cube([outer_radius * 2, outer_radius * 2, wall_thickness]);
}

PropellerGuard();`,
    "utf-8",
  );

  it("should correctly parse Modelica source into PolyglotNode", () => {
    const node = parseSourceToPolyglotNode(sampleMoPath);
    assert.strictEqual(node.name, "DroneMotor");
    assert.ok(node.attributes && node.attributes.length >= 2);
    const torqueAttr = node.attributes.find((a) => a.name === "torque");
    assert.ok(torqueAttr);
    assert.strictEqual(torqueAttr.value, "2.5");
  });

  it("should correctly parse SysML v2 source into PolyglotNode", () => {
    const node = parseSourceToPolyglotNode(sampleSysmlPath);
    assert.strictEqual(node.name, "FlightController");
    assert.ok(node.attributes && node.attributes.length >= 1);
    const rateAttr = node.attributes.find((a) => a.name === "sampleRate");
    assert.ok(rateAttr);
    assert.strictEqual(rateAttr.value, "500.0");
  });

  it("should correctly parse OpenSCAD source into PolyglotNode", () => {
    const node = parseSourceToPolyglotNode(sampleScadPath);
    assert.strictEqual(node.name, "PropellerGuard");
    assert.ok(node.attributes && node.attributes.length >= 2);
    const rAttr = node.attributes.find((a) => a.name === "outer_radius");
    assert.ok(rAttr);
    assert.strictEqual(rAttr.value, "135.0");
    assert.ok(node.components && node.components.length >= 2);
  });

  it("should execute `msx polyglot verify` across all 8 polyglot domains", () => {
    const stdout = execFileSync(tsxBin, [cliPath, "polyglot", "verify"], {
      encoding: "utf-8",
      timeout: 60000,
    });
    assert.ok(stdout.includes("ModelScript Polyglot TGG Formal Confluence"));
    assert.ok(stdout.includes("Modelica"));
    assert.ok(stdout.includes("SysML v2"));
    assert.ok(stdout.includes("OpenSCAD"));
    assert.ok(stdout.includes("STEP CAD"));
    assert.ok(stdout.includes("Total Registered Rules"));
    assert.ok(stdout.includes("Formal confluence and bidirectional consistency verified successfully"));
  });

  it("should project Modelica model to SysML v2 via CLI `msx polyglot project`", () => {
    const outPath = path.join(scratchDir, "DroneMotor_Projected.sysml");
    const stdout = execFileSync(
      tsxBin,
      [cliPath, "polyglot", "project", sampleMoPath, "--target=sysml2", `--out=${outPath}`],
      { encoding: "utf-8", timeout: 30000 },
    );
    assert.ok(stdout.includes("✔ Projected"));
    assert.ok(fs.existsSync(outPath));

    const generated = fs.readFileSync(outPath, "utf-8");
    assert.ok(generated.includes("part def DroneMotor"));
    assert.ok(generated.includes("attribute torque: Real = 2.5;"));
  });

  it("should project SysML v2 to OWL 2 ontology via CLI `msx polyglot project`", () => {
    const outPath = path.join(scratchDir, "FlightController_Projected.owl");
    const stdout = execFileSync(
      tsxBin,
      [cliPath, "polyglot", "project", sampleSysmlPath, "--target=owl2", `--out=${outPath}`],
      { encoding: "utf-8", timeout: 30000 },
    );
    assert.ok(stdout.includes("✔ Projected"));
    assert.ok(fs.existsSync(outPath));

    const generated = fs.readFileSync(outPath, "utf-8");
    assert.ok(generated.includes("Declaration(Class(:FlightController))"));
    assert.ok(generated.includes("DataPropertyAssertion(:has_sampleRate"));
  });

  it("should project OpenSCAD to STEP CAD via CLI `msx polyglot project`", () => {
    const outPath = path.join(scratchDir, "PropellerGuard_Projected.step");
    const stdout = execFileSync(
      tsxBin,
      [cliPath, "polyglot", "project", sampleScadPath, "--target=step", `--out=${outPath}`],
      { encoding: "utf-8", timeout: 30000 },
    );
    assert.ok(stdout.includes("✔ Projected"));
    assert.ok(fs.existsSync(outPath));

    const generated = fs.readFileSync(outPath, "utf-8");
    assert.ok(generated.includes("ISO-10303-21"));
    assert.ok(generated.includes("PRODUCT('PropellerGuard'"));
  });

  it("should project Modelica to CSV parameter specs via CLI `msx polyglot project`", () => {
    const outPath = path.join(scratchDir, "DroneMotor_Specs.csv");
    const stdout = execFileSync(
      tsxBin,
      [cliPath, "polyglot", "project", sampleMoPath, "--target=csv", `--out=${outPath}`],
      { encoding: "utf-8", timeout: 30000 },
    );
    assert.ok(stdout.includes("✔ Projected"));
    assert.ok(fs.existsSync(outPath));

    const generated = fs.readFileSync(outPath, "utf-8");
    assert.ok(generated.includes("Name,Type,Value,Category"));
    assert.ok(generated.includes("torque,Real,2.5,attribute"));
  });

  it("should inspect digital thread alignment graph via `msx polyglot thread`", () => {
    const stdout = execFileSync(tsxBin, [cliPath, "polyglot", "thread", sampleMoPath], {
      encoding: "utf-8",
      timeout: 60000,
    });
    assert.ok(stdout.includes("Digital Thread Alignment for 'DroneMotor.mo'"));
    assert.ok(stdout.includes("Primary Node:   DroneMotor"));
    assert.ok(stdout.includes("SysML v2:"));
    assert.ok(stdout.includes("Modelica:"));
    assert.ok(stdout.includes("CAD (STEP):"));
    assert.ok(stdout.includes("Requirements:"));
    assert.ok(stdout.includes("SYNCHRONIZED"));
  });

  // Clean up scratch dir
  it("should clean up scratch test artifacts", () => {
    fs.rmSync(scratchDir, { recursive: true, force: true });
    assert.strictEqual(fs.existsSync(scratchDir), false);
  });
});
