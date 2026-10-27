// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SbmlCommand } from "../src/commands/sbml.js";

const CLI_SBML_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level2/version4" level="2" version="4">
  <model id="CliTestPathway" name="Glycolytic Step Test">
    <listOfCompartments>
      <compartment id="cytosol" size="1.0"/>
    </listOfCompartments>
    <listOfSpecies>
      <species id="A" compartment="cytosol" initialConcentration="5.0"/>
      <species id="B" compartment="cytosol" initialConcentration="0.0"/>
    </listOfSpecies>
    <listOfParameters>
      <parameter id="k_fwd" value="0.4"/>
    </listOfParameters>
    <listOfReactions>
      <reaction id="Reaction1" reversible="false">
        <listOfReactants>
          <speciesReference species="A" stoichiometry="1"/>
        </listOfReactants>
        <listOfProducts>
          <speciesReference species="B" stoichiometry="1"/>
        </listOfProducts>
        <kineticLaw>
          <formula>k_fwd * A</formula>
        </kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`;

test("SBML CLI Commands (msx sbml inspect, lint, simulate, to-dae, to-modelica)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_sbml_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const modelFile = path.join(tmpDir, "pathway.sbml");
  fs.writeFileSync(modelFile, CLI_SBML_MODEL, "utf-8");

  await t.test("msx sbml inspect / summary", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SbmlCommand.handler as any)({
        action: "inspect",
        files: [modelFile],
      });
      assert.ok(logs.some((l) => l.includes("SBML Model Summary")));
      assert.ok(logs.some((l) => l.includes("CliTestPathway")));
      assert.ok(logs.some((l) => l.includes("Species:        2")));
      assert.ok(logs.some((l) => l.includes("Reaction1")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx sbml lint", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SbmlCommand.handler as any)({
        action: "lint",
        files: [modelFile],
      });
      assert.ok(logs.some((l) => l.includes("passed all pre-flight checks")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx sbml simulate", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SbmlCommand.handler as any)({
        action: "simulate",
        files: [modelFile],
        duration: 5.0,
      });
      assert.ok(logs.some((l) => l.includes("Biochemical Simulation Results")));
      assert.ok(logs.some((l) => l.includes("Time Steps Solved:")));
      assert.ok(logs.some((l) => l.includes("[A]:")));
      assert.ok(logs.some((l) => l.includes("[B]:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx sbml to-dae", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      await (SbmlCommand.handler as any)({
        action: "to-dae",
        files: [modelFile],
      });
      assert.ok(logs.some((l) => l.includes("Lowered DAE Summary")));
      assert.ok(logs.some((l) => l.includes("Variables:")));
      assert.ok(logs.some((l) => l.includes("Equations:")));
    } finally {
      console.log = origLog;
    }
  });

  await t.test("msx sbml to-modelica", async () => {
    const outFile = path.join(tmpDir, "pathway.mo");

    await (SbmlCommand.handler as any)({
      action: "to-modelica",
      files: [modelFile],
      out: outFile,
    });

    assert.ok(fs.existsSync(outFile));
    const mo = fs.readFileSync(outFile, "utf-8");
    assert.ok(mo.includes("model pathway"));
    assert.ok(mo.includes("Real S_A"));
    assert.ok(mo.includes("der(S_A)"));
    assert.ok(mo.includes("end pathway;"));
  });

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
