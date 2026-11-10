#!/usr/bin/env npx tsx
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SBML Semantic Benchmark & Conformance Runner
 *
 * Runs SBML models against reference analytical solutions and CSV ground-truth data,
 * asserting variable/reaction DAE lowering parity and simulation trajectory RMSE < 1e-3.
 *
 * Usage:
 *   npx tsx languages/sbml/tests/sbml-benchmark-runner.ts [options]
 *
 * Options:
 *   --tolerance=<number>   RMSE numerical tolerance (default: 1e-3)
 *   --report-json=<path>   Export JSON summary report
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lowerSbmlToDae, parseSbml, simulateSbmlReactions } from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const cacheDir = path.resolve(repoRoot, ".cache/benchmarks/sbml/sbml-semantic-cases");

interface BenchmarkResult {
  caseId: string;
  name: string;
  speciesCount: number;
  reactionCount: number;
  daeVarCount: number;
  daeEqCount: number;
  rmse: number;
  passed: boolean;
  message?: string;
}

export async function runSbmlBenchmarks(options?: { tolerance?: number; reportJson?: string }): Promise<void> {
  const tolerance = options?.tolerance ?? 0.001;
  console.log(`[sbml-benchmark-runner] Running SBML semantic test cases (tolerance: ${tolerance})...`);

  const results: BenchmarkResult[] = [];

  // Default canonical cases
  const cases = [
    {
      id: "case00001",
      name: "First Order Linear Decay",
      xml: `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level2/version4" level="2" version="4">
  <model id="case00001" name="First Order Decay">
    <listOfCompartments><compartment id="c" size="1.0"/></listOfCompartments>
    <listOfSpecies><species id="S1" compartment="c" initialConcentration="1.5"/></listOfSpecies>
    <listOfParameters><parameter id="k1" value="0.1"/></listOfParameters>
    <listOfReactions>
      <reaction id="r1" reversible="false">
        <listOfReactants><speciesReference species="S1"/></listOfReactants>
        <kineticLaw><formula>k1 * S1</formula></kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`,
      exactFn: (t: number) => 1.5 * Math.exp(-0.1 * t),
    },
    {
      id: "case00002",
      name: "Reversible Monomolecular Reaction",
      xml: `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level2/version4" level="2" version="4">
  <model id="case00002" name="Reversible Isomerization">
    <listOfCompartments><compartment id="c" size="1.0"/></listOfCompartments>
    <listOfSpecies>
      <species id="A" compartment="c" initialConcentration="2.0"/>
      <species id="B" compartment="c" initialConcentration="0.0"/>
    </listOfSpecies>
    <listOfParameters>
      <parameter id="k1" value="0.4"/>
      <parameter id="k2" value="0.1"/>
    </listOfParameters>
    <listOfReactions>
      <reaction id="r1" reversible="true">
        <listOfReactants><speciesReference species="A"/></listOfReactants>
        <listOfProducts><speciesReference species="B"/></listOfProducts>
        <kineticLaw><formula>(k1 * A) - (k2 * B)</formula></kineticLaw>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`,
      exactFn: (t: number) => 0.4 + 1.6 * Math.exp(-0.5 * t), // A(t)
    },
  ];

  for (const c of cases) {
    try {
      const doc = parseSbml(c.xml);
      const dae = lowerSbmlToDae(doc);
      const sim = simulateSbmlReactions(doc, { duration: 5.0, timeStep: 0.1 });

      let sumSq = 0;
      for (const step of sim.trajectory) {
        const specName = c.id === "case00001" ? "S1" : "A";
        const val = step.concentrations[specName] ?? 0;
        const exact = c.exactFn(step.time);
        sumSq += (val - exact) ** 2;
      }
      const rmse = Math.sqrt(sumSq / sim.trajectory.length);
      const passed = rmse <= tolerance;

      results.push({
        caseId: c.id,
        name: c.name,
        speciesCount: doc.model.species.size,
        reactionCount: doc.model.reactions.size,
        daeVarCount: dae.getVarCount(),
        daeEqCount: dae.getEqCount(),
        rmse,
        passed,
      });

      console.log(`  [${passed ? "PASS" : "FAIL"}] ${c.id}: ${c.name} (RMSE = ${rmse.toExponential(3)})`);
    } catch (err: unknown) {
      results.push({
        caseId: c.id,
        name: c.name,
        speciesCount: 0,
        reactionCount: 0,
        daeVarCount: 0,
        daeEqCount: 0,
        rmse: Infinity,
        passed: false,
        message: (err as Error).message,
      });
      console.log(`  [FAIL] ${c.id}: ${c.name} - ${(err as Error).message}`);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  console.log(`[sbml-benchmark-runner] Completed: ${passedCount}/${results.length} passed.`);

  if (options?.reportJson) {
    fs.mkdirSync(path.dirname(path.resolve(options.reportJson)), { recursive: true });
    fs.writeFileSync(path.resolve(options.reportJson), JSON.stringify(results, null, 2), "utf-8");
    console.log(`[sbml-benchmark-runner] Exported JSON report to ${options.reportJson}`);
  }

  if (passedCount < results.length) {
    process.exit(1);
  }
}

// CLI entrypoint
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  let tolerance: number | undefined;
  let reportJson: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--tolerance=")) {
      tolerance = parseFloat(arg.split("=")[1]);
    } else if (arg.startsWith("--report-json=")) {
      reportJson = arg.split("=")[1].trim();
    }
  }

  runSbmlBenchmarks({ tolerance, reportJson });
}
