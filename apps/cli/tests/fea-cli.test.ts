// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { FeaCommand } from "../src/commands/fea.js";

const SAMPLE_INP_DECK = `*HEADING
Bracket Linear Elasticity Benchmark
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
3, 2.0, 0.0, 0.0
4, 0.0, 1.0, 0.0
5, 1.0, 1.0, 0.0
6, 2.0, 1.0, 0.0
7, 0.0, 0.0, 1.0
8, 1.0, 0.0, 1.0
*ELEMENT, TYPE=C3D8, ELSET=BRACKET_ELEMS
1, 1, 2, 5, 4, 7, 8, 6, 3
*NSET, NSET=FIXED_NODES
1, 4, 7
*MATERIAL, NAME=TITANIUM
*ELASTIC
110000000000.0, 0.34
*DENSITY
4430.0
*SOLID SECTION, ELSET=BRACKET_ELEMS, MATERIAL=TITANIUM
*BOUNDARY
FIXED_NODES, 1, 3, 0.0
*CLOAD
3, 2, -2000.0
`;

test("FEA CLI Commands (msx fea inspect, lint, to-dae, to-modelica, solve)", async (t) => {
  const tmpDir = path.resolve(process.cwd(), "data/scratch_fea_cli");
  fs.mkdirSync(tmpDir, { recursive: true });

  const inpFile = path.join(tmpDir, "bracket.inp");
  fs.writeFileSync(inpFile, SAMPLE_INP_DECK, "utf-8");

  await t.test("msx fea inspect / summary", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (FeaCommand.handler as any)({
        action: "inspect",
        files: [inpFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("FEA STRUCTURAL SUMMARY"));
      assert.ok(combined.includes("TITANIUM"));
      assert.ok(combined.includes("Mesh Nodes      : 8"));
    } finally {
      process.stdout.write = origWrite;
    }
  });

  await t.test("msx fea lint", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    const origExitCode = process.exitCode;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (FeaCommand.handler as any)({
        action: "lint",
        files: [inpFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("No pre-flight diagnostics found"));
    } finally {
      process.stdout.write = origWrite;
      process.exitCode = origExitCode;
    }
  });

  await t.test("msx fea to-dae", async () => {
    const daeOut = path.join(tmpDir, "fea_dae.json");
    await (FeaCommand.handler as any)({
      action: "to-dae",
      files: [inpFile],
      out: daeOut,
    });

    assert.ok(fs.existsSync(daeOut), "DAE metadata file should be created");
    const json = JSON.parse(fs.readFileSync(daeOut, "utf-8"));
    assert.ok(json.variables >= 10);
    assert.ok(json.equations >= 5);
  });

  await t.test("msx fea to-modelica", async () => {
    const moOut = path.join(tmpDir, "bracket.mo");
    await (FeaCommand.handler as any)({
      action: "to-modelica",
      files: [inpFile],
      out: moOut,
    });

    assert.ok(fs.existsSync(moOut), "Modelica file should be generated");
    const code = fs.readFileSync(moOut, "utf-8");
    assert.ok(code.includes("model"));
    assert.ok(code.includes("tipDisplacement"));
  });

  await t.test("msx fea solve", async () => {
    const outputs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      outputs.push(String(chunk));
      return true;
    };

    try {
      await (FeaCommand.handler as any)({
        action: "solve",
        files: [inpFile],
      });
      const combined = outputs.join("");
      assert.ok(combined.includes("FEA LINEAR ELASTICITY SOLVER"));
      assert.ok(combined.includes("Mesh Nodes"));
      assert.ok(combined.includes("Max Nodal Displacement"));
      assert.ok(combined.includes("LINEAR EQUILIBRIUM SOLVED"));
    } finally {
      process.stdout.write = origWrite;
    }
  });
});
